/**
 * Strategic Score engine — CLAUDE_CODE_BRIEF.md "Feature A".
 *
 * Pure and dependency-free, same discipline as engine.ts: this module never
 * touches I/O, the database, or match-server.ts's live socket state. It
 * consumes a replay (the ordered list of moves already validated and applied
 * by engine.ts) and produces a fully attributable point ledger. Given the
 * same replay, this always produces the same ledger — there is no branch in
 * this file that reads Date.now(), Math.random(), or anything outside its
 * arguments.
 *
 * STATUS: feature-flagged OFF everywhere. STRATEGIC_SCORE_ENABLED_RULESETS
 * (bottom of this file) is empty. Nothing in src/server/ consults this module
 * yet — that is Feature A's own Phase 3 (live win-condition wiring), gated on
 * this phase's bot-vs-bot simulation results first, per
 * CLAUDE_CODE_BRIEF.md's Feature A spec ("simulations and legal review
 * approve activation").
 *
 * DESIGN DECISION — the match still ends exactly when engine.ts already ends
 * it (a completed line, or both sides stuck). This file changes who is
 * CREDITED as the winner at that point, not when the match ends. The
 * alternative — extending the match past a completed line so a trailing
 * player can "catch up" — would mean rewriting engine.ts's turn loop and
 * match-server.ts's timing, which is exactly the "core mechanics" scope
 * CLAUDE_CODE_BRIEF.md Phase 6A froze pending human/legal review beyond what
 * this feature's own explicit owner override covers. Comparing accumulated
 * score at the engine's own natural end point already produces the intended
 * incentive (a rushed, undeveloped four-in-a-row can lose on total score to
 * an opponent who built board control/threats/position first) without
 * touching engine.ts at all.
 *
 * DESIGN DECISION — resign/abandon endings are out of scope for this module.
 * There is no "who played better" question when one side quits; the caller
 * (match-server.ts, Feature A Phase 3) must keep crediting the traditional
 * non-resigning player for those endings rather than calling into this file.
 * This file only ever answers "given a completed replay that reached a real
 * engine end-state (win or draw), who scored higher."
 */

import {
  applyMove,
  applyTimeout,
  createGame,
  opponentOf,
  type Board,
  type GameState,
  type Move,
  type PlayerSlot,
  type Ruleset,
} from "./engine"

// --- Replay input ------------------------------------------------------------

export type ReplayEntry =
  | { kind: "move"; slot: PlayerSlot; move: Move }
  | { kind: "timeout"; slot: PlayerSlot }

// --- Ledger ------------------------------------------------------------------

export type ScoreComponentId =
  | "four_in_a_row"
  | "board_control"
  | "threat_density"
  | "dual_threat"
  | "positional_dominance"
  | "forced_response"
  | "strategic_pressure"

export interface ScoreEvent {
  moveNumber: number
  slot: PlayerSlot
  component: ScoreComponentId
  label: string
  points: number
}

export interface StrategicScoreLedger {
  events: ScoreEvent[]
  totals: Record<PlayerSlot, number>
  componentTotals: Record<PlayerSlot, Record<ScoreComponentId, number>>
}

export interface StrategicScoreResult {
  ledger: StrategicScoreLedger
  finalState: GameState
  /** Whoever engine.ts's own status credits — null on a draw. Always computed, never consulted for anything money-relevant unless the caller chooses to. */
  traditionalWinner: PlayerSlot | null
  /**
   * Highest ledger total. Null only for an exact tie across every component
   * (see resolveTie below) — astronomically unlikely given point
   * granularity, but a real possibility that must resolve deterministically
   * rather than silently picking a side.
   */
  strategicWinner: PlayerSlot | null
  /** True when strategicWinner disagrees with traditionalWinner, or when traditionalWinner is null (a draw) but strategicWinner isn't — the exact case Feature A exists to produce. */
  reversedTraditionalOutcome: boolean
}

// --- Scoring constants ---------------------------------------------------
//
// Every value here is a flat point award for a precisely defined, boolean
// trigger condition — never a lookahead, never an opponent-reply simulation,
// never a probability. FOUR_IN_A_ROW_BASE/BOARD_CONTROL_BONUS/
// THREAT_DENSITY_PER_NEW_THREAT/DUAL_THREAT_BONUS reproduce
// CLAUDE_CODE_BRIEF.md's own worked ledger example verbatim (Move 18: +100
// four-in-a-row, +35 board control, +20 threat density, +40 dual threat =
// +195) on a move that satisfies all four triggers at once — see
// scripts/test-scoring-engine.ts's REPLICATES_BRIEF_WORKED_EXAMPLE case.

