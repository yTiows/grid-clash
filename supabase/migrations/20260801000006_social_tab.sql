-- =============================================================================
-- Migration: social tab — profile fields, friendships, referral attribution,
-- and the challenge-invite plumbing a friend's profile hands off into.
--
-- Per CLAUDE_CODE_BRIEF.md's active work queue, Phase 3. Checked the
-- filesystem first (§0): public.challenges/public.challenge_preferences
-- already existed (20260724000009_reputation.sql) but were more unwired
-- than BRACKETS ever was — select-only grants, no INSERT/UPDATE policy, no
-- functions, no callers anywhere in src/. This migration wires them rather
-- than building a second table. public.player_titles is already fully
-- live (earned at tournament completion, rendered on /leaderboard) — reused
-- as-is, not rebuilt. public.account_links is a separate, RLS-deny-all
-- fraud-detection table and is NOT the friends list; friendships is new.
--
-- Deliberately stops at "challenge accepted, match_id still null" — turning
-- an accepted challenge into a live match means teaching match-server.ts a
-- third LiveMatch.kind alongside "ranked"/"tournament", which is the
-- wager-marketplace phase's job, not this one. Building that here would be
-- exactly the second-match-creation-path risk CLAUDE_CODE_BRIEF.md §0 warns
-- about.
-- =============================================================================

alter table public.users
  add column avatar_url text,
  add column invited_by_user_id uuid references public.users (id) on delete set null;

comment on column public.users.invited_by_user_id is
  'Captured once at signup from a referral username, never changed after. Purely attribution for the friends-tab "add via invite" prompt — no reward/payout mechanics (CLAUDE_CODE_BRIEF.md: those need a product decision this brief does not make).';

-- ---------------------------------------------------------------------------
-- friendships
--
-- Mutual, explicit relationship — deliberately the ONLY channel Phase 4's
-- wager invites can be sent through, which is a real mitigation (not just a
-- courtesy) for the exact harassment-vector concern challenges' own 2026-07
-- comment raised about an open, unsolicited channel to top players.
-- ---------------------------------------------------------------------------
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users (id) on delete cascade,
  addressee_id uuid not null references public.users (id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friendships_distinct check (requester_id <> addressee_id),
  constraint friendships_status_check check (status in ('pending', 'accepted', 'declined'))
);

create index friendships_requester_idx on public.friendships (requester_id, status);
create index friendships_addressee_idx on public.friendships (addressee_id, status);

-- One active (pending or accepted) relationship per unordered pair — a
-- fresh request is allowed again after a decline, same "not a permanent
-- lock" shape as challenges_one_open_per_pair.
create unique index friendships_one_active_per_pair
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where status in ('pending', 'accepted');

alter table public.friendships enable row level security;

create policy "friendships_select_involved" on public.friendships
  for select to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- status = 'pending' is required here, not just the column default — without
-- it a requester could insert a row already 'accepted', skipping the
-- addressee's consent entirely and defeating the whole point of gating
-- Phase 4's wager invites behind a MUTUAL relationship.
create policy "friendships_insert_as_requester" on public.friendships
  for insert to authenticated
  with check (auth.uid() = requester_id and status = 'pending');

-- Either party can remove the relationship: the requester cancelling a
-- still-pending request, or either side ending an accepted friendship.
create policy "friendships_delete_involved" on public.friendships
  for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- No UPDATE policy/grant: accept/decline goes through respond_to_friend_
-- request() below instead of a raw client UPDATE. Same shape as
-- respond_to_challenge() elsewhere in this file — an explicit, testable
-- raised exception per failure case, not a bare RLS predicate a caller
-- only discovers through a generic "row-level security policy" error.
grant select, insert, delete on public.friendships to authenticated;

