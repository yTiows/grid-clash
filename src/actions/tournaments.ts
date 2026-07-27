"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { FIRST_TOURNAMENT_OF_WEEK_BONUS_CENTS } from "@/lib/game/fees"

export type EnterTournamentState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/** Monday 00:00:00 UTC of the week containing `date`. */
function weekStartUtc(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const day = d.getUTCDay() // 0 = Sunday
  const diffToMonday = day === 0 ? 6 : day - 1
  d.setUTCDate(d.getUTCDate() - diffToMonday)
  return d.toISOString().slice(0, 10)
}

/**
 * The RLS-scoped client is used deliberately, not the service role: enter_
 * tournament() already runs every eligibility check (self-exclusion,
 * jurisdiction, linked-account collision, capacity) inside its own
 * transaction as the security-definer function, so the caller doesn't need
 * elevated privileges — only their own authenticated session.
 *
 * redeemPoints is optional loyalty-points discount (CLAUDE_CODE_BRIEF.md
 * §5.2) — passed straight through to enter_tournament, which debits points
 * and reduces the cash charge atomically with the seat.
 */
export async function enterTournamentAction(
  tournamentId: string,
  redeemPoints = 0
): Promise<EnterTournamentState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  // Eligibility for the "first tournament this week" bonus (§5.6) is decided
  // BEFORE entry, from state that does not yet include the entry we're about
  // to make — checking after would always see at least one entry (the one
  // just created) and never fire.
  const weekStart = weekStartUtc(new Date())
  const { count: entriesThisWeek } = await supabase
    .from("tournament_entries")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("entered_at", `${weekStart}T00:00:00.000Z`)
  const eligibleForWeeklyBonus = (entriesThisWeek ?? 0) === 0

  const { error } = await supabase.rpc("enter_tournament", {
    p_user_id: user.id,
    p_tournament_id: tournamentId,
    p_redeem_points: redeemPoints,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  if (eligibleForWeeklyBonus) {
    // move_loyalty_points is revoked from `authenticated` (same lockdown as
    // move_balance — a raw money-mutation primitive is never client-
    // callable), so this one call needs the service-role client. Best-
    // effort: a failed bonus grant should never surface as a failed entry —
    // the player is already in. Idempotent on (user, week), so even a
    // double-invocation of this action in the same week cannot double-grant.
    const admin = createAdminClient()
    const { error: bonusError } = await admin.rpc("move_loyalty_points", {
      p_user_id: user.id,
      p_amount_cents: FIRST_TOURNAMENT_OF_WEEK_BONUS_CENTS,
      p_reason: "first_tournament_bonus",
      p_idempotency_key: `first_tournament_bonus:${user.id}:${weekStart}`,
      p_tournament_id: tournamentId,
    })
    if (bonusError) {
      console.error("[enterTournamentAction] weekly bonus grant failed", bonusError)
    }
  }

  revalidatePath("/dashboard/tournaments")
  revalidatePath("/dashboard")
  return { status: "success", message: "You're in." }
}
