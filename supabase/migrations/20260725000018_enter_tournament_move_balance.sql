-- =============================================================================
-- Migration: enter_tournament — call move_balance, not the defunct
-- debit_balance/credit_balance pair
--
-- FOUND BY: the same end-to-end probe that caught the ambiguous-column bug,
-- re-run immediately after fixing it — the next line of the same function
-- was also broken.
--
--   ERROR: function public.debit_balance(uuid, integer) does not exist
--
-- debit_balance/credit_balance (from migration 0006) were fully superseded
-- by move_balance (introduced later: idempotent via p_idempotency_key,
-- atomic check-and-write in one UPDATE avoiding the TOCTOU race a separate
-- check-then-debit would reopen, and it writes a proper ledger row with
-- reason/tournament_id context). Every other caller in the schema was
-- migrated to move_balance when it was introduced. enter_tournament was
-- not, and nothing had exercised this exact line since — the eligibility
-- checks before it, and the seat/bounty bookkeeping after it, all worked
-- and all got tested; the one line that actually moves money in the
-- no-satellite-seat path did not, and stayed broken silently.
--
-- Two real, distinct bugs in one function, both invisible to every prior
-- verification because prior verification tested this function's
-- dependencies, never the function completing end to end. That gap is
-- exactly what assert_tournament_entry_works() now closes permanently.
-- =============================================================================

create or replace function public.enter_tournament(
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

    -- move_balance raises on insufficient funds, which aborts this whole
    -- transaction — no separate boolean check needed, and no window between
    -- checking and debiting for a race to slip through.
    perform public.move_balance(
      p_user_id,
      -t.entry_fee_cents,
      'tournament_entry',
      'tournament_entry:' || p_tournament_id::text || ':' || p_user_id::text,
      null,
      p_tournament_id
    );
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
