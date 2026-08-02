"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export type AdminAutomationActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

export type AutomationResolution = "cleared" | "confirmed_automation" | "inconclusive"

const RESOLUTIONS: AutomationResolution[] = ["cleared", "confirmed_automation", "inconclusive"]

export type AutomationReviewWithUsername = {
  id: string
  userId: string
  username: string
  suspicionScore: number
  action: string
  latencyStdDevMs: number | null
  longestSessionHours: number | null
  activeHoursSpread: number | null
  matchesSampled: number
  openedAt: string
}

/**
 * Open (unresolved) automation_reviews, most suspicious first. Same shape
 * as listFraudFlagsAction: RLS denies all client access to this table
 * (automation_reviews_deny_all — the migration's own comment explains why:
 * exposing findings before resolution defames the accused), so this reads
 * on the service-role client, gated by is_admin() under the caller's own
 * session first.
 */
export async function listAutomationReviewsAction(): Promise<AutomationReviewWithUsername[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return []

  const admin = createAdminClient()

  const { data: reviews, error } = await admin
    .from("automation_reviews")
    .select(
      "id, user_id, suspicion_score, action, latency_std_dev_ms, longest_session_hours, active_hours_spread, matches_sampled, opened_at"
    )
    .is("resolved_at", null)
    .order("suspicion_score", { ascending: false })

  if (error || !reviews) {
    console.error("[listAutomationReviewsAction] failed", error)
    return []
  }

  const userIds = [...new Set(reviews.map((r) => r.user_id))]
  const { data: users } = await admin
    .from("users")
    .select("id, username")
    .in("id", userIds.length > 0 ? userIds : ["__none__"])
  const usernameById = new Map((users ?? []).map((u) => [u.id, u.username]))

  return reviews.map((r) => ({
    id: r.id,
    userId: r.user_id,
    username: usernameById.get(r.user_id) ?? r.user_id.slice(0, 8),
    suspicionScore: r.suspicion_score,
    action: r.action,
    latencyStdDevMs: r.latency_std_dev_ms,
    longestSessionHours: r.longest_session_hours,
    activeHoursSpread: r.active_hours_spread,
    matchesSampled: r.matches_sampled,
    openedAt: r.opened_at,
  }))
}

/** Ranked matches a confirmed-automation account won, within the same
 * lookback the detector itself uses — refund candidates, not an all-time
 * audit. Capped for the same reason match/replay queries elsewhere in this
 * codebase are capped: bounded work per admin action. */
const REFUND_LOOKBACK_DAYS = 30
const REFUND_MATCH_CAP = 200

/**
 * Records an admin's resolution of an automation review.
 *
 * 'cleared' restores account_status to 'active' if this system suspended it
 * — automation_reviews' migration comment is explicit that an account frozen
 * in error must not stay frozen once cleared. Only flips 'suspended' back;
 * a separately 'banned' account (a different, stronger admin action this
 * system never takes) is left alone.
 *
 * 'confirmed_automation' ensures the account is suspended regardless of
 * whether the original automatic action reached 'freeze', then refunds the
 * humans this account beat — the platform keeping a rake on a match it has
 * just declared fraudulent would mean profiting from the cheating it found.
 * Each refund is the victim's own entry fee (made whole, not also given the
 * confirmed account's stake), recorded in automation_refunds so a match is
 * never refunded twice even if this action is retried.
 */
export async function resolveAutomationReviewAction(
  reviewId: string,
  resolution: string,
  reviewerNote: string
): Promise<AdminAutomationActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { status: "error", message: "Not authorized." }

  if (!RESOLUTIONS.includes(resolution as AutomationResolution)) {
    return { status: "error", message: "Choose a valid resolution." }
  }

  const admin = createAdminClient()

  const { data: review } = await admin
    .from("automation_reviews")
    .select("id, user_id")
    .eq("id", reviewId)
    .is("resolved_at", null)
    .maybeSingle()

  if (!review) {
    return { status: "error", message: "Review not found, or already resolved." }
  }

  const { error: updateError } = await admin
    .from("automation_reviews")
    .update({
      resolved_at: new Date().toISOString(),
      resolution,
      reviewer_note: reviewerNote.trim() || null,
    })
    .eq("id", reviewId)
    .is("resolved_at", null)

  if (updateError) {
    console.error("[resolveAutomationReviewAction] failed", updateError)
    return { status: "error", message: `Could not record resolution: ${updateError.message}` }
  }

  if (resolution === "cleared") {
    await admin
      .from("users")
      .update({ account_status: "active" })
      .eq("id", review.user_id)
      .eq("account_status", "suspended")

    revalidatePath("/admin/automation")
    return { status: "success", message: "Cleared. Account restored to active." }
  }

  if (resolution !== "confirmed_automation") {
    revalidatePath("/admin/automation")
    return { status: "success", message: "Marked inconclusive." }
  }

  await admin.from("users").update({ account_status: "suspended" }).eq("id", review.user_id)

  const sinceIso = new Date(Date.now() - REFUND_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const { data: wonMatches } = await admin
    .from("matches")
    .select("id, loser_id, entry_fee_cents")
    .eq("ranked", true)
    .eq("winner_id", review.user_id)
    .gte("completed_at", sinceIso)
    .limit(REFUND_MATCH_CAP)

  const { data: alreadyRefunded } = await admin
    .from("automation_refunds")
    .select("match_id")
    .eq("review_id", reviewId)
  const refundedMatchIds = new Set((alreadyRefunded ?? []).map((r) => r.match_id))

  let refundedCount = 0
  for (const m of wonMatches ?? []) {
    if (refundedMatchIds.has(m.id)) continue

    const idempotencyKey = `automation_refund:${reviewId}:${m.id}:${m.loser_id}`
    const { error: moveError } = await admin.rpc("move_balance", {
      p_user_id: m.loser_id,
      p_amount_cents: m.entry_fee_cents,
      p_reason: "ranked_refund",
      p_idempotency_key: idempotencyKey,
    })
    if (moveError) {
      console.error("[resolveAutomationReviewAction] refund failed", m.id, moveError)
      continue
    }

    const { error: refundRowError } = await admin.from("automation_refunds").insert({
      review_id: reviewId,
      victim_user_id: m.loser_id,
      match_id: m.id,
      refund_cents: m.entry_fee_cents,
      paid_at: new Date().toISOString(),
    })
    if (!refundRowError) refundedCount += 1
  }

  revalidatePath("/admin/automation")
  return {
    status: "success",
    message: `Confirmed. Account suspended, ${refundedCount} victim${refundedCount === 1 ? "" : "s"} refunded.`,
  }
}
