/**
 * Fee model.
 *
 * One formula, one cap, published tiers. There is no threshold at which a
 * player should prefer a different stake for fee reasons below the cap, and
 * above the cap the marginal rate only ever falls.
 *
 * Tier criteria are published verbatim in the UI. A hidden multiplier on a
 * money term is not a transparent fee, whatever it is called internally.
 */

export const FEE_CAP_CENTS = 25_000 // $250 per match, hard ceiling

export type FeeTier = "standard" | "established" | "elite"

export interface FeeTierDefinition {
  id: FeeTier
  name: string
  bps: number
  /** Shown to the player verbatim. Every criterion is objectively checkable. */
  criteria: string[]
  minMatches: number
  minDistinctOpponents: number
  requiresVerification: boolean
  /** Percentile of Skill Index, where the tier uses one. */
  topPercentile: number | null
}

export const FEE_TIERS: Record<FeeTier, FeeTierDefinition> = {
  standard: {
    id: "standard",
    name: "Standard",
    // 10% as of the 2026-07-28 repricing (was 3%; BRAND.md §3/§5/§6/§11
    // updated in the same change — break-even moved from 51.55% to 55.56%,
    // still under the 60–70% the category's break-even actually runs at).
    // Raised because 3% no longer covered real operating cost after
    // processing fees and tax — 10% is the top of the "cash game" rake band
    // the platform's own research treats as not-yet-predatory (see
    // CLAUDE_CODE_BRIEF.md §5.1's cited range: cash games 2.5–10%, above
    // ~15–20% players correctly read it as predatory). Rank-based tiers
    // exist precisely so this base rate isn't the only rate: it's what a
    // brand-new account pays, not what a strong, established player settles
    // into.
    bps: 1000,
    criteria: ["Everyone starts here"],
    minMatches: 0,
    minDistinctOpponents: 0,
    requiresVerification: false,
    topPercentile: null,
  },
  established: {
    id: "established",
    name: "Established",
    // Modest discount, matching the old tier's shape (small step here, the
    // real drop reserved for elite) rather than splitting the 1000->500
    // range evenly.
    bps: 900,
    criteria: [
      "100 completed matches",
      "50 distinct opponents",
      "Identity verified",
      "No upheld fair-play findings",
    ],
    minMatches: 100,
    minDistinctOpponents: 50,
    requiresVerification: true,
    topPercentile: null,
  },
  elite: {
    id: "elite",
    name: "Elite",
    // 5% — half the standard rate, same ratio as the pre-repricing 1.5%/3%
    // pair. This is the number the top-tier marketing claim is built on.
    bps: 500,
    criteria: [
      "500 completed matches",
      "150 distinct opponents",
      "Identity verified",
      "Skill Index in the top 1%",
      "No upheld fair-play findings",
    ],
    minMatches: 500,
    minDistinctOpponents: 150,
    requiresVerification: true,
    topPercentile: 1,
  },
}

/**
 * The $1 stake is a deliberate loss-leading on-ramp, not a normal
 * percentage-rate stake: 3% of a $2 pot is 6 cents, too small to cover
 * processing/operational overhead on its own, and a fee that small reads as
 * "free" rather than "cheap." A flat quarter keeps the entry tier honest
 * about costing something while staying obviously the cheapest way to try
 * ranked for real. It does not scale down by fee tier — it's a floor, not a
 * rate, so a tier discount has nothing to apply to.
 */
export const MINIMUM_STAKE_CENTS = 100
export const MINIMUM_STAKE_FLAT_FEE_CENTS = 25

export interface MatchFee {
  tier: FeeTier
  bps: number
  potCents: number
  /** Uncapped fee, before FEE_CAP_CENTS is applied. */
  rawFeeCents: number
  feeCents: number
  capped: boolean
  /** True for the $1 minimum-stake flat fee — feeCents did not come from bps. */
  isFlatFee: boolean
  winnerPayoutCents: number
  /** Realised rate after the cap (or, for the flat fee, its equivalent rate). */
  effectiveBps: number
}

/**
 * Fee is floored so any rounding remainder lands in the payout rather than in
 * the platform's cut. The $1 stake is the one exception — see
 * MINIMUM_STAKE_FLAT_FEE_CENTS — where the fee is a fixed amount, not a rate.
 */
