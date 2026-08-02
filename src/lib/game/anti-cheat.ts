/**
 * Automation detection.
 *
 * The opposite disclosure posture from reputation.ts on purpose. That module
 * publishes every formula because disclosure costs a legitimate player
 * nothing. This one doesn't: automation_reviews' own migration comment says
 * it plainly — "publishing thresholds writes the evasion guide." Nothing in
 * this file, and nothing computed from it, may reach a client response.
 * Server-only (cron route + admin actions), full stop.
 *
 * Backs the automation_reviews table (20260724000009_reputation.sql), which
 * was fully specified — every column this module fills in already existed —
 * but had nothing writing to it. recompute-standing already reads
 * confirmed_automation resolutions into skill index and trust score; this is
 * the missing other half, the thing that actually populates the table.
 *
 * optimal_move_rate is a real column this module does not compute. Scoring
 * "was this move engine-optimal" requires a move-quality oracle — a search
 * over the game tree under the same hidden-information constraints a human
 * faces — which is a different, much larger piece of work than the timing/
 * session signals below, and a wrong oracle is worse than no oracle: it
 * would misjudge legitimate aggressive/defensive styles as suspicious. Left
 * null and excluded from suspicion scoring until a real one exists; see the
 * weight comment in computeSuspicionScore.
 */

/** Below this many sampled matches, timing statistics are noise — a human's
 * first few matches can easily look "too consistent" by chance. */
export const MIN_MATCHES_SAMPLED = 15

/**
 * Population standard deviation of per-move reaction time, in ms. A human
 * reading a board under time pressure produces real variance move to move —
 * a script executing a fixed decision loop tends toward a narrow, repeatable
 * band. Low is suspicious; this alone is deliberately weak evidence (a very
 * simple, fast human player can also be consistent), which is why it's one
 * signal among several rather than a verdict on its own.
 */
export function computeLatencyStdDevMs(latenciesMs: number[]): number {
  if (latenciesMs.length < 2) return 0
  const mean = latenciesMs.reduce((s, v) => s + v, 0) / latenciesMs.length
  const variance = latenciesMs.reduce((s, v) => s + (v - mean) ** 2, 0) / latenciesMs.length
  return Math.sqrt(variance)
}

/**
 * Count of distinct UTC hours-of-day with at least one completed match.
 * Ranges 1..24. A human's play clusters around waking hours in their own
 * timezone; a script running unattended tends to spread flat across the
 * clock. High spread combined with low latency variance is a materially
 * stronger signal than either alone — see computeSuspicionScore's weighting.
 */
export function computeActiveHoursSpread(completedAtIso: string[]): number {
  const hours = new Set(completedAtIso.map((iso) => new Date(iso).getUTCHours()))
  return hours.size
}

/**
 * Longest unbroken run of play, in hours, where a gap of `sessionGapMinutes`
 * or more starts a new session. A human session is bounded by fatigue,
 * work, sleep; a script's isn't. Timestamps need not be pre-sorted.
 */
export function computeLongestSessionHours(
  completedAtIso: string[],
  sessionGapMinutes = 30
): number {
  if (completedAtIso.length === 0) return 0
  const sorted = [...completedAtIso].map((iso) => new Date(iso).getTime()).sort((a, b) => a - b)

  const gapMs = sessionGapMinutes * 60_000
  let sessionStart = sorted[0] as number
  let longestMs = 0

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1] as number
    const cur = sorted[i] as number
    if (cur - prev > gapMs) {
      longestMs = Math.max(longestMs, prev - sessionStart)
      sessionStart = cur
    }
  }
  longestMs = Math.max(longestMs, (sorted[sorted.length - 1] as number) - sessionStart)

  return longestMs / (1000 * 60 * 60)
}

export interface AutomationSignals {
  latencyStdDevMs: number
  activeHoursSpread: number
  longestSessionHours: number
  matchesSampled: number
}

export type AutomationAction = "none" | "monitor" | "review" | "freeze"

export interface AutomationAssessment {
  suspicionScore: number
  action: AutomationAction
}

/**
 * Weighted 0..100 score plus the escalation ladder automation_reviews.action
 * already defines. Thresholds are conservative on purpose: a false "freeze"
 * suspends a paying, innocent player, which is a real cost this system must
 * spend cautiously. All three components must actually look wrong together
 * to reach 'freeze' — no single signal can get there alone.
 *
 * optimal_move_rate's weight is 0 — it isn't computed (see module comment)
 * — so today's ceiling without it is capped below what 'freeze' requires on
 * timing/session signals alone unless they're extreme on every axis at
 * once. That's intentional: this is the monitor/review layer until a move-
 * quality oracle exists, not the final word.
 */
export function computeSuspicionScore(signals: AutomationSignals): AutomationAssessment {
  if (signals.matchesSampled < MIN_MATCHES_SAMPLED) {
    return { suspicionScore: 0, action: "none" }
  }

  // Human single-move reaction time on a 5s-clock game realistically varies
  // by several hundred ms to seconds move to move. Below ~120ms std dev
  // across a real sample is characteristic of a fixed-delay script; above
  // ~600ms is unremarkable human variance.
  const timingScore = clamp01(1 - signals.latencyStdDevMs / 600) * 40

  // 20+ distinct UTC hours of activity is close to "plays around the clock."
  const spreadScore = clamp01((signals.activeHoursSpread - 8) / 12) * 25

  // A single unbroken 6h+ session is a long human sitting, but not
  // implausible; 12h+ starts to look automated.
  const sessionScore = clamp01((signals.longestSessionHours - 6) / 6) * 20

  const suspicionScore = Math.round(timingScore + spreadScore + sessionScore)

  let action: AutomationAction = "none"
  if (suspicionScore >= 80) action = "freeze"
  else if (suspicionScore >= 55) action = "review"
  else if (suspicionScore >= 30) action = "monitor"

  return { suspicionScore, action }
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}