-- ---------------------------------------------------------------------------
-- respond_to_friend_request
-- Only the addressee may accept/decline, and only while pending.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_friend_request(
  p_friendship_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_friendship record;
begin
  if v_caller is null then
    raise exception 'Not authenticated';
  end if;

  select * into v_friendship from public.friendships where id = p_friendship_id for update;
  if not found then
    raise exception 'Friend request not found';
  end if;

  if v_friendship.addressee_id <> v_caller then
    raise exception 'Only the addressee can respond to this friend request';
  end if;

  if v_friendship.status <> 'pending' then
    raise exception 'This friend request is no longer pending';
  end if;

  update public.friendships
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_friendship_id;
end;
$$;

revoke execute on function public.respond_to_friend_request(uuid, boolean) from anon;
grant execute on function public.respond_to_friend_request(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- create_challenge / respond_to_challenge
--
-- Wires the existing-but-unreachable public.challenges table. Runs an RPC
-- (not a raw RLS insert policy, unlike friendships) because the validation
-- here is the kind this codebase always puts behind a security-definer
-- function with a friendly raised message — friendship existence, the
-- target's own opt-in preference, and their declared stake range — the same
-- shape as file_match_dispute()'s "caller's own session, explicit checks,
-- not just an RLS expression."
-- ---------------------------------------------------------------------------
create or replace function public.create_challenge(
  p_target_id uuid,
  p_stake_cents integer,
  p_ruleset_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_friendship record;
  v_prefs public.challenge_preferences%rowtype;
  v_challenge_id uuid;
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

  -- Same reasoning as createTournamentAction's purist exclusion: no hidden
  -- information and a small enough board to be solved outright, so no
  -- real-money contest (a challenge is always heading toward one) should
  -- ever be playable in it.
  if p_ruleset_id = 'purist' then
    raise exception 'Purist has no hidden information and can be solved outright — not available for a real-money challenge';
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

  begin
    insert into public.challenges (challenger_id, target_id, stake_cents, ruleset_id, expires_at)
    values (v_caller, p_target_id, p_stake_cents, p_ruleset_id, now() + interval '24 hours')
    returning id into v_challenge_id;
  exception when unique_violation then
    raise exception 'You already have a pending challenge to this player';
  end;

  return v_challenge_id;
end;
$$;

revoke execute on function public.create_challenge(uuid, integer, text) from anon;
grant execute on function public.create_challenge(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- respond_to_challenge
-- Only the target may respond, and only while pending and unexpired. Does
-- NOT touch matches/match_id — that's the wager-marketplace phase's job.
-- ---------------------------------------------------------------------------
create or replace function public.respond_to_challenge(
  p_challenge_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_challenge record;
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

  if v_challenge.expires_at < now() then
    update public.challenges set status = 'expired' where id = p_challenge_id;
    raise exception 'This challenge has expired';
  end if;

  update public.challenges
  set status = case when p_accept then 'accepted' else 'declined' end,
      responded_at = now()
  where id = p_challenge_id;
end;
$$;

revoke execute on function public.respond_to_challenge(uuid, boolean) from anon;
grant execute on function public.respond_to_challenge(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: avatars bucket. Public read (a profile picture is not a secret),
-- write restricted to the owner's own folder (avatars/{user_id}/...).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy "avatars_read_all" on storage.objects
  for select to authenticated, anon
  using (bucket_id = 'avatars');

create policy "avatars_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "avatars_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Self-tests
-- ---------------------------------------------------------------------------
create or replace function public.assert_friendship_flow_works()
returns text
language plpgsql
as $$
declare
  v_a uuid;
  v_b uuid;
  v_friendship_id uuid;
  v_blocked_self_accept boolean := false;
begin
  select id into v_a from public.users order by created_at limit 1;
  select id into v_b from public.users where id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then
    return 'skipped: needs two distinct users';
  end if;

  delete from public.friendships
  where (requester_id = v_a and addressee_id = v_b) or (requester_id = v_b and addressee_id = v_a);

  -- A requests B, as A.
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  insert into public.friendships (requester_id, addressee_id)
  values (v_a, v_b)
  returning id into v_friendship_id;

  -- A cannot accept their own request via the RPC.
  begin
    perform public.respond_to_friend_request(v_friendship_id, true);
  exception when others then
    v_blocked_self_accept := true;
  end;
  if not v_blocked_self_accept then
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected the requester to be unable to accept their own friend request';
  end if;

  -- B accepts, as B.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.respond_to_friend_request(v_friendship_id, true);

  perform 1 from public.friendships where id = v_friendship_id and status = 'accepted';
  if not found then
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected friendship to be accepted after addressee responded';
  end if;

  delete from public.friendships where id = v_friendship_id;

  return 'ok: friendship request/accept flow enforces addressee-only response via respond_to_friend_request';
end;
$$;

revoke execute on function public.assert_friendship_flow_works() from anon, authenticated;

create or replace function public.assert_create_challenge_respects_friendship_and_preferences()
returns text
language plpgsql
as $$
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
begin
  select id into v_a from public.users order by created_at limit 1;
  select id into v_b from public.users where id <> v_a order by created_at limit 1;
  if v_a is null or v_b is null then
    return 'skipped: needs two distinct users';
  end if;

  delete from public.friendships
  where (requester_id = v_a and addressee_id = v_b) or (requester_id = v_b and addressee_id = v_a);
  select exists(select 1 from public.challenge_preferences where user_id = v_b) into v_had_prefs;
  if v_had_prefs then
    select accepts_challenges into v_prior_accepts from public.challenge_preferences where user_id = v_b;
  end if;

  perform set_config('request.jwt.claim.sub', v_a::text, true);

  -- No friendship yet: must be refused.
  begin
    perform public.create_challenge(v_b, 500, 'classic');
  exception when others then
    v_blocked_without_friendship := true;
  end;
  if not v_blocked_without_friendship then
    raise exception 'Expected create_challenge to refuse a non-friend target';
  end if;

  -- Build a genuinely accepted friendship through the real RLS-gated flow
  -- (insert as pending requester, accept as addressee) rather than
  -- inserting status='accepted' directly — the insert policy only allows
  -- 'pending' rows for exactly this reason.
  insert into public.friendships (requester_id, addressee_id)
  values (v_a, v_b)
  returning id into v_friendship_id;
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  perform public.respond_to_friend_request(v_friendship_id, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  -- Friends now, but target hasn't opted in to challenges: still refused.
  -- challenge_preferences' own RLS (insert/update own only) means writing
  -- v_b's row must run as v_b, not as v_a — switch context for the write,
  -- then switch back to v_a to call create_challenge as the challenger.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  insert into public.challenge_preferences (user_id, accepts_challenges)
  values (v_b, false)
  on conflict (user_id) do update set accepts_challenges = false;
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin
    perform public.create_challenge(v_b, 500, 'classic');
  exception when others then
    v_blocked_without_optin := true;
  end;
  if not v_blocked_without_optin then
    delete from public.friendships where id = v_friendship_id;
    raise exception 'Expected create_challenge to refuse a target who has not opted in to challenges';
  end if;

  -- Opted in: must succeed.
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  update public.challenge_preferences set accepts_challenges = true where user_id = v_b;
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  v_challenge_id := public.create_challenge(v_b, 500, 'classic');

  -- Only the target may respond — the challenger trying to respond is
  -- refused. The "did it correctly refuse" check must live OUTSIDE the
  -- exception-catching block: raising the failure exception *inside* the
  -- same block that catches "when others" would swallow a real bug
  -- silently instead of failing the test.
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
$$;

revoke execute on function public.assert_create_challenge_respects_friendship_and_preferences() from anon, authenticated;

select public.assert_friendship_flow_works();
select public.assert_create_challenge_respects_friendship_and_preferences();
