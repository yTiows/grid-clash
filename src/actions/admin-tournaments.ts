"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { FORMATS, planTournament, distributePrizePool, planSatellite, type FormatId } from "@/lib/game/formats"
import { calculatePrizePool } from "@/lib/game/fees"

export type AdminActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

const VALID_FORMATS = Object.keys(FORMATS) as FormatId[]

/**
 * Every money term is computed by the same tested formats.ts logic the
 * player-facing contest cards will eventually read from, then written once.
 * The database's own CHECK constraints (gross_cents = entry_fee_cents *
 * field_size, etc. — see migration 0005/0007) independently verify the
 * arithmetic on insert, so a bug here fails loudly as a constraint violation
 * rather than silently shipping a contest with terms that don't add up.
 *
 * Runs on the service-role client because no client-side INSERT policy
 * exists on `tournaments` — verified against the live schema rather than
 * assumed. is_admin() is checked first, explicitly, before that client is
 * ever touched.
 */
export async function createTournamentAction(
  _prevState: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin, error: adminCheckError } = await supabase.rpc("is_admin")
  if (adminCheckError || !isAdmin) {
    return { status: "error", message: "Not authorized." }
  }

  const formatId = String(formData.get("formatId") ?? "") as FormatId
  const rulesetId = String(formData.get("rulesetId") ?? "classic")
  const entryFeeCents = Math.round(Number(formData.get("entryFeeCents")) || 0)
  const fieldSize = Math.round(Number(formData.get("fieldSize")) || 0)
  const name = String(formData.get("name") ?? "").trim()
  const satelliteTargetTournamentId = String(formData.get("satelliteTargetTournamentId") ?? "").trim()
  const startsAtRaw = String(formData.get("startsAt") ?? "").trim()
  // datetime-local has no timezone; treated as the operator's local time and
  // converted to a real instant here rather than stored as a bare string.
  const startsAt = startsAtRaw ? new Date(startsAtRaw).toISOString() : null

  if (!VALID_FORMATS.includes(formatId)) {
    return { status: "error", message: "Choose a valid format." }
  }
  if (!name) {
    return { status: "error", message: "Name is required." }
  }
  if (entryFeeCents <= 0) {
    return { status: "error", message: "Entry fee must be positive." }
  }

  let plan: ReturnType<typeof planTournament>
  try {
    plan = planTournament(formatId, rulesetId, entryFeeCents, fieldSize)
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : "Invalid contest parameters." }
  }

  const admin = createAdminClient()

  // A satellite's whole mechanic is "prize = a seat in a specific bigger
  // contest" — tournaments_satellite_shape (migration 7) enforces that a
  // satellite always has a target, so this must be resolved before insert
  // or the DB constraint refuses the row.
  let satelliteTargetEntryFeeCents: number | null = null
  if (formatId === "satellite") {
    if (!satelliteTargetTournamentId) {
      return { status: "error", message: "A satellite needs a target tournament." }
    }
    const { data: target } = await admin
      .from("tournaments")
      .select("id, entry_fee_cents, status")
      .eq("id", satelliteTargetTournamentId)
      .maybeSingle()
    if (!target) {
      return { status: "error", message: "Target tournament not found." }
    }
    if (target.status === "completed" || target.status === "cancelled") {
      return { status: "error", message: "Target tournament has already finished — pick one that's still upcoming." }
    }
    if (target.entry_fee_cents <= entryFeeCents) {
      return {
        status: "error",
        message: "The target tournament's entry fee must be higher than this satellite's — otherwise it isn't a satellite.",
      }
    }
    satelliteTargetEntryFeeCents = target.entry_fee_cents

    const satellite = planSatellite(plan.pool.prizePoolCents, satelliteTargetEntryFeeCents)
    if (satellite.seatsAwarded < 1) {
      return {
        status: "error",
        message: `At this field size and entry fee, the pool ($${(plan.pool.prizePoolCents / 100).toFixed(2)}) can't fund even one $${(satelliteTargetEntryFeeCents / 100).toFixed(2)} seat. Raise the field, the entry fee, or pick a cheaper target.`,
      }
    }
  }

  const { error: insertError } = await admin.from("tournaments").insert({
    kind: "tournament_standard",
    name,
    entry_fee_cents: plan.entryFeeCents,
    field_size: plan.fieldSize,
    rake_bps: plan.format.rakeBps,
    gross_cents: plan.pool.grossCents,
    rake_cents: plan.pool.feeCents,
    prize_pool_cents: plan.pool.prizePoolCents,
    format_id: plan.format.id,
    ruleset_id: plan.ruleset.id,
    rounds: plan.rounds,
    bounty_share_bps: FORMATS[formatId].bountyShareBps,
    bounty_pool_cents: plan.bountyPoolCents,
    bounty_per_head_cents: plan.bountyPerHeadCents,
    place_pool_cents: plan.placePoolCents,
    status: "open",
    starts_at: startsAt,
    ...(formatId === "satellite"
      ? {
          satellite_target_tournament_id: satelliteTargetTournamentId,
          satellite_seat_value_cents: satelliteTargetEntryFeeCents,
        }
      : {}),
  })

  if (insertError) {
    console.error("[createTournamentAction] insert failed", insertError)
    return { status: "error", message: `Could not create contest: ${insertError.message}` }
  }

  revalidatePath("/admin/tournaments")
  revalidatePath("/dashboard/tournaments")

  return { status: "success", message: `${name} created — ${plan.fieldSize} seats at ${(entryFeeCents / 100).toFixed(2)} each.` }
}

