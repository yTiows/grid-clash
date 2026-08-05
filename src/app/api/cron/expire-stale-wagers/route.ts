import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * GET|POST /api/cron/expire-stale-wagers
 *
 * expire_stale_wagers() (see supabase/migrations/20260801000009_wager_marketplace.sql)
 * does the actual work in one atomic sweep per row (`for update skip locked`,
 * so this is safe to run concurrently with itself if a run overlaps):
 *
 *   - A pending open wager or friend challenge past its 24h expires_at:
 *     marked expired, the poster's reservation refunded.
 *   - An accepted wager whose players never both showed up to actually play
 *     (challenges.started_at stays null until match-server.ts's
 *     startWagerMatch stamps it) for more than 30 minutes past acceptance:
 *     marked expired, both sides' reservations refunded.
 *
 * Same shared-secret-auth shape as every other cron route in this project.
 * Runs every 5 minutes (vercel.json) — matches commit-tournament-fields'
 * cadence, frequent enough that a player's stake doesn't sit held for long
 * after either expiry condition is met.
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handleExpire(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleExpire(request)
}

async function handleExpire(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()

  const { data, error } = await admin.rpc("expire_stale_wagers")

  if (error) {
    console.error("[expire-stale-wagers] sweep failed", error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = data ?? []
  return NextResponse.json({
    processed: rows.length,
    expiredPending: rows.filter((r) => r.outcome === "expired_pending").length,
    expiredNeverStarted: rows.filter((r) => r.outcome === "expired_never_started").length,
  })
}
