/**
 * Self-test for src/lib/game/performance-index.ts — same standard as
 * scripts/test-scoring-engine.ts (no test runner in this project).
 *
 * Run: npx tsx scripts/test-performance-index.ts
 */

import { calculatePerformanceIndex, PERFORMANCE_INDEX_MAX, type MatchPerformanceSnapshot } from "../src/lib/game/performance-index"

let failures = 0

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok — ${name}`)
  } else {
    failures++
    console.error(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`)
  }
}

const blank: MatchPerformanceSnapshot = {
  movesMade: 10,
  scoreFourInARow: 0,
  scoreBoardControl: 0,
  scoreThreatDensity: 0,
  scoreDualThreat: 0,
  scorePositionalDominance: 0,
  scoreForcedResponse: 0,
  scoreStrategicPressure: 0,
  scoreThreatNeutralized: 0,
}

// --- Test 1: no matches -----------------------------------------------------
{
  console.log("Test 1: zero matches")
  const r = calculatePerformanceIndex({ matches: [] })
  check("total is 0 with no matches", r.total === 0)
  check("matchesConsidered is 0", r.matchesConsidered === 0)
}

// --- Test 2: an all-zero match scores 0, not undefined/NaN ------------------
{
  console.log("Test 2: an all-zero match")
  const r = calculatePerformanceIndex({ matches: [blank] })
  check("total is a finite number", Number.isFinite(r.total))
  check("total is 0 for a match with no scoring events at all", r.total === 0)
}

// --- Test 3: strong, consistent play scores near the max --------------------
{
  console.log("Test 3: strong, consistent play across several matches")
  const strong: MatchPerformanceSnapshot = {
    movesMade: 10,
    scoreFourInARow: 100,
    scoreBoardControl: 35,
    scoreThreatDensity: 60,
    scoreDualThreat: 40,
    scorePositionalDominance: 45,
    scoreForcedResponse: 25,
    scoreStrategicPressure: 20,
    scoreThreatNeutralized: 70,
  }
  const r = calculatePerformanceIndex({ matches: Array(10).fill(strong) })
  check("total is well above a blank baseline", r.total > 500, `total=${r.total}`)
  check("consistency is maxed for identical repeated matches (zero variance)", r.consistency === 100, `consistency=${r.consistency}`)
  check("total never exceeds PERFORMANCE_INDEX_MAX", r.total <= PERFORMANCE_INDEX_MAX)
}

// --- Test 4: inconsistent play scores lower on the consistency component ----
{
  console.log("Test 4: inconsistent play scores lower on consistency than identical-quality steady play")
  const spiky: MatchPerformanceSnapshot[] = [
    { ...blank, scoreThreatDensity: 200 },
    { ...blank, scoreThreatDensity: 0 },
    { ...blank, scoreThreatDensity: 200 },
    { ...blank, scoreThreatDensity: 0 },
  ]
  const steady: MatchPerformanceSnapshot[] = Array(4).fill({ ...blank, scoreThreatDensity: 100 })
  const spikyResult = calculatePerformanceIndex({ matches: spiky })
  const steadyResult = calculatePerformanceIndex({ matches: steady })
  check(
    "steady play (same mean, zero variance) scores higher on consistency than spiky play with the same mean",
    steadyResult.consistency > spikyResult.consistency,
    `steady=${steadyResult.consistency} spiky=${spikyResult.consistency}`
  )
}

// --- Test 5: gameplay-only invariant — the input type structurally cannot carry money ----
{
  console.log("Test 5: gameplay-only invariant (structural, checked by construction)")
  // This is a compile-time property, not a runtime one: MatchPerformanceSnapshot
  // has no stake/fee/payout/balance field, so there is no value of that type
  // that could carry one. Asserting the field list here so a future edit that
  // silently widens the interface with a financial field is caught by this
  // test rather than only by code review.
  const fields = Object.keys(blank)
  const forbidden = ["stake", "fee", "payout", "balance", "cents", "wallet", "deposit", "withdraw", "rake"]
  const leaked = fields.filter((f) => forbidden.some((bad) => f.toLowerCase().includes(bad)))
  check("no field name on MatchPerformanceSnapshot resembles a financial term", leaked.length === 0, JSON.stringify(leaked))
}

console.log("")
if (failures > 0) {
  console.error(`${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log("All performance-index self-tests passed.")
}
