import { NextResponse } from "next/server"

import { createAdminClient } from "@/lib/supabase/admin"
import { commitField, type RegistrationWindow } from "@/lib/game/scheduling"
import { FORMATS, type FormatId } from "@/lib/game/formats"

/**
 * GET|POST /api/cron/commit-tournament-fields
 *
 * The other half of wiring scheduling.ts's demand-sizing into real
 * tournament creation (sizeFieldForDemand was already wired via
 * admin-tournament-sizing.ts's suggestFieldSizeAction — this closes
 * commitField, which had never been called from anywhere in src/).
 *
 * A tournament created with field_commit_mode = 'demand' stores field_size
 * as a CEILING, not an exact count, and reuses the existing
 * registration_opens_at/starts_at columns as the registration window's
 * open/close bounds. This job finds every such tournament whose window has
 * closed and applies commitField()'s decision:
 *
 *   - Below the format's floor: refund every entrant in full (identical
 *     shape to cancelTournamentAction's existing refund loop) and cancel.
 *   - At or above the floor: for bracket formats, commitField() may snap
 *     down to a clean power of two below actual registrations — the
 *     overflow (latest-registered, by seat_number) is refunded and
 *     removed, then commit_tournament_field() atomically rewrites the
 *     tournament's stored money terms and flips it to 'full', the same
 *     state a fixed-mode tournament reaches when it fills naturally.
 *
 * Same shape as recompute-standing/detect-automation: shared-secret auth
 * for a scheduler with no human session, GET and POST both wired. Runs
 * every 5 minutes (vercel.json) — frequent enough that a contest doesn't
 * sit "open" long past its stated start time on a platform this size
 * (CLAUDE_CODE_BRIEF.md §6: ~5,000 users, not a high-volume exchange).
 */
export async function GET(request: Request): Promise<NextResponse> {
  return handleCommit(request)
}

export async function POST(request: Request): Promise<NextResponse> {
  return handleCommit(request)
}

interface CommitOutcome {
  tournamentId: string
  outcome: "cancelled" | "committed" | "error"
  fieldSize?: number
  refunded?: number
  error?: string
}

async function handleCommit(request: Request): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization")
  const expected = process.env.CRON_SECRET
  if (!expected || authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const admin = createAdminClient()
  const nowIso = new Date().toISOString()

  const { data: due, error: dueError } = await admin
    .from("tournaments")
    .select("id, format_id, entry_fee_cents, field_size, registration_opens_at, starts_at")
    .eq("status", "open")
    .eq("field_commit_mode", "demand")
    .not("starts_at", "is", null)
    .lte("starts_at", nowIso)

  if (dueError) {
    console.error("[commit-tournament-fields] failed to list due tournaments", dueError)
    return NextResponse.json({ error: dueError.message }, { status: 500 })
  }

  const results: CommitOutcome[] = []

  for (const t of due ?? []) {
    try {
      results.push(await commitOne(admin, t))
    } catch (err) {
      console.error("[commit-tournament-fields] failed for", t.id, err)
      results.push({
        tournamentId: t.id,
        outcome: "error",
        error: err instanceof Error ? err.message : "Unknown error",
      })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}

async function commitOne(
  admin: ReturnType<typeof createAdminClient>,
  t: {
    id: string
    format_id: string
    entry_fee_cents: number
    field_size: number
    registration_opens_at: string
    starts_at: string | null
  }
): Promise<CommitOutcome> {
  const { count: registrations } = await admin
    .from("tournament_entries")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", t.id)

  const format = FORMATS[t.format_id as FormatId]
  const window: RegistrationWindow = {
    minField: format.minField,
    maxField: t.field_size,
    opensAt: new Date(t.registration_opens_at).getTime(),
    // starts_at is guaranteed non-null by the caller's query filter.
    closesAt: new Date(t.starts_at as string).getTime(),
  }

  const decision = commitField(registrations ?? 0, window, t.format_id as FormatId)

  if (decision.cancelled) {
    const { data: entries } = await admin
      .from("tournament_entries")
      .select("user_id")
      .eq("tournament_id", t.id)

    for (const entry of entries ?? []) {
      await admin.rpc("move_balance", {
        p_user_id: entry.user_id,
        p_amount_cents: t.entry_fee_cents,
        p_reason: "tournament_refund",
        p_idempotency_key: `tourney_undersub_cancel:${t.id}:${entry.user_id}`,
      })
    }

    await admin.from("tournaments").update({ status: "cancelled" }).eq("id", t.id)

    return { tournamentId: t.id, outcome: "cancelled", refunded: entries?.length ?? 0 }
  }

  if (decision.refunded > 0) {
    // Bracket formats snap down to a clean power of two — the overflow is
    // whoever registered last, chosen by seat_number descending so the
    // rule is objective and disclosed, not arbitrary.
    const { data: overflow } = await admin
      .from("tournament_entries")
      .select("id, user_id")
      .eq("tournament_id", t.id)
      .order("seat_number", { ascending: false })
      .limit(decision.refunded)

    for (const entry of overflow ?? []) {
      await admin.rpc("move_balance", {
        p_user_id: entry.user_id,
        p_amount_cents: t.entry_fee_cents,
        p_reason: "tournament_refund",
        p_idempotency_key: `tourney_field_snapdown:${t.id}:${entry.user_id}`,
      })
    }

    const overflowUserIds = (overflow ?? []).map((e) => e.user_id)
    if (overflowUserIds.length > 0) {
      // A refunded overflow entrant never plays, so any bounty posted on
      // their head (bounty format) is removed along with their seat rather
      // than left dangling for a contest they're no longer in.
      await admin
        .from("tournament_bounties")
        .delete()
        .eq("tournament_id", t.id)
        .in("head_user_id", overflowUserIds)
      await admin
        .from("tournament_entries")
        .delete()
        .eq("tournament_id", t.id)
        .in("user_id", overflowUserIds)
    }
  }

  const { error: commitError } = await admin.rpc("commit_tournament_field", {
    p_tournament_id: t.id,
    p_final_field_size: decision.fieldSize,
  })

  if (commitError) {
    throw new Error(commitError.message)
  }

  return { tournamentId: t.id, outcome: "committed", fieldSize: decision.fieldSize, refunded: decision.refunded }
}
