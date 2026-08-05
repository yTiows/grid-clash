/**
 * Performance Gap — CLAUDE_CODE_BRIEF.md "Feature C" (originally specced as
 * "Conversion Gap"; renamed — see the header note below).
 *
 * NAMING: "Conversion Gap" is a marketing/sales term (turning a lead into a
 * paying customer). Naming a skill-coaching surface after that concept
 * frames it as a monetization funnel before a single word of copy is
 * written. "Performance Gap" names what it actually measures — the same
 * pattern this codebase already uses for Skill Index and Performance Index
 * — and reads as gameplay analytics, not a pitch. brand/BRAND.md §6: "Name
 * what the player controls."
 *
 * REVISION HISTORY (kept, not scrubbed, per this codebase's own convention
 * of leaving real mistakes and their fixes visible in comments rather than
 * a clean-room rewrite — see fees.ts's inline repricing history for the
 * precedent): the first version of this file compared every match against
 * the player's lifetime personal-best Performance Index. An independent
 * adversarial copy review (four reviewers, different lenses, run before
 * this shipped) converged on two real problems with that design, not just
 * wording: (1) a brand-new player's very first match is trivially their
 * own "personal best" (n=1), so the celebratory "personal-best match"
 * framing fired with zero instructional content on literally every first
 * match; (2) comparing every future match against a lifetime maximum is a
 * ratchet — once a player has one unusually good match, most matches after
 * it register as a deficit relative to that outlier, which is a
 * near-permanent "you're underperforming" message baked into the
 * benchmark choice, not the tone. Rebuilt below to compare against a
 * ROLLING RECENT AVERAGE (the same window Feature B's Performance Index
 * already uses) as the primary reference, with a genuine personal-best
 * called out only as a rare, separate, earned event gated on having real
 * match history — exactly the fix the review converged on.
 *
 * The same review also confirmed 3b-equivalent claims about this game's
 * mechanics (an open double threat can only be blocked one cell per turn)
 * against engine.ts directly: bomb requires an occupied target
 * (`if (!target) return fail(...)`) and swap requires two occupied cells
 * (`if (!target || !other) return fail(...)`) — neither can ever be played
 * into an empty threat cell, so only a single normal/shield placement can
 * block one, one cell per move, exactly as the copy below states. Verified
 * against the actual engine, not assumed from general Connect-4 knowledge.
 *
 * WHAT THIS NEVER DOES: mention money, stakes, entry fees, payouts,
 * profit, "bracket," or breakeven — not softened, entirely absent, because
 * PerformanceGapInputs (below) has no financial field for it to reference
 * even by accident, same structural pattern as performance-index.ts. Never
 * suggests playing another match — no "queue again," no "try now," nothing
 * that reads as pointing a player who may have just lost real money back
 * toward the queue. Shown after every ranked match, win or loss, so it
 * reads as a routine analytics feature rather than something that singles
 * out a loss. A below-average match always pairs its coaching note with an
 * affirmation of the player's actual strongest category that match — never
 * a bare deficit with nothing named as having gone well. Every generated
 * string is self-tested against brand/BRAND.md's banned-vocabulary list in
 * scripts/test-performance-gap.ts — not just written carefully once.
 */

import { matchSubScoreFractions, type MatchPerformanceSnapshot, type PerformanceSubScoreCategory } from "./performance-index"

export interface PerformanceGapInputs {
  thisMatch: MatchPerformanceSnapshot
  thisMatchIndex: number
  /** Rolling average Performance Index over the player's recent matches, EXCLUDING this one. Same window Feature B's player_standing.performance_index uses. */
  recentAverageIndex: number
  /** Highest single-match Performance Index this player has ever recorded, EXCLUDING this one. 0 if this is their first match. */
  priorPersonalBestIndex: number
  /** How many prior matches (not counting this one) this player has recorded. Gates new-personal-best and first-match handling — see MIN_MATCHES_FOR_COMPARISON. */
  priorMatchCount: number
  rulesetName: string
}

export interface PerformanceGapReport {
  thisMatchIndex: number
  band: "first_match" | "new_personal_best" | "above_recent_form" | "steady" | "below_recent_form"
  headline: string
  note: string
  focusCategory: PerformanceSubScoreCategory | null
  /** Informational only — never a call to play another match. */
  tutorialHref: string
}

/** Below this, match-to-match variance isn't a real signal worth a coaching note. */
const GAP_NOISE_THRESHOLD = 30

/**
 * A "personal best" or "recent form" comparison needs enough history to
 * mean anything — see this file's revision-history note above for the
 * exact bug this constant fixes (a first match trivially being its own
 * "best"). Matches the same order of magnitude as reputation.ts's
 * CONFIDENCE_FULL_AT_MATCHES (30), scaled down: a meaningful comparison
 * needs some history, not a full confidence window.
 */
