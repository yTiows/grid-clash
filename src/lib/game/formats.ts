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

import { calculatePrizePool, expectedScore, type FeeTier, type PrizePool } from "./fees"
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
    rakeBps: 1400,
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
    rakeBps: 1500,
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
    rakeBps: 1400,
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
    rakeBps: 1500,
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
    rakeBps: 1100,
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
    rakeBps: 1400,
    rakeRationale: "Standard rate. Prize is paid as tournament entry at face value.",
    minField: 8,
    maxField: 256,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },

  // Was advertised as a literal "winner stays on" king-of-the-hill ladder
  // (one continuous seat, challengers queued one at a time), priced above
  // Knockout for that reason. That mechanic was never actually implemented
  // — bracket.ts's advanceRound had no branch for "arena" at all, so it
  // silently fell into the shared score-format path and crowned whichever
  // tied player happened to sort first after a single simultaneous round,
  // while still charging the higher rate for a contest structure that
  // doesn't exist in code. Routed through the same knockout bracket
  // Knockout/Satellite/Bounty already use (bracket.ts) until a real
  // sequential king-of-the-hill runner gets built — this file's own
  // architecture is round-based/simultaneous throughout, and "one ongoing
  // seat" doesn't fit that shape without a different scheduler, which is
  // more than a rules fix. Priced identically to Knockout now, since the
  // mechanic genuinely is Knockout's until that runner exists.
  arena: {
    id: "arena",
    name: "Arena",
    blurb: "Single elimination. One loss ends your run.",
    rakeBps: 1400,
    rakeRationale: "Standard rate — same bracket mechanic as Knockout.",
    minField: 6,
    maxField: 64,
    guaranteedMatches: 1,
    bountyShareBps: 0,
  },
}

// --- Rank-tiered rake --------------------------------------------------------

/**
 * A tournament pools money from an entire field at one rake rate — unlike
 * ranked, where each match is its own private pot, there is no way to give
 * different entrants a different effective rate inside the same pool
 * without breaking gross_cents = entry_fee_cents * field_size, the
 * invariant every CHECK constraint and downstream payout function assumes.
 *
 * So instead of per-player discounting, this is a per-CONTEST discount: a
 * tournament is created with a minPlayerTier (tournaments.min_player_tier),
 * gating entry to players whose player_standing.fee_tier meets it
 * (enforced in check_contest_eligibility(), 20260801000005) and charging
 * that tier's rate for the whole field. Same shape poker/DFS actually use
 * for tournaments — rakeback after the fact (this codebase's loyalty
 * points, §5.2), not a different up-front rate inside one pool.
 *
 * Elite is exactly half of standard for every format — the same "half
 * price once you've proven it" story as FEE_TIERS.elite being exactly half
 * of FEE_TIERS.standard in fees.ts (5% of 10%). Established sits close to
 * ranked's own 0.9x ratio, rounded to a clean printed number per format
 * rather than a raw multiply (12.5% reads better than 12.6%).
 */
export const FORMAT_TIER_RAKE_BPS: Record<FormatId, Record<FeeTier, number>> = {
  single_elimination: { standard: 1400, established: 1250, elite: 700 },
  swiss: { standard: 1500, established: 1350, elite: 750 },
  bounty: { standard: 1400, established: 1250, elite: 700 },
  survivor: { standard: 1500, established: 1350, elite: 750 },
  ladder: { standard: 1100, established: 1000, elite: 550 },
  satellite: { standard: 1400, established: 1250, elite: 700 },
  arena: { standard: 1400, established: 1250, elite: 700 },
}

export function rakeBpsForTier(formatId: FormatId, tier: FeeTier): number {
  return FORMAT_TIER_RAKE_BPS[formatId][tier]
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
  /** The tier this plan was priced at — 'standard' unless requested otherwise. */
  tier: FeeTier
  /** The actual rate charged, from FORMAT_TIER_RAKE_BPS — may differ from format.rakeBps when tier isn't 'standard'. */
  rakeBps: number
}