/** Scaled by connectTarget so a 5-in-a-row format (Siege, Sprawl) isn't worth the same as a 4-in-a-row format for a strictly harder line. Classic (connectTarget 4) yields exactly 100. */
function fourInARowBase(rules: Ruleset): number {
  return Math.round((100 * rules.connectTarget) / 4)
}

/**
 * Flat award when a move pushes the mover's own-cells-minus-opponent-cells
 * margin to a new high for them so far this match — not simply "margin went
 * up from the move before," which degenerates to "any placement" (a normal
 * or shield placement always raises the mover's own margin by exactly one
 * relative to their own immediately-prior state, since it adds a cell for
 * you and touches nothing of the opponent's — see
 * scripts/test-scoring-engine.ts's history for the version of this rule
 * that had that bug, caught by executing the test, not by reading the
 * code). Comparing against the player's own best-ever margin instead means
 * routine alternating placement — which plateaus at the same +1 lead every
 * turn under equal play — earns this once, at most, while actually widening
 * a lead beyond that plateau (a bomb that removes an opponent cell, or
 * simply outpacing an opponent who is placing less effectively) earns it
 * again. Not scaled by the size of the swing past the prior high — kept
 * flat for auditability, matching every other component here.
 */
const BOARD_CONTROL_BONUS = 35

/** Per NEW immediate-win threat the move creates (threats that already existed before the move don't re-earn this). */
const THREAT_DENSITY_PER_NEW_THREAT = 20

/** One-time award for the move that first brings the mover's simultaneous threat count to 2 or more — a fork, the single strongest tactical shape in a connect-style game (the opponent cannot block both). Fires once per crossing, not once per threat above 2. */
const DUAL_THREAT_BONUS = 40

/** Claiming a cell in the ruleset's center region (the board minus its outermost ring) — more lines pass through center cells, so early central presence is real positional value, not decoration. */
const POSITIONAL_DOMINANCE_BONUS = 15

/** Awarded when the mover has at least one live threat and the opponent has none — the opponent's next move is forced into defense rather than free to build. */
const FORCED_RESPONSE_BONUS = 25

/** Awarded when the mover keeps at least one live threat alive across two consecutive moves of their own (not merely re-creating one) — sustained pressure, distinct from the single-move DUAL_THREAT_BONUS spike. */
const STRATEGIC_PRESSURE_BONUS = 10

// --- Board helpers -------------------------------------------------------

function ownedCells(board: Board, slot: PlayerSlot): number {
  let n = 0
  for (const cell of board) if (cell && cell.owner === slot) n++
  return n
}

function controlMargin(board: Board, slot: PlayerSlot): number {
  return ownedCells(board, slot) - ownedCells(board, opponentOf(slot))
}

/**
 * The board minus its outermost ring. For an N×N board this is the inner
 * (N-2)×(N-2) region — derived from boardSize, never a per-ruleset lookup
 * table, so a new ruleset gets a correct center region for free.
 */
function isCenterCell(index: number, rules: Ruleset): boolean {
  const size = rules.boardSize
  const row = Math.floor(index / size)
  const col = index % size
  return row > 0 && row < size - 1 && col > 0 && col < size - 1
}

/**
 * Deliberately not imported from bot.ts's wouldComplete, despite being
 * nearly identical: bot.ts is scoped to the free, no-money practice
 * opponent and its functions aren't exported for reuse outside that module
 * (see bot.ts's own header). Scoring a real-money win condition on a
 * private helper from a module explicitly carved out as non-money-relevant
 * would tie two things together that should be able to change
 * independently.
 */
function wouldCompleteLine(board: Board, index: number, owner: PlayerSlot, rules: Ruleset): boolean {
  if (board[index] !== null) return false
  const hypothetical = board.slice()
  hypothetical[index] = { owner, shielded: false }
  return findWinningLineLocal(hypothetical, index, rules) !== null
}

