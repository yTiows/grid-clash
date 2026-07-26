/**
 * Grid Clash rules engine.
 *
 * Pure and dependency-free by design: the same module runs in the browser for
 * optimistic rendering and on the authoritative server for validation. The
 * server's result is always canonical — the client copy exists only to hide
 * network latency, never to decide anything.
 *
 * Rules
 *  - 5x5 board, connect 4 (orthogonal or diagonal) to win.
 *  - Each player holds 8 normal pieces, 1 shield, 1 bomb, 1 swap.
 *  - Inventory is hidden from the opponent (see redactStateFor).
 *  - 5s per move; timeout forfeits the turn's piece and passes play.
 *  - Board full with no line = draw.
 */

import { CLASSIC, type Inventory, type Ruleset } from "./rulesets"

export type { Inventory, Ruleset }

/** Retained for callers that assume the default ruleset. */
export const BOARD_SIZE = CLASSIC.boardSize
export const CONNECT_TARGET = CLASSIC.connectTarget
export const MOVE_TIMEOUT_MS = CLASSIC.moveTimeoutMs

export type PlayerSlot = 1 | 2

export type PieceKind = "normal" | "shield" | "bomb" | "swap"

export interface Cell {
  owner: PlayerSlot
  /** Shielded cells cannot be bombed or swapped. */
  shielded: boolean
}

export type Board = ReadonlyArray<Cell | null>

export function createInventory(rules: Ruleset = CLASSIC): Inventory {
  return { ...rules.inventory }
}

export type GameStatus = "active" | "player_1_won" | "player_2_won" | "draw"

export interface GameState {
  /** Carried in state so no function needs it passed alongside. */
  ruleset: Ruleset
  board: Board
  turn: PlayerSlot
  inventories: Record<PlayerSlot, Inventory>
  status: GameStatus
  /** Index of the winning line, when status is a win. */
  winningLine: number[] | null
  moveNumber: number
}

/** A move as submitted by a client. Index is a flat 0..24 board position. */
export interface Move {
  kind: PieceKind
  index: number
  /** Second cell, required for `swap` only. */
  targetIndex?: number
}

export interface MoveResult {
  ok: boolean
  state: GameState
  error?: string
}

export function createGame(rules: Ruleset = CLASSIC): GameState {
  return {
    ruleset: rules,
    board: Array<Cell | null>(rules.boardSize * rules.boardSize).fill(null),
    turn: 1,
    inventories: { 1: createInventory(rules), 2: createInventory(rules) },
    status: "active",
    winningLine: null,
    moveNumber: 0,
  }
}

export function opponentOf(slot: PlayerSlot): PlayerSlot {
  return slot === 1 ? 2 : 1
}

export function indexToCoords(index: number, size: number = BOARD_SIZE): { row: number; col: number } {
  return { row: Math.floor(index / size), col: index % size }
}

export function coordsToIndex(row: number, col: number, size: number = BOARD_SIZE): number {
  return row * size + col
}

function inBounds(row: number, col: number, size: number): boolean {
  return row >= 0 && row < size && col >= 0 && col < size
}

const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1], // horizontal
  [1, 0], // vertical
  [1, 1], // diagonal down-right
  [1, -1], // diagonal down-left
]

/**
 * Returns the winning line containing `index`, or null.
 * Only lines through the just-played cell can be new, so this is O(1) per move
 * rather than a full-board scan.
 */
export function findWinningLine(
  board: Board,
  index: number,
  rules: Ruleset = CLASSIC
): number[] | null {
  const cell = board[index]
  if (!cell) return null

  const size = rules.boardSize
  const target = rules.connectTarget
  const { row, col } = indexToCoords(index, size)

  for (const [dRow, dCol] of DIRECTIONS) {
    const line: number[] = [index]

    for (const sign of [1, -1] as const) {
      let r = row + dRow * sign
      let c = col + dCol * sign
      while (inBounds(r, c, size)) {
        const next = board[coordsToIndex(r, c, size)]
        if (!next || next.owner !== cell.owner) break
        line.push(coordsToIndex(r, c, size))
        r += dRow * sign
        c += dCol * sign
      }
    }

    if (line.length >= target) {
      return line.sort((a, b) => a - b)
    }
  }

  return null
}

export function isBoardFull(board: Board): boolean {
  return board.every((cell) => cell !== null)
}

function cloneInventories(
  inventories: Record<PlayerSlot, Inventory>
): Record<PlayerSlot, Inventory> {
  return { 1: { ...inventories[1] }, 2: { ...inventories[2] } }
}

function fail(state: GameState, error: string): MoveResult {
  return { ok: false, state, error }
}

/**
 * Validates and applies a move. Never mutates the input state.
 * This is the single source of truth for legality — the server calls it for
 * every inbound move and discards anything that returns ok: false.
 */