const MIN_MATCHES_FOR_COMPARISON = 5

const CATEGORY_LABEL: Record<PerformanceSubScoreCategory, string> = {
  tactical: "Board control",
  threatCreation: "Threat creation",
  defense: "Defense",
  // Not "Conversion" — see the header's revision-history note: the same
  // word named the rejected "Conversion Gap" feature, and even though this
  // usage is purely about finishing a board line, reusing it is an
  // avoidable, free naming-hygiene fix.
  conversion: "Finishing",
}

const CATEGORY_AFFIRMATION: Record<PerformanceSubScoreCategory, string> = {
  tactical: "Board control carried this one.",
  threatCreation: "You kept threats coming all match.",
  defense: "You shut down their attempts clean.",
  conversion: "You closed it out the moment you could.",
}

const CATEGORY_TEACHING: Record<PerformanceSubScoreCategory, string> = {
  tactical:
    "Central cells sit on more potential lines than edge cells. Claiming ground in the middle early gives you more to build on the rest of the match.",
  threatCreation:
    "A line with both ends open threatens two cells at once — your opponent can only block one. Look for these before playing pieces elsewhere.",
  defense:
    "An open threat stays live until it's actually removed. Checking your opponent's best next move before playing your own catches these before they decide the match.",
  conversion:
    "Recognizing a completable line the moment it's on the board — and taking it before building further — matters as much as creating the position in the first place.",
}

function strongestCategory(fractions: Record<PerformanceSubScoreCategory, number>): PerformanceSubScoreCategory {
  return (Object.keys(fractions) as PerformanceSubScoreCategory[]).reduce((best, c) =>
    fractions[c] > fractions[best] ? c : best
  )
}

function weakestCategory(fractions: Record<PerformanceSubScoreCategory, number>): PerformanceSubScoreCategory {
  return (Object.keys(fractions) as PerformanceSubScoreCategory[]).reduce((worst, c) =>
    fractions[c] < fractions[worst] ? c : worst
  )
}

export function buildPerformanceGapReport(inputs: PerformanceGapInputs): PerformanceGapReport {
  const { thisMatch, thisMatchIndex, recentAverageIndex, priorPersonalBestIndex, priorMatchCount, rulesetName } = inputs
  const fractions = matchSubScoreFractions(thisMatch)
  const top = strongestCategory(fractions)

  if (priorMatchCount < MIN_MATCHES_FOR_COMPARISON) {
    // Not enough history for "personal best" or "recent form" to mean
    // anything — see the header's revision-history note. Purely
    // informational, no comparison implied.
    return {
      thisMatchIndex,
      band: "first_match",
      headline: "First recorded match",
      note: `${thisMatchIndex} points on ${rulesetName}. ${CATEGORY_AFFIRMATION[top]}`,
      focusCategory: null,
      tutorialHref: "/tutorial",
    }
  }

  if (thisMatchIndex > priorPersonalBestIndex) {
    // A genuine, rare event now that it's gated on real history — flat and
    // factual per brand/BRAND.md §6's result-screen register, not
    // celebration-inflated.
    return {
      thisMatchIndex,
      band: "new_personal_best",
      headline: "New personal best",
      note: `${thisMatchIndex} points on ${rulesetName} — your highest recorded. ${CATEGORY_AFFIRMATION[top]}`,
      focusCategory: null,
      tutorialHref: "/tutorial",
    }
  }

  const delta = thisMatchIndex - recentAverageIndex

  if (Math.abs(delta) < GAP_NOISE_THRESHOLD) {
    return {
      thisMatchIndex,
      band: "steady",
      headline: "Right around your usual form",
      note: `${thisMatchIndex} points on ${rulesetName} — close to your recent average of ${Math.round(recentAverageIndex)}.`,
      focusCategory: null,
      tutorialHref: "/tutorial",
    }
  }

  if (delta > 0) {
    return {
      thisMatchIndex,
      band: "above_recent_form",
      headline: `${Math.round(delta)} points above your recent average`,
      note: `${thisMatchIndex} points on ${rulesetName}. ${CATEGORY_AFFIRMATION[top]}`,
      focusCategory: null,
      tutorialHref: "/tutorial",
    }
  }

  const weak = weakestCategory(fractions)
  return {
    thisMatchIndex,
    band: "below_recent_form",
    headline: `${Math.round(-delta)} points below your recent average`,
    note: `${CATEGORY_LABEL[weak]} was this match's biggest opportunity. ${CATEGORY_TEACHING[weak]} ${top !== weak ? CATEGORY_AFFIRMATION[top] : ""}`.trim(),
    focusCategory: weak,
    tutorialHref: "/tutorial",
  }
}
