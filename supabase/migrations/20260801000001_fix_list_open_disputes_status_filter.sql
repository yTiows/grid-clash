-- Fix: list_open_disputes() never actually filtered by status despite its
-- name and its own comment ("the admin queue needs to see every open one").
-- is_admin() is a caller-scoped boolean with no row-level meaning, so the
-- original `where public.is_admin()` filtered nothing — every admin caller
-- got every dispute ever filed (open, reviewing, upheld, denied alike),
-- oldest-first. Found by the Phase 1 verification pass (2026-08-01), not
-- reported by a live user: the match_disputes table is currently empty on
-- the live project, so the bug hasn't visibly manifested, but it is
-- deterministic — the first resolved dispute would never leave the "Open &
-- reviewing" admin queue, and would push genuinely new disputes toward the
-- bottom of an ever-growing list.
create or replace function public.list_open_disputes()
returns setof public.match_disputes
language sql
stable
security definer
set search_path = public
as $$
  select d.* from public.match_disputes d
  where public.is_admin() and d.status in ('open', 'reviewing')
  order by d.created_at asc;
$$;

revoke execute on function public.list_open_disputes() from anon;
grant execute on function public.list_open_disputes() to authenticated;

-- ---------------------------------------------------------------------------
-- Self-test, following this codebase's assert_* convention (CLAUDE_CODE_BRIEF
-- §7: anything that moves money or advances a bracket gets one; extended
-- here to admin-queue correctness since a silently-wrong filter is the same
-- class of bug as a silently-wrong balance). Files two disputes on two real
-- matches, resolves one, and asserts list_open_disputes() returns the
-- unresolved one and only the unresolved one.
-- ---------------------------------------------------------------------------
create or replace function public.assert_list_open_disputes_filters_by_status()
returns text
language plpgsql
as $$
declare
  v_p1 uuid;
  v_p2 uuid;
  v_admin uuid;
  v_match_a uuid;
  v_match_b uuid;
  v_dispute_open uuid;
  v_dispute_resolved uuid;
  v_open_count integer;
  v_resolved_visible boolean;
begin
  -- Deliberately not filtered on account_status/phone_verified like the
  -- money-moving self-tests elsewhere in this codebase: this test only
  -- exercises list_open_disputes()'s status filter, which has no
  -- eligibility requirement on the participants, so any two distinct real
  -- user rows are sufficient and this stays runnable on a near-empty
  -- project.
  select id into v_p1 from public.users order by created_at limit 1;
  select id into v_p2 from public.users where id <> v_p1 order by created_at limit 1;
  select id into v_admin from public.users where is_admin = true limit 1;

  if v_p1 is null or v_p2 is null then
    return 'skipped: needs two distinct users';
  end if;
  if v_admin is null then
    return 'skipped: needs at least one admin user';
  end if;

  -- list_open_disputes() gates on is_admin(), which reads auth.uid() —
  -- there is no real authenticated session in a self-test run via the SQL
  -- editor/migration runner, so the admin's JWT subject claim is simulated
  -- for the current transaction only (set_config's third arg = true is
  -- transaction-local; it does not persist or affect any other session).
  perform set_config('request.jwt.claim.sub', v_admin::text, true);

  insert into public.matches (
    player_1_id, player_2_id, winner_id, loser_id,
    entry_fee_cents, winner_payout_cents, loser_payout_cents, platform_rake_cents,
    ranked, completed_at
  ) values (
    v_p1, v_p2, v_p1, v_p2, 100, 198, 0, 2, true, now()
  ) returning id into v_match_a;

  insert into public.matches (
    player_1_id, player_2_id, winner_id, loser_id,
    entry_fee_cents, winner_payout_cents, loser_payout_cents, platform_rake_cents,
    ranked, completed_at
  ) values (
    v_p1, v_p2, v_p1, v_p2, 100, 198, 0, 2, true, now()
  ) returning id into v_match_b;

  insert into public.match_disputes (match_id, filed_by_user_id, reason)
  values (v_match_a, v_p1, '__probe_open__') returning id into v_dispute_open;

  insert into public.match_disputes (match_id, filed_by_user_id, reason)
  values (v_match_b, v_p1, '__probe_resolved__') returning id into v_dispute_resolved;

  update public.match_disputes
  set status = 'denied', resolved_at = now()
  where id = v_dispute_resolved;

  select count(*) into v_open_count
  from public.list_open_disputes()
  where id = v_dispute_open;

  select exists (
    select 1 from public.list_open_disputes() where id = v_dispute_resolved
  ) into v_resolved_visible;

  delete from public.match_disputes where id in (v_dispute_open, v_dispute_resolved);
  delete from public.matches where id in (v_match_a, v_match_b);

  if v_open_count <> 1 then
    raise exception 'Expected the open dispute to appear exactly once in list_open_disputes(), got %', v_open_count;
  end if;

  if v_resolved_visible then
    raise exception 'A denied dispute is still visible in list_open_disputes() — status filter is not working';
  end if;

  return 'ok: list_open_disputes() returns open/reviewing disputes only, resolved ones are excluded';
end;
$$;

revoke execute on function public.assert_list_open_disputes_filters_by_status() from anon, authenticated;
