/**
 * Feature A, Phase 2 — bot-vs-bot simulation (CLAUDE_CODE_BRIEF.md's own
 * standard: real engine.ts/bot.ts, no mocking, same methodology as the
 * earlier draw-rate instrumentation pass referenced in the brief's Phase
 * 6A). Answers the brief's own question: "if a rushed connect-four
 * consistently beats strategically superior play, rebalance the scoring
 * system" — with real numbers, not a guess.
 *
 * Two experiments:
 *   1. Balanced self-play (bot.ts vs itself) across all 10 rulesets —
 *      measures how often the Strategic Score winner disagrees with the
 *      traditional (first-line/draw) outcome, and how often a traditional
 *      draw resolves to a decisive strategic result.
 *   2. A deliberately degenerate "rusher" policy (defined only in this
 *      script, never touching bot.ts) vs the real bot.ts, on Classic —
 *      the rusher takes a winning move the instant one exists and
 *      otherwise only ever extends its own longest line, never blocks the
 *      opponent and never prefers central cells. This isolates the exact
 *      question Feature A's spec poses: does blind speed still win once
 *      Strategic Score is the win condition?
 *
 * Run: npx tsx scripts/simulate-strategic-score.ts
 */

import {
  applyMove,
  applyTimeout,
  createGame,
  findWinningLine,
  hasLegalMove,
  opponentOf,
  type Board,
  type GameState,
  type Move,
  type PlayerSlot,
} from "../src/lib/game/engine"
import { chooseBotMove } from "../src/lib/game/bot"
import { RULESETS, type Ruleset } from "../src/lib/game/rulesets"
import { computeStrategicScore, type ReplayEntry } from "../src/lib/game/scoring"

type BotPolicy = (state: GameState, slot: PlayerSlot) => Move

function wouldComplete(board: Board, index: number, owner: PlayerSlot, rules: Ruleset): boolean {
  if (board[index] !== null) return false
  const hyp = board.slice()
  hyp[index] = { owner, shielded: false }
  return findWinningLine(hyp, index, rules) !== null
}

/** Longest run of `owner`'s own pieces that would pass through `index` if placed there, in any single direction — used only to rank candidate rush cells. */
function longestRunIfPlaced(board: Board, index: number, owner: PlayerSlot, rules: Ruleset): number {
  const size = rules.boardSize
  const row = Math.floor(index / size)
  const col = index % size
  const dirs: Array<[number, number]> = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ]
  let best = 1
  for (const [dr, dc] of dirs) {
    let run = 1
    for (const sign of [1, -1] as const) {
      let r = row + dr * sign
      let c = col + dc * sign
      while (r >= 0 && r < size && c >= 0 && c < size) {
        const cell = board[r * size + c]
        if (!cell || cell.owner !== owner) break
        run++
        r += dr * sign
        c += dc * sign
      }
    }
    best = Math.max(best, run)
  }
  return best
}

/**
 * Deliberately blind to the opponent: never blocks, never bombs to break a
 * threat, no center preference. Only goal is "complete a line as fast as
 * possible." This is the "Player A rushes a basic four-in-a-row" archetype
 * from CLAUDE_CODE_BRIEF.md's Feature A spec, made concrete enough to
 * simulate.
 */
const rusherPolicy: BotPolicy = (state, slot) => {
  const inv = state.inventories[slot]

  if (inv.normal > 0 || inv.shield > 0) {
    for (let i = 0; i < state.board.length; i++) {
      if (wouldComplete(state.board, i, slot, state.ruleset)) {
        return { kind: inv.normal > 0 ? "normal" : "shield", index: i }
      }
    }
  }

  let bestIndex = -1
  let bestRun = -1
  state.board.forEach((cell, i) => {
    if (cell !== null) return
    const run = longestRunIfPlaced(state.board, i, slot, state.ruleset)
    if (run > bestRun || (run === bestRun && Math.random() < 0.5)) {
      bestRun = run
      bestIndex = i
    }
  })
  if (bestIndex >= 0 && inv.normal > 0) return { kind: "normal", index: bestIndex }
  if (bestIndex >= 0 && inv.shield > 0) return { kind: "shield", index: bestIndex }

  if (inv.bomb > 0) {
    const foe = state.board.findIndex((c) => c && c.owner !== slot && !c.shielded)
    if (foe >= 0) return { kind: "bomb", index: foe }
  }
  if (inv.swap > 0) {
    const own = state.board.findIndex((c) => c && c.owner === slot && !c.shielded)
    const foe = state.board.findIndex((c) => c && c.owner !== slot && !c.shielded)
    if (own >= 0 && foe >= 0) return { kind: "swap", index: own, targetIndex: foe }
  }
  return { kind: "normal", index: state.board.findIndex((c) => c === null) }
}

