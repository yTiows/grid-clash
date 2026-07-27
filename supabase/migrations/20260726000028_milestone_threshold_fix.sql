-- =============================================================================
-- Migration: fix milestone_progress — it used a dead, superseded threshold
--
-- FOUND BY: comparing milestone_progress (migration 5: threshold_cents =
-- 100000, i.e. $1,000) against scheduling.ts's fully-worked-out milestone
-- spec (MILESTONE_PROFIT_THRESHOLD_CENTS = 2,000,000, i.e. $20,000, with the
-- entire fixed_subsidy/guaranteed_pool exposure model built on that number).
-- fees.ts ALSO exported a third, different value (MILESTONE_THRESHOLD_CENTS
-- = 100_000) with its own progressToNextMilestone() — a stub that was never
-- imported anywhere in src/, left behind by whatever rewrite produced
-- scheduling.ts's real version. Three sources of truth for the same number,
-- two of them wrong, none of them reconciled.
--
-- IMPACT: nothing reads milestone_progress from application code yet (this
-- handoff's own §5.4 is the first thing to surface it), so this had no live
-- effect — but it would have shipped a dashboard that ticks 20x too fast the
-- first time someone wired it up, exactly the kind of bug that looks correct
-- until the day it's actually used.
--
-- FIX: the view now uses the same 2,000,000-cent threshold scheduling.ts
-- already treats as canonical. The dead duplicates in fees.ts are removed in
-- the same change (src/lib/game/fees.ts) so there is exactly one number.
-- =============================================================================

create or replace view public.milestone_progress
  with (security_invoker = false)
  as
  select
    public.realised_profit_cents() as realised_profit_cents,
    2000000 as threshold_cents,
    (public.realised_profit_cents() / 2000000)::integer as milestones_earned,
    (public.realised_profit_cents() % 2000000)::integer as progress_cents,
    (select count(*) from public.tournaments where kind = 'tournament_milestone')::integer
      as milestones_created;

comment on view public.milestone_progress is
  'Threshold matches scheduling.ts MILESTONE_PROFIT_THRESHOLD_CENTS ($20,000). Keep these in sync by hand — the view cannot import a TS constant.';