/**
 * Cancels a tournament that hasn't filled and refunds every entrant in full.
 * Uses move_balance (idempotent, ledger-recorded) rather than touching
 * balance_cents directly, so a cancellation shows up in each player's own
 * transaction history exactly like any other credit.
 */
export async function cancelTournamentAction(tournamentId: string): Promise<AdminActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { status: "error", message: "Not authorized." }

  const admin = createAdminClient()

  const { data: tournament } = await admin
    .from("tournaments")
    .select("status, entry_fee_cents")
    .eq("id", tournamentId)
    .single()

  if (!tournament) return { status: "error", message: "Contest not found." }
  if (tournament.status === "in_progress" || tournament.status === "completed") {
    return { status: "error", message: "Cannot cancel a contest that has already started." }
  }

  const { data: entries } = await admin
    .from("tournament_entries")
    .select("user_id")
    .eq("tournament_id", tournamentId)

  for (const entry of entries ?? []) {
    await admin.rpc("move_balance", {
      p_user_id: entry.user_id,
      p_amount_cents: tournament.entry_fee_cents,
      p_reason: "tournament_refund",
      p_idempotency_key: `tourney_cancel:${tournamentId}:${entry.user_id}`,
    })
  }

  await admin.from("tournaments").update({ status: "cancelled" }).eq("id", tournamentId)

  revalidatePath("/admin/tournaments")
  revalidatePath("/dashboard/tournaments")

  return { status: "success", message: `Cancelled and refunded ${entries?.length ?? 0} entrant(s).` }
}

/**
 * Completes a tournament, distributing the prize pool by finish order.
 *
 * Amounts are computed by distributePrizePool (formats.ts, money-conservation
 * tested) from the tournament's own immutable stored terms, then handed to
 * complete_tournament(), which pays and records atomically. The admin
 * supplies only the ORDER finishers placed in — never the amounts, which
 * removes any path for a mistyped number to misplace prize money.
 */
export async function completeTournamentAction(
  tournamentId: string,
  orderedUserIds: string[]
): Promise<AdminActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { status: "error", message: "Not authorized." }

  if (orderedUserIds.length === 0) {
    return { status: "error", message: "Select at least a winner." }
  }

  const admin = createAdminClient()

  const { data: tournament } = await admin
    .from("tournaments")
    .select("entry_fee_cents, field_size, rake_bps, kind, format_id, prize_pool_cents, satellite_seat_value_cents")
    .eq("id", tournamentId)
    .single()

  if (!tournament) return { status: "error", message: "Contest not found." }

  // Satellites pay seats at face value, never a descending place curve — see
  // complete_satellite_tournament (20260726000026_satellite_completion.sql).
  // This is the manual/admin fallback path; the same rule the automatic
  // advancement path (sql-match-store.ts payoutTournament) already follows.
  if (tournament.format_id === "satellite") {
    if (!tournament.satellite_seat_value_cents) {
      return { status: "error", message: "This satellite has no seat value configured." }
    }

    const satellite = planSatellite(tournament.prize_pool_cents, tournament.satellite_seat_value_cents)

    const seatWinners = orderedUserIds
      .slice(0, satellite.seatsAwarded)
      .map((userId, i) => ({ user_id: userId, place: i + 1 }))
    const bubbleUserId = orderedUserIds[satellite.seatsAwarded]
    const bubble =
      satellite.bubbleCashCents > 0 && bubbleUserId
        ? { user_id: bubbleUserId, place: satellite.seatsAwarded + 1, amount_cents: satellite.bubbleCashCents }
        : null

    const { error: satelliteError } = await admin.rpc("complete_satellite_tournament", {
      p_tournament_id: tournamentId,
      p_seat_winners: seatWinners,
      p_bubble: bubble,
    })

    if (satelliteError) {
      console.error("[completeTournamentAction] satellite failed", satelliteError)
      return { status: "error", message: `Could not complete satellite: ${satelliteError.message}` }
    }

    revalidatePath("/admin/tournaments")
    revalidatePath("/dashboard/tournaments")

    return {
      status: "success",
      message: `Completed. ${satellite.seatsAwarded} seat(s) awarded${bubble ? `, plus $${(bubble.amount_cents / 100).toFixed(2)} bubble cash` : ""}.`,
    }
  }

  const pool = calculatePrizePool(
    "tournament_standard",
    tournament.entry_fee_cents,
    tournament.field_size,
    tournament.rake_bps
  )
  const payouts = distributePrizePool(pool)

  // Only as many places are paid as the curve defines for this field size —
  // extra finishers beyond that are recorded as unplaced, not paid zero.
  const placings = orderedUserIds.slice(0, payouts.length).map((userId, i) => ({
    user_id: userId,
    place: i + 1,
    amount_cents: payouts[i]!.amountCents,
  }))

  const { error } = await admin.rpc("complete_tournament", {
    p_tournament_id: tournamentId,
    p_placings: placings,
  })

  if (error) {
    console.error("[completeTournamentAction] failed", error)
    return { status: "error", message: `Could not complete contest: ${error.message}` }
  }

  revalidatePath("/admin/tournaments")
  revalidatePath("/dashboard/tournaments")

  return {
    status: "success",
    message: `Completed. ${placings.length} place(s) paid, totaling $${(placings.reduce((s, p) => s + p.amount_cents, 0) / 100).toFixed(2)}.`,
  }
}