export function calculateMatchFee(entryFeeCents: number, tier: FeeTier = "standard"): MatchFee {
  const { bps } = FEE_TIERS[tier]
  const potCents = entryFeeCents * 2

  if (entryFeeCents === MINIMUM_STAKE_CENTS) {
    const feeCents = Math.min(MINIMUM_STAKE_FLAT_FEE_CENTS, potCents)
    return {
      tier,
      bps,
      potCents,
      rawFeeCents: feeCents,
      feeCents,
      capped: false,
      isFlatFee: true,
      winnerPayoutCents: potCents - feeCents,
      effectiveBps: Math.round((feeCents / potCents) * 10_000),
    }
  }

  const rawFeeCents = Math.floor((potCents * bps) / 10_000)
  const feeCents = Math.min(rawFeeCents, FEE_CAP_CENTS)

  return {
    tier,
    bps,
    potCents,
    rawFeeCents,
    feeCents,
    capped: rawFeeCents > FEE_CAP_CENTS,
    isFlatFee: false,
    winnerPayoutCents: potCents - feeCents,
    effectiveBps: Math.round((feeCents / potCents) * 10_000),
  }
}

/** Pot at which the cap starts binding, for a given tier. */
export function capBindsAtPotCents(tier: FeeTier = "standard"): number {
  return Math.ceil((FEE_CAP_CENTS * 10_000) / FEE_TIERS[tier].bps)
}

/**
 * Break-even win rate. Staking E to win W, expected value is p·W − E, so
 * break-even is p = E / W.
 *
 * Printed next to the stake selector, per tier. It is the single most
 * decision-relevant number on the page: at the standard 10% rate it is
 * 55.56%, which a strong player clears. The whole product premise depends on
 * this staying true, so it is displayed rather than derivable.
 */
export function breakEvenWinRate(entryFeeCents: number, tier: FeeTier = "standard"): number {
  return entryFeeCents / calculateMatchFee(entryFeeCents, tier).winnerPayoutCents
}

export function expectedValueCents(
  entryFeeCents: number,
  winRate: number,
  tier: FeeTier = "standard"
): number {
  return winRate * calculateMatchFee(entryFeeCents, tier).winnerPayoutCents - entryFeeCents
}

// --- Stake brackets ---------------------------------------------------------

/**
 * Financial leagues. Access is earned, which keeps a funded beginner out of a
 * pool where they are certain to be outclassed.
 *
 * NOTE — liquidity: segmenting a small player base across brackets thins every
 * queue. `bracketsOpenAfterWait` widens the search the longer someone waits, so
 * a quiet Tuesday does not mean no games. Without that, this design is a
 * fairness win and a retention loss.
 *
 * STATUS — not wired into matchmaking. Nothing in src/ calls BRACKETS,
 * bracketsUnlockedFor, or bracketsOpenAfterWait outside this file: the queue
 * (stake-picker.tsx, match-server.ts) gates only on RANKED_STAKE_TIERS_CENTS
 * and newAccountStakeCeilingCents below. elite.maxStakeCents ($10,000) is
 * therefore NOT the platform's real ranked stake ceiling — a prior review
 * (CLAUDE_CODE_BRIEF.md §5.1) mistook this dead scaffold for the live limit.
 * The real ceiling is RANKED_STAKE_TIERS_CENTS' top entry, and that is what
 * was actually lowered. Leave this comment until BRACKETS is either wired up
 * or removed, so the same mistake isn't made twice.
 */
export type BracketId = "bronze" | "silver" | "gold" | "elite"

export interface Bracket {
  id: BracketId
  name: string
  minStakeCents: number
  maxStakeCents: number
  /** Matches required before this bracket unlocks. */
  minMatches: number
  minSkillIndex: number
  requiresVerification: boolean
}

