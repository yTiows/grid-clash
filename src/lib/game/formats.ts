/**
 * Tournament formats.
 *
 * Rake varies by format, and the variation is justified rather than arbitrary:
 * a Swiss guarantees every entrant a fixed number of matches, a single
 * elimination can send someone home after one. Charging the same for both
 * prices the same fee against very different amounts of play.
 *
 * Every rate here is stated on the contest card before entry — the schema
 * stores rake_bps as an immutable column, so the advertised number and the
 * settled number are the same value.
 */

import { calculatePrizePool, type PrizePool } from "./fees"
import { getRuleset, type Ruleset } from "./rulesets"

export type FormatId =
  | "single_elimination"
  | "swiss"
  | "bounty"
  | "survivor"
  | "ladder"
  | "satellite"
  | "arena"

export interface FormatDefinition {
  id: FormatId
  name: string
  /** Shown on the contest card. */
  blurb: string
  rakeBps: number
  /** Why this format's rate differs. Surfaced in the fairness page, not buried. */
  rakeRationale: string
  minField: number
  maxField: number
  /** Guaranteed matches per entrant, where the structure can promise one. */
  guaranteedMatches: number | null
  /** Fraction of each entry diverted to bounties rather than the pool. */
  bountyShareBps: number
}

export const FORMATS: Record<FormatId, FormatDefinition> = {
  single_elimination: {
    id: "single_elimination",
    name: "Knockout",
    blurb: "Lose once, you're out. Shortest road to the title.",
    rakeBps: 1000,
    rakeRationale: "Standard rate. One loss ends your run, so play time varies.",
    minField: 4,
    maxField: 256,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },

  swiss: {
    id: "swiss",
    name: "Swiss",
    blurb: "Fixed rounds, paired by record. Nobody goes home early.",
    rakeBps: 1200,
    rakeRationale: "Higher rate: every entrant plays all rounds regardless of record.",
    minField: 8,
    maxField: 512,
    guaranteedMatches: 5,
    bountyShareBps: 0,
  },

  bounty: {
    id: "bounty",
    name: "Bounty",
    blurb: "Part of every entry sits on that player's head. Knock them out, take it.",
    rakeBps: 1000,
    rakeRationale: "Standard rate. 30% of each entry becomes bounties, paid to entrants.",
    minField: 8,
    maxField: 128,
    guaranteedMatches: 1,
    bountyShareBps: 3000,
  },

  survivor: {
    id: "survivor",
    name: "Survivor",
    blurb: "Every round cuts the bottom half. Last standing takes it.",
    rakeBps: 1200,
    rakeRationale: "Higher rate: guarantees at least three rounds before any cut.",
    minField: 16,
    maxField: 256,
    guaranteedMatches: 3,
    bountyShareBps: 0,
  },

  ladder: {
    id: "ladder",
    name: "Ladder",
    blurb: "Climb against rising opposition. Bank your winnings or push on.",
    rakeBps: 800,
    rakeRationale: "Lower rate: solo structure with no bracket to run or seat to hold.",
    minField: 1,
    maxField: 1,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },

  satellite: {
    id: "satellite",
    name: "Satellite",
    blurb: "Prize is a seat at a bigger table, not cash.",
    rakeBps: 1000,
    rakeRationale: "Standard rate. Prize is paid as tournament entry at face value.",
    minField: 8,
    maxField: 256,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },

  arena: {
    id: "arena",
    name: "Arena",
    blurb: "Winner stays on. Break the streak to take the throne.",
    rakeBps: 1200,
    rakeRationale: "Higher rate: continuous seating, every entrant gets a turn at the throne.",
    minField: 6,
    maxField: 64,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },
}

// --- Structural math --------------------------------------------------------

/** Rounds needed to resolve a single-elimination bracket. */
export function knockoutRounds(fieldSize: number): number {
  return Math.ceil(Math.log2(fieldSize))
}

/**
 * Swiss round count. log2 of the field is the point at which one entrant can
 * be cleanly separated on record; below 8 players it degenerates, so floor
 * at 3 rounds to keep the format meaningful.
 */
export function swissRounds(fieldSize: number): number {
  return Math.max(3, Math.ceil(Math.log2(fieldSize)))
}

/** Survivor cuts the bottom half each round until one remains. */
export function survivorRounds(fieldSize: number): number {
  return Math.ceil(Math.log2(fieldSize))
}

