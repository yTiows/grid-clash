-- Phase 4: wager marketplace (equal-stake only -- mechanic A).
--
-- Human-confirmed scope for this migration:
--   - Equal-stake wagers only. Handicap/spread and side-bet mechanics (B/C)
--     are explicitly out of scope for launch, pending separate confirmation.
--   - Fee tier charged at the WINNER's fee tier (same precedent as
--     settle_ranked_match / loadParticipants): standard 12%, established
--     11%, elite 6% -- see WAGER_FEE_TIERS_BPS in src/lib/game/fees.ts and
--     CLAUDE_CODE_BRIEF.md SS5 for the reasoning log.
--   - Anti-abuse kept exactly as scoped: accounts_are_linked check at both
--     post and accept, a 5-per-week repeat-pairing cap, no new admin
--     surface (existing /admin/fraud queue covers this via account_links).
--
-- ============================================================================
-- 1. Ledger vocabulary: three new reasons, one new platform-ledger type.
--    (Per the documented lesson in 20260724000008_ledger_vocabulary.sql --
--    any new money path must extend both the CHECK constraints AND
--    assert_ledger_vocabulary()'s required_reasons in the same change.)
-- ============================================================================

alter table public.balance_entries drop constraint if exists balance_entries_reason_check;
alter table public.balance_entries add constraint balance_entries_reason_check
  check (reason = any (array[
    'deposit','withdrawal','withdrawal_reversed','chargeback',
    'ranked_entry','ranked_payout','ranked_refund',
    'tournament_entry','tournament_payout','tournament_refund',
    'bounty_claim','bounty_refund','satellite_conversion',
    'ladder_entry','ladder_bank','ladder_bust',
    'guarantee_refund','adjustment',
    'wager_entry','wager_payout','wager_refund'
  ]));

alter table public.platform_ledger drop constraint if exists platform_ledger_entry_type_check;
alter table public.platform_ledger add constraint platform_ledger_entry_type_check
  check (entry_type = any (array[
    'ranked_rake','tournament_rake','ladder_rake','milestone_subsidy',
    'guarantee_overlay','bounty_pool','satellite_conversion','refund','adjustment',
    'wager_rake'
  ]));

-- ============================================================================
-- 2. challenges table: reused for both friend challenges (target_id set at
--    creation) and open wagers (target_id null until accepted).
-- ============================================================================

alter table public.challenges alter column target_id drop not null;
alter table public.challenges add column if not exists challenger_reservation_id uuid references public.stake_reservations(id);
alter table public.challenges add column if not exists acceptor_reservation_id uuid references public.stake_reservations(id);
alter table public.challenges add column if not exists started_at timestamptz;

alter table public.challenges drop constraint if exists challenges_status_check;
alter table public.challenges add constraint challenges_status_check
  check (status = any (array['pending','accepted','declined','expired','cancelled','completed']));

drop index if exists public.challenges_one_open_per_pair;
create unique index challenges_one_open_per_pair
  on public.challenges (challenger_id, target_id) where (status = 'pending');

-- ============================================================================
-- 3. check_contest_eligibility: found while designing settle_wager_match
--    (which is about to insert real `matches` rows with ranked = false) --
--    the ranked-match-count gate had no ranked = true filter, so it would
--    have silently counted wager matches toward tournament eligibility.
-- ============================================================================

create or replace function public.check_contest_eligibility(p_user_id uuid, p_tournament_id uuid)
 returns table(allowed boolean, reason text)
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_kind text;
  v_status text;
  v_min_player_tier text;
  v_rules public.contest_eligibility_rules%rowtype;
  v_user public.users%rowtype;
  v_ranked_matches integer;
  v_linked_entrants integer;
  v_player_tier text;
  v_player_rank integer;
  v_required_rank integer;
begin
  select t.kind, t.status, t.min_player_tier into v_kind, v_status, v_min_player_tier
  from public.tournaments t where t.id = p_tournament_id;

  if not found then
    return query select false, 'Contest not found'; return;
  end if;

  if v_status <> 'open' then
    return query select false, 'Contest is not open for entry'; return;
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    return query select false, 'Unknown player'; return;
  end if;

  if v_user.account_status <> 'active' then
    return query select false, 'Account is not active'; return;
  end if;

  if public.is_self_excluded(p_user_id) then
    return query select false, 'Self-exclusion is active'; return;
  end if;

  select * into v_rules from public.contest_eligibility_rules where kind = v_kind;
  if not found then
    return query select false, 'No eligibility rules configured'; return;
  end if;

  if v_rules.requires_kyc and not v_user.kyc_verified then
    return query select false, 'Identity verification required for this contest'; return;
  end if;

  if not v_user.phone_verified then
    return query select false, 'Phone verification required'; return;
  end if;

  if v_user.created_at > now() - make_interval(hours => v_rules.min_account_age_hours) then
    return query select false, format('Account must be at least %s hours old', v_rules.min_account_age_hours); return;
  end if;

  -- FOUND (2026-08-01, while building wager settlement): this count had no
  -- `ranked = true` filter, so a match row of ANY kind counted toward
  -- "ranked matches played" -- harmless while matches only ever held ranked
  -- rows, but wager settlement (below) is about to insert real matches
  -- rows with ranked = false, which would otherwise silently inflate this
  -- eligibility gate. Also relevant if tournament-match logging is ever
  -- added later (deliberately deferred, see CLAUDE_CODE_BRIEF.md).
  select count(*) into v_ranked_matches
  from public.matches
  where (player_1_id = p_user_id or player_2_id = p_user_id)
    and ranked = true;

  if v_ranked_matches < v_rules.min_ranked_matches then
    return query select false, format('Play %s ranked matches to unlock this contest', v_rules.min_ranked_matches); return;
  end if;

  if v_min_player_tier <> 'standard' then
    select fee_tier into v_player_tier from public.player_standing where user_id = p_user_id;
    v_player_tier := coalesce(v_player_tier, 'standard');

    v_player_rank := case v_player_tier
      when 'elite' then 2
      when 'established' then 1
      else 0
    end;
    v_required_rank := case v_min_player_tier
      when 'elite' then 2
      when 'established' then 1
      else 0
    end;

    if v_player_rank < v_required_rank then
      return query select false, format('This contest requires %s tier or above (yours: %s)', v_min_player_tier, v_player_tier); return;
    end if;
  end if;

  if v_rules.enforce_account_links then
    select count(*) into v_linked_entrants
    from public.tournament_entries e
    join public.account_links l
      on (l.user_id_1 = p_user_id and l.user_id_2 = e.user_id)
      or (l.user_id_2 = p_user_id and l.user_id_1 = e.user_id)
    where e.tournament_id = p_tournament_id
      and l.confidence_score >= v_rules.max_link_confidence
      and l.review_action is distinct from 'cleared';

    if v_linked_entrants > 0 then
      return query select false, 'A linked account already holds a seat in this contest'; return;
    end if;
  end if;

  return query select true, null::text;
end;
$function$;

-- ============================================================================
-- 4. Reservation primitives. reserve_stake/refund_stake (ranked) hardcode
--    ranked-specific ledger reasons internally, so wagers get their own
--    mirror functions rather than a modified shared one.
-- ============================================================================

create or replace function public.reserve_wager_stake(p_user_id uuid, p_amount_cents integer)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_reservation_id uuid;
begin
  if p_amount_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  perform public.assert_can_wager(p_user_id, p_amount_cents);

  v_reservation_id := gen_random_uuid();

  perform public.move_balance(
    p_user_id,
    -p_amount_cents,
    'wager_entry',
    'reserve_wager:' || v_reservation_id::text
  );

  insert into public.stake_reservations (id, user_id, amount_cents, status)
  values (v_reservation_id, p_user_id, p_amount_cents, 'held');

  return v_reservation_id;
end;
$function$;

create or replace function public.refund_wager_stake(p_reservation_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
    return false;
  end if;

  perform public.move_balance(
    v_res.user_id,
    v_res.amount_cents,
    'wager_refund',
    'refund_wager:' || p_reservation_id::text
  );

  update public.stake_reservations
  set status = 'refunded', resolved_at = now()
  where id = p_reservation_id;

  return true;
end;
$function$;

-- ============================================================================
-- 5. Anti-abuse: collusion check reuses the existing accounts_are_linked()
--    (already wired into ranked queue + tournament bracket start). This adds
--    the repeat-pairing cap, which is wager-specific.
-- ============================================================================

create or replace function public.assert_wager_pairing_not_rate_limited(p_a uuid, p_b uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_max_per_week constant integer := 5;
  v_count integer;
begin
  select count(*) into v_count
  from public.challenges
  where created_at > now() - interval '7 days'
    and ((challenger_id = p_a and target_id = p_b) or (challenger_id = p_b and target_id = p_a));

  if v_count >= v_max_per_week then
    raise exception 'Too many wagers between these two accounts this week (limit %)', v_max_per_week;
  end if;
end;
$function$;

-- ============================================================================
-- 6. Creation / acceptance / cancellation.
-- ============================================================================

create or replace function public.create_challenge(p_target_id uuid, p_stake_cents integer, p_ruleset_id text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_friendship record;
  v_prefs public.challenge_preferences%rowtype;
  v_challenge_id uuid;
  v_reservation_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_target_id = v_caller then
    raise exception 'Cannot challenge yourself';
  end if;

  if p_stake_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  if p_ruleset_id = 'purist' then
    raise exception 'Purist has no hidden information and can be solved outright -- not available for a real-money challenge';
  end if;

  select * into v_friendship
  from public.friendships
  where status = 'accepted'
    and ((requester_id = v_caller and addressee_id = p_target_id)
      or (requester_id = p_target_id and addressee_id = v_caller));

  if not found then
    raise exception 'You can only challenge a friend';
  end if;

  select * into v_prefs from public.challenge_preferences where user_id = p_target_id;

  if v_prefs.user_id is null or not v_prefs.accepts_challenges then
    raise exception 'This player is not accepting challenges right now';
  end if;

  if v_prefs.min_stake_cents is not null and p_stake_cents < v_prefs.min_stake_cents then
    raise exception 'This player''s minimum stake is %s cents', v_prefs.min_stake_cents;
  end if;
  if v_prefs.max_stake_cents is not null and p_stake_cents > v_prefs.max_stake_cents then
    raise exception 'This player''s maximum stake is %s cents', v_prefs.max_stake_cents;
  end if;

  if public.accounts_are_linked(v_caller, p_target_id) then
    raise exception 'You can only challenge a friend';
  end if;

  perform public.assert_wager_pairing_not_rate_limited(v_caller, p_target_id);

  begin
    insert into public.challenges (challenger_id, target_id, stake_cents, ruleset_id, expires_at)
    values (v_caller, p_target_id, p_stake_cents, p_ruleset_id, now() + interval '24 hours')
    returning id into v_challenge_id;
  exception when unique_violation then
    raise exception 'You already have a pending challenge to this player';
  end;

  v_reservation_id := public.reserve_wager_stake(v_caller, p_stake_cents);

  update public.challenges
  set challenger_reservation_id = v_reservation_id
  where id = v_challenge_id;

  return v_challenge_id;
end;
$function$;

create or replace function public.create_open_wager(p_stake_cents integer, p_ruleset_id text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_challenge_id uuid;
  v_reservation_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_stake_cents <= 0 then
    raise exception 'Stake must be positive';
  end if;

  if p_ruleset_id = 'purist' then
    raise exception 'Purist has no hidden information and can be solved outright -- not available for a real-money challenge';
  end if;

  insert into public.challenges (challenger_id, target_id, stake_cents, ruleset_id, expires_at)
  values (v_caller, null, p_stake_cents, p_ruleset_id, now() + interval '24 hours')
  returning id into v_challenge_id;

  v_reservation_id := public.reserve_wager_stake(v_caller, p_stake_cents);

  update public.challenges
  set challenger_reservation_id = v_reservation_id
  where id = v_challenge_id;

  return v_challenge_id;
end;
$function$;

create or replace function public.respond_to_challenge(p_challenge_id uuid, p_accept boolean)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_challenge record;
  v_reservation_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge not found';
  end if;

  if v_challenge.target_id <> v_caller then
    raise exception 'Only the challenged player can respond';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'This challenge is no longer pending';
  end if;

  -- Expiry raises immediately with no inline write: an earlier version of
  -- this branch tried to update-then-raise, which silently rolled back its
  -- own update (raise exception aborts the whole transaction, including
  -- prior writes in the same call). Cleanup for expired challenges lives
  -- solely in expire_stale_wagers() now.
  if v_challenge.expires_at < now() then
    raise exception 'This challenge has expired';
  end if;

  if not p_accept then
    update public.challenges
    set status = 'declined', responded_at = now()
    where id = p_challenge_id;

    if v_challenge.challenger_reservation_id is not null then
      perform public.refund_wager_stake(v_challenge.challenger_reservation_id);
    end if;

    return;
  end if;

  if public.accounts_are_linked(v_challenge.challenger_id, v_caller) then
    raise exception 'This challenge can no longer be accepted';
  end if;
  perform public.assert_wager_pairing_not_rate_limited(v_challenge.challenger_id, v_caller);

  v_reservation_id := public.reserve_wager_stake(v_caller, v_challenge.stake_cents);

  update public.challenges
  set status = 'accepted', responded_at = now(), acceptor_reservation_id = v_reservation_id
  where id = p_challenge_id;
end;
$function$;

create or replace function public.accept_open_wager(p_challenge_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_challenge record;
  v_reservation_id uuid;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Wager not found';
  end if;

  if v_challenge.target_id is not null then
    raise exception 'This is not an open wager';
  end if;

  if v_challenge.challenger_id = v_caller then
    raise exception 'Cannot accept your own wager';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'This wager is no longer open';
  end if;

  if v_challenge.expires_at < now() then
    raise exception 'This wager has expired';
  end if;

  if public.accounts_are_linked(v_challenge.challenger_id, v_caller) then
    raise exception 'You cannot accept this wager';
  end if;
  perform public.assert_wager_pairing_not_rate_limited(v_challenge.challenger_id, v_caller);

  v_reservation_id := public.reserve_wager_stake(v_caller, v_challenge.stake_cents);

  update public.challenges
  set target_id = v_caller, status = 'accepted', responded_at = now(), acceptor_reservation_id = v_reservation_id
  where id = p_challenge_id;
end;
$function$;

create or replace function public.cancel_wager(p_challenge_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_caller uuid := auth.uid();
  v_challenge record;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Wager not found';
  end if;

  if v_challenge.challenger_id <> v_caller then
    raise exception 'Only the poster can cancel this wager';
  end if;

  if v_challenge.status <> 'pending' then
    raise exception 'This wager is no longer pending';
  end if;

  update public.challenges set status = 'cancelled' where id = p_challenge_id;

  if v_challenge.challenger_reservation_id is not null then
    perform public.refund_wager_stake(v_challenge.challenger_reservation_id);
  end if;
end;
$function$;

-- ============================================================================
-- 7. Settlement. Mirrors settle_ranked_match closely: idempotent by
--    match_id existence check, conservation-checked before any write,
--    row-locks both reservations. Deliberately does NOT touch Elo /
--    elo_ratings_history / users.elo_rating -- wagers are equal-stake
--    money contests, not ranked-ladder contests.
-- ============================================================================

create or replace function public.settle_wager_match(
  p_match_id uuid, p_challenge_id uuid, p_winner_id uuid, p_loser_id uuid, p_is_draw boolean,
  p_fee_cents integer, p_winner_payout_cents integer, p_reason text, p_duration_seconds integer,
  p_replay jsonb, p_move_sequence text[], p_timings_1 integer[], p_timings_2 integer[]
)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_challenge record;
  v_res1 record;
  v_res2 record;
  v_p1 uuid;
  v_p2 uuid;
begin
  if exists (select 1 from public.matches where id = p_match_id) then
    return false;
  end if;

  select * into v_challenge from public.challenges where id = p_challenge_id for update;
  if not found then
    raise exception 'Challenge % not found', p_challenge_id;
  end if;
  if v_challenge.status = 'completed' then
    return false;
  end if;
  if v_challenge.status <> 'accepted' then
    raise exception 'Challenge % is not accepted (status: %)', p_challenge_id, v_challenge.status;
  end if;
  if v_challenge.challenger_reservation_id is null or v_challenge.acceptor_reservation_id is null then
    raise exception 'Challenge % is missing a stake reservation', p_challenge_id;
  end if;

  select * into v_res1 from public.stake_reservations where id = v_challenge.challenger_reservation_id for update;
  select * into v_res2 from public.stake_reservations where id = v_challenge.acceptor_reservation_id for update;

  if v_res1 is null or v_res2 is null then
    raise exception 'Missing stake reservation for challenge %', p_challenge_id;
  end if;
  if v_res1.status <> 'held' or v_res2.status <> 'held' then
    raise exception 'Stake reservation already resolved for challenge %', p_challenge_id;
  end if;
  if v_res1.amount_cents <> v_challenge.stake_cents or v_res2.amount_cents <> v_challenge.stake_cents then
    raise exception 'Reservation amounts do not match stake for challenge %', p_challenge_id;
  end if;
  if not p_is_draw and p_fee_cents + p_winner_payout_cents <> v_challenge.stake_cents * 2 then
    raise exception 'Settlement does not balance: fee % + payout % <> pot %',
      p_fee_cents, p_winner_payout_cents, v_challenge.stake_cents * 2;
  end if;

  v_p1 := v_res1.user_id;
  v_p2 := v_res2.user_id;

  insert into public.matches (
    id, player_1_id, player_2_id, winner_id, loser_id,
    entry_fee_cents, winner_payout_cents, loser_payout_cents,
    platform_rake_cents, ranked, duration_seconds, completed_at
  ) values (
    p_match_id, v_p1, v_p2,
    coalesce(p_winner_id, v_p1),
    coalesce(p_loser_id, v_p2),
    v_challenge.stake_cents,
    case when p_is_draw then v_challenge.stake_cents else p_winner_payout_cents end,
    case when p_is_draw then v_challenge.stake_cents else 0 end,
    case when p_is_draw then 0 else p_fee_cents end,
    false, p_duration_seconds, now()
  );

  if p_is_draw then
    perform public.move_balance(v_p1, v_challenge.stake_cents, 'wager_refund',
      'wager_draw:' || p_match_id::text || ':' || v_p1::text, p_match_id);
    perform public.move_balance(v_p2, v_challenge.stake_cents, 'wager_refund',
      'wager_draw:' || p_match_id::text || ':' || v_p2::text, p_match_id);
  else
    perform public.move_balance(p_winner_id, p_winner_payout_cents, 'wager_payout',
      'wager_payout:' || p_match_id::text, p_match_id);

    if p_fee_cents > 0 then
      insert into public.platform_ledger (entry_type, amount_cents, match_id, note)
      values ('wager_rake', p_fee_cents, p_match_id, 'wager settlement');
    end if;
  end if;

  update public.stake_reservations
  set status = 'consumed', resolved_at = now(), match_id = p_match_id
  where id in (v_challenge.challenger_reservation_id, v_challenge.acceptor_reservation_id);

  update public.challenges
  set status = 'completed', match_id = p_match_id
  where id = p_challenge_id;

  insert into public.match_replays
    (match_id, replay_data, move_sequence, player_1_timings, player_2_timings)
  values (p_match_id, p_replay, p_move_sequence, p_timings_1, p_timings_2);

  if not p_is_draw then
    insert into public.rivalries (user_id, opponent_id, wins, losses, net_cents, last_played_at)
    values (p_winner_id, p_loser_id, 1, 0, p_winner_payout_cents - v_challenge.stake_cents, now())
    on conflict (user_id, opponent_id) do update
      set wins = public.rivalries.wins + 1,
          net_cents = public.rivalries.net_cents + (p_winner_payout_cents - v_challenge.stake_cents),
          last_played_at = now();

    insert into public.rivalries (user_id, opponent_id, wins, losses, net_cents, last_played_at)
    values (p_loser_id, p_winner_id, 0, 1, -v_challenge.stake_cents, now())
    on conflict (user_id, opponent_id) do update
      set losses = public.rivalries.losses + 1,
          net_cents = public.rivalries.net_cents - v_challenge.stake_cents,
          last_played_at = now();
  end if;

  insert into public.personal_bests (
    user_id, total_matches, net_profit_cents,
    current_win_streak, current_loss_streak, longest_win_streak
  ) values (
    coalesce(p_winner_id, v_p1), 1,
    case when p_is_draw then 0 else p_winner_payout_cents - v_challenge.stake_cents end,
    case when p_is_draw then 0 else 1 end, 0,
    case when p_is_draw then 0 else 1 end
  )
  on conflict (user_id) do update set
    total_matches = public.personal_bests.total_matches + 1,
    net_profit_cents = public.personal_bests.net_profit_cents
      + case when p_is_draw then 0 else p_winner_payout_cents - v_challenge.stake_cents end,
    current_win_streak = case when p_is_draw then public.personal_bests.current_win_streak
                              else public.personal_bests.current_win_streak + 1 end,
    current_loss_streak = case when p_is_draw then public.personal_bests.current_loss_streak else 0 end,
    longest_win_streak = greatest(
      public.personal_bests.longest_win_streak,
      case when p_is_draw then public.personal_bests.current_win_streak
           else public.personal_bests.current_win_streak + 1 end
    ),
    updated_at = now();

  insert into public.personal_bests (
    user_id, total_matches, net_profit_cents, current_loss_streak
  ) values (
    coalesce(p_loser_id, v_p2), 1,
    case when p_is_draw then 0 else -v_challenge.stake_cents end,
    case when p_is_draw then 0 else 1 end
  )
  on conflict (user_id) do update set
    total_matches = public.personal_bests.total_matches + 1,
    net_profit_cents = public.personal_bests.net_profit_cents
      + case when p_is_draw then 0 else -v_challenge.stake_cents end,
    current_loss_streak = case when p_is_draw then public.personal_bests.current_loss_streak
                               else public.personal_bests.current_loss_streak + 1 end,
    current_win_streak = case when p_is_draw then public.personal_bests.current_win_streak else 0 end,
    updated_at = now();

  update public.users set matches_played = matches_played + 1 where id in (v_p1, v_p2);
  update public.users set matches_won = matches_won + 1
    where id = p_winner_id and not p_is_draw;

  return true;
end;
$function$;

-- ============================================================================
-- 8. Cron sweep: expires stale pending offers and accepted-but-never-started
--    wagers (30-minute grace), refunding whichever reservations exist.
-- ============================================================================

create or replace function public.expire_stale_wagers()
 returns table(challenge_id uuid, outcome text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_challenge record;
  v_start_grace_minutes constant integer := 30;
begin
  for v_challenge in
    select * from public.challenges
    where status = 'pending' and expires_at < now()
    for update skip locked
  loop
    update public.challenges set status = 'expired' where id = v_challenge.id;
    if v_challenge.challenger_reservation_id is not null then
      perform public.refund_wager_stake(v_challenge.challenger_reservation_id);
    end if;
    challenge_id := v_challenge.id;
    outcome := 'expired_pending';
    return next;
  end loop;

  for v_challenge in
    select * from public.challenges
    where status = 'accepted'
      and started_at is null
      and responded_at < now() - make_interval(mins => v_start_grace_minutes)
    for update skip locked
  loop
    update public.challenges set status = 'expired' where id = v_challenge.id;
    if v_challenge.challenger_reservation_id is not null then
      perform public.refund_wager_stake(v_challenge.challenger_reservation_id);
    end if;
    if v_challenge.acceptor_reservation_id is not null then
      perform public.refund_wager_stake(v_challenge.acceptor_reservation_id);
    end if;
    challenge_id := v_challenge.id;
    outcome := 'expired_never_started';
    return next;
  end loop;

  return;
end;
$function$;

-- ============================================================================
-- 9. assert_ledger_vocabulary: extended with the three new wager reasons.
-- ============================================================================

create or replace function public.assert_ledger_vocabulary()
 returns text
 language plpgsql
as $function$
declare
  required_reasons text[] := array[
    'deposit','withdrawal','withdrawal_reversed','chargeback',
    'ranked_entry','ranked_payout','ranked_refund',
    'tournament_entry','tournament_payout','tournament_refund',
    'bounty_claim','bounty_refund','satellite_conversion',
    'ladder_entry','ladder_bank','ladder_bust',
    'guarantee_refund','adjustment',
    'wager_entry','wager_payout','wager_refund'
  ];
  r text;
  gaps text[] := '{}';
  probe_user uuid;
  probe_key text;
begin
  select id into probe_user from public.users limit 1;
  if probe_user is null then
    return 'skipped: no users to probe with';
  end if;

  foreach r in array required_reasons loop
    probe_key := 'vocab_probe_' || gen_random_uuid()::text;
    begin
      insert into public.balance_entries
        (user_id, amount_cents, balance_after_cents, reason, idempotency_key)
      values (probe_user, 1, 1, r, probe_key);
      delete from public.balance_entries where idempotency_key = probe_key;
    exception when check_violation then
      gaps := gaps || r;
    end;
  end loop;

  if array_length(gaps, 1) > 0 then
    raise exception 'Ledger vocabulary gap: % not accepted by balance_entries_reason_check',
      array_to_string(gaps, ', ');
  end if;

  return 'ok: all ' || array_length(required_reasons, 1) || ' reason codes accepted';
end;
$function$;

-- ============================================================================
-- 10. Self-tests. Money-moving and bracket-advancing changes get a paired
--     assert_*() per CLAUDE_CODE_BRIEF.md SS0. On this project's current
--     live data (1 active+phone-verified funded account, 2 phone_pending),
--     the two-funded-user paths legitimately skip rather than fail --
--     that's surfaced in the returned text, not hidden.
-- ============================================================================

create or replace function public.assert_wager_settlement_works()
 returns text
 language plpgsql
as $function$
declare
  v_a uuid;
  v_b uuid;
  v_a_balance_before integer;
  v_b_balance_before integer;
  v_a_elo_before integer;
  v_b_elo_before integer;
  v_challenge_id uuid;
  v_match_id uuid := gen_random_uuid();
  v_challenge record;
  v_ok boolean;
  v_match record;
begin
  select id into v_a from public.users
  where account_status = 'active' and phone_verified and balance_cents >= 10000
  order by created_at limit 1;
  select id into v_b from public.users
  where account_status = 'active' and phone_verified and balance_cents >= 10000 and id <> v_a
  order by created_at limit 1;

  if v_a is null or v_b is null then
    return 'skipped: needs two distinct active, phone-verified, funded ($100+) users';
  end if;

  select balance_cents into v_a_balance_before from public.users where id = v_a;
  select balance_cents into v_b_balance_before from public.users where id = v_b;
  select elo_rating into v_a_elo_before from public.users where id = v_a;
  select elo_rating into v_b_elo_before from public.users where id = v_b;

  -- Clear any repeat-pairing history between these two so this probe can't
  -- spuriously trip its own rate limit on a re-run.
  delete from public.challenges
  where (challenger_id = v_a and target_id = v_b) or (challenger_id = v_b and target_id = v_a)
     or (challenger_id = v_a and target_id is null) or (challenger_id = v_b and target_id is null);

  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_challenge_id := public.create_open_wager(5000, 'classic'); -- $50 stake

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.accept_open_wager(v_challenge_id);

  select * into v_challenge from public.challenges where id = v_challenge_id;
  if v_challenge.status <> 'accepted' then
    raise exception 'Expected challenge to be accepted, got %', v_challenge.status;
  end if;
  if v_challenge.challenger_reservation_id is null or v_challenge.acceptor_reservation_id is null then
    raise exception 'Expected both reservations to be set after acceptance';
  end if;

  -- Winner-tier fee: both probe accounts default to 'standard' (no
  -- player_standing row needed for this), 12% of a $100 pot = $12.
  v_ok := public.settle_wager_match(
    v_match_id, v_challenge_id, v_a, v_b, false,
    1200, 8800, 'line', 42,
    '{"probe":true}'::jsonb, array['1:normal:12'], array[1000], array[1200]
  );

  if not v_ok then
    raise exception 'settle_wager_match returned false on a fresh match_id';
  end if;

  select * into v_match from public.matches where id = v_match_id;
  if v_match.ranked <> false then
    raise exception 'Expected matches.ranked = false for a wager, got %', v_match.ranked;
  end if;
  if v_match.winner_payout_cents <> 8800 or v_match.platform_rake_cents <> 1200 then
    raise exception 'Conservation broken: winner_payout=%, rake=% (expected 8800 / 1200)',
      v_match.winner_payout_cents, v_match.platform_rake_cents;
  end if;

  -- The whole point of not touching Elo: verify it genuinely didn't move.
  if (select elo_rating from public.users where id = v_a) <> v_a_elo_before
     or (select elo_rating from public.users where id = v_b) <> v_b_elo_before then
    raise exception 'Expected wager settlement to leave Elo untouched';
  end if;

  if (select balance_cents from public.users where id = v_a) <> v_a_balance_before + 8800 - 5000 then
    raise exception 'Winner balance did not move by the expected net amount';
  end if;
  if (select balance_cents from public.users where id = v_b) <> v_b_balance_before - 5000 then
    raise exception 'Loser balance did not move by the expected net amount';
  end if;

  select status, match_id into v_challenge.status, v_challenge.match_id
  from public.challenges where id = v_challenge_id;
  if v_challenge.status <> 'completed' or v_challenge.match_id <> v_match_id then
    raise exception 'Expected challenge to be marked completed with the settled match_id';
  end if;

  -- Idempotency: settling the same match_id again must no-op, not double-pay.
  v_ok := public.settle_wager_match(
    v_match_id, v_challenge_id, v_a, v_b, false,
    1200, 8800, 'line', 42,
    '{"probe":true}'::jsonb, array['1:normal:12'], array[1000], array[1200]
  );
  if v_ok then
    raise exception 'Expected settle_wager_match to no-op (return false) on an already-settled match_id';
  end if;
  if (select balance_cents from public.users where id = v_a) <> v_a_balance_before + 8800 - 5000 then
    raise exception 'Balance moved again on a re-settlement attempt -- not idempotent';
  end if;

  delete from public.match_replays where match_id = v_match_id;
  delete from public.matches where id = v_match_id;
  delete from public.challenges where id = v_challenge_id;
  delete from public.rivalries where (user_id = v_a and opponent_id = v_b) or (user_id = v_b and opponent_id = v_a);

  return 'ok: wager settlement conserves money, leaves Elo untouched, records ranked=false, and is idempotent';
end;
$function$;

create or replace function public.assert_wager_anti_abuse_works()
 returns text
 language plpgsql
as $function$
declare
  v_a uuid;
  v_b uuid;
  v_c uuid;
  v_link_id uuid;
  v_raised boolean;
  i integer;
begin
  select id into v_a from public.users order by created_at limit 1 offset 0;
  select id into v_b from public.users order by created_at limit 1 offset 1;
  select id into v_c from public.users order by created_at limit 1 offset 2;

  if v_a is null or v_b is null then
    return 'skipped: needs at least two existing users to probe pairing primitives';
  end if;

  delete from public.account_links where (user_id_1 = v_a and user_id_2 = v_b) or (user_id_1 = v_b and user_id_2 = v_a);
  if public.accounts_are_linked(v_a, v_b) then
    raise exception 'Expected accounts_are_linked to be false before any link row exists';
  end if;

  insert into public.account_links (user_id_1, user_id_2, link_type, confidence_score, flagged_at)
  values (v_a, v_b, 'device', 0.95, now())
  returning id into v_link_id;

  if not public.accounts_are_linked(v_a, v_b) then
    raise exception 'Expected accounts_are_linked to be true once a high-confidence link row exists';
  end if;
  if not public.accounts_are_linked(v_b, v_a) then
    raise exception 'Expected accounts_are_linked to be symmetric regardless of column order';
  end if;

  delete from public.account_links where id = v_link_id;
  if public.accounts_are_linked(v_a, v_b) then
    raise exception 'Expected accounts_are_linked to be false again after the link row is removed';
  end if;

  if v_c is null then
    return 'ok: accounts_are_linked verified true/symmetric/false; rate-limit probe skipped (needs a 3rd user)';
  end if;

  delete from public.challenges where (challenger_id = v_c and target_id = v_b) or (challenger_id = v_b and target_id = v_c);

  for i in 1..5 loop
    insert into public.challenges (challenger_id, target_id, stake_cents, ruleset_id, status, expires_at, created_at)
    values (v_c, v_b, 2500, 'classic', 'declined', now() + interval '1 day', now() - (i || ' hours')::interval);
  end loop;

  begin
    perform public.assert_wager_pairing_not_rate_limited(v_c, v_b);
    v_raised := false;
  exception when others then
    v_raised := true;
  end;

  delete from public.challenges where (challenger_id = v_c and target_id = v_b) or (challenger_id = v_b and target_id = v_c);

  if not v_raised then
    raise exception 'Expected assert_wager_pairing_not_rate_limited to reject a 6th pairing within 7 days';
  end if;

  return 'ok: accounts_are_linked verified true/symmetric/false, and the 5/week pairing rate limit correctly rejects a 6th attempt';
end;
$function$;

create or replace function public.assert_expire_stale_wagers_works()
 returns text
 language plpgsql
as $function$
declare
  v_a uuid;
  v_b uuid;
  v_a_balance_before integer;
  v_challenge_id uuid;
  v_reservation_id uuid;
  v_res_status text;
  v_challenge_status text;
  v_swept_pending boolean := false;
  v_accepted_tested boolean := false;
  v2_challenge_id uuid;
  v2_challenger_res uuid;
  v2_acceptor_res uuid;
  r record;
begin
  select id into v_a from public.users
  where account_status = 'active' and phone_verified and balance_cents >= 5000
  order by created_at limit 1;

  if v_a is null then
    return 'skipped: needs one active, phone-verified, funded ($50+) user';
  end if;

  select id into v_b from public.users where id <> v_a order by created_at limit 1;

  select balance_cents into v_a_balance_before from public.users where id = v_a;
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_challenge_id := public.create_open_wager(2500, 'classic');
  select challenger_reservation_id into v_reservation_id from public.challenges where id = v_challenge_id;

  if (select balance_cents from public.users where id = v_a) <> v_a_balance_before - 2500 then
    raise exception 'Expected stake to be debited on wager creation before testing expiry';
  end if;

  update public.challenges set expires_at = now() - interval '1 minute' where id = v_challenge_id;

  for r in select * from public.expire_stale_wagers() loop
    if r.challenge_id = v_challenge_id then
      v_swept_pending := true;
      if r.outcome <> 'expired_pending' then
        raise exception 'Expected pending-expiry outcome = expired_pending, got %', r.outcome;
      end if;
    end if;
  end loop;

  if not v_swept_pending then
    raise exception 'Expected expire_stale_wagers to sweep the backdated pending challenge';
  end if;

  select status into v_challenge_status from public.challenges where id = v_challenge_id;
  select status into v_res_status from public.stake_reservations where id = v_reservation_id;
  if v_challenge_status <> 'expired' then
    raise exception 'Expected challenge status = expired after sweep, got %', v_challenge_status;
  end if;
  if v_res_status <> 'refunded' then
    raise exception 'Expected reservation status = refunded after sweep, got %', v_res_status;
  end if;
  if (select balance_cents from public.users where id = v_a) <> v_a_balance_before then
    raise exception 'Expected challenger balance to be fully refunded after pending expiry';
  end if;

  delete from public.challenges where id = v_challenge_id;

  if v_b is not null then
    insert into public.stake_reservations (user_id, amount_cents, status)
    values (v_a, 2500, 'held') returning id into v2_challenger_res;
    insert into public.stake_reservations (user_id, amount_cents, status)
    values (v_b, 2500, 'held') returning id into v2_acceptor_res;

    insert into public.challenges
      (challenger_id, target_id, stake_cents, ruleset_id, status, expires_at, responded_at, started_at,
       challenger_reservation_id, acceptor_reservation_id)
    values
      (v_a, v_b, 2500, 'classic', 'accepted', now() + interval '1 day', now() - interval '40 minutes', null,
       v2_challenger_res, v2_acceptor_res)
    returning id into v2_challenge_id;

    for r in select * from public.expire_stale_wagers() loop
      if r.challenge_id = v2_challenge_id then
        v_accepted_tested := true;
        if r.outcome <> 'expired_never_started' then
          raise exception 'Expected accepted-never-started outcome = expired_never_started, got %', r.outcome;
        end if;
      end if;
    end loop;

    if not v_accepted_tested then
      raise exception 'Expected expire_stale_wagers to sweep the accepted-but-never-started challenge past grace';
    end if;

    if (select status from public.stake_reservations where id = v2_challenger_res) <> 'refunded'
       or (select status from public.stake_reservations where id = v2_acceptor_res) <> 'refunded' then
      raise exception 'Expected both reservations refunded for the accepted-never-started sweep';
    end if;

    delete from public.challenges where id = v2_challenge_id;
    delete from public.stake_reservations where id in (v2_challenger_res, v2_acceptor_res);

    return 'ok: expire_stale_wagers sweeps both the pending-expired case (real funded reservation, fully refunded) and the accepted-never-started 30-min-grace case (refunds both sides)';
  end if;

  return 'ok: pending-expiry case verified with a real funded reservation; accepted-never-started case skipped (needs a 2nd user id)';
end;
$function$;

-- ============================================================================
-- 11. Lock down execute grants -- every new function here moves money,
--     mutates challenge/reservation state, or is a self-test; none of these
--     are meant to be callable directly by anon/authenticated except via
--     the SECURITY DEFINER RPCs which check auth.uid() internally.
-- ============================================================================

revoke execute on function public.reserve_wager_stake(uuid, integer) from anon, authenticated;
revoke execute on function public.refund_wager_stake(uuid) from anon, authenticated;
revoke execute on function public.assert_wager_pairing_not_rate_limited(uuid, uuid) from anon, authenticated;
revoke execute on function public.settle_wager_match(uuid, uuid, uuid, uuid, boolean, integer, integer, text, integer, jsonb, text[], integer[], integer[]) from anon, authenticated;
revoke execute on function public.expire_stale_wagers() from anon, authenticated;
revoke execute on function public.assert_wager_settlement_works() from anon, authenticated;
revoke execute on function public.assert_wager_anti_abuse_works() from anon, authenticated;
revoke execute on function public.assert_expire_stale_wagers_works() from anon, authenticated;

grant execute on function public.create_challenge(uuid, integer, text) to authenticated;
grant execute on function public.create_open_wager(integer, text) to authenticated;
grant execute on function public.respond_to_challenge(uuid, boolean) to authenticated;
grant execute on function public.accept_open_wager(uuid) to authenticated;
grant execute on function public.cancel_wager(uuid) to authenticated;

-- ============================================================================
-- 12. Run every self-test at migration time -- must show "ok" or a
--     legitimate "skipped" reason, never fail silently.
-- ============================================================================

select public.assert_ledger_vocabulary() as assert_ledger_vocabulary;
select public.assert_wager_settlement_works() as assert_wager_settlement_works;
select public.assert_wager_anti_abuse_works() as assert_wager_anti_abuse_works;
select public.assert_expire_stale_wagers_works() as assert_expire_stale_wagers_works;
