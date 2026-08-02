import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  MIN_MATCHES_SAMPLED,
  computeActiveHoursSpread,
  computeLatencyStdDevMs,
  computeLongestSessionHours,
  computeSuspicionScore,
} from "@/lib/game/anti-cheat"

/**
 * GET|POST /api/cron/detect-automation
 *
 * automation_reviews (20260724000009_reputation.sql) was fully specified —
 * suspicion_score, latency_std_dev_ms, optimal_move_rate, longest_session_hours,
 * active_hours_spread, the none/monitor/review/freeze ladder — and already
 * consumed downstream: recompute-standing reads confirmed_automation
 * resolutions into skill index and trust score. Nothing wrote to the table.
 * This is what does.
 *
 * Same shape as recompute-standing: shared-secret auth for a scheduler with
 * no human session, one batch pass rather than incremental (same target-
 * scale reasoning — see that route's own comment), GET and POST both wired
 * since either could be how a scheduler is configured.
 *
 * Scoped to the last 30 days of ranked play — this is a behavior-pattern
 * detector, not an all-time audit. A user with an already-open (unresolved)
 * review is skipped rather than re-flagged, so the same behavior doesn't
 * spam a fresh row every run while the last one waits for a human.
 */
const LOOKBACK_DAYS = 30
const MATCH_CAP = 20_000

export async function GET(request: Request): Promise<NextResponse> {
  return handleDetect(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleDetect(request)
}

async function handleDetect(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const sinceIso = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: matches, error: matchesError } = await admin
    .from("matches")
    .select("id, player_1_id, player_2_id, completed_at")
    .eq("ranked", true)
    .gte("completed_at", sinceIso)
    .order("completed_at", { ascending: false })
    .limit(MATCH_CAP)
  if (matchesError) {
    return NextResponse.json({ error: matchesError.message }, { status: 500 })
  }
  if (!matches || matches.length === 0) {
    return NextResponse.json({ assessed: 0, flagged: 0 })
  }

  const matchIds = matches.map((m) => m.id)
  const { data: replays, error: replaysError } = await admin
    .from("match_replays")
    .select("match_id, player_1_timings, player_2_timings")
    .in("match_id", matchIds)
  if (replaysError) {
    return NextResponse.json({ error: replaysError.message }, { status: 500 })
  }
  const replayByMatchId = new Map((replays ?? []).map((r) => [r.match_id, r]))

  // Only accounts that could actually be suspended by this run — already
  // inactive accounts have nothing for a freeze action to do.
  const { data: activeUsers, error: usersError } = await admin
    .from("users")
    .select("id")
    .eq("account_status", "active")
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }
  const activeUserIds = new Set((activeUsers ?? []).map((u) => u.id))

  const { data: openReviews } = await admin
    .from("automation_reviews")
    .select("user_id")
    .is("resolved_at", null)
  const usersWithOpenReview = new Set((openReviews ?? []).map((r) => r.user_id))

  interface UserAgg {
    latenciesMs: number[]
    completedAtIso: string[]
  }
  const agg = new Map<string, UserAgg>()
  const ensure = (userId: string): UserAgg => {
    let a = agg.get(userId)
    if (!a) {
      a = { latenciesMs: [], completedAtIso: [] }
      agg.set(userId, a)
    }
    return a
  }

  for (const m of matches) {
    const replay = replayByMatchId.get(m.id)
    if (!replay) continue

    if (m.player_1_id) {
      const a = ensure(m.player_1_id)
      a.latenciesMs.push(...(replay.player_1_timings ?? []))
      a.completedAtIso.push(m.completed_at)
    }
    if (m.player_2_id) {
      const a = ensure(m.player_2_id)
      a.latenciesMs.push(...(replay.player_2_timings ?? []))
      a.completedAtIso.push(m.completed_at)
    }
  }

  const toFreeze: string[] = []
  const reviewRows: {
    user_id: string
    suspicion_score: number
    action: string
    latency_std_dev_ms: number
    longest_session_hours: number
    active_hours_spread: number
    matches_sampled: number
  }[] = []

  for (const [userId, a] of agg) {
    if (!activeUserIds.has(userId)) continue
    if (usersWithOpenReview.has(userId)) continue
    if (a.completedAtIso.length < MIN_MATCHES_SAMPLED) continue

    const { suspicionScore, action } = computeSuspicionScore({
      latencyStdDevMs: computeLatencyStdDevMs(a.latenciesMs),
      activeHoursSpread: computeActiveHoursSpread(a.completedAtIso),
      longestSessionHours: computeLongestSessionHours(a.completedAtIso),
      matchesSampled: a.completedAtIso.length,
    })

    if (action === "none") continue

    reviewRows.push({
      user_id: userId,
      suspicion_score: suspicionScore,
      action,
      latency_std_dev_ms: Math.round(computeLatencyStdDevMs(a.latenciesMs) * 100) / 100,
      longest_session_hours: Math.round(computeLongestSessionHours(a.completedAtIso) * 100) / 100,
      active_hours_spread: computeActiveHoursSpread(a.completedAtIso),
      matches_sampled: a.completedAtIso.length,
    })

    if (action === "freeze") toFreeze.push(userId)
  }

  if (reviewRows.length > 0) {
    const { error: insertError } = await admin.from("automation_reviews").insert(reviewRows)
    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }
  }

  // Freezing suspends play (assert_can_wager rejects new stakes for any
  // account_status other than 'active') — it does not seize funds or touch
  // an already-live match. A human reviewer still resolves the review;
  // this only stops new paid entries while that happens.
  for (const userId of toFreeze) {
    await admin.from("users").update({ account_status: "suspended" }).eq("id", userId)
  }

  return NextResponse.json({
    assessed: agg.size,
    flagged: reviewRows.length,
    frozen: toFreeze.length,
  })
}