export const BRACKETS: Record<BracketId, Bracket> = {
  bronze: {
    id: "bronze",
    name: "Bronze",
    minStakeCents: 100,
    maxStakeCents: 1_000,
    minMatches: 0,
    minSkillIndex: 0,
    requiresVerification: false,
  },
  silver: {
    id: "silver",
    name: "Silver",
    minStakeCents: 1_000,
    maxStakeCents: 10_000,
    minMatches: 25,
    minSkillIndex: 2_000,
    requiresVerification: true,
  },
  gold: {
    id: "gold",
    name: "Gold",
    minStakeCents: 10_000,
    maxStakeCents: 100_000,
    minMatches: 100,
    minSkillIndex: 5_000,
    requiresVerification: true,
  },
  elite: {
    id: "elite",
    name: "Elite",
    minStakeCents: 100_000,
    maxStakeCents: 1_000_000,
    minMatches: 300,
    minSkillIndex: 8_000,
    requiresVerification: true,
  },
}

export const BRACKET_ORDER: BracketId[] = ["bronze", "silver", "gold", "elite"]

export function bracketsUnlockedFor(
  matchesPlayed: number,
  skillIndex: number,
  verified: boolean
): BracketId[] {
  return BRACKET_ORDER.filter((id) => {
    const b = BRACKETS[id]
    if (matchesPlayed < b.minMatches) return false
    if (skillIndex < b.minSkillIndex) return false
    if (b.requiresVerification && !verified) return false
    return true
  })
}

/**
 * Progressive widening. After a wait threshold the matcher accepts adjacent
 * brackets so thin queues still resolve. Never widens past what the player has
 * unlocked, and never upward past their stake ceiling.
 */
export function bracketsOpenAfterWait(
  preferred: BracketId,
  unlocked: BracketId[],
  waitedMs: number
): BracketId[] {
  const widenAfterMs = 20_000
  if (waitedMs < widenAfterMs || !unlocked.includes(preferred)) return [preferred]

  const steps = Math.floor(waitedMs / widenAfterMs)
  const index = BRACKET_ORDER.indexOf(preferred)
  const lo = Math.max(0, index - steps)
  const hi = Math.min(BRACKET_ORDER.length - 1, index + steps)

  return BRACKET_ORDER.slice(lo, hi + 1).filter((b) => unlocked.includes(b))
}

// --- New-account stake ceiling ---------------------------------------------

/**
 * A smurf can play erratically to keep their confidence low and farm the
 * beginner pool for a full placement window. Matchmaking isolation alone does
 * not stop that — it only decides who the beginner loses to.
 *
 * A stake ceiling protects the beginner's wallet, which is the thing actually
 * at risk. It rises with match count rather than with consistency, so
 * deliberately erratic play cannot hold a smurf inside the low-stake pool.
 */
export function newAccountStakeCeilingCents(matchesPlayed: number): number {
  if (matchesPlayed < 5) return 200
  if (matchesPlayed < 15) return 500
  if (matchesPlayed < 30) return 1_000
  if (matchesPlayed < 60) return 5_000
  return Number.MAX_SAFE_INTEGER
}

// --- Suggested stakes -------------------------------------------------------

/**
 * A recommendation, never a nudge upward. Bankroll-fraction sizing is the
 * standard result: risking a small fixed fraction per match makes ruin
 * improbable even through normal losing variance.
 *
 * Anything above the suggestion requires explicit confirmation. The platform
 * never proposes a larger stake than this function returns.
 */
export function suggestedStakeCents(
  balanceCents: number,
  matchesPlayed: number,
  recentWinRate: number
): { suggestedCents: number; maxAdvisableCents: number; rationale: string } {
  const ceiling = newAccountStakeCeilingCents(matchesPlayed)

  // 2% of bankroll per match; 1% while still finding their level.
  const fraction = matchesPlayed < 30 ? 0.01 : 0.02
  const bankrollSized = Math.floor(balanceCents * fraction)

  const suggestedCents = Math.max(100, Math.min(bankrollSized, ceiling))
  const maxAdvisableCents = Math.max(100, Math.min(Math.floor(balanceCents * 0.05), ceiling))

  let rationale: string
  if (ceiling !== Number.MAX_SAFE_INTEGER) {
    rationale = `New accounts are capped at ${(ceiling / 100).toFixed(2)} per match while placement completes.`
  } else if (recentWinRate < 0.45) {
    rationale = "Your recent results are below break-even. This keeps variance survivable."
  } else {
    rationale = "Sized at 2% of your balance so a normal losing run does not end your session."
  }

  return { suggestedCents, maxAdvisableCents, rationale }
}

// --- Formatting -------------------------------------------------------------

export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100)
}

