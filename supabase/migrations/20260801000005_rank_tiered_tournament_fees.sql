-- =============================================================================
-- Migration: rank-tiered tournament fees
--
-- Phase 2 hard-stop deliverable, confirmed by the person before this was
-- written (CLAUDE_CODE_BRIEF.md §5): tournaments and ranked both now share
-- the same 10% headline rate after the 2026-07-28 repricing, so ranked's
-- established/elite fee discount needs a tournament-side counterpart or the
-- funnel toward tournaments loses one of its levers.
--
-- A tournament pools money from its whole field at ONE rake rate — unlike
-- ranked, where each match is a private 2-party pot, there's no way to give
-- individual entrants different effective rates inside the same pool
-- without breaking gross_cents = entry_fee_cents * field_size, the
-- invariant every CHECK constraint and payout function here assumes. So
-- this is a per-CONTEST tier, not a per-entrant discount: a tournament is
-- created gated to a minimum player_standing.fee_tier and charges that
-- tier's rate (src/lib/game/formats.ts FORMAT_TIER_RAKE_BPS) for the whole
-- field — the same shape poker/DFS actually use for tournaments (rakeback
-- after the fact, via the loyalty points this codebase already has, not a
-- different up-front rate inside one pool).
-- =============================================================================

alter table public.tournaments
  add column min_player_tier text not null default 'standard'
  constraint tournaments_min_player_tier_check check (min_player_tier in ('standard', 'established', 'elite'));

comment on column public.tournaments.min_player_tier is
  'Minimum player_standing.fee_tier required to enter (enforced in check_contest_eligibility). Also the tier this contest''s stored rake_bps was priced at — src/lib/game/formats.ts FORMAT_TIER_RAKE_BPS.';

create index tournaments_min_player_tier_idx on public.tournaments (min_player_tier) where min_player_tier <> 'standard';