export interface FormatPlan {
  format: FormatDefinition
  ruleset: Ruleset
  fieldSize: number
  entryFeeCents: number
  rounds: number
  pool: PrizePool
  /** Diverted to per-head bounties. Zero outside bounty format. */
  bountyPoolCents: number
  /** Per-head bounty, when the format uses them. */
  bountyPerHeadCents: number
  /** Prize pool after bounties are carved out. */
  placePoolCents: number
}

export function planTournament(
  formatId: FormatId,
  rulesetId: string,
  entryFeeCents: number,
  fieldSize: number
): FormatPlan {
  const format = FORMATS[formatId]
  const ruleset = getRuleset(rulesetId)

  if (fieldSize < format.minField || fieldSize > format.maxField) {
    throw new Error(
      `${format.name} requires a field between ${format.minField} and ${format.maxField}`
    )
  }
  if (entryFeeCents <= 0) throw new Error("Entry fee must be positive")

  // Charged at the format's own rate, which is the rate printed on the card.
  const pool = calculatePrizePool(
    "tournament_standard",
    entryFeeCents,
    fieldSize,
    format.rakeBps
  )

  // Bounties come out of the post-rake pool, not on top of it. Taking them
  // from gross would quietly raise the effective rake above the advertised
  // figure — the exact drift the single-module rule exists to prevent.
  const bountyPoolCents = Math.floor((pool.prizePoolCents * format.bountyShareBps) / 10_000)
  const bountyPerHeadCents = format.bountyShareBps > 0 ? Math.floor(bountyPoolCents / fieldSize) : 0

  // Rounding remainder stays with the places rather than evaporating.
  const distributedBounties = bountyPerHeadCents * fieldSize
  const placePoolCents = pool.prizePoolCents - distributedBounties

  let rounds: number
  switch (formatId) {
    case "swiss":
      rounds = swissRounds(fieldSize)
      break
    case "survivor":
      rounds = survivorRounds(fieldSize)
      break
    case "arena":
      rounds = fieldSize - 1
      break
    case "ladder":
      rounds = 1
      break
    default:
      rounds = knockoutRounds(fieldSize)
  }

  return {
    format,
    ruleset,
    fieldSize,
    entryFeeCents,
    rounds,
    pool,
    bountyPoolCents: distributedBounties,
    bountyPerHeadCents,
    placePoolCents,
  }
}

// --- Guaranteed pools -------------------------------------------------------

/**
 * A guarantee is a published floor on the prize pool. If entries fall short,
 * the platform covers the difference — that shortfall is called overlay and it
 * is a real cost, not an accounting trick.
 *
 * Guarantees drive entries because they are genuinely good for players: an
 * under-subscribed guaranteed event is the best value on the site. The
 * discipline is setting them where expected entries clear the floor most of
 * the time, and treating overlay as marketing spend when they don't.
 */
export interface GuaranteeOutcome {
  guaranteedCents: number
  actualPoolCents: number
  /** Platform's cost when the field falls short. */
  overlayCents: number
  /** What players actually compete for. */
  finalPoolCents: number
  metGuarantee: boolean
}

export function resolveGuarantee(
  guaranteedCents: number,
  actualPoolCents: number
): GuaranteeOutcome {
  const overlayCents = Math.max(0, guaranteedCents - actualPoolCents)
  return {
    guaranteedCents,
    actualPoolCents,
    overlayCents,
    finalPoolCents: Math.max(guaranteedCents, actualPoolCents),
    metGuarantee: actualPoolCents >= guaranteedCents,
  }
}

/**
 * Entries required before a guarantee stops costing money. Use this when
 * setting one — a guarantee whose break-even field exceeds realistic turnout
 * is a standing loss, not a promotion.
 */
export function guaranteeBreakEvenField(
  guaranteedCents: number,
  entryFeeCents: number,
  rakeBps: number
): number {
  const netPerEntry = entryFeeCents * (1 - rakeBps / 10_000)
  return Math.ceil(guaranteedCents / netPerEntry)
}

// --- Satellites -------------------------------------------------------------

/**
 * A satellite pays seats rather than cash. Seats are awarded at face value, so
 * the number of seats is the pool divided by the target buy-in; any remainder
 * pays out as cash to the next finisher rather than being retained.
 */
