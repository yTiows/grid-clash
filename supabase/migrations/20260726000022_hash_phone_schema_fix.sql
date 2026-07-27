-- =============================================================================
-- Migration: fix hash_phone() — pgcrypto's digest() is not resolvable
--
-- FOUND BY: calling assert_can_wager() end to end against a live database for
-- the first time since migration 21 introduced hash_phone().
--
--   ERROR: 42883: function digest(text, unknown) does not exist
--
-- BUG: Supabase installs pgcrypto into the `extensions` schema, not `public`.
-- hash_phone() is a plain SQL function with no SET search_path, so at the
-- point Postgres inlines and resolves it, it runs under the CALLER's pinned
-- search_path. Every real caller is assert_can_wager(), which is
-- `security definer set search_path = public` — `extensions` is never in
-- scope, so digest() cannot be found.
--
-- IMPACT: assert_can_wager() raised on every call for a phone-verified user,
-- because the phone-hash exclusion check (migration 21, GAP 2) runs
-- unconditionally before the phone_verified check that would otherwise short
-- -circuit it. That is the money gate for every ranked stake, tournament
-- entry, and withdrawal — this broke paid entry entirely for any verified
-- account, caught only by executing the function against a live database
-- rather than trusting that a clean `create or replace function` applied.
-- =============================================================================

create or replace function public.hash_phone(p_phone text)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(lower(trim(p_phone)), 'sha256'), 'hex');
$$;
