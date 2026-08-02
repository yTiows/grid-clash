/**
 * Practice-mode opponent. Not for ranked, not for money — see /practice.
 *
 * This is the "limited practice AI with no real-money payouts" answer the
 * design review recommended for the empty-queue/liquidity problem instead
 * of a house bot that plays for stakes: the platform should never have
 * financial exposure to a match's outcome, and a bot that could win real
 * money is exactly that exposure. This bot exists purely so a player (or a
 * developer with no second account handy) can see the real board, the real
 * pieces, the real clock, work end to end, offline, for free.
 *
 * Deliberately simple, not solved: win-now, then block the human's
 * immediate threat, then build next to its own pieces, then anything
 * legal. It uses full board visibility to do this (there's nothing hidden
 * about the board itself, only inventory breakdowns — see engine.ts), so
 * this isn't "cheating," it's the same information a human opponent has
 * just by looking at the board.
 */

import {
  coordsToIndex,
  findWinningLine,
  indexToCoords,
  opponentOf,
  type Board,
  type GameState,
  type Move,
  type PlayerSlot,
  type Ruleset,
} from "./engine"

function wouldComplete(board: Board, index: number, owner: PlayerSlot, rules: Ruleset): boolean {
  if (board[index] !== null) return false
  const hypothetical = board.slice()
  hypothetical[index] = { owner, shielded: false }
  return findWinningLine(hypothetical, index, rules) !== null
}

function findWinningPlacement(state: GameState, slot: PlayerSlot): Move | null {
  const inv = state.inventories[slot]
  if (inv.normal <= 0 && inv.shield <= 0) return null

  for (let i = 0; i < state.board.length; i++) {
    if (wouldComplete(state.board, i, slot, state.ruleset)) {
      return { kind: inv.normal > 0 ? "normal" : "shield", index: i }
    }
  }
  return null
}

/**
 * A swap trades two already-occupied cells' positions without changing who
 * owns either piece (see engine.ts's applyMove swap case) — so it can win
 * by moving the bot's own piece into a gap that completes a line, even
 * though every cell involved is already occupied and wouldComplete (which
 * only ever considers empty cells) can't see it. Previously the bot's win
 * search only checked placements, so a winning swap sitting right in front
 * of it was invisible.
 */
function wouldSwapComplete(
  board: Board,
  ownIndex: number,
  foeIndex: number,
  owner: PlayerSlot,
  rules: Ruleset
): boolean {
  const hypothetical = board.slice()
  const own = hypothetical[ownIndex]
  const foe = hypothetical[foeIndex]
  if (!own || !foe || own.owner !== owner || foe.owner === owner) return false
  if (own.shielded || foe.shielded) return false
  hypothetical[ownIndex] = foe
  hypothetical[foeIndex] = own
  // The bot's own piece ends up AT foeIndex after the swap (ownIndex gets
  // the foe's old piece instead) — the line to check is the one through
  // foeIndex, not ownIndex. Checking ownIndex here would ask whether the
  // foe's own piece happens to complete a line for them, which is a
  // completely different question from whether this swap wins for the bot.
  return findWinningLine(hypothetical, foeIndex, rules) !== null
}

function findWinningSwap(state: GameState, slot: PlayerSlot): Move | null {
  if (state.inventories[slot].swap <= 0) return null
  const human = opponentOf(slot)
  const ownCells = state.board.reduce<number[]>((acc, c, i) => {
    if (c && c.owner === slot && !c.shielded) acc.push(i)
    return acc
  }, [])
  const foeCells = state.board.reduce<number[]>((acc, c, i) => {
    if (c && c.owner === human && !c.shielded) acc.push(i)
    return acc
  }, [])

  for (const ownIndex of ownCells) {
    for (const foeIndex of foeCells) {
      if (wouldSwapComplete(state.board, ownIndex, foeIndex, slot, state.ruleset)) {
        return { kind: "swap", index: ownIndex, targetIndex: foeIndex }
      }
    }
  }
  return null
}

function findThreatCell(state: GameState, human: PlayerSlot): number | null {
  for (let i = 0; i < state.board.length; i++) {
    if (wouldComplete(state.board, i, human, state.ruleset)) return i
  }
  return null
}

