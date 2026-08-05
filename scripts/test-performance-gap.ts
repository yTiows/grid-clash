/**
 * Self-test for src/lib/game/performance-gap.ts (Feature C). Same standard
 * as this project's other pure-logic self-tests, plus one this file adds
 * that the others don't need: an exhaustive scan of every copy string this
 * module can ever generate against brand/BRAND.md's banned-vocabulary list
 * and this feature's own added constraints (no money framing, no
 * continued-play nudge). Every band × every focus category is enumerated
 * and scanned — not just the strings a human reviewer happened to read.
 *
 * Run: npx tsx scripts/test-performance-gap.ts
 */

import { buildPerformanceGapReport, type PerformanceGapReport } from "../src/lib/game/performance-gap"
import type { MatchPerformanceSnapshot } from "../src/lib/game/performance-index"

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

// A snapshot strong specifically in one category, weak in the others —
// used to force each band/category combination deterministically rather
// than hoping random inputs happen to hit every branch.
function snapshotFavoring(category: "tactical" | "threatCreation" | "defense" | "conversion"): MatchPerformanceSnapshot {
  const s = { ...blank }
  if (category === "tactical") {
    s.scoreBoardControl = 35
    s.scorePositionalDominance = 15
  } else if (category === "threatCreation") {
    s.scoreThreatDensity = 40
    s.scoreDualThreat = 40
  } else if (category === "defense") {
    s.scoreThreatNeutralized = 70
  } else {
    s.scoreFourInARow = 100
  }
  return s
}

// --- Test 1: the first-match bug the adversarial review caught, fixed -------
// The first version of this module compared every match against the
// player's lifetime personal best, which meant a brand-new player's very
// first match was trivially "their own best" (n=1) and fired celebratory
// copy with zero instructional content. This test pins the fix.
{
  console.log("Test 1: a player's first few matches never trigger a 'personal best' or comparison claim")
  const r = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 500,
    recentAverageIndex: 0,
    priorPersonalBestIndex: 0,
    priorMatchCount: 0, // literally their first match
    rulesetName: "Classic",
  })
  check("band is 'first_match', not 'new_personal_best'", r.band === "first_match")
  check("headline does not claim a personal best on match #1", !r.headline.toLowerCase().includes("best"))

  const r2 = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 500,
    recentAverageIndex: 200,
    priorPersonalBestIndex: 400,
    priorMatchCount: 3, // below MIN_MATCHES_FOR_COMPARISON (5)
    rulesetName: "Classic",
  })
  check("still 'first_match' with only 3 prior matches (below the 5-match minimum)", r2.band === "first_match")
}

// --- Test 2: new personal best requires real history ------------------------
{
  console.log("Test 2: new personal best, gated on real history")
  const r = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 500,
    recentAverageIndex: 300,
    priorPersonalBestIndex: 400,
    priorMatchCount: 10,
    rulesetName: "Classic",
  })
  check("a match above prior personal best with enough history is 'new_personal_best'", r.band === "new_personal_best")
}

// --- Test 3: rolling-average comparison bands --------------------------------
{
  console.log("Test 3: rolling-average comparison (not lifetime max)")
  const steady = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 310,
    recentAverageIndex: 300, // 10-point delta, under the 30-point noise threshold
    priorPersonalBestIndex: 500,
    priorMatchCount: 10,
    rulesetName: "Classic",
  })
  check("a small delta from recent average is 'steady'", steady.band === "steady")

  const above = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 400,
    recentAverageIndex: 300, // +100
    priorPersonalBestIndex: 500,
    priorMatchCount: 10,
    rulesetName: "Classic",
  })
  check("meaningfully above recent average (but not a new best) is 'above_recent_form'", above.band === "above_recent_form")

  const below = buildPerformanceGapReport({
    thisMatch: blank,
    thisMatchIndex: 200,
    recentAverageIndex: 300, // -100
    priorPersonalBestIndex: 500,
    priorMatchCount: 10,
    rulesetName: "Classic",
  })
  check("meaningfully below recent average is 'below_recent_form'", below.band === "below_recent_form")
  check("focusCategory is set for a below_recent_form report", below.focusCategory !== null)
}

// --- Test 4: below-average reports always pair the coaching note with an affirmation ----
// The adversarial review's other blocking finding: a bare deficit with
// nothing named as having gone well reads as "kicking someone while
// they're down," especially since this band structurally over-represents
// people who just lost. Pinned here so it can't silently regress.
{
  console.log("Test 4: below-average reports name a strength alongside the coaching note")
  const s = snapshotFavoring("defense") // strong in defense, weak everywhere else
  const r = buildPerformanceGapReport({
    thisMatch: s,
    thisMatchIndex: 200,
    recentAverageIndex: 350,
    priorPersonalBestIndex: 500,
    priorMatchCount: 10,
    rulesetName: "Classic",
  })
  check("below_recent_form band", r.band === "below_recent_form")
  check("focus category is not the player's actual strongest category", r.focusCategory !== "defense", `focusCategory=${r.focusCategory}`)
  check(
    "the note names something the player did well, not just the weak spot",
    r.note.includes("shut down their attempts clean"),
    r.note
  )
}