-- ---------------------------------------------------------------------------
-- check_contest_eligibility: adds the player-tier gate. Everything else in
-- this function is unchanged from 20260724000006_security_hardening.sql —
-- reproduced in full because this is a body-only CREATE OR REPLACE (the
-- signature is untouched, so this is safe per this codebase's own hard
-- lesson on enter_tournament: DROP FUNCTION is only required when a
-- parameter is added, not for a body edit).
-- ---------------------------------------------------------------------------
create or replace function public.check_contest_eligibility(
  p_user_id uuid,
  p_tournament_id uuid
)
returns table (allowed boolean, reason text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_status text;
  v_min_player_tier text;
  v_rules public.contest_eligibility_rules%rowtype;
  v_user public.users%rowtype;
  v_ranked_matches integer;
  v_linked_entrants integer;
  v_player_tier text;
  v_player_rank integer;
  v_required_rank integer;
begin
  select t.kind, t.status, t.min_player_tier into v_kind, v_status, v_min_player_tier
  from public.tournaments t where t.id = p_tournament_id;

  if not found then
    return query select false, 'Contest not found'; return;
  end if;

  if v_status <> 'open' then
    return query select false, 'Contest is not open for entry'; return;
  end if;

  select * into v_user from public.users where id = p_user_id;
  if not found then
    return query select false, 'Unknown player'; return;
  end if;

  if v_user.account_status <> 'active' then
    return query select false, 'Account is not active'; return;
  end if;

  if public.is_self_excluded(p_user_id) then
    return query select false, 'Self-exclusion is active'; return;
  end if;

  select * into v_rules from public.contest_eligibility_rules where kind = v_kind;
  if not found then
    return query select false, 'No eligibility rules configured'; return;
  end if;

  if v_rules.requires_kyc and not v_user.kyc_verified then
    return query select false, 'Identity verification required for this contest'; return;
  end if;

  if not v_user.phone_verified then
    return query select false, 'Phone verification required'; return;
  end if;

  if v_user.created_at > now() - make_interval(hours => v_rules.min_account_age_hours) then
    return query select false, format('Account must be at least %s hours old', v_rules.min_account_age_hours); return;
  end if;

  select count(*) into v_ranked_matches
  from public.matches
  where player_1_id = p_user_id or player_2_id = p_user_id;

  if v_ranked_matches < v_rules.min_ranked_matches then
    return query select false, format('Play %s ranked matches to unlock this contest', v_rules.min_ranked_matches); return;
  end if;

  -- Rank-gated tournament tier (Phase 2 economy rebuild). A tournament with
  -- min_player_tier = 'standard' (the default — every pre-existing
  -- tournament) skips this entirely, so nothing about current behavior
  -- changes for a standard contest. player_standing may not have a row yet
  -- (a brand-new account, or before the standing-recompute cron has ever
  -- run) — treated as 'standard', the same default FEE_TIERS itself uses
  -- for an unclassified account.
  if v_min_player_tier <> 'standard' then
    select fee_tier into v_player_tier from public.player_standing where user_id = p_user_id;
    v_player_tier := coalesce(v_player_tier, 'standard');

    v_player_rank := case v_player_tier
      when 'elite' then 2
      when 'established' then 1
      else 0
    end;
    v_required_rank := case v_min_player_tier
      when 'elite' then 2
      when 'established' then 1
      else 0
    end;

    if v_player_rank < v_required_rank then
      return query select false, format('This contest requires %s tier or above (yours: %s)', v_min_player_tier, v_player_tier); return;
    end if;
  end if;

  -- The sockpuppet gate: refuse if a linked account already holds a seat.
  if v_rules.enforce_account_links then
    select count(*) into v_linked_entrants
    from public.tournament_entries e
    join public.account_links l
      on (l.user_id_1 = p_user_id and l.user_id_2 = e.user_id)
      or (l.user_id_2 = p_user_id and l.user_id_1 = e.user_id)
    where e.tournament_id = p_tournament_id
      and l.confidence_score >= v_rules.max_link_confidence
      and l.review_action is distinct from 'cleared';

    if v_linked_entrants > 0 then
      return query select false, 'A linked account already holds a seat in this contest'; return;
    end if;
  end if;

  return query select true, null::text;
end;
$$;

-- ---------------------------------------------------------------------------
-- Self-test: a standard-tier player must be refused entry to an
-- elite-gated contest, and admitted once their player_standing.fee_tier is
-- raised to elite. Seeds five completed matches for the probe player first
-- (same reasoning as assert_commit_tournament_field_works — tournament_
-- standard's contest_eligibility_rules require 5 ranked matches, so without
-- this the test would fail on an EARLIER, unrelated gate and misreport the
-- tier gate as broken). Restores/removes its own player_standing row
-- afterward rather than leaving a probe value behind.
-- ---------------------------------------------------------------------------
create or replace function public.assert_rank_tiered_tournament_gating_works()
returns text
language plpgsql
as $$
declare
  v_user_id uuid;
  v_opponent_id uuid;
  v_tournament_id uuid;
  v_match_ids uuid[] := '{}';
  v_match_id uuid;
  v_had_standing boolean;
  v_prior_tier text;
  v_allowed boolean;
  v_reason text;
  i integer;
begin
  select id into v_user_id from public.users
  where account_status = 'active' and phone_verified
  order by created_at limit 1;
  select id into v_opponent_id from public.users where id <> v_user_id order by created_at limit 1;

  if v_user_id is null or v_opponent_id is null then
    return 'skipped: needs an active, phone-verified user plus one other distinct user';
  end if;

  select exists(select 1 from public.player_standing where user_id = v_user_id) into v_had_standing;
  if v_had_standing then
    select fee_tier into v_prior_tier from public.player_standing where user_id = v_user_id;
  end if;

  begin
    for i in 1..5 loop
      insert into public.matches (
        player_1_id, player_2_id, winner_id, loser_id,
        entry_fee_cents, winner_payout_cents, loser_payout_cents, platform_rake_cents,
        ranked, completed_at
      ) values (
        v_user_id, v_opponent_id, v_user_id, v_opponent_id, 100, 198, 0, 2, true, now()
      ) returning id into v_match_id;
      v_match_ids := array_append(v_match_ids, v_match_id);
    end loop;

    insert into public.tournaments (
      kind, name, entry_fee_cents, field_size, rake_bps,
      gross_cents, rake_cents, prize_pool_cents,
      format_id, ruleset_id, rounds, status, min_player_tier
    ) values (
      'tournament_standard', '__tier_gate_probe__', 25000, 4, 700,
      100000, 7000, 93000,
      'single_elimination', 'classic', 2, 'open', 'elite'
    ) returning id into v_tournament_id;

    -- No player_standing row at all (brand-new account) must be treated as
    -- 'standard' and refused for an elite-gated contest, not error out.
    delete from public.player_standing where user_id = v_user_id;

    select allowed, reason into v_allowed, v_reason
    from public.check_contest_eligibility(v_user_id, v_tournament_id);

    if v_allowed then
      raise exception 'Expected a player with no player_standing row to be refused an elite-gated contest, was allowed';
    end if;
    if v_reason not ilike '%requires elite tier%' then
      raise exception 'Refused for the wrong reason (an earlier gate, not the tier check): %', v_reason;
    end if;

    -- Now genuinely elite-tier: the tier gate specifically must stop firing.
    insert into public.player_standing (user_id, fee_tier)
    values (v_user_id, 'elite')
    on conflict (user_id) do update set fee_tier = 'elite';

    select allowed, reason into v_allowed, v_reason
    from public.check_contest_eligibility(v_user_id, v_tournament_id);

    if not v_allowed and v_reason ilike '%requires elite tier%' then
      raise exception 'Elite-tier player was still refused by the tier gate after being raised to elite: %', v_reason;
    end if;
    if not v_allowed then
      raise exception 'Expected an elite-tier player clearing every other gate to be allowed, refused for: %', v_reason;
    end if;
  exception when others then
    delete from public.tournaments where id = v_tournament_id;
    delete from public.matches where id = any(v_match_ids);
    if v_had_standing then
      update public.player_standing set fee_tier = v_prior_tier where user_id = v_user_id;
    else
      delete from public.player_standing where user_id = v_user_id;
    end if;
    raise;
  end;

  delete from public.tournaments where id = v_tournament_id;
  delete from public.matches where id = any(v_match_ids);
  if v_had_standing then
    update public.player_standing set fee_tier = v_prior_tier where user_id = v_user_id;
  else
    delete from public.player_standing where user_id = v_user_id;
  end if;

  return 'ok: rank-tiered tournament gating refuses below-tier players (including no player_standing row at all) and admits them once raised to the required tier';
end;
$$;

revoke execute on function public.assert_rank_tiered_tournament_gating_works() from anon, authenticated;

select public.assert_rank_tiered_tournament_gating_works();
