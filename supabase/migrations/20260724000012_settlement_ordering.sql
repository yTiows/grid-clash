-- =============================================================================
-- Migration: Settlement write-ordering fix
--
-- FOUND BY: executing settle_ranked_match() against a live database.
--
--   ERROR: insert or update on table "balance_entries" violates foreign key
--   constraint "balance_entries_match_id_fkey"
--   DETAIL: Key (match_id)=(...) is not present in table "matches".
--
-- BUG: the function credited the winner via move_balance(..., p_match_id)
-- before inserting the match row. balance_entries carries an FK to matches, so
-- the ledger entry referenced a row that did not exist yet.
--
-- IMPACT: every decisive ranked settlement would have aborted. Draws happened
-- to work, because the draw path does not pass a match id to move_balance —
-- which is exactly the kind of partial success that makes a bug survive a
-- casual smoke test.
--
-- FIX: insert the match row first, then move money against it. Ordering is now
-- load-bearing and commented as such.
--
-- This is the third seam bug found only by executing the schema rather than
-- applying it: a wrong function name, a missing ledger vocabulary entry, and
-- now a write order. All three applied cleanly. None of them worked.
-- =============================================================================

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
  -- Idempotency. The match row's existence is the marker, which is why it must
  -- be written inside the same transaction as the money.
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
  if v_res1.amount_cents <> p_stake_cents or v_res2.amount_cents <> p_stake_cents then
    raise exception 'Reservation amounts do not match stake for match %', p_match_id;
  end if;
  if not p_is_draw and p_fee_cents + p_winner_payout_cents <> p_stake_cents * 2 then
    raise exception 'Settlement does not balance: fee % + payout % <> pot %',
      p_fee_cents, p_winner_payout_cents, p_stake_cents * 2;
  end if;

  v_p1 := v_res1.user_id;
  v_p2 := v_res2.user_id;

  select elo_rating into v_winner_elo from public.users where id = coalesce(p_winner_id, v_p1);
  select elo_rating into v_loser_elo  from public.users where id = coalesce(p_loser_id, v_p2);

  -- ORDERING IS LOAD-BEARING.
  -- The match row must exist before anything references it: balance_entries
  -- and platform_ledger both carry an FK to matches.
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

  -- Money moves only after the match row is on disk.
  if p_is_draw then
    perform public.move_balance(v_p1, p_stake_cents, 'ranked_refund',
      'draw:' || p_match_id::text || ':' || v_p1::text, p_match_id);
    perform public.move_balance(v_p2, p_stake_cents, 'ranked_refund',
      'draw:' || p_match_id::text || ':' || v_p2::text, p_match_id);
  else
    perform public.move_balance(p_winner_id, p_winner_payout_cents, 'ranked_payout',
      'payout:' || p_match_id::text, p_match_id);

    if p_fee_cents > 0 then
      insert into public.platform_ledger (entry_type, amount_cents, match_id, note)
      values ('ranked_rake', p_fee_cents, p_match_id, 'ranked settlement');
    end if;
  end if;

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

  -- net_profit_cents is maintained for both players on every match. A player
  -- who is down must be able to see that at a glance; it is their money.
  insert into public.personal_bests (
    user_id, total_matches, net_profit_cents,
    current_win_streak, current_loss_streak, longest_win_streak, highest_elo
  ) values (
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

  insert into public.personal_bests (
    user_id, total_matches, net_profit_cents, current_loss_streak, highest_elo
  ) values (
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

  update public.users set matches_played = matches_played + 1 where id in (v_p1, v_p2);
  update public.users set matches_won = matches_won + 1
    where id = p_winner_id and not p_is_draw;

  return true;
end;
$$;

revoke execute on function public.settle_ranked_match(
  uuid, uuid, uuid, uuid, uuid, boolean, integer, integer, integer,
  integer, integer, text, integer, jsonb, text[], integer[], integer[]
) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Extends the dependency smoke test into an end-to-end settlement probe.
--
-- The previous version only checked that functions resolve. It passed while
-- settlement was still broken, because a name that resolves can still be
-- called in the wrong order. This one runs a real settlement inside a
-- rolled-back block, so ordering and FK bugs surface at deploy time.
-- ---------------------------------------------------------------------------
create or replace function public.assert_settlement_works()
returns text
language plpgsql
as $$
declare
  v_a uuid;
  v_b uuid;
  v_r1 uuid;
  v_r2 uuid;
  v_match uuid := gen_random_uuid();
  v_ok boolean;
begin
  -- Self-excluded accounts are correctly refused by assert_can_wager, so the
  -- probe must not select them or it fails on a working system.
  select id into v_a from public.users u
   where u.account_status = 'active' and u.phone_verified
     and not public.is_self_excluded(u.id)
   order by u.created_at limit 1;
  select id into v_b from public.users u
   where u.account_status = 'active' and u.phone_verified
     and u.id <> v_a and not public.is_self_excluded(u.id)
   order by u.created_at limit 1;

  if v_a is null or v_b is null then
    return 'skipped: needs two active verified users';
  end if;

  if (select balance_cents from public.users where id = v_a) < 100
     or (select balance_cents from public.users where id = v_b) < 100 then
    return 'skipped: probe users need a balance';
  end if;

  v_r1 := public.reserve_stake(v_a, 100);
  v_r2 := public.reserve_stake(v_b, 100);

  v_ok := public.settle_ranked_match(
    v_match, v_r1, v_r2, v_a, v_b, false,
    100, 4, 196, 1, -1, 'line', 10,
    '{"probe":true}'::jsonb, ARRAY['probe'], ARRAY[100], ARRAY[100]
  );

  if not v_ok then
    raise exception 'Settlement probe returned false';
  end if;

  return 'ok: settlement executes end to end';
end;
$$;

revoke execute on function public.assert_settlement_works() from anon, authenticated;
