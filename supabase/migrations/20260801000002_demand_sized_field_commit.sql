-- =============================================================================
-- Migration: demand-sized tournament field commit
--
-- Phase 2 of CLAUDE_CODE_BRIEF.md's active work queue: wire
-- scheduling.ts's commitField() into real tournament creation (sizeFieldForDemand
-- was already wired via admin-tournament-sizing.ts / suggestFieldSizeAction —
-- this is the other half).
--
-- Reuses existing columns rather than inventing new ones:
-- registration_opens_at and starts_at already exist and are already shown
-- in the UI (countdown). A tournament created with field_commit_mode =
-- 'demand' treats its stored field_size as a CEILING, not a fixed count —
-- registration_opens_at/starts_at become the registration window's
-- open/close bounds, and at close (a new cron job, see the accompanying
-- route) the real field size is committed from actual signups via
-- commitField(), exactly like a poker sit-and-go or DFS contest resolves.
-- 'fixed' (the default) preserves the current behavior exactly — nothing
-- about an existing 'fixed' tournament changes.
-- =============================================================================

alter table public.tournaments
  add column field_commit_mode text not null default 'fixed'
  constraint tournaments_field_commit_mode_check check (field_commit_mode in ('fixed', 'demand'));

comment on column public.tournaments.field_commit_mode is
  'fixed: field_size is exact, as today. demand: field_size is a ceiling; the real size is committed from actual signups at starts_at via commit_tournament_field().';

