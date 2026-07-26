-- =============================================================================
-- Migration: Self-attested date of birth at signup
--
-- kyc_records.date_of_birth exists but is only populated when a player
-- completes identity verification, which may be never for a Standard-tier
-- player who never withdraws. A real-money platform needs an age gate at the
-- account's first moment, not only at the point someone tries to cash out.
--
-- This is self-attested, not verified — it does not replace KYC. It is the
-- first line of defence and the thing a minor has to actively lie about to
-- get past, which is a meaningfully higher bar than no gate at all.
-- =============================================================================

alter table public.users
  add column date_of_birth_self_attested date,
  add column terms_accepted_at timestamptz;

alter table public.users
  add constraint users_self_attested_age_check check (
    date_of_birth_self_attested is null
    or date_of_birth_self_attested <= (current_date - interval '18 years')
  );

comment on column public.users.date_of_birth_self_attested is
  'Self-attested at signup. Not a substitute for KYC — see kyc_records.date_of_birth for verified DOB.';