export function applyMove(state: GameState, slot: PlayerSlot, move: Move): MoveResult {
  if (state.status !== "active") return fail(state, "Match is already over.")
  if (state.turn !== slot) return fail(state, "Not your turn.")

  if (!Number.isInteger(move.index) || move.index < 0 || move.index >= state.board.length) {
    return fail(state, "Move is off the board.")
  }

  const inventory = state.inventories[slot]
  if (inventory[move.kind] <= 0) {
    return fail(state, `No ${move.kind} pieces remaining.`)
  }

  const board = [...state.board]
  const inventories = cloneInventories(state.inventories)
  const target = board[move.index] ?? null

  switch (move.kind) {
    case "normal": {
      if (target) return fail(state, "That square is taken.")
      board[move.index] = { owner: slot, shielded: false }
      break
    }

    case "shield": {
      if (target) return fail(state, "That square is taken.")
      board[move.index] = { owner: slot, shielded: true }
      break
    }

    case "bomb": {
      if (!target) return fail(state, "Bomb needs an occupied square.")
      if (target.owner === slot) return fail(state, "Bomb can only clear an opponent's piece.")
      if (target.shielded) return fail(state, "That piece is shielded.")
      board[move.index] = null
      break
    }

    case "swap": {
      if (move.targetIndex === undefined) return fail(state, "Swap needs a second square.")
      if (
        !Number.isInteger(move.targetIndex) ||
        move.targetIndex < 0 ||
        move.targetIndex >= board.length
      ) {
        return fail(state, "Swap target is off the board.")
      }
      if (move.targetIndex === move.index) return fail(state, "Swap needs two different squares.")

      const other = board[move.targetIndex] ?? null
      if (!target || !other) return fail(state, "Swap needs two occupied squares.")
      if (target.shielded || other.shielded) return fail(state, "That piece is shielded.")
      if (target.owner === other.owner) return fail(state, "Swap needs one piece from each player.")

      board[move.index] = other
      board[move.targetIndex] = target
      break
    }

    default:
      return fail(state, "Unknown piece.")
  }

  inventories[slot][move.kind] -= 1

  // A swap or bomb can complete a line for either player, so check both cells
  // touched by the move and attribute the win to the line's owner.
  const touched = [move.index, move.targetIndex].filter(
    (i): i is number => i !== undefined && board[i] !== null
  )

  let winningLine: number[] | null = null
  let winner: PlayerSlot | null = null

  for (const i of touched) {
    const line = findWinningLine(board, i, state.ruleset)
    if (line) {
      const cell = board[i]
      if (cell) {
        winningLine = line
        winner = cell.owner
        // The mover wins ties they created for both sides.
        if (winner === slot) break
      }
    }
  }

  let status: GameStatus = "active"
  if (winner) {
    status = winner === 1 ? "player_1_won" : "player_2_won"
  } else if (isBoardFull(board) || !hasLegalMove(board, inventories, opponentOf(slot))) {
    status = "draw"
  }

  return {
    ok: true,
    state: {
      ruleset: state.ruleset,
      board,
      turn: status === "active" ? opponentOf(slot) : state.turn,
      inventories,
      status,
      winningLine,
      moveNumber: state.moveNumber + 1,
    },
  }
}

/** True if `slot` has at least one legal move available. */
export function hasLegalMove(
  board: Board,
  inventories: Record<PlayerSlot, Inventory>,
  slot: PlayerSlot
): boolean {
  const inv = inventories[slot]
  const hasEmpty = board.some((cell) => cell === null)

  if ((inv.normal > 0 || inv.shield > 0) && hasEmpty) return true

  if (inv.bomb > 0) {
    if (board.some((cell) => cell !== null && cell.owner !== slot && !cell.shielded)) return true
  }

  if (inv.swap > 0) {
    const ownUnshielded = board.some((c) => c !== null && c.owner === slot && !c.shielded)
    const foeUnshielded = board.some((c) => c !== null && c.owner !== slot && !c.shielded)
    if (ownUnshielded && foeUnshielded) return true
  }

  return false
}

/**
 * Applies a move timeout. The player forfeits one normal piece (or their
 * cheapest remaining piece) and play passes. Forfeiting inventory rather than
 * the match keeps a dropped connection from being an instant loss.
 */
export function applyTimeout(state: GameState, slot: PlayerSlot): GameState {
  if (state.status !== "active" || state.turn !== slot) return state

  const inventories = cloneInventories(state.inventories)
  const order: PieceKind[] = ["normal", "swap", "bomb", "shield"]
  const burn = order.find((kind) => inventories[slot][kind] > 0)
  if (burn) inventories[slot][burn] -= 1

  const next = opponentOf(slot)
  const stuck =
    !hasLegalMove(state.board, inventories, slot) && !hasLegalMove(state.board, inventories, next)

  return {
    ...state,
    inventories,
    turn: next,
    status: stuck ? "draw" : state.status,
    moveNumber: state.moveNumber + 1,
  }
}

/**
 * The view of the game sent to a given player. Inventory is hidden
 * information: the opponent sees only how many pieces remain in total, never
 * the breakdown. This is what blunts engine-assisted play — a solver cannot
 * search a tree it cannot observe.
 */
export interface RedactedGameState {
  board: Board
  turn: PlayerSlot
  you: PlayerSlot
  yourInventory: Inventory
  opponentPiecesRemaining: number
  status: GameStatus
  winningLine: number[] | null
  moveNumber: number
}

export function redactStateFor(state: GameState, slot: PlayerSlot): RedactedGameState {
  const foe = state.inventories[opponentOf(slot)]
  return {
    board: state.board,
    turn: state.turn,
    you: slot,
    yourInventory: { ...state.inventories[slot] },
    opponentPiecesRemaining: foe.normal + foe.shield + foe.bomb + foe.swap,
    status: state.status,
    winningLine: state.winningLine,
    moveNumber: state.moveNumber,
  }
}
