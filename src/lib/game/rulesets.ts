/**
 * Rulesets are data, not code.
 *
 * Every variant below is the same engine with different constants, so adding a
 * format costs a table row rather than a release. This is what makes format
 * variety affordable: the alternative is a bespoke implementation per variant,
 * each with its own bugs and its own settlement edge cases.
 */

export interface Inventory {
  normal: number
  shield: number
  bomb: number
  swap: number
}

export interface Ruleset {
  id: string
  name: string
  boardSize: number
  connectTarget: number
  moveTimeoutMs: number
  inventory: Inventory
  /**
   * When true, a Shield placed on an opponent's cell renders identically to
   * a Normal piece to its opponent — engine.ts's redactStateFor masks it —
   * until either it's tested (a Bomb/Swap attempt against it is rejected as
   * illegal, which itself is the tell) or the match ends, when it's
   * revealed to both sides at showdown. This is the one bluffing lever in
   * the system: everywhere else, hidden information can only be withheld,
   * never used to actively misrepresent what's on the board. Spelled out
   * explicitly on every ruleset (not defaulted) so it's never accidentally
   * on for a format that hasn't been designed around it.
   */
  hiddenShields: boolean
  /** One line, shown on the contest card. */
  blurb: string
}

function ruleset(r: Ruleset): Ruleset {
  const cells = r.boardSize * r.boardSize
  const pieces = r.inventory.normal + r.inventory.shield + r.inventory.bomb + r.inventory.swap
  // Only normal/shield placements ever add a NEW cell of your own color to
  // the board: bomb only removes an opponent's piece, and swap trades one
  // of your already-occupied cells for one of theirs (net zero change to
  // either side's owned-cell count — see applyMove's swap case). bomb/swap
  // therefore contribute nothing toward ever completing a line, so they
  // must not count toward either guard below, even though a naive sum of
  // all four kinds happens to still pass for every ruleset shipped today.
  const placementPieces = r.inventory.normal + r.inventory.shield

  // A ruleset where a player's own placeable pieces can never reach the
  // connect target produces unwinnable matches. Caught here rather than at
  // 2am.
  if (placementPieces < r.connectTarget) {
    throw new Error(`Ruleset ${r.id}: not enough placeable pieces to ever complete a line`)
  }
  if (r.connectTarget > r.boardSize) {
    throw new Error(`Ruleset ${r.id}: connectTarget exceeds board dimension`)
  }
  if (pieces > cells) {
    throw new Error(`Ruleset ${r.id}: inventory exceeds board capacity`)
  }
  // Both players' normal+shield pieces must fit on the board even if bomb
  // and swap are never used — the true ceiling on how full the board can
  // get, since only placements add cells.
  if (placementPieces * 2 > cells) {
    throw new Error(`Ruleset ${r.id}: both players' placeable pieces exceed board capacity`)
  }
  if (r.hiddenShields && r.inventory.shield === 0) {
    throw new Error(`Ruleset ${r.id}: hiddenShields with zero shields has nothing to hide`)
  }
  return r
}

export const CLASSIC = ruleset({
  id: "classic",
  name: "Classic",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 8, shield: 1, bomb: 1, swap: 1 },
  hiddenShields: false,
  blurb: "5×5, connect 4. One shield, one bomb, one swap.",
})

export const BLITZ = ruleset({
  id: "blitz",
  name: "Blitz",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 3000,
  inventory: { normal: 8, shield: 1, bomb: 1, swap: 1 },
  hiddenShields: false,
  blurb: "Classic on a 3-second clock. Read faster.",
})

export const PURIST = ruleset({
  id: "purist",
  name: "Purist",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 12, shield: 0, bomb: 0, swap: 0 },
  hiddenShields: false,
  blurb: "No specials. Nothing hidden but intent.",
})

export const SIEGE = ruleset({
  id: "siege",
  name: "Siege",
  boardSize: 6,
  connectTarget: 5,
  moveTimeoutMs: 7000,
  inventory: { normal: 12, shield: 2, bomb: 2, swap: 1 },
  hiddenShields: false,
  blurb: "6×6, connect 5. Deeper board, heavier toolkit.",
})

export const DEMOLITION = ruleset({
  id: "demolition",
  name: "Demolition",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 6, shield: 1, bomb: 4, swap: 1 },
  hiddenShields: false,
  blurb: "Four bombs each. Nothing you build is safe.",
})

export const FORTRESS = ruleset({
  id: "fortress",
  name: "Fortress",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 7, shield: 4, bomb: 1, swap: 0 },
  hiddenShields: false,
  blurb: "Four shields each. Commit early, defend it.",
})

export const SHUFFLE = ruleset({
  id: "shuffle",
  name: "Shuffle",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 7, shield: 1, bomb: 0, swap: 4 },
  hiddenShields: false,
  blurb: "Four swaps each. The board never sits still.",
})

/**
 * The standard board, win condition, and clock — nothing about the match
 * looks unfamiliar — with the toolkit doubled instead of single-use. A
 * one-shot special is a single early commitment; a special on a two-count
 * is a decision that recurs across the whole match (spend the first, hold
 * the second for the moment that actually matters), which is the same
 * "simple rule, deep repeated decision" shape a cooldown ability has in any
 * competitive game, without adding a new rule to learn. Same total pieces
 * per player as DEMOLITION (12) — that number is already proven at this
 * board size, just redistributed evenly across all three specials instead
 * of concentrated in one.
 */
export const GAMBIT = ruleset({
  id: "gambit",
  name: "Gambit",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 6, shield: 2, bomb: 2, swap: 2 },
  hiddenShields: false,
  blurb: "5×5, connect 4. Two of everything — the tools recur, so does the pressure.",
})

/**
 * Same numbers as Classic — board, win condition, clock, inventory — with
 * exactly one variable changed: a Shield placed on your own cell looks like
 * a Normal piece to your opponent until they test it or the match ends.
 * Isolated to one variable on purpose, so this can actually be evaluated
 * against Classic rather than against a format that also changed the
 * toolkit size. This is the prototype for the bluffing mechanic the design
 * review flagged as the biggest gap versus Poker-depth hidden information —
 * tournament-only until it's been played, not ranked-eligible (see
 * protocol.ts RANKED_RULESET_IDS): a new information rule belongs in front
 * of players who opted into a labeled contest, not silently in the default
 * ranked queue.
 */
export const FEINT = ruleset({
  id: "feint",
  name: "Feint",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 8, shield: 1, bomb: 1, swap: 1 },
  hiddenShields: true,
  blurb: "Classic, but a shield looks like a normal piece until you test it.",
})

export const SPRAWL = ruleset({
  id: "sprawl",
  name: "Sprawl",
  boardSize: 7,
  connectTarget: 5,
  moveTimeoutMs: 8000,
  inventory: { normal: 18, shield: 2, bomb: 2, swap: 2 },
  hiddenShields: false,
  blurb: "7×7, connect 5. Long game.",
})

export const RULESETS: Record<string, Ruleset> = {
  classic: CLASSIC,
  blitz: BLITZ,
  purist: PURIST,
  siege: SIEGE,
  demolition: DEMOLITION,
  fortress: FORTRESS,
  shuffle: SHUFFLE,
  gambit: GAMBIT,
  feint: FEINT,
  sprawl: SPRAWL,
}

export function getRuleset(id: string): Ruleset {
  const found = RULESETS[id]
  if (!found) throw new Error(`Unknown ruleset: ${id}`)
  return found
}
