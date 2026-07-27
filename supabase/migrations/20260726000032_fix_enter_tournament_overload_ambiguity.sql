-- =============================================================================
-- Migration: drop the stale 2-arg enter_tournament — CREATE OR REPLACE with
-- an added parameter creates an overload, it does not replace in place
--
-- FOUND BY: running assert_tournament_entry_works() (a 2-arg call) right
-- after adding the 3-arg p_redeem_points version (migration 30).
--
--   ERROR: 42725: function public.enter_tournament(uuid, uuid) is not unique
--
-- BUG: unlike renaming a parameter (migration 17, which correctly used DROP
-- FUNCTION first because Postgres refuses an in-place rename), ADDING a
-- parameter with CREATE OR REPLACE silently succeeds — but it defines a
-- second, distinct overload rather than replacing the original, because
-- Postgres identifies a function by its argument type signature and
-- (uuid, uuid) is not the same signature as (uuid, uuid, integer). Both
-- functions existed simultaneously; every existing 2-arg caller
-- (enterTournamentAction) became ambiguous, since the 3-arg version's
-- default made it an equally valid match.
--
-- This is a fourth distinct way this exact function has broken on a change
-- that looked safe in isolation. The self-test suite is what caught it
-- again, immediately, rather than at the next real player action.
-- =============================================================================

drop function if exists public.enter_tournament(uuid, uuid);

-- Confirm exactly one enter_tournament remains.
do $$
declare
  v_count integer;
begin
  select count(*) into v_count from pg_proc where proname = 'enter_tournament';
  if v_count <> 1 then
    raise exception 'Expected exactly one enter_tournament function, found %', v_count;
  end if;
end $$;