export interface SatelliteStructure {
  seatsAwarded: number
  seatValueCents: number
  /** Remainder paid in cash to the first player below the seat line. */
  bubbleCashCents: number
}

export function planSatellite(
  poolCents: number,
  targetBuyInCents: number
): SatelliteStructure {
  const seatsAwarded = Math.floor(poolCents / targetBuyInCents)
  return {
    seatsAwarded,
    seatValueCents: targetBuyInCents,
    bubbleCashCents: poolCents - seatsAwarded * targetBuyInCents,
  }
}

// --- Ladder -----------------------------------------------------------------

/**
 * Ladder is a solo climb against progressively stronger opposition, with a
 * decision to bank or continue after each rung.
 *
 * Payouts are published in full before entry, and the decision point is a
 * genuine one: banking is always available, never delayed, and never
 * discouraged in copy. The format works because pushing on is tempting on its
 * merits, not because stopping is made awkward.
 */
export interface LadderRung {
  rung: number
  opponentEloOffset: number
  /** Cumulative return if the player banks here, in cents. */
  bankValueCents: number
  multiplier: number
}

const LADDER_MULTIPLIERS = [1.8, 3.2, 5.6, 9.5, 16] as const

export function planLadder(entryFeeCents: number): LadderRung[] {
  return LADDER_MULTIPLIERS.map((multiplier, i) => ({
    rung: i + 1,
    opponentEloOffset: 50 + i * 75,
    bankValueCents: Math.floor(entryFeeCents * multiplier),
    multiplier,
  }))
}

/**
 * House edge on a ladder rung, given a per-match win probability.
 *
 * Published alongside the rung table. A ladder's multipliers look generous in
 * isolation and the compounding failure probability is what actually decides
 * the value — a player who cannot see both numbers cannot evaluate the offer.
 */
export function ladderEdge(
  entryFeeCents: number,
  rungs: LadderRung[],
  perMatchWinRate: number
): { rung: number; reachProbability: number; expectedValueCents: number }[] {
  return rungs.map((rung) => {
    const reachProbability = perMatchWinRate ** rung.rung
    return {
      rung: rung.rung,
      reachProbability,
      expectedValueCents: reachProbability * rung.bankValueCents - entryFeeCents,
    }
  })
}

// --- Payout distribution ----------------------------------------------------

export interface PayoutPlace {
  place: number
  amountCents: number
}

/**
 * Payout curves by field size. Small fields are winner-takes-all — that is
 * what makes the Daily Dollar and Milestone events feel like events. Larger
 * fields pay deeper so a long grind is not all-or-nothing.
 *
 * Weights are relative and get normalised against the actual prize pool.
 */
const PAYOUT_CURVES: ReadonlyArray<{ minField: number; weights: readonly number[] }> = [
  { minField: 0, weights: [1] },
  { minField: 16, weights: [0.6, 0.25, 0.15] },
  { minField: 33, weights: [0.45, 0.22, 0.14, 0.1, 0.09] },
  { minField: 65, weights: [0.35, 0.19, 0.13, 0.09, 0.07, 0.06, 0.06, 0.05] },
]

function curveFor(fieldSize: number): readonly number[] {
  let chosen = PAYOUT_CURVES[0]!.weights
  for (const curve of PAYOUT_CURVES) {
    if (fieldSize >= curve.minField) chosen = curve.weights
  }
  return chosen
}

/**
 * Splits a prize pool across places. Distributes floored amounts first, then
 * hands every leftover cent to first place, so the sum of payouts always
 * equals the pool exactly — no cent is ever created or lost.
 *
 * Restored here after being found missing from the codebase entirely: an
 * earlier design pass described this function and its weight curves in
 * detail, but the implementation did not survive an intervening rewrite of
 * fees.ts/formats.ts. Caught by checking the import before using it, not by
 * assuming a previously-described function still existed.
 */
export function distributePrizePool(pool: PrizePool): PayoutPlace[] {
  const weights = curveFor(pool.fieldSize)
  const places: PayoutPlace[] = weights.map((weight, i) => ({
    place: i + 1,
    amountCents: Math.floor(pool.prizePoolCents * weight),
  }))

  const distributed = places.reduce((sum, p) => sum + p.amountCents, 0)
  const remainder = pool.prizePoolCents - distributed
  const first = places[0]
  if (remainder !== 0 && first) {
    first.amountCents += remainder
  }

  return places
}
