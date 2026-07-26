-- =============================================================================
-- Migration: phone_verifications unique constraint
--
-- FOUND BY: writing src/actions/phone.ts against the live schema. The action
-- upserts on (user_id, phone_number) — re-attempting a code for the same
-- number should update one tracked row, not accumulate a new one per SMS
-- sent. No constraint enforced that, so the upsert would have thrown
-- "there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" on its very first call. Neither tsc nor next build can see
-- this class of bug — it only exists at the boundary between application
-- code and the database, which is exactly why every migration this session
-- has been verified by running it, not just applying it.
-- =============================================================================

-- Pre-existing duplicate (user_id, phone_number) rows, if any, are collapsed
-- to the most recent before the constraint is added — a constraint can't be
-- added over data that already violates it.
delete from public.phone_verifications a
using public.phone_verifications b
where a.user_id = b.user_id
  and a.phone_number = b.phone_number
  and a.created_at < b.created_at;

alter table public.phone_verifications
  add constraint phone_verifications_user_phone_unique unique (user_id, phone_number);
