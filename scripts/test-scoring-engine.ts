/**
 * Self-test for src/lib/game/scoring.ts — the same "actually execute it,
 * don't just read it" standard CLAUDE_CODE_BRIEF.md applies to every
 * assert_* SQL self-test in this project, applied here since there is no
 * test runner in this project (checked package.json — brief §3, Phase 4).
 *
 * Run: npx tsx scripts/test-scoring-engine.ts
 * Exits non-zero on any failure so it can gate a commit/CI the same way a
 * failing assert_* SQL function would.
 */

import { CLASSIC } from "../src/lib/game/rulesets"
import { computeStrategicScore, type ReplayEntry } from "../src/lib/game/scoring"

let failures = 0

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    console.log(`  ok — ${name}`)
  } else {
    failures++
    console.error(`  FAIL — ${name}${detail ? `: ${detail}` : ""}`)
  }
}

function move(slot: 1 | 2, index: number): ReplayEntry {
  return { kind: "move", slot, move: { kind: "normal", index } }
}

// --- Test 1: determinism ---------------------------------------------------
// "Given the same replay, every implementation must always produce the same
// score" (CLAUDE_CODE_BRIEF.md, Feature A). Not a formality — this is the
// literal requirement, so it gets its own test rather than being assumed
// from "the function is pure."
{
  console.log("Test 1: determinism")
  const replay: ReplayEntry[] = [
    move(1, 12), move(2, 0), move(1, 13), move(2, 1),
    move(1, 14), move(2, 2), move(1, 11), // P1 completes a line at 11-14
  ]
  const a = computeStrategicScore(CLASSIC, replay)
  const b = computeStrategicScore(CLASSIC, replay)
  check("identical ledger JSON across two runs", JSON.stringify(a.ledger) === JSON.stringify(b.ledger))
  check("identical strategicWinner across two runs", a.strategicWinner === b.strategicWinner)
}

// --- Test 2: component triggers are isolated and correct --------------------
// Unit-style checks per component, each construction chosen to isolate ONE
// trigger rather than asserting a whole-game outcome narrative — whether
// realistic bot play makes rushing or strategic accumulation win *on
// average* is an empirical question for Phase 2's thousands of simulated
// games, not something a single hand-built replay can honestly prove either
// way. This test only proves the mechanism fires on exactly the documented
// conditions.
{
  console.log("Test 2: component triggers are isolated and correct")

  // board_control: fires on a player's own first move (0 -> new personal
  // high) and then plateaus for pure alternating placement, since routine
  // placement always nets the same +1-over-your-own-prior-best margin
  // exactly once, never again, until something (a bomb) pushes past it.
  {
    const replay: ReplayEntry[] = [move(1, 0), move(2, 20), move(1, 1), move(2, 21)]
    const r = computeStrategicScore(CLASSIC, replay)
    const p1BoardControlEvents = r.ledger.events.filter((e) => e.slot === 1 && e.component === "board_control")
    check(
      "board_control fires exactly once for a player under plain alternating placement",
      p1BoardControlEvents.length === 1,
      `got ${p1BoardControlEvents.length}`
    )
  }

  // positional_dominance: fires only for a center-region cell (5x5 -> rows/cols 1..3).
  {
    const edgeOnly: ReplayEntry[] = [move(1, 0), move(2, 20), move(1, 4), move(2, 24)]
    const r = computeStrategicScore(CLASSIC, edgeOnly)
    check(
      "positional_dominance never fires when every move is on the edge ring",
      r.ledger.componentTotals[1].positional_dominance === 0 && r.ledger.componentTotals[2].positional_dominance === 0
    )
    const centerMove: ReplayEntry[] = [move(1, 12) /* row2,col2 = dead center */, move(2, 20)]
    const r2 = computeStrategicScore(CLASSIC, centerMove)
    check("positional_dominance fires for a dead-center placement", r2.ledger.componentTotals[1].positional_dominance === 15)
  }

  // dual_threat: fires exactly once, on the move that first reaches 2 simultaneous threats.
  {
    // P1 builds two separate open three-in-a-rows that both complete on this move's resulting board.
    // Row1 (5,6,7,_) and a vertical (2,7,12,_) sharing cell 7 as the pivot: placing the 3rd piece of
    // one line while the other is already 2-of-4 does not reliably fork; instead use a plus-shape
    // around 12 (row2,col2) via 11,12,13 (horizontal, needs 10 or 14 to complete) plus 2,7,12,17,22
    // (vertical, needs 2+7 done, 17+22 done) is overcomplicated — simplest real fork: three in a row
    // horizontally with BOTH ends open (e.g. 6,7,8 with 5 and 9 both empty) threatens two completions
    // (5 and 9) at once from a single line.
    const replay: ReplayEntry[] = [move(1, 6), move(2, 0), move(1, 7), move(2, 1), move(1, 8), move(2, 2)]
    const r = computeStrategicScore(CLASSIC, replay)
    const dualThreatEvents = r.ledger.events.filter((e) => e.slot === 1 && e.component === "dual_threat")
    check("dual_threat fires exactly once for an open three-in-a-row (two completion cells)", dualThreatEvents.length === 1, JSON.stringify(r.ledger.events))
  }

  // threat_neutralized: fires when a move removes one of the OPPONENT's
  // active threats. Added after Phase 2's bot-vs-bot simulation showed a
  // blind-rush policy (never blocks) out-scored balanced play under the
  // original components, precisely because defense earned nothing — see
  // scoring.ts's THREAT_NEUTRALIZED_PER_THREAT comment for the numbers.
  {
    const replay: ReplayEntry[] = [
      move(1, 0),
      move(2, 16),
      move(1, 1),
      move(2, 17),
      move(1, 2),
      move(2, 18), // P2 now has an open three (16,17,18) — threats at both 15 and 19
      move(1, 15), // P1 blocks one end
    ]
    const r = computeStrategicScore(CLASSIC, replay)
    const blockEvents = r.ledger.events.filter((e) => e.slot === 1 && e.moveNumber === r.finalState.moveNumber)
    const byComponent = Object.fromEntries(blockEvents.map((e) => [e.component, e.points]))
    check("blocking one of two open-three threats earns threat_neutralized = 35", byComponent.threat_neutralized === 35, JSON.stringify(byComponent))
  }
}

