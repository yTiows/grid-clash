-- =============================================================================
-- Migration: close a live PUBLIC-execute-grant leak on every SECURITY
-- DEFINER function in this schema, plus a real ownership-check gap found
-- while fixing it.
--
-- ROOT CAUSE: every migration in this codebase, going back to the first
-- one, correctly does `revoke execute on function X from anon,
-- authenticated` for functions that must never be called by a client
-- directly — the intent has always been right. But Postgres grants EXECUTE
-- on a newly created function to the implicit PUBLIC pseudo-role by
-- default, and revoking a privilege from a NAMED role (anon,
-- authenticated) does not remove that role's access to a privilege it
-- still holds via PUBLIC — only revoking from PUBLIC itself does that.
-- Every migration revoked from the named roles; none revoked from PUBLIC.
-- The result, confirmed live via has_function_privilege() before writing
-- this migration, not assumed: anon (fully unauthenticated) currently has
-- EXECUTE on settle_ranked_match, settle_wager_match, reserve_stake,
-- refund_stake, request_withdrawal, is_admin, and 44 other
-- SECURITY DEFINER functions — every one of them, regardless of what any
-- individual migration's revoke statement intended.
--
-- FIX SHAPE, verified against actual call sites (grep for `.rpc(` across
-- src/) before writing a single revoke, not assumed from function names:
--   - Functions called ONLY via the service-role admin client
--     (sql-match-store.ts, cron routes, the Stripe webhook route) never
--     legitimately need anon or authenticated access at all — revoked
--     from PUBLIC, anon, and authenticated. service_role/postgres are
--     unaffected: Supabase's service_role has its own independent grants
--     and is not subject to these revokes.
--   - Trigger and event-trigger functions (assert_bounty_pool_balance,
--     enforce_*, flag_*, handle_new_user, link_accounts_by_device,
--     mint_loyalty_points_from_rake, populate_exclusion_identifiers,
--     rls_auto_enable) can never be invoked directly by any role
--     regardless of grants — Postgres only allows the trigger machinery
--     to call them — but their existing broad anon/authenticated grants
--     were revoked anyway for hygiene, so a future `information_schema`
--     audit doesn't have to re-derive "trigger functions are safe despite
--     the grant" from scratch.
--   - Functions confirmed called directly from request-scoped
--     (authenticated-context) app code — accept_open_wager, cancel_wager,
--     create_challenge, create_open_wager, respond_to_challenge,
--     file_match_dispute, is_admin, list_open_disputes,
--     resolve_match_dispute, respond_to_friend_request — already carried
--     a correct, independent grant to `authenticated` (not just the
--     PUBLIC leak), confirmed via information_schema.role_routine_grants.
--     Revoking PUBLIC does not affect them.
--   - Three functions — enter_tournament, request_withdrawal,
--     record_withdrawal_outcome — are ALSO called directly from
--     request-scoped app code (src/actions/tournaments.ts,
--     src/actions/withdrawal.ts) but had NO independent authenticated
--     grant — PUBLIC was their only route to working at all. These get an
--     explicit `grant execute ... to authenticated` alongside the PUBLIC
--     revoke, or this migration would break real tournament entry and
--     real withdrawals the moment it landed. Verified by reading
--     withdrawal.ts/tournaments.ts directly, not inferred.
--   - check_rate_limit already had correct, independent grants to both
--     anon and authenticated (it has to work before a session exists, for
--     signup/login rate limiting) — PUBLIC revoked, both existing grants
--     left untouched.
--
-- SECOND FINDING while verifying record_withdrawal_outcome's grants: the
-- function itself has no caller-ownership check at all — any authenticated
-- caller could pass ANY p_payout_id, not just their own. Combined with the
-- authenticated grant this migration must keep (withdrawal.ts genuinely
-- needs it), this meant any logged-in user could call
-- record_withdrawal_outcome(<someone else's payout id>, null, 'failed',
-- 'x') directly against the Supabase REST API — the function's own
-- terminal-state guard (`if v_payout.status in ('paid','failed',
-- 'reversed') then return`) means a forged 'failed' landing before the
-- real Stripe outcome arrives would permanently lock out the real
-- transfer.reversed/success recording AND credit the payout's real amount
-- back to its real owner via move_balance's 'withdrawal_reversed' path —
-- while Stripe's real transfer, if it later completes, still sends the
-- real money. That is a real double-credit path, reachable by any
-- authenticated account against any other account's in-flight withdrawal,
-- not just a theoretical one. Fixed below with an auth.uid() ownership
-- check that is a no-op for the service-role/webhook caller (auth.uid()
-- is null in that context) and refuses any other authenticated caller who
-- isn't the payout's own owner.
-- =============================================================================

