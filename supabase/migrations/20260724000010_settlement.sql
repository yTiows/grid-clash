-- =============================================================================
-- Migration: Stake reservations and atomic match settlement
--
-- This is the seam between the match server and the ledger. Settlement touches
-- eight tables and must be all-or-nothing: a partial settlement either pays a
-- pot that was never funded or takes a stake without awarding one.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- stake_reservations
--
-- A stake is held at queue-join, not at match-found. Holding later would let
-- one balance sit in several queues and win a race it should have lost.
--
-- The reservation id is what makes refunds idempotent: a refund names a
-- specific hold rather than an amount, so a retried refund finds the hold
-- already resolved and does nothing. Refunding by (user, amount) would double
-- credit on any retry.
-- ---------------------------------------------------------------------------
create table public.stake_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  amount_cents integer not null,
  status text not null default 'held',
  match_id uuid references public.matches (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint stake_reservations_amount_check check (amount_cents > 0),
  constraint stake_reservations_status_check check (
    status in ('held', 'consumed', 'refunded')
  ),
  constraint stake_reservations_resolved_shape check (
    (status = 'held') = (resolved_at is null)
  )
);

create index stake_reservations_user_idx on public.stake_reservations (user_id);
create index stake_reservations_held_idx on public.stake_reservations (user_id)
  where status = 'held';
create index stake_reservations_match_idx on public.stake_reservations (match_id);

comment on table public.stake_reservations is
  'Held at queue-join. Terminal states only: a resolved hold can never return to held.';

-- Held is the only non-terminal state. Without this, a bug that flips a
-- consumed reservation back to held would let the same stake fund two matches.
create or replace function public.enforce_reservation_terminal()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'held' and new.status <> old.status then
    raise exception 'Reservation % is already %, cannot become %',
      old.id, old.status, new.status;
  end if;
  return new;
end;
$$;

create trigger enforce_reservation_terminal_on_update
  before update on public.stake_reservations
  for each row execute function public.enforce_reservation_terminal();