const balancedPolicy: BotPolicy = (state, slot) => chooseBotMove(state, slot)

interface GameOutcome {
  moves: number
  traditionalStatus: GameState["status"]
  traditionalWinner: PlayerSlot | null
  strategicWinner: PlayerSlot | null
  reversed: boolean
  drawResolvedByStrategicScore: boolean
}

const MAX_PLIES = 500 // hard safety cap; hasLegalMove already guarantees termination well before this for every shipped ruleset

function playOneGame(rules: Ruleset, policy1: BotPolicy, policy2: BotPolicy): GameOutcome {
  let state = createGame(rules)
  const entries: ReplayEntry[] = []
  const policies: Record<PlayerSlot, BotPolicy> = { 1: policy1, 2: policy2 }

  let plies = 0
  while (state.status === "active" && plies < MAX_PLIES) {
    const slot = state.turn
    if (!hasLegalMove(state.board, state.inventories, slot)) {
      // Mirrors match-server.ts's own handling: a stuck side times out, which
      // engine.ts resolves (possibly ending the game if both sides are stuck).
      entries.push({ kind: "timeout", slot })
      state = applyTimeout(state, slot)
      plies++
      continue
    }
    const move = policies[slot](state, slot)
    const result = applyMove(state, slot, move)
    if (!result.ok) {
      // A policy proposed an illegal move — a bug in the policy, not
      // something to paper over by retrying with something else, since that
      // would silently mask the bug the same way the brief warns against.
      throw new Error(`policy for slot ${slot} produced an illegal move on ruleset ${rules.id}: ${result.error}`)
    }
    entries.push({ kind: "move", slot, move })
    state = result.state
    plies++
  }
  if (state.status === "active") {
    throw new Error(`game on ruleset ${rules.id} did not terminate within ${MAX_PLIES} plies`)
  }

  const scored = computeStrategicScore(rules, entries)
  return {
    moves: state.moveNumber,
    traditionalStatus: state.status,
    traditionalWinner: scored.traditionalWinner,
    strategicWinner: scored.strategicWinner,
    reversed: scored.reversedTraditionalOutcome,
    drawResolvedByStrategicScore: scored.traditionalWinner === null && scored.strategicWinner !== null,
  }
}

interface Aggregate {
  games: number
  totalMoves: number
  traditionalP1Wins: number
  traditionalP2Wins: number
  traditionalDraws: number
  strategicP1Wins: number
  strategicP2Wins: number
  strategicTrueDraws: number
  reversals: number
  drawsResolved: number
}

function newAggregate(): Aggregate {
  return {
    games: 0,
    totalMoves: 0,
    traditionalP1Wins: 0,
    traditionalP2Wins: 0,
    traditionalDraws: 0,
    strategicP1Wins: 0,
    strategicP2Wins: 0,
    strategicTrueDraws: 0,
    reversals: 0,
    drawsResolved: 0,
  }
}

function record(agg: Aggregate, o: GameOutcome) {
  agg.games++
  agg.totalMoves += o.moves
  if (o.traditionalWinner === 1) agg.traditionalP1Wins++
  else if (o.traditionalWinner === 2) agg.traditionalP2Wins++
  else agg.traditionalDraws++

  if (o.strategicWinner === 1) agg.strategicP1Wins++
  else if (o.strategicWinner === 2) agg.strategicP2Wins++
  else agg.strategicTrueDraws++

  if (o.reversed) agg.reversals++
  if (o.drawResolvedByStrategicScore) agg.drawsResolved++
}

function pct(n: number, of: number): string {
  return of === 0 ? "0.0" : ((100 * n) / of).toFixed(1)
}

function printAggregate(label: string, agg: Aggregate) {
  console.log(`\n${label} — ${agg.games} games, mean length ${(agg.totalMoves / agg.games).toFixed(1)} moves`)
  console.log(
    `  traditional:  P1 ${pct(agg.traditionalP1Wins, agg.games)}%  P2 ${pct(agg.traditionalP2Wins, agg.games)}%  draw ${pct(agg.traditionalDraws, agg.games)}%`
  )
  console.log(
    `  strategic:    P1 ${pct(agg.strategicP1Wins, agg.games)}%  P2 ${pct(agg.strategicP2Wins, agg.games)}%  true-tie ${pct(agg.strategicTrueDraws, agg.games)}%`
  )
  console.log(`  reversal rate (strategic winner != traditional winner/draw): ${pct(agg.reversals, agg.games)}%`)
  console.log(`  traditional draws resolved to a decisive strategic winner: ${pct(agg.drawsResolved, agg.games)}% of all games`)
}

