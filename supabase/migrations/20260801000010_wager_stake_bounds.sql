-- FOUND (2026-08-01, while wiring the wager UI actions): WAGER_MIN_STAKE_CENTS
-- / WAGER_MAX_STAKE_CENTS ($25 / $5,000, src/lib/game/fees.ts) were defined
-- earlier this phase but never actually enforced anywhere -- create_open_wager
-- and create_challenge only checked p_stake_cents <= 0. A constant that lives
-- only in TS is not a real bound: "server decides, client never asserts" means
-- the RPC itself must reject an out-of-range stake, not just the form that
-- calls it. Closing this before wiring the client action that would otherwise
-- have been the only thing enforcing it.

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
  v_min_stake_cents constant integer := 2500;
  v_max_stake_cents constant integer := 500000;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_stake_cents < v_min_stake_cents or p_stake_cents > v_max_stake_cents then
    raise exception 'Stake must be between % and % cents', v_min_stake_cents, v_max_stake_cents;
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
  v_min_stake_cents constant integer := 2500;
  v_max_stake_cents constant integer := 500000;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  if p_target_id = v_caller then
    raise exception 'Cannot challenge yourself';
  end if;

  if p_stake_cents < v_min_stake_cents or p_stake_cents > v_max_stake_cents then
    raise exception 'Stake must be between % and % cents', v_min_stake_cents, v_max_stake_cents;
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

create or replace function public.assert_wager_stake_bounds_enforced()
returns text
language plpgsql
as $$
declare
  v_a uuid;
  v_raised_low boolean;
  v_raised_high boolean;
begin
  -- No balance requirement: both bounds checks raise before
  -- create_open_wager ever calls reserve_wager_stake, so this only needs an
  -- active, phone-verified account to authenticate as, not a funded one.
  select id into v_a from public.users
  where account_status = 'active' and phone_verified
  order by created_at limit 1;

  if v_a is null then
    return 'skipped: needs one active, phone-verified user';
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin
    perform public.create_open_wager(100, 'classic'); -- $1, below the $25 floor
    v_raised_low := false;
  exception when others then
    v_raised_low := true;
  end;

  begin
    perform public.create_open_wager(1000000, 'classic'); -- $10,000, above the $5,000 ceiling
    v_raised_high := false;
  exception when others then
    v_raised_high := true;
  end;

  if not v_raised_low then
    raise exception 'Expected create_open_wager to reject a stake below the $25 floor';
  end if;
  if not v_raised_high then
    raise exception 'Expected create_open_wager to reject a stake above the $5,000 ceiling';
  end if;

  return 'ok: create_open_wager rejects stakes outside the $25-$5,000 bounds';
end;
$$;

revoke execute on function public.assert_wager_stake_bounds_enforced() from anon, authenticated;

select public.assert_wager_stake_bounds_enforced() as assert_wager_stake_bounds_enforced;
select public.assert_wager_settlement_works() as assert_wager_settlement_works;
select public.assert_wager_anti_abuse_works() as assert_wager_anti_abuse_works;
select public.assert_expire_stale_wagers_works() as assert_expire_stale_wagers_works;
