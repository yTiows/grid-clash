-- =============================================================================
-- Migration: Elite Performance Benchmark (CLAUDE_CODE_BRIEF.md Feature B)
--
-- GAMEPLAY-ONLY INVARIANT, enforced structurally, not by convention:
-- performance_index_snapshots carries zero financial columns. Not "we agreed
-- not to add one" — assert_performance_index_snapshots_excludes_financial_columns()
-- below introspects information_schema.columns and RAISES if a column whose
-- name resembles stake/fee/payout/balance/wallet/deposit/withdraw/rake/cents
-- (excluding this table's own non-financial *_cents-free score columns, which
-- there are none of — every score column here is a plain integer point
-- total, never a currency amount) is ever added to this table. Run this after
-- any future migration that touches this table, the same way
-- assert_ledger_vocabulary() already gates the ledger's reason vocabulary.
-- =============================================================================

create table public.performance_index_snapshots (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  ruleset_id text not null references public.rulesets (id),
  moves_made integer not null,
  won boolean not null,

  -- Mirrors src/lib/game/scoring.ts's ScoreComponentId union exactly, one
  -- column per component, so performance-index.ts's field mapping and this
  -- table's column list can never silently drift apart from each other.
  score_four_in_a_row integer not null default 0,
  score_board_control integer not null default 0,
  score_threat_density integer not null default 0,
  score_dual_threat integer not null default 0,
  score_positional_dominance integer not null default 0,
  score_forced_response integer not null default 0,
  score_strategic_pressure integer not null default 0,
  score_threat_neutralized integer not null default 0,

  computed_at timestamptz not null default now(),

  constraint performance_index_snapshots_one_per_match_user unique (match_id, user_id),
  constraint performance_index_snapshots_moves_check check (moves_made >= 0),
  constraint performance_index_snapshots_scores_nonneg check (
    score_four_in_a_row >= 0 and score_board_control >= 0 and score_threat_density >= 0 and
    score_dual_threat >= 0 and score_positional_dominance >= 0 and score_forced_response >= 0 and
    score_strategic_pressure >= 0 and score_threat_neutralized >= 0
  )
);

create index performance_index_snapshots_user_idx on public.performance_index_snapshots (user_id, computed_at desc);

comment on table public.performance_index_snapshots is
  'Gameplay-only analytics for Feature B (Elite Performance Benchmark). No financial column may ever be added here — see assert_performance_index_snapshots_excludes_financial_columns(). Computed from src/lib/game/scoring.ts''s Strategic Score ledger for every ranked match, independent of whether Strategic Score is that match''s actual win condition (see match-server.ts settle()).';

-- ---------------------------------------------------------------------------
-- record_performance_snapshot: the only writer.
--
-- security definer + revoke from anon/authenticated, same pattern as every
-- other server-only RPC in this codebase — not because this touches money
-- (it doesn't), but because a player-writable analytics table is a player-
-- forgeable Performance Index, and the whole point of Feature B is that the
-- number is earned by real play, not self-reported.
--
-- Note the parameter list: there is no p_stake_cents, no p_payout, no
-- p_fee — not omitted by choice on each call site, but because they were
-- never added to this function's signature. A caller cannot pass what this
-- function was never written to accept.
-- ---------------------------------------------------------------------------
create or replace function public.record_performance_snapshot(
  p_match_id uuid,
  p_user_id uuid,
  p_ruleset_id text,
  p_moves_made integer,
  p_won boolean,
  p_score_four_in_a_row integer,
  p_score_board_control integer,
  p_score_threat_density integer,
  p_score_dual_threat integer,
  p_score_positional_dominance integer,
  p_score_forced_response integer,
  p_score_strategic_pressure integer,
  p_score_threat_neutralized integer
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.performance_index_snapshots (
    match_id, user_id, ruleset_id, moves_made, won,
    score_four_in_a_row, score_board_control, score_threat_density, score_dual_threat,
    score_positional_dominance, score_forced_response, score_strategic_pressure, score_threat_neutralized
  ) values (
    p_match_id, p_user_id, p_ruleset_id, p_moves_made, p_won,
    p_score_four_in_a_row, p_score_board_control, p_score_threat_density, p_score_dual_threat,
    p_score_positional_dominance, p_score_forced_response, p_score_strategic_pressure, p_score_threat_neutralized
  )
  -- Idempotent by construction (performance_index_snapshots_one_per_match_user):
  -- a retried analytics call after a network blip just no-ops rather than
  -- double-counting one match's contribution to the index.
  on conflict (match_id, user_id) do nothing;
end;
$$;

revoke execute on function public.record_performance_snapshot from public, anon, authenticated;

alter table public.performance_index_snapshots enable row level security;
create policy "performance_index_snapshots_select_own" on public.performance_index_snapshots
  for select to authenticated using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- performance_index columns on player_standing.
--
-- Reuses the existing skill_index/recompute-standing pattern rather than a
-- parallel table: player_standing is already gameplay-only (grep confirms
-- zero financial columns on it, same as the invariant this feature adds),
-- already has the percentile-computation cron this feature extends, and
-- already carries the "computed, not live-queried, denormalised for read
-- volume" convention this fits. Nullable/zero-default: existing rows (there
-- are none live yet) don't need a backfill migration to stay valid.
-- ---------------------------------------------------------------------------
alter table public.player_standing
  add column performance_index integer not null default 0,
  add column pi_tactical integer not null default 0,
  add column pi_threat_creation integer not null default 0,
  add column pi_defense integer not null default 0,
  add column pi_conversion integer not null default 0,
  add column pi_consistency integer not null default 0,
  add column performance_index_percentile numeric(5,2),
  add constraint player_standing_performance_index_range check (performance_index between 0 and 1000),
  add constraint player_standing_pi_components_sum check (
    performance_index = pi_tactical + pi_threat_creation + pi_defense + pi_conversion + pi_consistency
  );

-- ---------------------------------------------------------------------------
-- Structural self-test: the gameplay-only invariant, checked against the
-- live schema, not just against this migration's own text. Run this any
-- time this table or player_standing's PI columns are touched again.
-- ---------------------------------------------------------------------------
create or replace function public.assert_performance_index_snapshots_excludes_financial_columns()
returns text
language plpgsql
as $$
declare
  v_leaked text;
begin
  select string_agg(column_name, ', ') into v_leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('performance_index_snapshots')
    and (
      column_name ~* 'stake|fee|payout|balance|wallet|deposit|withdraw|rake|price|cost|revenue'
      -- '_cents' alone would also flag legitimate non-financial future columns
      -- named e.g. "latency_ms" — none exist today, but the check is scoped
      -- to the actual financial-term list above, not a blanket suffix ban.
    );

  if v_leaked is not null then
    raise exception 'performance_index_snapshots has financial-looking column(s): %. Feature B''s gameplay-only invariant is violated.', v_leaked;
  end if;

  select string_agg(column_name, ', ') into v_leaked
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'player_standing'
    and column_name like 'pi_%'
    and column_name ~* 'stake|fee|payout|balance|wallet|deposit|withdraw|rake|price|cost|revenue';

  if v_leaked is not null then
    raise exception 'player_standing has financial-looking Performance Index column(s): %.', v_leaked;
  end if;

  return 'ok: performance_index_snapshots and player_standing.pi_* carry no financial columns';
end;
$$;