// Re-implemented locally rather than importing engine.ts's findWinningLine
// with a hypothetical board mutation from outside engine.ts's own module —
// engine.ts exports findWinningLine already, so this just calls straight
// through; kept as a thin named wrapper so every caller in this file reads
// "line-completion check" at the call site instead of a bare import alias.
import { findWinningLine as findWinningLineLocal } from "./engine"

/** Count of empty cells where a normal/shield placement by `slot` would complete a line right now. Placement-only by definition — a bomb/swap threat is a materially different (and rarer) shape and isn't counted here, matching bot.ts's own scope of "threat" for the same reason. */
function countThreats(board: Board, slot: PlayerSlot, rules: Ruleset): number {
  let n = 0
  for (let i = 0; i < board.length; i++) {
    if (wouldCompleteLine(board, i, slot, rules)) n++
  }
  return n
}

// --- Per-player running state during a replay -----------------------------

interface PlayerRunningState {
  /** Whether this player's PREVIOUS own move (two plies back) left them with a live threat — needed for STRATEGIC_PRESSURE_BONUS's "consecutive" requirement. */
  hadThreatLastOwnMove: boolean
  /** The highest own-cells-minus-opponent-cells margin this player has held after any of their own moves so far — see BOARD_CONTROL_BONUS. */
  bestMargin: number
}

function emptyRunningState(): PlayerRunningState {
  return { hadThreatLastOwnMove: false, bestMargin: -Infinity }
}

function emptyComponentTotals(): Record<ScoreComponentId, number> {
  return {
    four_in_a_row: 0,
    board_control: 0,
    threat_density: 0,
    dual_threat: 0,
    positional_dominance: 0,
    forced_response: 0,
    strategic_pressure: 0,
  }
}

/** Scores one already-applied move. Returns the events it earned (zero or more) — an event list, not a single number, because a move can trigger several components at once (see the brief's own worked example). */
function scoreMove(
  before: GameState,
  after: GameState,
  slot: PlayerSlot,
  move: Move,
  running: PlayerRunningState
): ScoreEvent[] {
  const rules = before.ruleset
  const opponent = opponentOf(slot)
  const events: ScoreEvent[] = []
  const push = (component: ScoreComponentId, label: string, points: number) => {
    if (points > 0) events.push({ moveNumber: after.moveNumber, slot, component, label, points })
  }

  const completedLine =
    after.winningLine !== null &&
    ((slot === 1 && after.status === "player_1_won") || (slot === 2 && after.status === "player_2_won"))
  if (completedLine) {
    push("four_in_a_row", "Four-in-a-Row", fourInARowBase(rules))
  }

  const marginAfter = controlMargin(after.board, slot)
  if (marginAfter > running.bestMargin) {
    push("board_control", "Board Control", BOARD_CONTROL_BONUS)
  }
  running.bestMargin = Math.max(running.bestMargin, marginAfter)

  const threatsBefore = countThreats(before.board, slot, rules)
  const threatsAfter = countThreats(after.board, slot, rules)
  const newThreats = Math.max(0, threatsAfter - threatsBefore)
  if (newThreats > 0) {
    push("threat_density", "Threat Density", THREAT_DENSITY_PER_NEW_THREAT * newThreats)
  }
  if (threatsBefore < 2 && threatsAfter >= 2) {
    push("dual_threat", "Dual Threat Created", DUAL_THREAT_BONUS)
  }

  let claimedIndex: number | null = null
  if (move.kind === "normal" || move.kind === "shield") claimedIndex = move.index
  else if (move.kind === "swap" && move.targetIndex !== undefined) claimedIndex = move.targetIndex
  if (claimedIndex !== null && isCenterCell(claimedIndex, rules)) {
    push("positional_dominance", "Positional Dominance", POSITIONAL_DOMINANCE_BONUS)
  }

  const opponentThreatsAfter = countThreats(after.board, opponent, rules)
  if (threatsAfter > 0 && opponentThreatsAfter === 0) {
    push("forced_response", "Forced-Response Pressure", FORCED_RESPONSE_BONUS)
  }

  if (threatsAfter > 0 && running.hadThreatLastOwnMove) {
    push("strategic_pressure", "Strategic Pressure", STRATEGIC_PRESSURE_BONUS)
  }
  running.hadThreatLastOwnMove = threatsAfter > 0

  return events
}