// --- Test 3: worked-example point values, verified independently -----------
// CLAUDE_CODE_BRIEF.md's own auditability example uses +100/+35/+20/+40 for
// four-in-a-row/board-control/threat-density/dual-threat. Forcing all four
// onto one literal move needs an artificially contrived board and proves
// nothing beyond what checking each value independently already proves, so
// this checks the constants where they naturally co-occur: a real open
// three-in-a-row (5x5, cells 6-7-8 with both 5 and 9 open) simultaneously
// creates 2 new threats (threat_density = 20 * 2 = 40), crosses the
// 2-simultaneous-threats line (dual_threat = 40), and lands on a center
// cell (positional_dominance = 15) — all on the same real move, hand-traced
// and asserted exactly.
{
  console.log("Test 3: worked-example point values, verified independently")
  const replay: ReplayEntry[] = [move(1, 6), move(2, 0), move(1, 7), move(2, 1), move(1, 8), move(2, 2)]
  const result = computeStrategicScore(CLASSIC, replay)
  const forkMoveEvents = result.ledger.events.filter((e) => e.slot === 1 && e.moveNumber === 5)
  const byComponent = Object.fromEntries(forkMoveEvents.map((e) => [e.component, e.points]))
  check("open three-in-a-row: threat_density = 40 (2 new threats x 20)", byComponent.threat_density === 40, JSON.stringify(byComponent))
  check("open three-in-a-row: dual_threat = 40", byComponent.dual_threat === 40, JSON.stringify(byComponent))
  check("open three-in-a-row: positional_dominance = 15 (cell 8 is in the center region)", byComponent.positional_dominance === 15, JSON.stringify(byComponent))

  // four_in_a_row and board_control's exact brief-matching values, isolated.
  const winReplay: ReplayEntry[] = [move(1, 12), move(2, 0), move(1, 13), move(2, 1), move(1, 14), move(2, 2), move(1, 11)]
  const winResult = computeStrategicScore(CLASSIC, winReplay)
  const winningMoveEvents = winResult.ledger.events.filter((e) => e.moveNumber === winResult.finalState.moveNumber)
  const byComponent2 = Object.fromEntries(winningMoveEvents.map((e) => [e.component, e.points]))
  check("completing move includes four_in_a_row = 100", byComponent2.four_in_a_row === 100, JSON.stringify(byComponent2))
  check("first own move of the game includes board_control = 35", winResult.ledger.events.find((e) => e.slot === 1 && e.component === "board_control")?.points === 35)
}

// --- Test 4: every event is individually attributable -----------------------
{
  console.log("Test 4: ledger attributability")
  const replay: ReplayEntry[] = [move(1, 12), move(2, 0), move(1, 13), move(2, 1), move(1, 14), move(2, 2), move(1, 11)]
  const result = computeStrategicScore(CLASSIC, replay)
  const recomputedTotals: Record<1 | 2, number> = { 1: 0, 2: 0 }
  for (const e of result.ledger.events) recomputedTotals[e.slot] += e.points
  check("summing individual events reproduces the ledger totals", recomputedTotals[1] === result.ledger.totals[1] && recomputedTotals[2] === result.ledger.totals[2])
  check("every event carries a moveNumber, slot, and positive points", result.ledger.events.every((e) => e.moveNumber > 0 && (e.slot === 1 || e.slot === 2) && e.points > 0))
}

// --- Test 5: illegal replay throws rather than silently scoring garbage -----
{
  console.log("Test 5: an illegal move in the replay throws")
  const illegalReplay: ReplayEntry[] = [move(1, 0), move(2, 0) /* occupied — illegal */]
  let threw = false
  try {
    computeStrategicScore(CLASSIC, illegalReplay)
  } catch {
    threw = true
  }
  check("throws on an illegal move rather than returning a result", threw)
}

console.log("")
if (failures > 0) {
  console.error(`${failures} check(s) failed.`)
  process.exit(1)
} else {
  console.log("All scoring engine self-tests passed.")
}
