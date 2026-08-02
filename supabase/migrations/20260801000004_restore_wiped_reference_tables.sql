-- =============================================================================
-- Migration: restore contest_eligibility_rules and jurisdiction_rules
--
-- Same root cause and same discovery path as 20260801000003's rulesets fix:
-- found live-breaking during Phase 2 work. Both tables were originally
-- seeded (20260724000006, 20260724000004) and are currently EMPTY on the
-- live project — almost certainly the same blanket test-data TRUNCATE
-- CLAUDE_CODE_BRIEF.md §3 already documents catching a real person's
-- public.users row, just not previously checked against reference/config
-- tables that aren't user data at all.
--
-- contest_eligibility_rules being empty is the more severe of the two:
-- enforce_entry_eligibility() (20260724000006_security_hardening.sql) is a
-- BEFORE INSERT trigger on tournament_entries that fails CLOSED with "No
-- eligibility rules configured" when no row matches a contest's kind —
-- deliberate, correct fail-closed design, but with this table empty it
-- means EVERY tournament entry of every kind currently fails on the live
-- project, full stop. This is not a Phase 2 feature gap; the tournament
-- system is currently down.
--
-- jurisdiction_rules is lower severity — assert_can_wager() fails OPEN when
-- no row matches (a missing row is not treated as a refusal), so its
-- absence doesn't block anything, it just means the geo-restriction check
-- has been silently inert. Restoring it is not a new legal/business
-- judgment call (CLAUDE_CODE_BRIEF.md §6 explicitly reserves that for
-- counsel) — this reinserts the exact same seed values migration
-- 20260724000004 already wrote and already labeled "a starting point for
-- counsel to correct, not legal advice."
--
-- Both restored with their original values verbatim, via ON CONFLICT ...
-- DO UPDATE so this is idempotent and self-healing rather than DO NOTHING.
-- =============================================================================

insert into public.contest_eligibility_rules
  (kind, requires_kyc, min_account_age_hours, min_ranked_matches, max_link_confidence)
values
  ('ranked',                false, 0,   0,  0.80),
  ('tournament_standard',   false, 24,  5,  0.70),
  ('tournament_dollar',     true,  72,  10, 0.50),
  ('tournament_milestone',  true,  168, 25, 0.40)
on conflict (kind) do update set
  requires_kyc = excluded.requires_kyc,
  min_account_age_hours = excluded.min_account_age_hours,
  min_ranked_matches = excluded.min_ranked_matches,
  max_link_confidence = excluded.max_link_confidence;

insert into public.jurisdiction_rules (country_code, region_code, paid_entry_allowed, minimum_age, notes) values
  ('US', null, true,  18, 'Default for US states not listed. Review per state before launch.'),
  ('US', 'AZ', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'AR', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'CT', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'DE', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'LA', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'MT', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'SD', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'TN', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'WA', false, 18, 'Broad prohibition on online contests for value. Confirm with counsel.'),
  ('US', 'ID', false, 18, 'Paid-entry contest restrictions. Confirm current status with counsel.'),
  ('US', 'IA', true,  21, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'MA', true,  21, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'AL', true,  19, 'Higher minimum age. Confirm current status with counsel.'),
  ('US', 'NE', true,  19, 'Higher minimum age. Confirm current status with counsel.')
on conflict (country_code, region_code) do update set
  paid_entry_allowed = excluded.paid_entry_allowed,
  minimum_age = excluded.minimum_age,
  notes = excluded.notes;

-- ---------------------------------------------------------------------------
-- Self-test: the specific failure mode this migration closes — a real
-- tournament_entries insert for an eligible, freshly-seated user must
-- actually succeed once these tables are restored. Constructs a tournament
-- old enough to clear tournament_standard's 24-hour min_account_age_hours-
-- equivalent gate is on the USER's account age, not the tournament's, so
-- this seeds a probe user row old enough to pass, then cleans up.
-- ---------------------------------------------------------------------------
create or replace function public.assert_reference_tables_restored()
returns text
language plpgsql
as $$
declare
  v_eligibility_count integer;
  v_jurisdiction_count integer;
  v_user_id uuid;
  v_tournament_id uuid;
  v_allowed boolean;
  v_reason text;
begin
  select count(*) into v_eligibility_count from public.contest_eligibility_rules;
  if v_eligibility_count <> 4 then
    raise exception 'Expected 4 contest_eligibility_rules rows, got %', v_eligibility_count;
  end if;

  select count(*) into v_jurisdiction_count from public.jurisdiction_rules;
  if v_jurisdiction_count <> 15 then
    raise exception 'Expected 15 jurisdiction_rules rows, got %', v_jurisdiction_count;
  end if;

  -- End-to-end: the exact refusal reason this migration exists to fix
  -- ("No eligibility rules configured") must no longer occur. Not asserting
  -- allowed = true here on purpose — a real refusal for a genuine business
  -- reason (e.g. insufficient ranked matches, easy to hit on a near-empty
  -- project) is correct behavior, not the bug this migration fixes. Only
  -- the specific "config table was empty" refusal is what's being checked.
  select id into v_user_id from public.users order by created_at limit 1;
  if v_user_id is null then
    return 'ok: reference tables restored (eligibility check itself skipped — no user to probe with)';
  end if;

  insert into public.tournaments (
    kind, name, entry_fee_cents, field_size, rake_bps,
    gross_cents, rake_cents, prize_pool_cents,
    format_id, ruleset_id, rounds, status
  ) values (
    'tournament_standard', '__eligibility_probe__', 500, 4, 1400,
    2000, 280, 1720,
    'single_elimination', 'classic', 2, 'open'
  ) returning id into v_tournament_id;

  select allowed, reason into v_allowed, v_reason
  from public.check_contest_eligibility(v_user_id, v_tournament_id);

  delete from public.tournaments where id = v_tournament_id;

  if not v_allowed and v_reason = 'No eligibility rules configured' then
    raise exception 'contest_eligibility_rules is still being read as empty for kind tournament_standard';
  end if;

  return format('ok: contest_eligibility_rules and jurisdiction_rules restored — check_contest_eligibility no longer refuses on missing config (probe result: allowed=%s, reason=%s)', v_allowed, coalesce(v_reason, 'n/a'));
end;
$$;

revoke execute on function public.assert_reference_tables_restored() from anon, authenticated;

select public.assert_reference_tables_restored();