/**
 * Deterministic tie-break when both players' ledger totals are exactly
 * equal. Order matters and is fixed: traditional line winner first (if the
 * game wasn't a draw), then each component in the priority order below,
 * then — the true, no-signal-left case — player 1. This never introduces
 * randomness; it only ever picks among values already in the ledger.
 */
const TIE_BREAK_COMPONENT_ORDER: ScoreComponentId[] = [
  "four_in_a_row",
  "board_control",
  "threat_density",
  "dual_threat",
  "positional_dominance",
  "forced_response",
  "strategic_pressure",
]

function resolveTie(
  traditionalWinner: PlayerSlot | null,
  componentTotals: Record<PlayerSlot, Record<ScoreComponentId, number>>
): PlayerSlot {
  if (traditionalWinner !== null) return traditionalWinner
  for (const component of TIE_BREAK_COMPONENT_ORDER) {
    const a = componentTotals[1][component]
    const b = componentTotals[2][component]
    if (a !== b) return a > b ? 1 : 2
  }
  return 1
}

/**
 * Replays `entries` from a fresh game and produces the full Strategic Score
 * ledger. Throws if the replay contains an illegal move — a caller handing
 * this an unvalidated move list is a bug in the caller, not something this
 * function should silently paper over, since it exists specifically to make
 * settlement decisions.
 */
export function computeStrategicScore(rules: Ruleset, entries: ReplayEntry[]): StrategicScoreResult {
  let state = createGame(rules)
  const events: ScoreEvent[] = []
  const running: Record<PlayerSlot, PlayerRunningState> = { 1: emptyRunningState(), 2: emptyRunningState() }

  for (const entry of entries) {
    if (state.status !== "active") {
      throw new Error("computeStrategicScore: replay continues past a completed game")
    }

    if (entry.kind === "timeout") {
      state = applyTimeout(state, entry.slot)
      continue
    }

    const before = state
    const result = applyMove(before, entry.slot, entry.move)
    if (!result.ok) {
      throw new Error(`computeStrategicScore: replay contains an illegal move — ${result.error}`)
    }
    state = result.state
    events.push(...scoreMove(before, state, entry.slot, entry.move, running[entry.slot]))
  }

  const componentTotals: Record<PlayerSlot, Record<ScoreComponentId, number>> = {
    1: emptyComponentTotals(),
    2: emptyComponentTotals(),
  }
  const totals: Record<PlayerSlot, number> = { 1: 0, 2: 0 }
  for (const event of events) {
    totals[event.slot] += event.points
    componentTotals[event.slot][event.component] += event.points
  }

  const traditionalWinner: PlayerSlot | null =
    state.status === "player_1_won" ? 1 : state.status === "player_2_won" ? 2 : null

  let strategicWinner: PlayerSlot | null
  if (totals[1] === totals[2]) {
    const allComponentsEqual = TIE_BREAK_COMPONENT_ORDER.every(
      (c) => componentTotals[1][c] === componentTotals[2][c]
    )
    strategicWinner = allComponentsEqual && traditionalWinner === null ? null : resolveTie(traditionalWinner, componentTotals)
  } else {
    strategicWinner = totals[1] > totals[2] ? 1 : 2
  }

  const reversedTraditionalOutcome = strategicWinner !== traditionalWinner

  return {
    ledger: { events, totals, componentTotals },
    finalState: state,
    traditionalWinner,
    strategicWinner,
    reversedTraditionalOutcome,
  }
}

// --- Feature flag ----------------------------------------------------------

/**
 * Empty by design. Populated only after CLAUDE_CODE_BRIEF.md's Feature A
 * Phase 2 (bot-vs-bot simulation) confirms the constants above actually
 * reward strategic play over rushing for a given ruleset, and only then
 * consulted by match-server.ts's settlement path (Phase 3) — never read by
 * anything today. A ruleset id present here means "the live win condition
 * for this ruleset is Strategic Score, not first-line-wins"; the set is the
 * single source of truth so the flag can never be split across two
 * disagreeing checks.
 */
export const STRATEGIC_SCORE_ENABLED_RULESETS: ReadonlySet<string> = new Set([])

export function isStrategicScoreEnabled(rulesetId: string): boolean {
  return STRATEGIC_SCORE_ENABLED_RULESETS.has(rulesetId)
}
