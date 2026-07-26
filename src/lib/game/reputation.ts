/**
 * Reputation and rewards.
 *
 * Every formula here is published verbatim in-product. Elo has been public for
 * seventy years and remains unexploitable, because the only way to move it is
 * to win. The same property holds for everything below: each input is
 * something a player would want to do anyway, so disclosure costs nothing and
 * buys the trust that makes a stakes platform usable.
 *
 * Money rewards are handled in fees.ts. This module is what players chase once
 * money stops being novel — which happens faster than most operators expect.
 */

import type { FeeTier } from "./fees"

// --- Skill Index ------------------------------------------------------------

/**
 * A 0..10,000 composite. Elo alone answers "how strong", which understates a
 * player who has beaten hard fields and overstates one who farmed a soft pool.
 *
 * Weighting is deliberate: rating dominates, but it cannot be the whole score
 * or a player who never faces anyone good looks identical to one who does.
 *
 *   Rating        6,000  normalised Elo
 *   Opposition    1,500  average strength of fields faced
 *   Consistency   1,000  inverse of result variance
 *   Volume        1,000  log-scaled, capped
 *   Fair play       500  clean record
 */
export const SKILL_INDEX_MAX = 10_000

export interface SkillIndexInputs {
  eloRating: number
  /** Mean Elo of opponents faced, last 100 matches. */
  averageOpponentElo: number
  /** Standard deviation of per-match performance vs expectation. Lower is steadier. */
  performanceStdDev: number
  matchesPlayed: number
  distinctOpponents: number
  upheldFairPlayFindings: number
}

