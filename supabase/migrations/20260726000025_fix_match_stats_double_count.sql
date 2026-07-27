-- =============================================================================
-- Migration: drop the orphaned update_match_stats trigger — it double-counts
-- every ranked match
--
-- FOUND BY: comparing a probe user's users.matches_played (12) against the
-- real row count in public.matches for that player (6) after 6 real
-- settlements — exactly 2x, not a rounding artifact.
--
-- ROOT CAUSE: migration 2 created update_match_stats(), a trigger on
-- `after insert on public.matches` that increments matches_played,
-- matches_won, and lifetime_winnings_cents, and inserts two rows into
-- elo_ratings_history using a nonsensical formula
-- (elo_before := elo_change_winner + elo_change_winner, i.e. a doubled Elo
-- *delta* stored as if it were an absolute rating). Migration 10/12 later
-- introduced settle_ranked_match(), which inserts into public.matches AND
-- performs its own correct, explicit matches_played/matches_won updates —
-- but the migration 2 trigger was never dropped, so it fires on the same
-- insert and double-applies every stat.
--
-- IMPACT: users.matches_played, users.matches_won, and
-- users.lifetime_winnings_cents are all exactly 2x their real values for
-- every account that has played a ranked match. These are the columns
-- public.public_players and public.leaderboard expose directly — this is a
-- user-visible correctness bug, not an internal one. elo_ratings_history
-- also fills with garbage rows (elo_before/elo_after computed from the delta,
-- not the actual rating) — currently unread anywhere in application code,
-- but wrong data left in an audit table is exactly the kind of thing that
-- looks plausible until someone reads it.
--
-- eligibility gates (check_contest_eligibility's min_ranked_matches, migration
-- 6) are NOT affected: they count real rows in public.matches directly, never
-- the cached column.
--
-- FIX: drop the trigger and its function. settle_ranked_match already owns
-- matches_played/matches_won correctly; extend it to also write a correct
-- elo_ratings_history row per player, using the before/after ratings it
-- already computes.
-- =============================================================================

drop trigger if exists update_match_stats_on_match_insert on public.matches;
drop function if exists public.update_match_stats();

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

    -- Correct replacement for the garbage rows the dropped trigger used to
    -- write: real before/after ratings, not the delta doubled and tripled.
    insert into public.elo_ratings_history (user_id, match_id, elo_before, elo_after, change)
    values (
      p_winner_id, p_match_id,
      coalesce(v_winner_elo, 1600),
      greatest(400, least(3200, coalesce(v_winner_elo, 1600) + p_elo_delta_winner)),
      p_elo_delta_winner
    );
    insert into public.elo_ratings_history (user_id, match_id, elo_before, elo_after, change)
    values (
      p_loser_id, p_match_id,
      coalesce(v_loser_elo, 1600),
      greatest(400, least(3200, coalesce(v_loser_elo, 1600) + p_elo_delta_loser)),
      p_elo_delta_loser
    );
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