-- ---------------------------------------------------------------------------
-- reserve_stake
-- Eligibility gate, debit, and hold in one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.reserve_stake(
  p_user_id uuid,
  p_amount_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  perform public.assert_can_wager(p_user_id, p_amount_cents);

  v_reservation_id := gen_random_uuid();

  -- move_balance raises on insufficient funds, aborting the whole transaction
  -- so no hold row survives a failed debit.
  perform public.move_balance(
    p_user_id,
    -p_amount_cents,
    'ranked_entry',
    'reserve:' || v_reservation_id::text
  );

  insert into public.stake_reservations (id, user_id, amount_cents, status)
  values (v_reservation_id, p_user_id, p_amount_cents, 'held');

  return v_reservation_id;
end;
$$;

revoke execute on function public.reserve_stake(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- refund_stake
-- Idempotent by construction: the row lock plus the terminal-state check mean
-- a second call sees a resolved hold and returns false without crediting.
-- ---------------------------------------------------------------------------
create or replace function public.refund_stake(p_reservation_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res record;
begin
  select * into v_res
  from public.stake_reservations
  where id = p_reservation_id
  for update;

  if not found then
    return false;
  end if;

  if v_res.status <> 'held' then
    -- Already consumed or refunded. Not an error; retries land here.
    return false;
  end if;

  perform public.move_balance(
    v_res.user_id,
    v_res.amount_cents,
    'ranked_refund',
    'refund:' || p_reservation_id::text
  );

  update public.stake_reservations
  set status = 'refunded', resolved_at = now()
  where id = p_reservation_id;

  return true;
end;
$$;

revoke execute on function public.refund_stake(uuid) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- settle_ranked_match
--
-- One transaction covering: idempotency check, reservation consumption, match
-- row, winner payout, platform fee, Elo, stats, replay, rivalries, personal
-- bests.
--
-- Elo deltas are computed by the tested TypeScript in fees.ts and passed in,
-- so the rating formula has exactly one implementation. This function trusts
-- them because only the service role can call it.
--
-- IDEMPOTENCY: keyed on the caller-supplied match id. The match server holds an
-- in-memory settled flag, but that flag dies with the process and does not
-- exist across instances. This is the guard that actually holds.
-- ---------------------------------------------------------------------------
create or replace function public.settle_ranked_match(
  p_match_id uuid,
  p_reservation_1 uuid,
  p_reservation_2 uuid,
  p_winner_id uuid,
  p_loser_id uuid,
  p_is_draw boolean,
  p_stake_cents integer,
  p_fee_cents integer,
  p_winner_payout_cents integer,
  p_elo_delta_winner integer,
  p_elo_delta_loser integer,
  p_reason text,
  p_duration_seconds integer,
  p_replay jsonb,
  p_move_sequence text[],
  p_timings_1 integer[],
  p_timings_2 integer[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res1 record;
  v_res2 record;
  v_p1 uuid;
  v_p2 uuid;
  v_winner_elo integer;
  v_loser_elo integer;
begin
  -- Already settled. Safe to call again; returns false so the caller knows.
  if exists (select 1 from public.matches where id = p_match_id) then
    return false;
  end if;

  select * into v_res1 from public.stake_reservations where id = p_reservation_1 for update;
  select * into v_res2 from public.stake_reservations where id = p_reservation_2 for update;

  if v_res1 is null or v_res2 is null then
    raise exception 'Missing stake reservation for match %', p_match_id;
  end if;
  if v_res1.status <> 'held' or v_res2.status <> 'held' then
    raise exception 'Stake reservation already resolved for match %', p_match_id;
  end if;

  -- The pot must equal what was actually held. Settling against a different
  -- figure would pay out money nobody staked.
  if v_res1.amount_cents <> p_stake_cents or v_res2.amount_cents <> p_stake_cents then
    raise exception 'Reservation amounts do not match stake for match %', p_match_id;
  end if;
  if p_fee_cents + p_winner_payout_cents <> p_stake_cents * 2 and not p_is_draw then
    raise exception 'Settlement does not balance: fee % + payout % <> pot %',
      p_fee_cents, p_winner_payout_cents, p_stake_cents * 2;
  end if;

  v_p1 := v_res1.user_id;
  v_p2 := v_res2.user_id;

  if p_is_draw then
    -- Full refund of both stakes, no fee.
    perform public.move_balance(v_p1, p_stake_cents, 'ranked_refund',
      'draw:' || p_match_id::text || ':' || v_p1::text);
    perform public.move_balance(v_p2, p_stake_cents, 'ranked_refund',
      'draw:' || p_match_id::text || ':' || v_p2::text);
  else
    perform public.move_balance(p_winner_id, p_winner_payout_cents, 'ranked_payout',
      'payout:' || p_match_id::text, p_match_id);

    if p_fee_cents > 0 then
      insert into public.platform_ledger (entry_type, amount_cents, match_id, note)
      values ('ranked_rake', p_fee_cents, p_match_id, 'ranked settlement');
    end if;
  end if;

  select elo_rating into v_winner_elo from public.users
    where id = coalesce(p_winner_id, v_p1);
  select elo_rating into v_loser_elo from public.users
    where id = coalesce(p_loser_id, v_p2);

  insert into public.matches (
    id, player_1_id, player_2_id, winner_id, loser_id,
    entry_fee_cents, winner_payout_cents, loser_payout_cents,
    platform_rake_cents, ranked, elo_change_winner, elo_change_loser,
    duration_seconds, completed_at
  ) values (
    p_match_id, v_p1, v_p2,
    coalesce(p_winner_id, v_p1),
    coalesce(p_loser_id, v_p2),
    p_stake_cents,
    case when p_is_draw then p_stake_cents else p_winner_payout_cents end,
    case when p_is_draw then p_stake_cents else 0 end,
    case when p_is_draw then 0 else p_fee_cents end,
    true, p_elo_delta_winner, p_elo_delta_loser,
    p_duration_seconds, now()
  );

  update public.stake_reservations
  set status = 'consumed', resolved_at = now(), match_id = p_match_id
  where id in (p_reservation_1, p_reservation_2);

  if not p_is_draw then
    update public.users
    set elo_rating = greatest(400, least(3200, elo_rating + p_elo_delta_winner))
    where id = p_winner_id;

    update public.users
    set elo_rating = greatest(400, least(3200, elo_rating + p_elo_delta_loser))
    where id = p_loser_id;
  end if;

  insert into public.match_replays
    (match_id, replay_data, move_sequence, player_1_timings, player_2_timings)
  values (p_match_id, p_replay, p_move_sequence, p_timings_1, p_timings_2);

  -- Head-to-head records, both directions.
  if not p_is_draw then
    insert into public.rivalries (user_id, opponent_id, wins, losses, net_cents, last_played_at)
    values (p_winner_id, p_loser_id, 1, 0, p_winner_payout_cents - p_stake_cents, now())
    on conflict (user_id, opponent_id) do update
      set wins = public.rivalries.wins + 1,
          net_cents = public.rivalries.net_cents + (p_winner_payout_cents - p_stake_cents),
          last_played_at = now();

    insert into public.rivalries (user_id, opponent_id, wins, losses, net_cents, last_played_at)
    values (p_loser_id, p_winner_id, 0, 1, -p_stake_cents, now())
    on conflict (user_id, opponent_id) do update
      set losses = public.rivalries.losses + 1,
          net_cents = public.rivalries.net_cents - p_stake_cents,
          last_played_at = now();
  end if;

  -- Personal bests. net_profit_cents is always maintained, win or lose: a
  -- player who is down must be able to see that at a glance.
  insert into public.personal_bests (user_id, total_matches, net_profit_cents, current_win_streak,
    current_loss_streak, longest_win_streak, highest_elo)
  values (
    coalesce(p_winner_id, v_p1), 1,
    case when p_is_draw then 0 else p_winner_payout_cents - p_stake_cents end,
    case when p_is_draw then 0 else 1 end, 0,
    case when p_is_draw then 0 else 1 end,
    coalesce(v_winner_elo, 1600) + coalesce(p_elo_delta_winner, 0)
  )
  on conflict (user_id) do update set
    total_matches = public.personal_bests.total_matches + 1,
    net_profit_cents = public.personal_bests.net_profit_cents
      + case when p_is_draw then 0 else p_winner_payout_cents - p_stake_cents end,
    current_win_streak = case when p_is_draw then public.personal_bests.current_win_streak
                              else public.personal_bests.current_win_streak + 1 end,
    current_loss_streak = case when p_is_draw then public.personal_bests.current_loss_streak else 0 end,
    longest_win_streak = greatest(
      public.personal_bests.longest_win_streak,
      case when p_is_draw then public.personal_bests.current_win_streak
           else public.personal_bests.current_win_streak + 1 end
    ),
    highest_elo = greatest(public.personal_bests.highest_elo,
      coalesce(v_winner_elo, 1600) + coalesce(p_elo_delta_winner, 0)),
    updated_at = now();

  insert into public.personal_bests (user_id, total_matches, net_profit_cents,
    current_loss_streak, highest_elo)
  values (
    coalesce(p_loser_id, v_p2), 1,
    case when p_is_draw then 0 else -p_stake_cents end,
    case when p_is_draw then 0 else 1 end,
    coalesce(v_loser_elo, 1600)
  )
  on conflict (user_id) do update set
    total_matches = public.personal_bests.total_matches + 1,
    net_profit_cents = public.personal_bests.net_profit_cents
      + case when p_is_draw then 0 else -p_stake_cents end,
    current_loss_streak = case when p_is_draw then public.personal_bests.current_loss_streak
                               else public.personal_bests.current_loss_streak + 1 end,
    current_win_streak = case when p_is_draw then public.personal_bests.current_win_streak else 0 end,
    updated_at = now();

  update public.users
  set matches_played = matches_played + 1
  where id in (v_p1, v_p2);

  update public.users
  set matches_won = matches_won + 1
  where id = p_winner_id and not p_is_draw;

  return true;
end;
$$;

revoke execute on function public.settle_ranked_match(
  uuid, uuid, uuid, uuid, uuid, boolean, integer, integer, integer,
  integer, integer, text, integer, jsonb, text[], integer[], integer[]
) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- reconcile_orphan_reservations
--
-- A hold whose match never started leaves money out of a player's balance.
-- The match server refunds on disconnect, but a crash between reserve and
-- match-start leaves an orphan no in-process handler will ever see.
--
-- Run on a schedule. Anything held longer than the cutoff is refunded.
-- ---------------------------------------------------------------------------
create or replace function public.reconcile_orphan_reservations(
  p_older_than interval default interval '30 minutes'
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.stake_reservations
    where status = 'held' and created_at < now() - p_older_than
    for update skip locked
  loop
    if public.refund_stake(v_row.id) then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.reconcile_orphan_reservations(interval) from anon, authenticated;

alter table public.stake_reservations enable row level security;
create policy "stake_reservations_select_own" on public.stake_reservations
  for select to authenticated using (auth.uid() = user_id);
grant select on public.stake_reservations to authenticated;
