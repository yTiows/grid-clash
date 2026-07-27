-- =============================================================================
-- Migration: enter_tournament accepts an optional loyalty-points discount
--
-- Adds p_redeem_points as a DEFAULTED trailing parameter so every existing
-- caller (enterTournamentAction, assert_tournament_entry_works,
-- assert_tournament_completion_works) keeps working unchanged with a 2-arg
-- call. This function has broken three times before on seemingly-safe edits
-- (ambiguous column, wrong param name, defunct debit_balance call) — the
-- self-test at the bottom is re-run for both the zero-redemption and the
-- redemption path before this is considered done, not just re-read.
--
-- Points are debited BEFORE the (possibly-discounted) cash debit, inside the
-- same transaction as the seat insert: a failure anywhere after the points
-- debit rolls the whole thing back, so a redemption can never be spent
-- without a seat, or a seat taken without the points actually leaving the
-- balance.
--
-- NOTE: this migration's CREATE OR REPLACE turned out to define a second
-- overload rather than replace enter_tournament(uuid, uuid) in place — see
-- migration 32, found immediately by the self-test suite.
-- =============================================================================

create or replace function public.enter_tournament(
  p_user_id uuid,
  p_tournament_id uuid,
  p_redeem_points integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  taken integer;
  next_seat integer;
  entry_id uuid;
  linked_entrant uuid;
  seat record;
  v_cash_due integer;
begin
  if p_redeem_points < 0 then
    raise exception 'Points redeemed cannot be negative';
  end if;

  select * into t
  from public.tournaments
  where id = p_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;

  if t.status <> 'open' then
    raise exception 'Tournament is not open for entry';
  end if;

  if exists (
    select 1 from public.tournament_entries
    where tournament_id = p_tournament_id and user_id = p_user_id
  ) then
    raise exception 'Already entered';
  end if;

  select e.user_id into linked_entrant
  from public.tournament_entries e
  where e.tournament_id = p_tournament_id
    and public.accounts_are_linked(e.user_id, p_user_id)
  limit 1;

  if linked_entrant is not null then
    raise exception 'A linked account is already entered in this contest';
  end if;

  select count(*) into taken
  from public.tournament_entries
  where tournament_id = p_tournament_id;

  if taken >= t.field_size then
    raise exception 'Tournament is full';
  end if;

  select * into seat
  from public.satellite_seats
  where user_id = p_user_id
    and target_tournament_id = p_tournament_id
    and status = 'unredeemed'
  for update
  limit 1;

  if seat is not null then
    -- A satellite seat pays the entry outright. Points cannot double-discount
    -- an entry that already cost no cash.
    if p_redeem_points > 0 then
      raise exception 'Cannot redeem points on a seat won from a satellite';
    end if;

    update public.satellite_seats
    set status = 'redeemed', redeemed_at = now()
    where id = seat.id;
  else
    -- Discount is capped at the entry fee — points can cover an entry
    -- outright but never create a negative charge.
    v_cash_due := greatest(0, t.entry_fee_cents - p_redeem_points);

    -- Eligibility (self-exclusion, phone, age gate, jurisdiction, loss
    -- limits) always runs, even on a fully points-covered entry — a $0 cash
    -- charge is still contest entry, not an exemption from the money gate.
    -- assert_can_wager requires a positive stake; a nominal 1 cent preserves
    -- every other check when the real cash owed is zero.
    perform public.assert_can_wager(p_user_id, greatest(v_cash_due, 1));

    if p_redeem_points > 0 then
      perform public.move_loyalty_points(
        p_user_id, -p_redeem_points, 'tournament_redemption',
        'loyalty_redeem:' || p_tournament_id::text || ':' || p_user_id::text,
        null, p_tournament_id
      );
    end if;

    if v_cash_due > 0 then
      perform public.move_balance(
        p_user_id,
        -v_cash_due,
        'tournament_entry',
        'tournament_entry:' || p_tournament_id::text || ':' || p_user_id::text,
        null,
        p_tournament_id
      );
    end if;
  end if;

  next_seat := taken + 1;

  insert into public.tournament_entries
    (tournament_id, user_id, seat_number, entry_fee_paid_cents)
  values
    (p_tournament_id, p_user_id, next_seat, t.entry_fee_cents)
  returning id into entry_id;

  if t.bounty_per_head_cents > 0 then
    insert into public.tournament_bounties (tournament_id, head_user_id, amount_cents)
    values (p_tournament_id, p_user_id, t.bounty_per_head_cents)
    on conflict (tournament_id, head_user_id) do nothing;
  end if;

  if next_seat = t.field_size then
    update public.tournaments set status = 'full' where id = p_tournament_id;
  end if;

  return entry_id;
end;
$$;

revoke execute on function public.enter_tournament(uuid, uuid, integer) from anon, authenticated;

create or replace function public.assert_tournament_entry_works()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_tournament_id uuid;
  v_entry_id uuid;
begin
  select id into v_user
  from public.users
  where account_status = 'active' and phone_verified and balance_cents >= 500
  order by created_at limit 1;

  if v_user is null then
    return 'skipped: needs an active, verified user with balance >= 500';
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__probe__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_tournament_id;

  v_entry_id := public.enter_tournament(v_user, v_tournament_id);

  if v_entry_id is null then
    raise exception 'enter_tournament returned null';
  end if;

  return 'ok: tournament entry executes end to end';
end;
$$;

revoke execute on function public.assert_tournament_entry_works() from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_loyalty_redemption_works — the new path, exercised for real:
-- partial discount, full discount, and insufficient-points refusal.
-- Superseded by migration 31 (test-isolation fix) and migration 33
-- (absolute-vs-relative assertion fix) — kept here verbatim as applied so
-- the local migration history matches what actually ran, not a cleaned-up
-- rewrite of it.
-- ---------------------------------------------------------------------------
create or replace function public.assert_loyalty_redemption_works()
returns text
language plpgsql
as $$
declare
  v_user uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_cash_before integer;
  v_cash_after integer;
  v_points_before integer;
  v_points_after integer;
  v_refused boolean := false;
begin
  select id into v_user
  from public.users
  where account_status = 'active' and phone_verified
    and date_of_birth_self_attested is not null
    and balance_cents >= 2000
  order by created_at limit 1;

  if v_user is null then
    return 'skipped: needs an active, verified, funded user';
  end if;

  perform public.move_loyalty_points(v_user, 1000, 'adjustment', 'redeem_probe_seed:' || gen_random_uuid()::text);

  select balance_cents into v_points_before from public.loyalty_points where user_id = v_user;
  select balance_cents into v_cash_before from public.users where id = v_user;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_partial__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t1;

  perform public.enter_tournament(v_user, v_t1, 300);

  select balance_cents into v_points_after from public.loyalty_points where user_id = v_user;
  select balance_cents into v_cash_after from public.users where id = v_user;

  if v_points_before - v_points_after <> 300 then
    raise exception 'Expected 300 points redeemed, got %', v_points_before - v_points_after;
  end if;
  if v_cash_before - v_cash_after <> 200 then
    raise exception 'Expected 200 cents cash charged, got %', v_cash_before - v_cash_after;
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_full__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t2;

  select balance_cents into v_cash_before from public.users where id = v_user;
  perform public.enter_tournament(v_user, v_t2, 500);
  select balance_cents into v_cash_after from public.users where id = v_user;

  if v_cash_before <> v_cash_after then
    raise exception 'Fully points-covered entry should not touch cash balance: % -> %', v_cash_before, v_cash_after;
  end if;

  select balance_cents into v_points_after from public.loyalty_points where user_id = v_user;
  if v_points_after <> 200 then
    raise exception 'Expected 200 points remaining after 300+500 redeemed from 1000, got %', v_points_after;
  end if;

  begin
    perform public.enter_tournament(v_user, v_t1, 999999);
  exception when others then
    v_refused := true;
  end;
  if not v_refused then
    raise exception 'Expected insufficient-points redemption to be refused';
  end if;

  return 'ok: loyalty redemption — partial discount, full discount, and insufficient-points refusal all correct';
end;
$$;

revoke execute on function public.assert_loyalty_redemption_works() from anon, authenticated;