-- --- Category 1: PUBLIC only, no anon/authenticated access needed at all ---

revoke execute on function public.settle_ranked_match(uuid, uuid, uuid, uuid, uuid, boolean, integer, integer, integer, integer, integer, text, integer, jsonb, text[], integer[], integer[]) from public, anon, authenticated;
revoke execute on function public.settle_wager_match(uuid, uuid, uuid, uuid, boolean, integer, integer, text, integer, jsonb, text[], integer[], integer[]) from public, anon, authenticated;
revoke execute on function public.reserve_stake(uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_stake(uuid) from public, anon, authenticated;
revoke execute on function public.reserve_wager_stake(uuid, integer) from public, anon, authenticated;
revoke execute on function public.refund_wager_stake(uuid) from public, anon, authenticated;
revoke execute on function public.complete_tournament(uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.complete_satellite_tournament(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.create_tournament_round(uuid, integer, jsonb) from public, anon, authenticated;
revoke execute on function public.record_tournament_match_result(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.commit_tournament_field(uuid, integer) from public, anon, authenticated;
revoke execute on function public.expire_stale_wagers() from public, anon, authenticated;
revoke execute on function public.cleanup_rate_limit_counters() from public, anon, authenticated;
revoke execute on function public.reconcile_orphan_reservations(interval) from public, anon, authenticated;
revoke execute on function public.audit_balance_drift() from public, anon, authenticated;
revoke execute on function public.realised_profit_cents() from public, anon, authenticated;
revoke execute on function public.accounts_are_linked(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.check_contest_eligibility(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.check_deposit_allowed(uuid, integer) from public, anon, authenticated;
revoke execute on function public.is_self_excluded(uuid) from public, anon, authenticated;
revoke execute on function public.is_identifier_excluded(text, text) from public, anon, authenticated;

-- Self-test probes with real parameters (not zero-arg deployment probes —
-- see scripts calling them in this project's own migrations) — never meant
-- to be called by a client either.
revoke execute on function public.assert_can_wager(uuid, integer) from public, anon, authenticated;
revoke execute on function public.assert_wager_pairing_not_rate_limited(uuid, uuid) from public, anon, authenticated;

-- --- Category 2: trigger / event-trigger functions ---------------------------
-- Cannot be invoked directly by any role regardless of grants (Postgres:
-- "trigger functions can only be called as triggers") — revoked anyway,
-- for hygiene, so this isn't left as a standing exception future audits
-- have to re-verify from scratch every time.

revoke execute on function public.assert_bounty_pool_balance() from public, anon, authenticated;
revoke execute on function public.assert_payouts_balance() from public, anon, authenticated;
revoke execute on function public.enforce_comeback_cooldown() from public, anon, authenticated;
revoke execute on function public.enforce_entry_eligibility() from public, anon, authenticated;
revoke execute on function public.enforce_field_capacity() from public, anon, authenticated;
revoke execute on function public.flag_bot_behavior() from public, anon, authenticated;
revoke execute on function public.flag_chargeback_on_transaction() from public, anon, authenticated;
revoke execute on function public.flag_suspicious_match() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.link_accounts_by_device() from public, anon, authenticated;
revoke execute on function public.mint_loyalty_points_from_rake() from public, anon, authenticated;
revoke execute on function public.populate_exclusion_identifiers() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- --- Category 3: PUBLIC revoked, existing correct authenticated (+ anon for --
-- --- check_rate_limit) grants left untouched -------------------------------

revoke execute on function public.accept_open_wager(uuid) from public;
revoke execute on function public.cancel_wager(uuid) from public;
revoke execute on function public.create_challenge(uuid, integer, text) from public;
revoke execute on function public.create_open_wager(integer, text) from public;
revoke execute on function public.respond_to_challenge(uuid, boolean) from public;
revoke execute on function public.file_match_dispute(uuid, text) from public;
revoke execute on function public.is_admin() from public;
revoke execute on function public.list_open_disputes() from public;
revoke execute on function public.resolve_match_dispute(uuid, text, text, uuid, integer) from public;
revoke execute on function public.respond_to_friend_request(uuid, boolean) from public;
revoke execute on function public.check_rate_limit(text, text, integer, integer) from public;

-- --- Category 4: PUBLIC revoked, NEW explicit authenticated grant added -----
-- (had no independent grant before this — PUBLIC was the only reason these
-- worked for a real logged-in user; see this migration's header)

revoke execute on function public.enter_tournament(uuid, uuid, integer) from public;
grant execute on function public.enter_tournament(uuid, uuid, integer) to authenticated;

revoke execute on function public.request_withdrawal(uuid, integer) from public;
grant execute on function public.request_withdrawal(uuid, integer) to authenticated;

revoke execute on function public.record_withdrawal_outcome(uuid, text, text, text) from public;
grant execute on function public.record_withdrawal_outcome(uuid, text, text, text) to authenticated;

-- =============================================================================
-- record_withdrawal_outcome: add the missing ownership check.
--
-- auth.uid() is null when called via the service-role client (the Stripe
-- webhook path, transfer.reversed) — the `auth.uid() is not null and`
-- guard makes the check a no-op there, exactly matching every other
-- security-definer function in this codebase that already distinguishes
-- "the trusted backend called this" from "a real user session called
-- this" the same way. A real authenticated caller can now only ever
-- affect their own payout row.
-- =============================================================================
create or replace function public.record_withdrawal_outcome(
  p_payout_id uuid,
  p_stripe_transfer_id text,
  p_status text,
  p_failure_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payout record;
begin
  select * into v_payout from public.payouts where id = p_payout_id for update;
  if not found then
    raise exception 'Payout % not found', p_payout_id;
  end if;

  if auth.uid() is not null and auth.uid() <> v_payout.user_id then
    raise exception 'Not authorized to update this payout';
  end if;

  if v_payout.status in ('paid', 'failed', 'reversed') then
    return;
  end if;

  update public.payouts
  set status = p_status,
      stripe_transfer_id = coalesce(p_stripe_transfer_id, stripe_transfer_id),
      failure_reason = p_failure_reason,
      completed_at = case when p_status in ('paid', 'failed', 'reversed') then now() else completed_at end
  where id = p_payout_id;

  if p_status in ('failed', 'reversed') then
    perform public.move_balance(
      v_payout.user_id, v_payout.amount_cents, 'withdrawal_reversed',
      'withdrawal_reversed:' || p_payout_id::text
    );
  end if;
end;
$$;

revoke execute on function public.record_withdrawal_outcome(uuid, text, text, text) from public, anon;
grant execute on function public.record_withdrawal_outcome(uuid, text, text, text) to authenticated;

-- =============================================================================
-- Self-test: pins the contract so this class of bug can't silently
-- regress. Two checks — no SECURITY DEFINER function in public is
-- PUBLIC-executable (the exact bug this migration fixes), and anon
-- specifically has zero access to the confirmed money-moving set.
-- =============================================================================
create or replace function public.assert_no_public_execute_leak_on_security_definer_functions()
returns text
language plpgsql
set search_path = public
as $$
declare
  v_leaked text;
  v_anon_leaked text;
  v_money_functions text[] := array[
    'settle_ranked_match', 'settle_wager_match', 'reserve_stake', 'refund_stake',
    'reserve_wager_stake', 'refund_wager_stake', 'complete_tournament',
    'complete_satellite_tournament', 'record_tournament_match_result',
    'commit_tournament_field', 'request_withdrawal', 'record_withdrawal_outcome'
  ];
  v_fn text;
begin
  select string_agg(p.proname, ', ') into v_leaked
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef = true
    and has_function_privilege('public', p.oid, 'execute');

  if v_leaked is not null then
    raise exception 'SECURITY DEFINER function(s) still executable by PUBLIC: %', v_leaked;
  end if;

  foreach v_fn in array v_money_functions loop
    if exists (
      select 1 from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = v_fn
        and has_function_privilege('anon', p.oid, 'execute')
    ) then
      v_anon_leaked := coalesce(v_anon_leaked || ', ', '') || v_fn;
    end if;
  end loop;

  if v_anon_leaked is not null then
    raise exception 'anon (unauthenticated) can still execute money-moving function(s): %', v_anon_leaked;
  end if;

  return 'ok: no SECURITY DEFINER function is PUBLIC-executable, and anon has zero access to any money-moving function';
end;
$$;

revoke execute on function public.assert_no_public_execute_leak_on_security_definer_functions() from public, anon, authenticated;