export function formatPercent(fraction: number, digits = 2): string {
  return `${(fraction * 100).toFixed(digits)}%`
}

// --- Tournament economics ---------------------------------------------------

/**
 * Tournament fee is charged on the gross field, not per match, and is stated
 * on the contest card before entry.
 *
 * NOTE — the 1v1 standard fee is 1% (FEE_TIERS.standard). Tournament fees are
 * higher because an entry buys a structure rather than a single match:
 * bracket running, seat guarantees, concentrated prizes and a title. That gap
 * is defensible but it is large, and sophisticated players will compare the
 * two directly. See TOURNAMENT_FEE_BPS.
 */
export type ContestKind =
  | "ranked"
  | "tournament_standard"
  | "tournament_dollar"
  | "tournament_milestone"

/** Negative means the house adds to the pot from realised profit. */
export const CONTEST_FEE_BPS: Record<ContestKind, number> = {
  // Dead weight in practice — the real ranked path reads FEE_TIERS via
  // calculateMatchFee(), never this. Kept in sync anyway so no one reading
  // this table sees a second, disagreeing number for what ranked charges.
  ranked: 1000,
  // Tournament economics are deliberately their own thing, not a copy of
  // ranked's rate — an entry buys bracket structure, seat guarantees, and a
  // concentrated prize, not a single match. This default is a fallback only:
  // every FORMATS entry (formats.ts) sets its own rakeBps, which is what
  // actually prices the contest card.
  tournament_standard: 1400,
  tournament_dollar: 0,
  tournament_milestone: -100,
}

export interface PrizePool {
  kind: ContestKind
  entryFeeCents: number
  fieldSize: number
  grossCents: number
  feeCents: number
  prizePoolCents: number
  returnToPlayer: number
}

/**
 * Positive fees are floored and subsidies are ceilinged, so in both directions
 * the rounding remainder lands in the prize pool rather than the platform's
 * cut.
 */
export function calculatePrizePool(
  kind: ContestKind,
  entryFeeCents: number,
  fieldSize: number,
  /**
   * Overrides the kind's default rate. Tournament formats set their own fee
   * (Swiss 12%, Ladder 8%, ...), and passing it explicitly is what keeps the
   * rate on the contest card identical to the rate actually charged.
   */
  overrideBps?: number
): PrizePool {
  const bps = overrideBps ?? CONTEST_FEE_BPS[kind]
  const grossCents = entryFeeCents * fieldSize
  const raw = (grossCents * bps) / 10_000
  const feeCents = bps >= 0 ? Math.floor(raw) : Math.ceil(raw)
  const prizePoolCents = grossCents - feeCents

  return {
    kind,
    entryFeeCents,
    fieldSize,
    grossCents,
    feeCents,
    prizePoolCents,
    returnToPlayer: prizePoolCents / grossCents,
  }
}

/** Expected value of one entry against a uniform field. */
export function tournamentExpectedValueCents(pool: PrizePool): number {
  return pool.prizePoolCents / pool.fieldSize - pool.entryFeeCents
}

// Milestone sizing constants and progressToNextMilestone() live in
// scheduling.ts (MILESTONE_PROFIT_THRESHOLD_CENTS = $20,000, with the full
// fixed_subsidy/guaranteed_pool exposure model built on that number — see
// planMilestoneEvent()). This file used to export a second, conflicting set
// of milestone constants ($1,000 threshold) and its own progressToNextMilestone
// — a stub nothing in src/ ever imported, left behind by whatever rewrite
// produced scheduling.ts's real version. milestone_progress (the SQL view)
// had drifted onto the same wrong $1,000 number as this dead stub; both are
// fixed to scheduling.ts's $20,000 as of 20260726000028_milestone_threshold_fix.sql.
// Removed here rather than left alongside the real one, so there is exactly
// one milestone threshold in the codebase, not two that can drift again.
export const DOLLAR_ENTRY_FEE_CENTS = 100
export const DOLLAR_FIELD_SIZE = 15

// --- Loyalty points -----------------------------------------------------

/**
 * One-time bonus for a player's first tournament entry in a rolling week —
 * CLAUDE_CODE_BRIEF.md §5.6. Lives here rather than in src/actions/
 * tournaments.ts: a "use server" file can only export async functions (and
 * types) — a plain const export from one fails Next.js's server-actions
 * build transform, a class of bug tsc/eslint don't catch.
 */
