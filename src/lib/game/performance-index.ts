/**
 * Elite Performance Benchmark — CLAUDE_CODE_BRIEF.md "Feature B".
 *
 * GAMEPLAY-ONLY INVARIANT, enforced structurally, not by convention:
 * PerformanceIndexInputs (below) has no field that could ever hold a
 * financial value — no stake, no fee, no payout, no balance. It is built
 * exclusively from performance_index_snapshots rows (see the migration),
 * a table that itself carries zero financial columns — see
 * assert_performance_index_snapshots_excludes_financial_columns() in that
 * migration, which introspects information_schema.columns and fails the
 * moment a stake/fee/payout/balance/cents-that-isn't-a-score column is
 * added to it. Two players who play identically-well get an identical
 * PerformanceIndexInputs and therefore an identical Performance Index
 * whether they staked $1 or $1,000 — not because this file promises not to
 * look at money, but because nothing money-shaped is reachable from the
 * type this function accepts. A future change that tried to pass a
 * financial figure in would not compile against this interface, and even
 * if the interface were widened, the query that populates it would still
 * have to reach past the snapshot table's own column set to find one.
 *
 * Reuses scoring.ts's Strategic Score components as its raw signal (the
 * dependency CLAUDE_CODE_BRIEF.md describes: "the scoring engine underlies
 * the Performance Index") — computed for every ranked match regardless of
 * whether Strategic Score is that match's actual win condition. This is
 * pure analytics on move quality, not a settlement decision.
 */

import type { ScoreComponentId } from "./scoring"

export const PERFORMANCE_INDEX_MAX = 1000

export interface MatchPerformanceSnapshot {
  movesMade: number
  scoreFourInARow: number
  scoreBoardControl: number
  scoreThreatDensity: number
  scoreDualThreat: number
  scorePositionalDominance: number
  scoreForcedResponse: number
  scoreStrategicPressure: number
  scoreThreatNeutralized: number
}

export interface PerformanceIndexInputs {
  /** Oldest first. Recent-match window (how many, how recent) is the caller's decision — this function just aggregates whatever it's given. */
  matches: MatchPerformanceSnapshot[]
}

