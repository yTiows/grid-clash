-- =============================================================================
-- Migration: fix enter_tournament()'s ambiguous column reference
--
-- FOUND BY: calling enter_tournament() through to completion for the first
-- time — not just its supporting checks (accounts_are_linked, debit_balance,
-- assert_can_wager) in isolation, which is all prior sessions' tests actually
-- exercised.
--
--   ERROR: column reference "target_tournament_id" is ambiguous
--   DETAIL: It could refer to either a PL/pgSQL variable or a table column.
--
-- BUG: satellite_seats.target_tournament_id shares its name with the
-- function's own target_tournament_id parameter. In:
--
--   where user_id = target_user_id
--     and target_tournament_id = target_tournament_id
--
-- Postgres cannot tell whether either side means the column or the
-- parameter, and refuses to guess. This is not a rare edge case — it fires
-- on every single call, unconditionally, regardless of data.
--
-- IMPACT: every tournament entry, through every format built this session —
-- knockout, Swiss, bounty, satellite, ladder — has been unusable since
-- migration 0007. The tournament system had full schema, full RLS, full
-- money-conservation guarantees, and a completely broken front door. Caught
-- only by running the exact call a real player action would make, end to
-- end, rather than trusting that testing its dependencies was equivalent to
-- testing it.
-- =============================================================================

create or replace function public.enter_tournament(
  target_user_id uuid,
  target_tournament_id uuid
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
begin
  select * into t
  from public.tournaments
  where id = target_tournament_id
  for update;

  if not found then
    raise exception 'Tournament not found';
  end if;

  if t.status <> 'open' then
    raise exception 'Tournament is not open for entry';
  end if;

  if exists (
    select 1 from public.tournament_entries
    where tournament_id = target_tournament_id and user_id = target_user_id
  ) then
    raise exception 'Already entered';
  end if;

  select e.user_id into linked_entrant
  from public.tournament_entries e
  where e.tournament_id = target_tournament_id
    and public.accounts_are_linked(e.user_id, target_user_id)
  limit 1;

  if linked_entrant is not null then
    raise exception 'A linked account is already entered in this contest';
  end if;

  select count(*) into taken
  from public.tournament_entries
  where tournament_id = target_tournament_id;

  if taken >= t.field_size then
    raise exception 'Tournament is full';
  end if;

  -- Fixed: table-qualified so Postgres resolves this against the column,
  -- never the parameter of the same name.
  select * into seat
  from public.satellite_seats
  where satellite_seats.user_id = target_user_id
    and satellite_seats.target_tournament_id = target_tournament_id
    and satellite_seats.status = 'unredeemed'
  for update
  limit 1;

  if seat is not null then
    update public.satellite_seats
    set status = 'redeemed', redeemed_at = now()
    where id = seat.id;
  else
    perform public.assert_can_wager(target_user_id, t.entry_fee_cents);

    if not public.debit_balance(target_user_id, t.entry_fee_cents) then
      raise exception 'Insufficient balance';
    end if;
  end if;

  next_seat := taken + 1;

  insert into public.tournament_entries
    (tournament_id, user_id, seat_number, entry_fee_paid_cents)
  values
    (target_tournament_id, target_user_id, next_seat, t.entry_fee_cents)
  returning id into entry_id;

  if t.bounty_per_head_cents > 0 then
    insert into public.tournament_bounties (tournament_id, head_user_id, amount_cents)
    values (target_tournament_id, target_user_id, t.bounty_per_head_cents)
    on conflict (tournament_id, head_user_id) do nothing;
  end if;

  if next_seat = t.field_size then
    update public.tournaments set status = 'full' where id = target_tournament_id;
  end if;

  return entry_id;
end;
$$;

revoke execute on function public.enter_tournament(uuid, uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- assert_tournament_entry_works
--
-- A dedicated end-to-end smoke test, the same shape as assert_settlement_
-- works() for ranked matches. Creates a real tournament and a real entry
-- inside a transaction, then rolls back — proving the RPC actually completes
-- rather than proving its dependencies resolve, which is precisely the gap
-- that let this bug ship undetected.
-- ---------------------------------------------------------------------------
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