-- ---------------------------------------------------------------------------
-- commit_tournament_field
--
-- Applies a field-size decision that scheduling.ts's commitField() already
-- computed in TypeScript (this codebase's stated convention: money/field
-- math computed once in TS, the DB function re-validates rather than
-- blindly trusting it). The caller (a cron route running under the
-- service-role client, mirroring recompute-standing/detect-automation) is
-- responsible for refunding any snapped-down overflow entrants via
-- move_balance and removing their tournament_entries rows BEFORE calling
-- this — this function then re-derives the actual remaining entry count
-- and raises if it doesn't match p_final_field_size, rather than trusting
-- the caller's arithmetic. Full under-floor cancellation is handled
-- entirely in the caller (a straight refund-everyone loop, identical in
-- shape to cancelTournamentAction's existing one) — this function is only
-- ever called for the "the contest runs, just smaller" outcome.
--
-- Idempotent: a no-op if the tournament isn't open or isn't in demand mode,
-- so a retried/overlapping cron invocation can't double-apply.
-- ---------------------------------------------------------------------------
create or replace function public.commit_tournament_field(
  p_tournament_id uuid,
  p_final_field_size integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t record;
  v_actual_entries integer;
  v_new_gross integer;
  v_new_rake integer;
  v_new_pool integer;
begin
  select * into t from public.tournaments where id = p_tournament_id for update;
  if not found then
    raise exception 'Tournament not found';
  end if;

  if t.status <> 'open' or t.field_commit_mode <> 'demand' then
    -- Already committed (or not a demand-mode contest at all) — idempotent
    -- no-op, matching resolve_match_dispute's own already-finalized pattern.
    return;
  end if;

  if p_final_field_size < 1 or p_final_field_size > t.field_size then
    raise exception 'Invalid final field size % for ceiling %', p_final_field_size, t.field_size;
  end if;

  select count(*) into v_actual_entries
  from public.tournament_entries
  where tournament_id = p_tournament_id;

  if v_actual_entries <> p_final_field_size then
    raise exception
      'commit_tournament_field: % actual entries does not match requested final size % — caller must refund/remove overflow entrants before calling this',
      v_actual_entries, p_final_field_size;
  end if;

  -- Same arithmetic tournaments_pool_arithmetic_check enforces at insert,
  -- recomputed against the committed field size at the same rake_bps
  -- advertised at creation — the rate never moves, only the field it's
  -- applied against.
  v_new_gross := t.entry_fee_cents * p_final_field_size;
  v_new_rake := floor(v_new_gross * t.rake_bps / 10000.0)::integer;
  v_new_pool := v_new_gross - v_new_rake;

  update public.tournaments
  set field_size = p_final_field_size,
      gross_cents = v_new_gross,
      rake_cents = v_new_rake,
      prize_pool_cents = v_new_pool,
      -- Matches enter_tournament's own status flip when a fixed-mode field
      -- fills naturally — a committed demand-mode field is, by definition,
      -- exactly full the moment it commits.
      status = 'full'
  where id = p_tournament_id;
end;
$$;

revoke execute on function public.commit_tournament_field(uuid, integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Self-test (CLAUDE_CODE_BRIEF §7: anything that moves money or advances a
-- bracket gets one — this both rewrites stored money terms and flips a
-- tournament into its playable state). Constructs a synthetic demand-mode
-- tournament directly (bypassing planTournament/createTournamentAction,
-- which is TS-only) with a ceiling of 4 and two real entrants, commits to
-- a final size of 2, and asserts the arithmetic and status are correct.
-- Also asserts the entries-mismatch guard actually raises.
-- ---------------------------------------------------------------------------
create or replace function public.assert_commit_tournament_field_works()
returns text
language plpgsql
as $$
declare
  v_p1 uuid;
  v_p2 uuid;
  v_tournament_id uuid;
  v_match_ids uuid[] := '{}';
  v_match_id uuid;
  v_mismatch_raised boolean := false;
  t record;
  i integer;
begin
  -- Must satisfy check_contest_eligibility's unconditional gates (account
  -- active, phone verified) as well as the 5-ranked-matches gate seeded
  -- below — a looser "any 2 distinct users" selection (fine for the
  -- disputes self-test, which never passes through this trigger) isn't
  -- enough here.
  select id into v_p1 from public.users
  where account_status = 'active' and phone_verified
  order by created_at limit 1;
  select id into v_p2 from public.users
  where account_status = 'active' and phone_verified and id <> v_p1
  order by created_at limit 1;

  if v_p1 is null or v_p2 is null then
    return 'skipped: needs two distinct active, phone-verified users';
  end if;

  -- enforce_entry_eligibility_on_entry (20260724000006_security_hardening.sql)
  -- requires 5 completed ranked matches for a tournament_standard entry —
  -- real enforcement, restored by 20260801000004, not something this test
  -- should route around. Seeds five real matches between the two probes
  -- rather than disabling the trigger (which is not transaction-scoped and
  -- would risk leaving real entry enforcement off if this function ever
  -- errored between disable and re-enable).
  begin
    for i in 1..5 loop
      insert into public.matches (
        player_1_id, player_2_id, winner_id, loser_id,
        entry_fee_cents, winner_payout_cents, loser_payout_cents, platform_rake_cents,
        ranked, completed_at
      ) values (
        v_p1, v_p2, v_p1, v_p2, 100, 198, 0, 2, true, now()
      ) returning id into v_match_id;
      v_match_ids := array_append(v_match_ids, v_match_id);
    end loop;

    insert into public.tournaments (
      kind, name, entry_fee_cents, field_size, rake_bps,
      gross_cents, rake_cents, prize_pool_cents,
      format_id, ruleset_id, rounds, status, field_commit_mode,
      registration_opens_at, starts_at
    ) values (
      'tournament_standard', '__commit_probe__', 500, 4, 1400,
      2000, 280, 1720,
      'single_elimination', 'classic', 2, 'open', 'demand',
      now() - interval '1 hour', now()
    ) returning id into v_tournament_id;

    insert into public.tournament_entries (tournament_id, user_id, seat_number, entry_fee_paid_cents)
    values
      (v_tournament_id, v_p1, 1, 500),
      (v_tournament_id, v_p2, 2, 500);

    -- Guard: committing to a size that doesn't match actual entries must raise.
    begin
      perform public.commit_tournament_field(v_tournament_id, 3);
    exception when others then
      v_mismatch_raised := true;
    end;
    if not v_mismatch_raised then
      raise exception 'Expected commit_tournament_field to reject a final size that does not match actual entries';
    end if;

    perform public.commit_tournament_field(v_tournament_id, 2);

    select * into t from public.tournaments where id = v_tournament_id;

    if t.field_size <> 2 then
      raise exception 'Expected field_size 2, got %', t.field_size;
    end if;
    if t.gross_cents <> 1000 then
      raise exception 'Expected gross_cents 1000 (500 * 2), got %', t.gross_cents;
    end if;
    if t.rake_cents <> 140 then
      raise exception 'Expected rake_cents 140 (14%% of 1000), got %', t.rake_cents;
    end if;
    if t.prize_pool_cents <> 860 then
      raise exception 'Expected prize_pool_cents 860, got %', t.prize_pool_cents;
    end if;
    if t.status <> 'full' then
      raise exception 'Expected status full after commit, got %', t.status;
    end if;

    -- Idempotency: calling again on the now-'full' tournament must be a
    -- no-op, not an error.
    perform public.commit_tournament_field(v_tournament_id, 2);
  exception when others then
    delete from public.tournament_entries where tournament_id = v_tournament_id;
    delete from public.tournaments where id = v_tournament_id;
    delete from public.matches where id = any(v_match_ids);
    raise;
  end;

  delete from public.tournament_entries where tournament_id = v_tournament_id;
  delete from public.tournaments where id = v_tournament_id;
  delete from public.matches where id = any(v_match_ids);

  return 'ok: commit_tournament_field recomputes gross/rake/pool correctly, flips to full, rejects entry-count mismatches, and is idempotent';
end;
$$;

revoke execute on function public.assert_commit_tournament_field_works() from anon, authenticated;
