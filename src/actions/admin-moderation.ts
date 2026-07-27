"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { REVIEW_ACTIONS, type FraudReviewAction } from "@/lib/moderation"

export type AdminModerationActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

export type FraudFlagSeverity = "low" | "medium" | "high" | "critical"

export type FraudFlagWithUsername = {
  id: string
  userId: string
  username: string
  flagType: string
  severity: FraudFlagSeverity
  reason: string | null
  triggeredAt: string
}

/** Most severe first. Ties within a severity fall back to triggered_at desc. */
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/**
 * Unreviewed fraud_flags rows, most severe first. RLS denies all client
 * access to this table (see 20260724000003_rls_policies.sql,
 * fraud_flags_deny_all), so the actual read runs on the service-role client
 * — but only after is_admin() is checked under the caller's own session,
 * same gate every other admin surface in this codebase uses (see
 * src/actions/admin-tournaments.ts).
 */
export async function listFraudFlagsAction(): Promise<FraudFlagWithUsername[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return []

  const admin = createAdminClient()

  const { data: flags, error } = await admin
    .from("fraud_flags")
    .select("id, user_id, flag_type, severity, reason, triggered_at")
    .is("reviewed_at", null)
    .order("triggered_at", { ascending: false })

  if (error || !flags) {
    console.error("[listFraudFlagsAction] failed", error)
    return []
  }

  // Two plain queries joined in JS, not a nested select — database.types.ts
  // deliberately leaves FK relationships unasserted, so every cross-table
  // read in this codebase does this instead of relying on PostgREST's
  // relationship inference (see src/app/dashboard/tournaments/page.tsx).
  const userIds = [...new Set(flags.map((f) => f.user_id))]
  const { data: users } = await admin
    .from("users")
    .select("id, username")
    .in("id", userIds.length > 0 ? userIds : ["__none__"])

  const usernameById = new Map((users ?? []).map((u) => [u.id, u.username]))

  // .order() above gives triggered_at desc; Array.prototype.sort is stable
  // (guaranteed since ES2019), so this re-sort by severity preserves that as
  // the tiebreaker rather than needing a second sort key.
  return flags
    .map((f) => ({
      id: f.id,
      userId: f.user_id,
      username: usernameById.get(f.user_id) ?? f.user_id.slice(0, 8),
      flagType: f.flag_type,
      severity: f.severity as FraudFlagSeverity,
      reason: f.reason,
      triggeredAt: f.triggered_at,
    }))
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 4) - (SEVERITY_RANK[b.severity] ?? 4))
}

/**
 * Records an admin's review decision on a fraud flag. fraud_flags has no SQL
 * function wrapping writes to it (unlike money-moving tables) — RLS already
 * denies every non-service-role write, so a direct, is_admin()-gated,
 * service-role update is the right amount of ceremony here, consistent with
 * how the rest of this table is locked down.
 */
export async function reviewFraudFlagAction(
  flagId: string,
  action: string
): Promise<AdminModerationActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { status: "error", message: "Not authorized." }

  if (!REVIEW_ACTIONS.includes(action as FraudReviewAction)) {
    return { status: "error", message: "Choose a valid review outcome." }
  }

  const admin = createAdminClient()

  const { error } = await admin
    .from("fraud_flags")
    .update({ reviewed_at: new Date().toISOString(), review_action: action })
    .eq("id", flagId)
    .is("reviewed_at", null)

  if (error) {
    console.error("[reviewFraudFlagAction] failed", error)
    return { status: "error", message: `Could not record review: ${error.message}` }
  }

  revalidatePath("/admin/fraud")

  return { status: "success", message: `Marked ${action}.` }
}