/**
 * Given a specific empty cell where the human would complete a line if they
 * placed there, finds an already-placed, unshielded human piece that's
 * actually part of that hypothetical line — bombing it breaks the threat
 * for real, rather than removing an arbitrary human piece elsewhere that
 * has nothing to do with the line being built.
 */
function findThreatBreakingBomb(state: GameState, human: PlayerSlot, threatCell: number): number | null {
  const hypothetical = state.board.slice()
  hypothetical[threatCell] = { owner: human, shielded: false }
  const line = findWinningLine(hypothetical, threatCell, state.ruleset)
  if (!line) return null

  for (const i of line) {
    if (i === threatCell) continue
    const cell = state.board[i]
    if (cell && cell.owner === human && !cell.shielded) return i
  }
  return null
}

/** An empty cell next to at least one of the bot's own pieces — building
 * outward from what's already there reads as intentional, not scattershot. */
function findBuildCell(state: GameState, slot: PlayerSlot): number | null {
  const size = state.ruleset.boardSize
  const candidates: number[] = []

  state.board.forEach((cell, i) => {
    if (cell !== null) return
    const { row, col } = indexToCoords(i, size)
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue
        const r = row + dr
        const c = col + dc
        if (r < 0 || r >= size || c < 0 || c >= size) continue
        const neighbor = state.board[coordsToIndex(r, c, size)]
        if (neighbor && neighbor.owner === slot) candidates.push(i)
      }
    }
  })

  if (candidates.length === 0) return null
  return candidates[Math.floor(Math.random() * candidates.length)] as number
}

export function chooseBotMove(state: GameState, slot: PlayerSlot): Move {
  const human = opponentOf(slot)
  const inv = state.inventories[slot]

  const winning = findWinningPlacement(state, slot) ?? findWinningSwap(state, slot)
  if (winning) return winning

  const threat = findThreatCell(state, human)
  if (threat !== null) {
    if (inv.shield > 0 && Math.random() < 0.35) return { kind: "shield", index: threat }
    if (inv.normal > 0) return { kind: "normal", index: threat }
    // No placement piece left to block with directly — a bomb that removes
    // the specific human piece completing this line is the next-best real
    // defense, not "no defense at all" (the old fallback below would have
    // bombed whatever unshielded human cell happened to sort first,
    // regardless of whether it had anything to do with this threat).
    if (inv.bomb > 0) {
      const breaker = findThreatBreakingBomb(state, human, threat)
      if (breaker !== null) return { kind: "bomb", index: breaker }
    }
  }

  const build = findBuildCell(state, slot)
  if (build !== null && inv.normal > 0) return { kind: "normal", index: build }

  const anyEmpty = state.board.findIndex((c) => c === null)
  if (anyEmpty >= 0) {
    if (inv.normal > 0) return { kind: "normal", index: anyEmpty }
    if (inv.shield > 0) return { kind: "shield", index: anyEmpty }
  }

  // Board is full or the bot's placement pieces are gone — fall back to
  // whatever's left. hasLegalMove (engine.ts) guarantees the server-side
  // equivalent of this situation always has *something* legal when it's
  // still this slot's turn, so one of these will apply. Still threat-aware
  // first: if the human has an active one-move threat, spend the bomb
  // breaking it specifically rather than clearing an arbitrary piece.
  if (inv.bomb > 0) {
    const activeThreat = findThreatCell(state, human)
    const breaker = activeThreat !== null ? findThreatBreakingBomb(state, human, activeThreat) : null
    if (breaker !== null) return { kind: "bomb", index: breaker }
    for (let i = 0; i < state.board.length; i++) {
      const cell = state.board[i]
      if (cell && cell.owner === human && !cell.shielded) return { kind: "bomb", index: i }
    }
  }
  if (inv.swap > 0) {
    const own = state.board.findIndex((c) => c && c.owner === slot && !c.shielded)
    const foe = state.board.findIndex((c) => c && c.owner === human && !c.shielded)
    if (own >= 0 && foe >= 0) return { kind: "swap", index: own, targetIndex: foe }
  }

  // Unreachable if hasLegalMove was checked before calling this, but a
  // well-typed fallback beats a thrown error in a practice tool.
  return { kind: "normal", index: state.board.findIndex((c) => c === null) }
}
