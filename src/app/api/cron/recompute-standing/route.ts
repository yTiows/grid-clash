import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import {
  calculateSkillIndex,
  calculateConfidence,
  isProvisional,
  calculateTrust,
  assignFeeTier,
} from "@/lib/game/reputation"
import { expectedScore } from "@/lib/game/fees"

/**
 * GET|POST /api/cron/recompute-standing
 *
 * Vercel Cron invokes scheduled paths with GET and automatically attaches
 * `Authorization: Bearer $CRON_SECRET` when that env var is set on the
 * project — see vercel.json. POST is also exposed for any other scheduler
 * (or a manual trigger) that prefers it; both run the identical handler.
 *
 * FOUND MISSING: player_standing (migration 9) is written by nothing —
 * confirmed by grepping every migration for an INSERT/UPDATE against it and
 * finding only the CREATE TABLE, the leaderboard view, and RLS. Every row
 * sits at the table's own defaults (skill_index 0, fee_tier 'standard')
 * forever. That is not just a missing leaderboard: sql-match-store.ts's
 * loadParticipants() reads player_standing.fee_tier to decide which of
 * FEE_TIERS (standard/established/elite, fees.ts) a settlement charges — so
 * the tiered-fee system has been silently inert, charging every match at
 * 'standard' regardless of a player's actual history, until this job exists
 * and runs at least once.
 *
 * Recomputes every active user's standing in one batch. At this platform's
 * target scale (~5,000 users, CLAUDE_CODE_BRIEF.md §6) a full recompute is
 * cheap enough to run on a schedule rather than needing incremental
 * updates — simplicity over premature optimisation.
 *
 * Auth: a shared secret header, the standard shape for a scheduler-triggered
 * endpoint with no human session (Vercel Cron, or any external scheduler —
 * see vercel.json / SETUP.md for wiring it up). Mirrors the src/app/api/cron/
 * naming convention already established by the (empty, unimplemented)
 * pair-matches scaffold this codebase left behind; that scaffold is dead —
 * the WS match server does live matchmaking in-process and needs no HTTP
 * pairing endpoint — so it is not resurrected here.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handleRecompute(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleRecompute(request)
}

async function handleRecompute(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data: users, error: usersError } = await admin
    .from("users")
    .select("id, elo_rating, kyc_verified, created_at")
    .eq("account_status", "active")
  if (usersError) {
    return NextResponse.json({ error: usersError.message }, { status: 500 })
  }
  if (!users || users.length === 0) {
    return NextResponse.json({ recomputed: 0 })
  }

  // Bounded at a generous cap for this platform's scale (§6) rather than
  // paginated — see the module comment.
  const { data: matches, error: matchesError } = await admin
    .from("matches")
    .select("player_1_id, player_2_id, winner_id, elo_change_winner, elo_change_loser, completed_at")
    .eq("ranked", true)
    .order("completed_at", { ascending: false })
    .limit(50_000)
  if (matchesError) {
    return NextResponse.json({ error: matchesError.message }, { status: 500 })
  }

  const { data: confirmedAutomation } = await admin
    .from("automation_reviews")
    .select("user_id")
    .eq("resolution", "confirmed_automation")

  const { data: openFlags } = await admin.from("fraud_flags").select("user_id").is("reviewed_at", null)

  const { data: chargebackFlags } = await admin.from("fraud_flags").select("user_id").eq("flag_type", "chargeback")

  const eloById = new Map(users.map((u) => [u.id, u.elo_rating]))
  const kycById = new Map(users.map((u) => [u.id, u.kyc_verified]))
  const createdAtById = new Map(users.map((u) => [u.id, u.created_at]))

  const upheldFindingsById = countBy(confirmedAutomation, "user_id")
  const openFlagsById = countBy(openFlags, "user_id")
  const chargebacksById = countBy(chargebackFlags, "user_id")

  interface MatchAgg {
    matchesPlayed: number
    opponents: Set<string>
    opponentEloSum: number
    performances: number[]
  }
  const agg = new Map<string, MatchAgg>()
  const ensure = (id: string): MatchAgg => {
    let a = agg.get(id)
    if (!a) {
      a = { matchesPlayed: 0, opponents: new Set(), opponentEloSum: 0, performances: [] }
      agg.set(id, a)
    }
    return a
  }

  for (const m of matches ?? []) {
    const p1 = m.player_1_id
    const p2 = m.player_2_id
    if (!p1 || !p2) continue

    // elo_change_winner/loser both 0 is settle_ranked_match's signature for a
    // draw (see match-server.ts settleMatch: draws pass {winnerDelta: 0,
    // loserDelta: 0}) — matches.winner_id is never actually null even for a
    // draw (settle_ranked_match defaults it to player_1), so this is the
    // only reliable signal in the stored row.
    const isDraw = m.elo_change_winner === 0 && m.elo_change_loser === 0
    const winnerId = m.winner_id

    const p1Elo = eloById.get(p1) ?? 1600
    const p2Elo = eloById.get(p2) ?? 1600

    const a1 = ensure(p1)
    a1.matchesPlayed += 1
    a1.opponents.add(p2)
    a1.opponentEloSum += p2Elo
    const expected1 = expectedScore(p1Elo, p2Elo)
    const actual1 = isDraw ? 0.5 : winnerId === p1 ? 1 : 0
    a1.performances.push(actual1 - expected1)

    const a2 = ensure(p2)
    a2.matchesPlayed += 1
    a2.opponents.add(p1)
    a2.opponentEloSum += p1Elo
    const expected2 = expectedScore(p2Elo, p1Elo)
    const actual2 = isDraw ? 0.5 : winnerId === p2 ? 1 : 0
    a2.performances.push(actual2 - expected2)
  }

  const now = Date.now()

  const rows = users.map((u) => {
    const a = agg.get(u.id)
    const matchesPlayed = a?.matchesPlayed ?? 0
    const distinctOpponents = a?.opponents.size ?? 0
    const averageOpponentElo = a && a.matchesPlayed > 0 ? a.opponentEloSum / a.matchesPlayed : u.elo_rating
    const performanceStdDev = a && a.performances.length > 1 ? populationStdDev(a.performances) : 0
    const upheldFairPlayFindings = upheldFindingsById.get(u.id) ?? 0

    const skillIndex = calculateSkillIndex({
      eloRating: u.elo_rating,
      averageOpponentElo,
      performanceStdDev,
      matchesPlayed,
      distinctOpponents,
      upheldFairPlayFindings,
    })

    const confidence = calculateConfidence(matchesPlayed)
    const provisional = isProvisional(matchesPlayed)

    const accountAgeDays = (now - new Date(createdAtById.get(u.id) ?? now).getTime()) / (1000 * 60 * 60 * 24)
    const trust = calculateTrust({
      accountAgeDays,
      matchesCompleted: matchesPlayed,
      distinctOpponents,
      identityVerified: kycById.get(u.id) ?? false,
      openFraudFlags: openFlagsById.get(u.id) ?? 0,
      upheldFairPlayFindings,
      chargebacks: chargebacksById.get(u.id) ?? 0,
    })

    return {
      user_id: u.id,
      skill_index: skillIndex.total,
      si_rating: skillIndex.rating,
      si_opposition: skillIndex.opposition,
      si_consistency: skillIndex.consistency,
      si_volume: skillIndex.volume,
      si_fair_play: skillIndex.fairPlay,
      confidence,
      is_provisional: provisional,
      trust_score: trust.score,
      trust_band: trust.band,
      fee_tier: assignFeeTier({
        matchesPlayed,
        distinctOpponents,
        identityVerified: kycById.get(u.id) ?? false,
        // Percentile is filled in below, after every user's raw skill_index
        // is known — assignFeeTier's elite tier needs it, so this first pass
        // intentionally under-assigns elite and gets corrected in the
        // second pass.
        skillIndexPercentile: 100,
        upheldFairPlayFindings,
      }),
      distinct_opponents: distinctOpponents,
      average_opponent_elo: Math.round(averageOpponentElo),
      performance_std_dev: performanceStdDev,
      upheld_fair_play_findings: upheldFairPlayFindings,
      skill_index_percentile: null as number | null,
      computed_at: new Date().toISOString(),
    }
  })

  // Percentile requires the full distribution — computed once, in one pass,
  // over the batch just built, then fee tier is re-derived for anyone whose
  // elite eligibility depends on it.
  const sorted = [...rows].sort((a, b) => b.skill_index - a.skill_index)
  const total = sorted.length
  sorted.forEach((row, index) => {
    const percentile = total > 1 ? (index / (total - 1)) * 100 : 0
    row.skill_index_percentile = Math.round(percentile * 100) / 100
    const a = agg.get(row.user_id)
    row.fee_tier = assignFeeTier({
      matchesPlayed: a?.matchesPlayed ?? 0,
      distinctOpponents: a?.opponents.size ?? 0,
      identityVerified: kycById.get(row.user_id) ?? false,
      skillIndexPercentile: row.skill_index_percentile,
      upheldFairPlayFindings: row.upheld_fair_play_findings,
    })
  })

  const { error: upsertError } = await admin.from("player_standing").upsert(rows, { onConflict: "user_id" })
  if (upsertError) {
    return NextResponse.json({ error: upsertError.message }, { status: 500 })
  }

  // Piggybacked maintenance rather than a second cron entry — see
  // cleanup_rate_limit_counters()'s own comment in
  // 20260726000035_http_rate_limiting.sql.
  await admin.rpc("cleanup_rate_limit_counters")
  await admin.rpc("reconcile_orphan_reservations")

  return NextResponse.json({ recomputed: rows.length })
}

function countBy<T extends { user_id: string }>(rows: T[] | null | undefined, _key: "user_id"): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of rows ?? []) {
    m.set(r.user_id, (m.get(r.user_id) ?? 0) + 1)
  }
  return m
}

function populationStdDev(values: number[]): number {
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}