export const FIRST_TOURNAMENT_OF_WEEK_BONUS_CENTS = 100

// --- Rating -----------------------------------------------------------------

export const ELO_DEFAULT = 1600
export const ELO_MIN = 400
export const ELO_MAX = 3200

/**
 * Selectable ranked stake amounts, shown in the queue UI. Distinct from
 * BRACKETS above: brackets gate which *range* of stakes an account may enter
 * based on skill/verification, while this is the fixed, concrete set of
 * amounts offered within whatever range is unlocked.
 *
 * CLAUDE_CODE_BRIEF.md §5.1 — funnel strategy: ranked's ceiling must sit
 * structurally below where a tournament entry starts feeling like "the real
 * stakes," so a player who outgrows ranked has nowhere to go but a
 * tournament. Standard-tournament title tiers (complete_tournament(),
 * 20260725000019_tournament_completion.sql) start bronze under $25 and gold
 * at $100 — the $10,000 top tier a prior review worried about (see the note
 * on BRACKETS above) turned out to be unreachable dead code; the real ceiling
 * here previously topped out at $100, sitting exactly ON the gold threshold
 * rather than below it.
 *
 * This is a pricing decision, not a pure bug fix, made conservatively per
 * this handoff's instructions: the $100 tier is removed rather than kept and
 * second-guessed later. Ranked stays a real, low-friction front door at $5
 * and $20 — both well under even the cheapest standard tournament tier — and
 * a player who wants to put more than $20 into a single contest now has no
 * ranked option and must go to a tournament to do it. Revisit only alongside
 * an actual pricing review, not as a follow-up code change.
 *
 * $1 added in the 2026-07 repricing as the true minimum-friction on-ramp —
 * see MINIMUM_STAKE_CENTS/MINIMUM_STAKE_FLAT_FEE_CENTS for why it charges a
 * flat fee instead of the tier rate. It sits below newAccountStakeCeilingCents'
 * lowest ceiling ($2), so it's selectable from a brand-new account's very
 * first queue.
 */
export const RANKED_STAKE_TIERS_CENTS = [100, 500, 2000] as const
export type RankedStakeCents = (typeof RANKED_STAKE_TIERS_CENTS)[number]

/**
 * K-factor by experience. New accounts move fast so matchmaking finds their
 * level quickly; established accounts move slowly so a hot streak does not
 * fling them into a bracket they cannot hold.
 */
export function kFactor(matchesPlayed: number): number {
  if (matchesPlayed < 30) return 40
  if (matchesPlayed < 100) return 24
  return 16
}

export function expectedScore(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

export interface RatingChange {
  winnerBefore: number
  winnerAfter: number
  winnerDelta: number
  loserBefore: number
  loserAfter: number
  loserDelta: number
}

function clampRating(rating: number): number {
  return Math.min(ELO_MAX, Math.max(ELO_MIN, rating))
}

export function calculateRatingChange(
  winnerRating: number,
  winnerMatches: number,
  loserRating: number,
  loserMatches: number
): RatingChange {
  const winnerExpected = expectedScore(winnerRating, loserRating)
  const winnerAfter = clampRating(
    Math.round(winnerRating + kFactor(winnerMatches) * (1 - winnerExpected))
  )
  const loserAfter = clampRating(
    Math.round(loserRating + kFactor(loserMatches) * (0 - (1 - winnerExpected)))
  )

  return {
    winnerBefore: winnerRating,
    winnerAfter,
    winnerDelta: winnerAfter - winnerRating,
    loserBefore: loserRating,
    loserAfter,
    loserDelta: loserAfter - loserRating,
  }
}

export function calculateDrawRatingChange(
  ratingA: number,
  matchesA: number,
  ratingB: number,
  matchesB: number
): { aAfter: number; bAfter: number } {
  const expectedA = expectedScore(ratingA, ratingB)
  return {
    aAfter: clampRating(Math.round(ratingA + kFactor(matchesA) * (0.5 - expectedA))),
    bAfter: clampRating(Math.round(ratingB + kFactor(matchesB) * (0.5 - (1 - expectedA)))),
  }
}