export interface PerformanceIndexBreakdown {
  total: number
  tactical: number
  threatCreation: number
  defense: number
  conversion: number
  consistency: number
  matchesConsidered: number
  /** Shown to the player so the number is never a black box — mirrors reputation.ts's calculateSkillIndex. */
  explanation: string[]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function ratePerMove(snapshot: MatchPerformanceSnapshot, components: ScoreComponentId[]): number {
  if (snapshot.movesMade <= 0) return 0
  const fieldByComponent: Record<ScoreComponentId, number> = {
    four_in_a_row: snapshot.scoreFourInARow,
    board_control: snapshot.scoreBoardControl,
    threat_density: snapshot.scoreThreatDensity,
    dual_threat: snapshot.scoreDualThreat,
    positional_dominance: snapshot.scorePositionalDominance,
    forced_response: snapshot.scoreForcedResponse,
    strategic_pressure: snapshot.scoreStrategicPressure,
    threat_neutralized: snapshot.scoreThreatNeutralized,
  }
  const sum = components.reduce((s, c) => s + fieldByComponent[c], 0)
  return sum / snapshot.movesMade
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((s, v) => s + v, 0) / values.length
}

function populationStdDev(values: number[]): number {
  if (values.length === 0) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

/**
 * Calibration constants below. These convert a raw "points per move" rate
 * (whose scale comes entirely from scoring.ts's own constants — see that
 * file) into a 0..weight sub-score. Picked from CLAUDE_CODE_BRIEF.md Feature
 * A Phase 2's balanced bot-vs-bot simulation data (mean ~10.5-19 moves/game
 * depending on ruleset, board_control firing ~1x/game, threat_density/
 * dual_threat/positional_dominance firing several times across a real
 * game) as a reasonable order-of-magnitude anchor, not a value tuned against
 * real human play — no human match volume exists yet (see
 * CLAUDE_CODE_BRIEF.md §4). Revisit once it does, the same "get the number
 * first" standard already applied to this codebase's game-balance and
 * fee-tier decisions.
 */
const RATE_SCALE = {
  tactical: 12, // board_control (35) + positional_dominance (15) per move, expected ceiling
  threatCreation: 15, // threat_density (20/threat) + dual_threat (40) per move
  defense: 10, // threat_neutralized (35) per move
  conversion: 8, // four_in_a_row (100, scaled by connectTarget) per move — naturally small since it fires at most once
} as const

const WEIGHTS = {
  tactical: 350,
  threatCreation: 250,
  defense: 200,
  conversion: 100,
  consistency: 100,
} as const

/** Every weight bucket above must sum to PERFORMANCE_INDEX_MAX, or the published total is a lie — same invariant reputation.ts's SkillIndex components enforce, checked once at module load rather than trusted. */
const WEIGHT_SUM = WEIGHTS.tactical + WEIGHTS.threatCreation + WEIGHTS.defense + WEIGHTS.conversion + WEIGHTS.consistency
if (WEIGHT_SUM !== PERFORMANCE_INDEX_MAX) {
  throw new Error(`performance-index.ts: WEIGHTS sum to ${WEIGHT_SUM}, expected ${PERFORMANCE_INDEX_MAX}`)
}

export type PerformanceSubScoreCategory = "tactical" | "threatCreation" | "defense" | "conversion"

/**
 * Per-category rate for a SINGLE match, expressed as a 0..1+ fraction of
 * RATE_SCALE (the same calibration calculatePerformanceIndex itself uses,
 * not a second set of numbers). Exported for src/lib/game/performance-gap.ts
 * (Feature C), which needs to name which category was weakest in one
 * specific match — "one tested implementation," not a second formula that
 * could drift from this one.
 */
export function matchSubScoreFractions(snapshot: MatchPerformanceSnapshot): Record<PerformanceSubScoreCategory, number> {
  return {
    tactical: ratePerMove(snapshot, ["board_control", "positional_dominance"]) / RATE_SCALE.tactical,
    threatCreation: ratePerMove(snapshot, ["threat_density", "dual_threat"]) / RATE_SCALE.threatCreation,
    defense: ratePerMove(snapshot, ["threat_neutralized"]) / RATE_SCALE.defense,
    conversion: ratePerMove(snapshot, ["four_in_a_row"]) / RATE_SCALE.conversion,
  }
}

export function calculatePerformanceIndex(inputs: PerformanceIndexInputs): PerformanceIndexBreakdown {
  const { matches } = inputs

  if (matches.length === 0) {
    return {
      total: 0,
      tactical: 0,
      threatCreation: 0,
      defense: 0,
      conversion: 0,
      consistency: 0,
      matchesConsidered: 0,
      explanation: ["No ranked matches yet — the index starts once you have some."],
    }
  }

  const tacticalRates = matches.map((m) => ratePerMove(m, ["board_control", "positional_dominance"]))
  const threatRates = matches.map((m) => ratePerMove(m, ["threat_density", "dual_threat"]))
  const defenseRates = matches.map((m) => ratePerMove(m, ["threat_neutralized"]))
  const conversionRates = matches.map((m) => ratePerMove(m, ["four_in_a_row"]))
  const totalRates = matches.map(
    (_, i) => tacticalRates[i]! + threatRates[i]! + defenseRates[i]! + conversionRates[i]!
  )

  const tactical = Math.round(clamp(mean(tacticalRates) / RATE_SCALE.tactical, 0, 1) * WEIGHTS.tactical)
  const threatCreation = Math.round(
    clamp(mean(threatRates) / RATE_SCALE.threatCreation, 0, 1) * WEIGHTS.threatCreation
  )
  const defense = Math.round(clamp(mean(defenseRates) / RATE_SCALE.defense, 0, 1) * WEIGHTS.defense)
  const conversion = Math.round(clamp(mean(conversionRates) / RATE_SCALE.conversion, 0, 1) * WEIGHTS.conversion)

  // Consistency: steadier per-match quality scores higher, same shape as
  // reputation.ts's calculateSkillIndex consistency term. Scale (0.5) is a
  // fraction of RATE_SCALE's own combined magnitude, not an independent
  // guess — a player whose total rate swings by more than half the combined
  // scale from match to match is, by definition, inconsistent relative to
  // their own ceiling.
  //
  // signalFactor guards a real degenerate case caught by this file's own
  // self-test: zero variance around a rate of zero (a player who never
  // triggers any component, every match) is mathematically "perfectly
  // consistent" but has nothing to actually be consistent about — without
  // this factor a totally inactive-in-play player scored full consistency
  // marks. Scaled against 10% of the combined rate ceiling: below that
  // average signal, consistency is down-weighted proportionally rather than
  // awarded in full for steadily doing nothing.
  const combinedScale = RATE_SCALE.tactical + RATE_SCALE.threatCreation + RATE_SCALE.defense + RATE_SCALE.conversion
  const stdDev = populationStdDev(totalRates)
  const signalFactor = clamp(mean(totalRates) / (combinedScale * 0.1), 0, 1)
  const consistency = Math.round(clamp(1 - stdDev / (combinedScale * 0.5), 0, 1) * signalFactor * WEIGHTS.consistency)

  const total = tactical + threatCreation + defense + conversion + consistency

  const explanation = [
    `Tactical ${tactical}/${WEIGHTS.tactical} — board control and central presence per move`,
    `Threat creation ${threatCreation}/${WEIGHTS.threatCreation} — new threats and forks per move`,
    `Defense ${defense}/${WEIGHTS.defense} — opponent threats neutralized per move`,
    `Conversion ${conversion}/${WEIGHTS.conversion} — closing out winning positions efficiently`,
    `Consistency ${consistency}/${WEIGHTS.consistency} — steadier play across your last ${matches.length} matches scores higher`,
  ]

  return { total, tactical, threatCreation, defense, conversion, consistency, matchesConsidered: matches.length, explanation }
}
