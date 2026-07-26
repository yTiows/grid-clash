-- =============================================================================
-- Migration: enter_tournament — permanent fix via parameter rename
--
-- The previous migration's fix (table-qualifying the LEFT side of the
-- satellite_seats comparison) was insufficient and re-tested as still
-- broken: the RIGHT side of `= target_tournament_id` was still a bare
-- identifier, and Postgres considers it ambiguous against the very same
-- table column regardless of how the left side is qualified. Partial
-- qualification does not resolve a name collision — every occurrence of the
-- colliding identifier must be unambiguous, including references in later
-- statements within the same function body.
--
-- The durable fix is the one already used by every other function in this
-- schema except this one: prefix parameters with p_ so they can never
-- collide with any current or future column name, in this table or any
-- other this function ever queries. Renamed accordingly and re-verified
-- with the same end-to-end probe that caught the original bug.
-- =============================================================================

-- Postgres refuses to rename parameters via CREATE OR REPLACE FUNCTION even
-- when the type signature is unchanged ("cannot change name of input
-- parameter... Use DROP FUNCTION first") — confirmed by trying the simpler
-- path first and having it fail exactly that way. An explicit drop is
-- required, not optional, for a parameter rename.
drop function if exists public.enter_tournament(uuid, uuid);

create function public.enter_tournament(
  p_user_id uuid,
  p_tournament_id uuid
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
    update public.satellite_seats
    set status = 'redeemed', redeemed_at = now()
    where id = seat.id;
  else
    perform public.assert_can_wager(p_user_id, t.entry_fee_cents);

    if not public.debit_balance(p_user_id, t.entry_fee_cents) then
      raise exception 'Insufficient balance';
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

revoke execute on function public.enter_tournament(uuid, uuid) from anon, authenticated;

-- Rewritten to match the new parameter names.
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