const GAMES_PER_RULESET = 4000 // matches CLAUDE_CODE_BRIEF.md Phase 6A's own precedent (4,000 games/ruleset)
const RUSHER_EXPERIMENT_GAMES = 10000 // tighter margin of error for the specific rushing-exploit question

async function main() {
  console.log("=== Experiment 1: balanced self-play (bot.ts vs bot.ts), all rulesets ===")
  for (const rules of Object.values(RULESETS)) {
    const agg = newAggregate()
    for (let i = 0; i < GAMES_PER_RULESET; i++) {
      record(agg, playOneGame(rules, balancedPolicy, balancedPolicy))
    }
    printAggregate(rules.id, agg)
  }

  console.log("\n\n=== Experiment 2: rusher (blind speed) vs balanced (bot.ts), Classic ===")
  const classic = RULESETS.classic
  if (!classic) throw new Error("classic ruleset missing")

  const rusherAsP1 = newAggregate()
  for (let i = 0; i < RUSHER_EXPERIMENT_GAMES / 2; i++) {
    record(rusherAsP1, playOneGame(classic, rusherPolicy, balancedPolicy))
  }
  printAggregate("rusher=P1, balanced=P2", rusherAsP1)
  console.log(
    `  rusher's traditional win rate: ${pct(rusherAsP1.traditionalP1Wins, rusherAsP1.games)}%   rusher's strategic win rate: ${pct(rusherAsP1.strategicP1Wins, rusherAsP1.games)}%`
  )

  const rusherAsP2 = newAggregate()
  for (let i = 0; i < RUSHER_EXPERIMENT_GAMES / 2; i++) {
    record(rusherAsP2, playOneGame(classic, balancedPolicy, rusherPolicy))
  }
  printAggregate("balanced=P1, rusher=P2", rusherAsP2)
  console.log(
    `  rusher's traditional win rate: ${pct(rusherAsP2.traditionalP2Wins, rusherAsP2.games)}%   rusher's strategic win rate: ${pct(rusherAsP2.strategicP2Wins, rusherAsP2.games)}%`
  )

  const rusherTraditionalWins = rusherAsP1.traditionalP1Wins + rusherAsP2.traditionalP2Wins
  const rusherStrategicWins = rusherAsP1.strategicP1Wins + rusherAsP2.strategicP2Wins
  const totalGames = rusherAsP1.games + rusherAsP2.games
  const traditionalRate = rusherTraditionalWins / totalGames
  const strategicRate = rusherStrategicWins / totalGames
  // Rough 95% margin of error for a binomial proportion at this sample size —
  // printed so the verdict below doesn't call a difference "real" when it's
  // within sampling noise, which a flat percentage-point comparison would.
  const marginOfError = 1.96 * Math.sqrt((traditionalRate * (1 - traditionalRate)) / totalGames)
  console.log(
    `\n  COMBINED — rusher traditional win rate: ${pct(rusherTraditionalWins, totalGames)}%   rusher strategic win rate: ${pct(rusherStrategicWins, totalGames)}%  (±${(marginOfError * 100).toFixed(1)}pp margin of error, n=${totalGames})`
  )
  const delta = strategicRate - traditionalRate
  if (delta > marginOfError) {
    console.log(
      `  FINDING: Strategic Score measurably INCREASED the rusher's win rate by ${(delta * 100).toFixed(1)}pp, beyond sampling noise — scoring.ts's constants need further rebalancing before this ruleset is a candidate for activation.`
    )
  } else if (delta < -marginOfError) {
    console.log(
      `  FINDING: Strategic Score measurably reduced the blind-rush policy's win rate by ${(-delta * 100).toFixed(1)}pp — directionally consistent with Feature A's stated goal.`
    )
  } else {
    console.log(
      `  FINDING: Strategic Score's effect on the rusher's win rate (${(delta * 100).toFixed(1)}pp) is within sampling noise at n=${totalGames} — no longer a measurable exploit at this sample size. A larger run (10k+ games) is worth doing before Phase 3 activation to shrink the margin of error further, but this is not evidence of remaining imbalance on its own.`
    )
  }
}

main()
