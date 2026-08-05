-- Phase 5 final sweep (2026-08-05): re-ran every assert_* self-test in the
-- project, not just Phase 4's new ones, to confirm nothing regressed across
-- the whole session. Found three real breakages, all caused by Phase 4's
-- own changes landing correct new behavior against self-tests written
-- before that behavior existed:
--
--   1. assert_create_challenge_respects_friendship_and_preferences used a
--      500-cent ($5) probe stake -- below the $25 floor added in
--      20260801000010_wager_stake_bounds.sql. Also picked "any two distinct
--      users" rather than two eligible ones, which broke separately once
--      respond_to_challenge started reserving a real stake (this
--      migration's own earlier sibling) and hit a phone_pending probe
--      account. Fixed to use a valid stake and skip honestly when fewer
--      than two eligible accounts exist, matching every other Phase 4
--      self-test's convention.
--   2. assert_tournament_entry_works and
--   3. assert_loyalty_redemption_works both assumed their probe account
--      already had 5+ real ranked matches on record (required by
--      check_contest_eligibility's min_ranked_matches gate) rather than
--      seeding that history themselves the way
--      assert_commit_tournament_field_works already did (Phase 2). On this
--      live project the one qualifying account genuinely has zero ranked
--      matches, so both always hit the eligibility gate before their own
--      assertions ever ran. Fixed by seeding 5 real ranked=true matches
--      rows for the probe pair and cleaning them up afterward -- confirmed
--      the fraud-detection trigger (flag_suspicious_match, fires above 10
--      matches between one pair) never trips at 5.
--
-- None of these are product bugs -- enter_tournament/respond_to_challenge
-- were correctly refusing an ineligible account in every case. The bug was
-- in what these self-tests assumed about the account they were testing
-- with.

create or replace function public.assert_tournament_entry_works()
returns text
language plpgsql
as $function$
declare
  v_user uuid;
  v_opponent uuid;
  v_tournament_id uuid;
  v_entry_id uuid;
  v_seeded_match_ids uuid[] := '{}';
  v_id uuid;
  i integer;
begin
  select id into v_user
  from public.users
  where account_status = 'active' and phone_verified and balance_cents >= 500
  order by created_at limit 1;

  if v_user is null then
    return 'skipped: needs an active, verified user with balance >= 500';
  end if;

  select id into v_opponent from public.users where id <> v_user order by created_at limit 1;
  if v_opponent is null then
    return 'skipped: needs a second distinct user to seed ranked-match history against';
  end if;

  for i in 1..5 loop
    insert into public.matches (
      player_1_id, player_2_id, winner_id, loser_id,
      entry_fee_cents, winner_payout_cents, platform_rake_cents, ranked
    ) values (
      v_user, v_opponent, v_user, v_opponent, 500, 900, 100, true
    ) returning id into v_id;
    v_seeded_match_ids := v_seeded_match_ids || v_id;
  end loop;

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

  delete from public.matches where id = any(v_seeded_match_ids);

  if v_entry_id is null then
    raise exception 'enter_tournament returned null';
  end if;

  return 'ok: tournament entry executes end to end';
end;
$function$;

create or replace function public.assert_loyalty_redemption_works()
returns text
language plpgsql
as $function$
declare
  v_user uuid;
  v_opponent uuid;
  v_t1 uuid;
  v_t2 uuid;
  v_t3 uuid;
  v_cash_before integer;
  v_cash_after integer;
  v_points_before integer;
  v_points_after integer;
  v_refused boolean := false;
  v_refusal_message text;
  v_seeded_match_ids uuid[] := '{}';
  v_id uuid;
  i integer;
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

  select id into v_opponent from public.users where id <> v_user order by created_at limit 1;
  if v_opponent is null then
    return 'skipped: needs a second distinct user to seed ranked-match history against';
  end if;

  for i in 1..5 loop
    insert into public.matches (
      player_1_id, player_2_id, winner_id, loser_id,
      entry_fee_cents, winner_payout_cents, platform_rake_cents, ranked
    ) values (
      v_user, v_opponent, v_user, v_opponent, 500, 900, 100, true
    ) returning id into v_id;
    v_seeded_match_ids := v_seeded_match_ids || v_id;
  end loop;

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
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Expected 300 points redeemed, got %', v_points_before - v_points_after;
  end if;
  if v_cash_before - v_cash_after <> 200 then
    delete from public.matches where id = any(v_seeded_match_ids);
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
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Fully points-covered entry should not touch cash balance: % -> %', v_cash_before, v_cash_after;
  end if;

  select balance_cents into v_points_after from public.loyalty_points where user_id = v_user;
  if v_points_before - v_points_after <> 800 then
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Expected 800 total points redeemed (300+500), got %', v_points_before - v_points_after;
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__redeem_probe_insufficient__', 500, 4, 1000,
    2000, 200, 1800,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_t3;

  begin
    perform public.enter_tournament(v_user, v_t3, 999999);
  exception when others then
    v_refused := true;
    v_refusal_message := sqlerrm;
  end;
  if not v_refused then
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Expected insufficient-points redemption to be refused';
  end if;
  if v_refusal_message not ilike '%insufficient points%' then
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Refused for the wrong reason: %', v_refusal_message;
  end if;

  if exists (select 1 from public.tournament_entries where tournament_id = v_t3 and user_id = v_user) then
    delete from public.matches where id = any(v_seeded_match_ids);
    raise exception 'Refused redemption still left a tournament_entries row behind';
  end if;

  delete from public.matches where id = any(v_seeded_match_ids);

  return 'ok: loyalty redemption — partial discount, full discount, and insufficient-points refusal (with clean rollback) all correct';
end;
$function$;

create or replace function public.assert_create_challenge_respects_friendship_and_preferences()
returns text
language plpgsql
as $function$
declare
  v_a uuid;
  v_b uuid;
  v_friendship_id uuid;
  v_had_prefs boolean;
  v_prior_accepts boolean;
  v_blocked_without_friendship boolean := false;
  v_blocked_without_optin boolean := false;
  v_blocked_challenger_responding boolean := false;
  v_challenge_id uuid;
  v_stake_cents constant integer := 3000;
begin
  select id into v_a from public.users
  where account_status = 'active' and phone_verified and balance_cents >= v_stake_cents
  order by created_at limit 1;
  select id into v_b from public.users
  where account_status = 'active' and phone_verified and balance_cents >= v_stake_cents and id <> v_a
  order by created_at limit 1;
  if v_a is null or v_b is null then
    return 'skipped: needs two distinct active, phone-verified, funded ($30+) users';
  end if;

  delete from public.friendships
  where (requester_id = v_a and addressee_id = v_b) or (requester_id = v_b and addressee_id = v_a);
  select exists(select 1 from public.challenge_preferences where user_id = v_b) into v_had_prefs;
  if v_had_prefs then
    select accepts_challenges into v_prior_accepts from public.challenge_preferences where user_id = v_b;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin
    perform public.create_challenge(v_b, v_stake_cents, 'classic');
  exception when others then
    v_blocked_without_friendship := true;
  end;
  if not v_blocked_without_friendship then
    raise exception 'Expected create_challenge to refuse a non-friend target';
  end if;

  insert into public.friendships (requester_id, addressee_id)
  values (v_a, v_b)
  returning id into v_friendship_id;
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.respond_to_friend_request(v_friendship_id, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  insert into public.challenge_preferences (user_id, accepts_challenges)
  values (v_b, false)
  on conflict (user_id) do update set accepts_challenges = false;
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin
    perform public.create_challenge(v_b, v_stake_cents, 'classic');
  exception when others then
    v_blocked_without_optin := true;
  end;
  if not v_blocked_without_optin then
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected create_challenge to refuse a target who has not opted in to challenges';
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  update public.challenge_preferences set accepts_challenges = true where user_id = v_b;
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_challenge_id := public.create_challenge(v_b, v_stake_cents, 'classic');

  begin
    perform public.respond_to_challenge(v_challenge_id, true);
  exception when others then
    v_blocked_challenger_responding := true;
  end;
  if not v_blocked_challenger_responding then
    delete from public.challenges where id = v_challenge_id;
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected the challenger to be unable to respond to their own challenge';
  end if;

  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.respond_to_challenge(v_challenge_id, true);

  perform 1 from public.challenges where id = v_challenge_id and status = 'accepted';
  if not found then
    delete from public.challenges where id = v_challenge_id;
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected challenge to be accepted after target responded';
  end if;

  delete from public.challenges where id = v_challenge_id;
  delete from public.friendships where id = v_friendship_id;
  if v_had_prefs then
    update public.challenge_preferences set accepts_challenges = v_prior_accepts where user_id = v_b;
  else
    delete from public.challenge_preferences where user_id = v_b;
  end if;

  return 'ok: create_challenge refuses non-friends and non-opted-in targets, admits a friend who opted in, and respond_to_challenge is target-only';
end;
$function$;

select public.assert_tournament_entry_works() as assert_tournament_entry_works;
select public.assert_loyalty_redemption_works() as assert_loyalty_redemption_works;
select public.assert_create_challenge_respects_friendship_and_preferences() as assert_create_challenge_respects_friendship_and_preferences;