export interface SkillIndexBreakdown {
  total: number
  rating: number
  opposition: number
  consistency: number
  volume: number
  fairPlay: number
  /** Shown to the player so the number is never a black box. */
  explanation: string[]
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function calculateSkillIndex(i: SkillIndexInputs): SkillIndexBreakdown {
  // Elo 400..3200 maps across the rating band.
  const rating = Math.round(clamp((i.eloRating - 400) / 2800, 0, 1) * 6000)

  // Opposition credit only accrues above the 1600 baseline: beating weaker
  // fields should not raise the score, or farming becomes a strategy.
  const opposition = Math.round(clamp((i.averageOpponentElo - 1400) / 800, 0, 1) * 1500)

  // Steadiness. A player whose results swing wildly is either still finding
  // their level or not playing their own game.
  const consistency = Math.round(clamp(1 - i.performanceStdDev / 0.5, 0, 1) * 1000)

  /**
   * Volume is log-scaled and capped so grinding cheap matches cannot
   * substitute for strength. Distinct opponents gate it: 500 matches against
   * six people is not a body of work, and it is the exact shape collusion
   * produces.
   */
  const opponentDiversity = clamp(i.distinctOpponents / 100, 0, 1)
  const rawVolume = clamp(Math.log10(Math.max(1, i.matchesPlayed)) / 3, 0, 1)
  const volume = Math.round(rawVolume * opponentDiversity * 1000)

  const fairPlay = i.upheldFairPlayFindings > 0 ? 0 : 500

  const total = rating + opposition + consistency + volume + fairPlay

  const explanation = [
    `Rating ${rating}/6000 — from your Elo of ${i.eloRating}`,
    `Opposition ${opposition}/1500 — average opponent ${Math.round(i.averageOpponentElo)}`,
    `Consistency ${consistency}/1000 — steadier results score higher`,
    `Volume ${volume}/1000 — ${i.matchesPlayed} matches across ${i.distinctOpponents} opponents`,
    `Fair play ${fairPlay}/500 — ${i.upheldFairPlayFindings === 0 ? "clean record" : "findings on file"}`,
  ]

  return { total, rating, opposition, consistency, volume, fairPlay, explanation }
}

// --- Confidence -------------------------------------------------------------

/**
 * How certain the system is about a player's true level. Drives placement
 * matchmaking and the new-account stake ceiling.
 *
 * Rises on match count ALONE. Tying it to consistency would let a smurf play
 * erratically to stay uncertain and farm the beginner pool for their whole
 * placement window — the ceiling would never lift because they would never let
 * it. Volume is not gameable in the same direction: staying low-confidence
 * requires not playing, which is self-defeating.
 */
export const CONFIDENCE_FULL_AT_MATCHES = 30

export function calculateConfidence(matchesPlayed: number): number {
  return clamp(matchesPlayed / CONFIDENCE_FULL_AT_MATCHES, 0, 1)
}

export function isProvisional(matchesPlayed: number): boolean {
  return matchesPlayed < CONFIDENCE_FULL_AT_MATCHES
}

// --- Trust ------------------------------------------------------------------

/**
 * Fraud-adjacent standing. Gates fee tier, contest access, and limits.
 *
 * It does NOT gate withdrawal speed. Holding someone's own money behind an
 * engagement score is indefensible however it is framed; withdrawal timing
 * keys on verification status and open fraud findings, which are objective and
 * contestable. See withdrawalHoldHours below.
 */
export interface TrustInputs {
  accountAgeDays: number
  matchesCompleted: number
  distinctOpponents: number
  identityVerified: boolean
  openFraudFlags: number
  upheldFairPlayFindings: number
  chargebacks: number
}

export interface TrustBreakdown {
  score: number
  band: "new" | "building" | "trusted" | "veteran"
  criteria: string[]
  blockedBy: string[]
}

export function calculateTrust(i: TrustInputs): TrustBreakdown {
  const blockedBy: string[] = []
  if (i.chargebacks > 0) blockedBy.push("Chargeback on file")
  if (i.upheldFairPlayFindings > 0) blockedBy.push("Upheld fair-play finding")
  if (i.openFraudFlags > 0) blockedBy.push("Open review")

  if (blockedBy.length > 0) {
    return { score: 0, band: "new", criteria: [], blockedBy }
  }

  const age = clamp(i.accountAgeDays / 90, 0, 1) * 25
  const volume = clamp(i.matchesCompleted / 200, 0, 1) * 25
  const diversity = clamp(i.distinctOpponents / 75, 0, 1) * 25
  const verified = i.identityVerified ? 25 : 0

  const score = Math.round(age + volume + diversity + verified)

  const band: TrustBreakdown["band"] =
    score >= 85 ? "veteran" : score >= 60 ? "trusted" : score >= 30 ? "building" : "new"

  return {
    score,
    band,
    criteria: [
      `Account age ${Math.round(age)}/25 — ${i.accountAgeDays} days`,
      `Matches ${Math.round(volume)}/25 — ${i.matchesCompleted} completed`,
      `Opponent diversity ${Math.round(diversity)}/25 — ${i.distinctOpponents} distinct`,
      `Verification ${verified}/25 — ${i.identityVerified ? "verified" : "not verified"}`,
    ],
    blockedBy: [],
  }
}

/**
 * Withdrawal hold, keyed on verification and open findings only.
 *
 * A player can always see exactly why their withdrawal is held and exactly
 * what clears it. Nothing here can be improved by playing more.
 */
export function withdrawalHoldHours(input: {
  identityVerified: boolean
  openFraudFlags: number
  depositWithinLast72h: boolean
}): { hours: number; reason: string; clearedBy: string } {
  if (input.openFraudFlags > 0) {
    return {
      hours: 72,
      reason: "An open review is on your account.",
      clearedBy: "Our team completes the review. You will be notified of the outcome.",
    }
  }
  if (!input.identityVerified) {
    return {
      hours: 24,
      reason: "Identity verification is not complete.",
      clearedBy: "Complete verification for instant withdrawals.",
    }
  }
  if (input.depositWithinLast72h) {
    return {
      hours: 72,
      reason: "Recent deposits settle for 72 hours before withdrawal.",
      clearedBy: "Automatic once the deposit settles.",
    }
  }
  return { hours: 0, reason: "No hold.", clearedBy: "" }
}

// --- Automated-play detection ----------------------------------------------

/**
 * Bot suspicion score, 0..100.
 *
 * Feeds a freeze-and-review queue. It never awards benefits.
 *
 * A "human rating" that unlocks perks fails three ways: a detected bot keeps
 * taking money from real players while it decays; jitter defeats it in one
 * line of code; and it penalises the consistency that actually defines strong
 * play, so the system would systematically punish its best users.
 *
 * Detection inputs stay server-side. Publishing them writes the evasion guide.
 */
export interface BotSignals {
  /** Std dev of move latency, ms. Humans vary far more than schedulers. */
  latencyStdDevMs: number
  /** Fraction of moves matching a solver's top choice. */
  optimalMoveRate: number
  /** Longest unbroken session, hours. */
  longestSessionHours: number
  /** Distinct calendar hours played across the week. */
  activeHoursSpread: number
  matchesPlayed: number
}

export type BotAction = "none" | "monitor" | "review" | "freeze"

export function scoreAutomationSuspicion(s: BotSignals): {
  score: number
  action: BotAction
} {
  if (s.matchesPlayed < 20) return { score: 0, action: "none" }

  let score = 0

  // Machine-regular timing.
  if (s.latencyStdDevMs < 40) score += 35
  else if (s.latencyStdDevMs < 90) score += 20

  // Near-solver accuracy sustained over volume.
  if (s.optimalMoveRate > 0.94) score += 35
  else if (s.optimalMoveRate > 0.88) score += 20

  // Sessions no human sustains.
  if (s.longestSessionHours > 14) score += 20
  else if (s.longestSessionHours > 10) score += 10

  // Round-the-clock coverage.
  if (s.activeHoursSpread >= 22) score += 10

  const action: BotAction =
    score >= 70 ? "freeze" : score >= 50 ? "review" : score >= 30 ? "monitor" : "none"

  return { score: Math.min(100, score), action }
}

// --- Comeback refund --------------------------------------------------------

/**
 * The corrected losing-streak mechanic.
 *
 * The original proposal — a free entry against a paying opponent — fails three
 * ways: it rewards continuing after ten losses, which is the textbook
 * loss-chasing trigger; it puts a paying opponent against someone with zero
 * downside, which is a hidden advantage; and it is farmable by dumping ten
 * cheap matches to claim a free expensive seat.
 *
 * This refunds ONE entry fee at the streak's own stake level instead. Identical
 * cost, no unfairness to anyone, and the exploit is arithmetically dead: you
 * cannot profit by losing ten matches to recover one.
 */
export const COMEBACK_STREAK_REQUIRED = 10
export const COMEBACK_COOLDOWN_DAYS = 7

export interface ComebackEligibility {
  eligible: boolean
  refundCents: number
  reason: string
  /** Shown alongside. The point is a decision, not a nudge to continue. */
  showBreakPrompt: boolean
  suggestedStakeDownCents: number | null
}

export function evaluateComeback(input: {
  consecutiveLosses: number
  /** Losses that were forfeits or timeouts rather than played out. */
  forfeitedLosses: number
  medianStakeInStreakCents: number
  daysSinceLastComeback: number | null
  currentStakeCents: number
}): ComebackEligibility {
  const playedLosses = input.consecutiveLosses - input.forfeitedLosses

  if (input.consecutiveLosses < COMEBACK_STREAK_REQUIRED) {
    return {
      eligible: false,
      refundCents: 0,
      reason: `${COMEBACK_STREAK_REQUIRED - input.consecutiveLosses} more to qualify`,
      showBreakPrompt: input.consecutiveLosses >= 5,
      suggestedStakeDownCents: null,
    }
  }

  // Instant forfeits are cheap to manufacture; only played matches count.
  if (playedLosses < COMEBACK_STREAK_REQUIRED) {
    return {
      eligible: false,
      refundCents: 0,
      reason: "Only matches played to completion count toward a comeback refund.",
      showBreakPrompt: true,
      suggestedStakeDownCents: null,
    }
  }

  if (input.daysSinceLastComeback !== null && input.daysSinceLastComeback < COMEBACK_COOLDOWN_DAYS) {
    return {
      eligible: false,
      refundCents: 0,
      reason: `Available again in ${COMEBACK_COOLDOWN_DAYS - input.daysSinceLastComeback} days`,
      showBreakPrompt: true,
      suggestedStakeDownCents: Math.floor(input.currentStakeCents / 2),
    }
  }

  // Refund is bounded by the streak's own stakes, so ten $1 losses cannot
  // fund a $100 seat.
  const refundCents = Math.min(input.medianStakeInStreakCents, input.currentStakeCents)

  return {
    eligible: true,
    refundCents,
    reason: "One entry fee refunded.",
    showBreakPrompt: true,
    suggestedStakeDownCents: Math.floor(input.currentStakeCents / 2),
  }
}

// --- Non-monetary rewards ---------------------------------------------------

export type RewardKind =
  | "title"
  | "access"
  | "reserved_seat"
  | "challenge_right"
  | "host_right"
  | "flair"
  | "archive_entry"

export interface RewardDefinition {
  id: string
  kind: RewardKind
  name: string
  description: string
  /** Published requirement. */
  earnedBy: string
  /** Whether it can ever be bought. Everything here is false, deliberately. */
  purchasable: false
  expiresAfterDays: number | null
}

/**
 * The catalogue.
 *
 * Nothing here is purchasable and nothing affects match outcomes. Both
 * properties are load-bearing: a reward that can be bought is pay-to-win the
 * moment it touches gameplay, and a reward that touches gameplay breaks the
 * skill claim the whole platform rests on.
 */
export const REWARDS: RewardDefinition[] = [
  {
    id: "title_tier",
    kind: "title",
    name: "Contest title",
    description: "Worn beside your name in lobbies and on the leaderboard.",
    earnedBy: "Win a contest at the corresponding entry tier.",
    purchasable: false,
    expiresAfterDays: null,
  },
  {
    id: "reserved_dollar_seat",
    kind: "reserved_seat",
    name: "Daily Dollar reserved seat",
    description: "Your seat in the next Daily Dollar is held for 60 minutes after it opens.",
    earnedBy: "Win a Daily Dollar. Applies to the next event only.",
    // Non-cumulative and single-event by design. Without both, fifteen winners
    // would lock a fifteen-seat event permanently and no newcomer would ever
    // get in.
    purchasable: false,
    expiresAfterDays: 1,
  },
  {
    id: "invitational_access",
    kind: "access",
    name: "Invitational entry",
    description: "Eligibility for invitation-only contests.",
    earnedBy: "Skill Index above 8,000 with verified identity and a clean record.",
    purchasable: false,
    expiresAfterDays: 30,
  },
  {
    id: "challenge_right",
    kind: "challenge_right",
    name: "Challenge right",
    description: "Issue a direct challenge to a ranked player above you.",
    earnedBy: "Win three consecutive ranked matches against higher-rated opponents.",
    // Recipients opt in and can decline without penalty. An unsolicited,
    // unlimited challenge channel aimed at top players is a harassment vector,
    // and the people it targets are the ones the platform can least afford to
    // lose.
    purchasable: false,
    expiresAfterDays: 7,
  },
  {
    id: "host_right",
    kind: "host_right",
    name: "Custom host rights",
    description: "Host custom 1v1s on any ruleset with your own stake and settings.",
    earnedBy: "50 completed matches and verified identity.",
    // Hosting rights rather than ruleset access. Gating rulesets themselves
    // would split an already-thin queue across variants; hosting is a
    // permission, not a partition.
    purchasable: false,
    expiresAfterDays: null,
  },
  {
    id: "season_archive",
    kind: "archive_entry",
    name: "Season archive",
    description: "Permanent entry in the season record. Never removed.",
    earnedBy: "Finish a season in the top 100 by Skill Index.",
    purchasable: false,
    expiresAfterDays: null,
  },
  {
    id: "profile_flair",
    kind: "flair",
    name: "Profile flair",
    description: "Visual marks on your profile and match history.",
    earnedBy: "Personal bests, streaks, and upsets.",
    purchasable: false,
    expiresAfterDays: null,
  },
]

// --- Personal bests ---------------------------------------------------------

/**
 * What a player chases once money stops being the novelty.
 *
 * Net profit is included and is ALWAYS shown, positive or negative. Displaying
 * it only when favourable is the kind of selective honesty that destroys trust
 * the first time someone notices. A player who is down should be able to see
 * that at a glance — it is their money.
 */
export interface PersonalBests {
  longestWinStreak: number
  highestElo: number
  /** Largest Elo gap overcome in a win. */
  biggestUpsetElo: number
  fastestWinSeconds: number
  bestFinishPlace: number | null
  totalMatches: number
  /** Always displayed. Never conditionally hidden. */
  netProfitCents: number
}

/**
 * Head-to-head record against a specific opponent.
 *
 * The cheapest retention mechanic available: a 3-4 record against someone you
 * remember is a reason to come back that costs nothing and manipulates no one.
 */
export interface Rivalry {
  opponentId: string
  opponentUsername: string
  wins: number
  losses: number
  lastPlayedAt: string
  netCents: number
}

// --- Fee tier assignment ----------------------------------------------------

/**
 * Maps standing onto the published fee tiers. Requirements are stated in
 * fees.ts and shown verbatim, so a player can always see the next tier and
 * exactly what reaches it.
 */
export function assignFeeTier(input: {
  matchesPlayed: number
  distinctOpponents: number
  identityVerified: boolean
  skillIndexPercentile: number
  upheldFairPlayFindings: number
}): FeeTier {
  if (input.upheldFairPlayFindings > 0) return "standard"

  if (
    input.matchesPlayed >= 500 &&
    input.distinctOpponents >= 150 &&
    input.identityVerified &&
    input.skillIndexPercentile <= 1
  ) {
    return "elite"
  }

  if (input.matchesPlayed >= 100 && input.distinctOpponents >= 50 && input.identityVerified) {
    return "established"
  }

  return "standard"
}