// --- Test 5: exhaustive banned-vocabulary + added-constraint scan -----------
{
  console.log("Test 5: exhaustive copy scan (all bands x all focus categories)")

  const BANNED = [
    "luck", "lucky", "unlucky",
    "chance", "odds", "jackpot",
    "bet", "wager", "gamble", "stake",
    "win big", "cash out big", "life-changing",
    "free money", "guaranteed", "risk-free",
    "profit", "bracket", "breakeven", "break-even", "money", "cash", "payout",
    "entry fee", "balance", "deposit", "withdraw",
    "queue again", "play again", "queue up", "try again", "keep playing", "one more",
  ]

  const categories = ["tactical", "threatCreation", "defense", "conversion"] as const
  const reports: PerformanceGapReport[] = []

  reports.push(
    buildPerformanceGapReport({ thisMatch: blank, thisMatchIndex: 500, recentAverageIndex: 0, priorPersonalBestIndex: 0, priorMatchCount: 0, rulesetName: "Classic" })
  )

  for (const c of categories) {
    reports.push(
      buildPerformanceGapReport({
        thisMatch: snapshotFavoring(c),
        thisMatchIndex: 500,
        recentAverageIndex: 300,
        priorPersonalBestIndex: 400,
        priorMatchCount: 10,
        rulesetName: "Classic",
      })
    )
  }

  reports.push(
    buildPerformanceGapReport({ thisMatch: blank, thisMatchIndex: 310, recentAverageIndex: 300, priorPersonalBestIndex: 500, priorMatchCount: 10, rulesetName: "Classic" })
  )

  for (const c of categories) {
    reports.push(
      buildPerformanceGapReport({
        thisMatch: snapshotFavoring(c),
        thisMatchIndex: 400,
        recentAverageIndex: 300,
        priorPersonalBestIndex: 500,
        priorMatchCount: 10,
        rulesetName: "Classic",
      })
    )
  }

  const allCategories = ["tactical", "threatCreation", "defense", "conversion"] as const
  for (const weak of allCategories) {
    const s = { ...blank }
    for (const c of allCategories) {
      if (c === weak) continue
      const favored = snapshotFavoring(c)
      Object.assign(s, {
        scoreBoardControl: s.scoreBoardControl + favored.scoreBoardControl,
        scorePositionalDominance: s.scorePositionalDominance + favored.scorePositionalDominance,
        scoreThreatDensity: s.scoreThreatDensity + favored.scoreThreatDensity,
        scoreDualThreat: s.scoreDualThreat + favored.scoreDualThreat,
        scoreThreatNeutralized: s.scoreThreatNeutralized + favored.scoreThreatNeutralized,
        scoreFourInARow: s.scoreFourInARow + favored.scoreFourInARow,
      })
    }
    reports.push(
      buildPerformanceGapReport({ thisMatch: s, thisMatchIndex: 200, recentAverageIndex: 350, priorPersonalBestIndex: 500, priorMatchCount: 10, rulesetName: "Classic" })
    )
  }

  let scannedStrings = 0
  for (const report of reports) {
    for (const field of [report.headline, report.note] as const) {
      scannedStrings++
      const lower = field.toLowerCase()
      for (const bad of BANNED) {
        if (lower.includes(bad)) {
          failures++
          console.error(`  FAIL — banned term "${bad}" found in generated copy: "${field}"`)
        }
      }
    }
  }
  check(`scanned ${scannedStrings} generated strings across ${reports.length} band/category combinations, zero banned terms`, true)
  check("at least one string was actually scanned (a passing count of zero would be a vacuous test)", scannedStrings > 0)
}

// --- Test 6: never links anywhere but the tutorial (informational, not a play CTA) ----
{
  console.log("Test 6: tutorialHref is always the informational tutorial, never a play/queue destination")
  const r = buildPerformanceGapReport({ thisMatch: blank, thisMatchIndex: 200, recentAverageIndex: 350, priorPersonalBestIndex: 500, priorMatchCount: 10, rulesetName: "Classic" })
  check("tutorialHref points at /tutorial", r.tutorialHref === "/tutorial")
}

console.log("")
if (failures > 0) {
  console.error(`${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log("All performance-gap self-tests passed.")
}