export function planTournament(
  formatId: FormatId,
  rulesetId: string,
  entryFeeCents: number,
  fieldSize: number,
  tier: FeeTier = "standard"
): FormatPlan {
  const format = FORMATS[formatId]
  const ruleset = getRuleset(rulesetId)

  if (fieldSize < format.minField || fieldSize > format.maxField) {
    throw new Error(
      `${format.name} requires a field between ${format.minField} and ${format.maxField}`
    )
  }
  if (entryFeeCents <= 0) throw new Error("Entry fee must be positive")

  // Charged at this tier's rate for the format, which is the rate printed
  // on the card — see FORMAT_TIER_RAKE_BPS above for why this is a
  // per-contest tier rather than a per-entrant discount.
  const rakeBps = rakeBpsForTier(formatId, tier)
  const pool = calculatePrizePool("tournament_standard", entryFeeCents, fieldSize, rakeBps)

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
    tier,
    rakeBps,
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

/**
 * Backward-induction check (V(i) = max(bank, p(i+1) * V(i+1)), same formula
 * settle_ranked_match's Elo already uses) on the old 50 + i*75 curve showed
 * banking strictly dominated pushing at every single rung — push EV was
 * roughly 5-8x worse than banking, not a real decision, just a trap for
 * anyone who ran the numbers. 75 + i*50 keeps the "progressively stronger
 * opposition" fantasy (still escalating) but flattens it enough that
 * pushing stays a genuine, if still bank-favored, temptation across the
 * whole ladder instead of falling off a cliff after rung 1: push EV runs
 * roughly 60% of bank's value at the first step down to ~30% at the last,
 * rather than 33% down to 12%.
 */
export function planLadder(entryFeeCents: number): LadderRung[] {
  return LADDER_MULTIPLIERS.map((multiplier, i) => ({
    rung: i + 1,
    opponentEloOffset: 75 + i * 50,
    bankValueCents: Math.floor(entryFeeCents * multiplier),
    multiplier,
  }))
}

/**
 * House edge on a ladder rung, given the player's estimated win rate against
 * rung 1's opponent strength.
 *
 * Previously this compounded one flat perMatchWinRate raised to the rung
 * number (perMatchWinRate ** rung.rung) — mathematically wrong the moment a
 * ladder has more than one rung, since every rung after the first has a
 * different (harder) opponentEloOffset, and a flat rate can't reflect that.
 * A player who calibrated their honest win rate against typical rung-1
 * opposition would see this page understate their real risk at every rung
 * beyond the first, on a page whose whole stated purpose is publishing the
 * real number so the offer can be evaluated honestly.
 *
 * Fixed by converting the reported rate into an implied Elo edge (the
 * inverse of the standard logistic formula) and compounding each rung's
 * ACTUAL win probability via expectedScore — the same formula matchmaking
 * itself already uses — scaled by how much harder that rung's opponent is
 * relative to rung 1, not by an arbitrary flat exponent.
 */
export function ladderEdge(
  entryFeeCents: number,
  rungs: LadderRung[],
  perMatchWinRate: number
): { rung: number; reachProbability: number; expectedValueCents: number }[] {
  const clamped = Math.min(0.999, Math.max(0.001, perMatchWinRate))
  const impliedEloEdge = 400 * Math.log10(clamped / (1 - clamped))
  const firstRungOffset = rungs[0]?.opponentEloOffset ?? 0

  let cumulative = 1
  return rungs.map((rung) => {
    const relativeOffset = rung.opponentEloOffset - firstRungOffset
    const rungWinProb = expectedScore(impliedEloEdge, relativeOffset)
    cumulative *= rungWinProb
    return {
      rung: rung.rung,
      reachProbability: cumulative,
      expectedValueCents: cumulative * rung.bankValueCents - entryFeeCents,
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
