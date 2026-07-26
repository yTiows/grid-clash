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
  /** One line, shown on the contest card. */
  blurb: string
}

function ruleset(r: Ruleset): Ruleset {
  const cells = r.boardSize * r.boardSize
  const pieces = r.inventory.normal + r.inventory.shield + r.inventory.bomb + r.inventory.swap

  // A ruleset where both players can exhaust inventory before the board can
  // hold a line produces unwinnable matches. Caught here rather than at 2am.
  if (pieces * 2 < r.connectTarget) {
    throw new Error(`Ruleset ${r.id}: not enough pieces to ever complete a line`)
  }
  if (r.connectTarget > r.boardSize) {
    throw new Error(`Ruleset ${r.id}: connectTarget exceeds board dimension`)
  }
  if (pieces > cells) {
    throw new Error(`Ruleset ${r.id}: inventory exceeds board capacity`)
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
  blurb: "5×5, connect 4. One shield, one bomb, one swap.",
})

export const BLITZ = ruleset({
  id: "blitz",
  name: "Blitz",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 3000,
  inventory: { normal: 8, shield: 1, bomb: 1, swap: 1 },
  blurb: "Classic on a 3-second clock. Read faster.",
})

export const PURIST = ruleset({
  id: "purist",
  name: "Purist",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 12, shield: 0, bomb: 0, swap: 0 },
  blurb: "No specials. Nothing hidden but intent.",
})

export const SIEGE = ruleset({
  id: "siege",
  name: "Siege",
  boardSize: 6,
  connectTarget: 5,
  moveTimeoutMs: 7000,
  inventory: { normal: 12, shield: 2, bomb: 2, swap: 1 },
  blurb: "6×6, connect 5. Deeper board, heavier toolkit.",
})

export const DEMOLITION = ruleset({
  id: "demolition",
  name: "Demolition",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 6, shield: 1, bomb: 4, swap: 1 },
  blurb: "Four bombs each. Nothing you build is safe.",
})

export const FORTRESS = ruleset({
  id: "fortress",
  name: "Fortress",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 7, shield: 4, bomb: 1, swap: 0 },
  blurb: "Four shields each. Commit early, defend it.",
})

export const SHUFFLE = ruleset({
  id: "shuffle",
  name: "Shuffle",
  boardSize: 5,
  connectTarget: 4,
  moveTimeoutMs: 5000,
  inventory: { normal: 7, shield: 1, bomb: 0, swap: 4 },
  blurb: "Four swaps each. The board never sits still.",
})

export const SPRAWL = ruleset({
  id: "sprawl",
  name: "Sprawl",
  boardSize: 7,
  connectTarget: 5,
  moveTimeoutMs: 8000,
  inventory: { normal: 18, shield: 2, bomb: 2, swap: 2 },
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
  sprawl: SPRAWL,
}

export function getRuleset(id: string): Ruleset {
  const found = RULESETS[id]
  if (!found) throw new Error(`Unknown ruleset: ${id}`)
  return found
}
