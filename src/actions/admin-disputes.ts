"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type AdminDisputeActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

const RESOLVABLE_STATUSES = ["reviewing", "upheld", "denied"] as const

/**
 * Resolves a match dispute. Runs on the caller's own RLS-scoped session
 * (src/lib/supabase/server.ts createClient()), never the service-role
 * client — resolve_match_dispute (20260726000034_match_disputes.sql) is
 * `security definer` and re-checks is_admin() via auth.uid() internally, so
 * the privileged part of this is already enforced DB-side. The is_admin()
 * check here is just the same early, friendly-error gate every other admin
 * action in this codebase does before touching anything (see
 * src/actions/admin-tournaments.ts).
 *
 * Any real balance adjustment goes through move_balance inside the RPC
 * itself, keyed on the dispute id — idempotent by construction, same as
 * every other money-moving path.
 */
export async function resolveDisputeAction(
  disputeId: string,
  status: string,
  resolutionNote: string,
  adjustmentUserId: string,
  adjustmentDollars: string
): Promise<AdminDisputeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { status: "error", message: "Not authorized." }

  if (!RESOLVABLE_STATUSES.includes(status as (typeof RESOLVABLE_STATUSES)[number])) {
    return { status: "error", message: "Choose a valid resolution." }
  }
  if (!resolutionNote.trim()) {
    return { status: "error", message: "A resolution note is required." }
  }

  let adjustmentCents = 0
  if (adjustmentDollars.trim()) {
    const parsedDollars = Number(adjustmentDollars)
    if (!Number.isFinite(parsedDollars)) {
      return { status: "error", message: "Adjustment amount must be a number." }
    }
    adjustmentCents = Math.round(parsedDollars * 100)
  }
  if (adjustmentCents !== 0 && !adjustmentUserId.trim()) {
    return { status: "error", message: "An adjustment needs a target user id." }
  }

  const { error } = await supabase.rpc("resolve_match_dispute", {
    p_dispute_id: disputeId,
    p_status: status,
    p_resolution_note: resolutionNote.trim(),
    ...(adjustmentCents !== 0
      ? { p_adjustment_user_id: adjustmentUserId.trim(), p_adjustment_cents: adjustmentCents }
      : {}),
  })

  if (error) {
    console.error("[resolveDisputeAction] failed", error)
    return { status: "error", message: `Could not resolve dispute: ${error.message}` }
  }

  revalidatePath("/admin/disputes")

  return { status: "success", message: `Marked ${status}.` }
}
