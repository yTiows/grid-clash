"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type EnterTournamentState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/**
 * The RLS-scoped client is used deliberately, not the service role: enter_
 * tournament() already runs every eligibility check (self-exclusion,
 * jurisdiction, linked-account collision, capacity) inside its own
 * transaction as the security-definer function, so the caller doesn't need
 * elevated privileges — only their own authenticated session.
 */
export async function enterTournamentAction(
  tournamentId: string
): Promise<EnterTournamentState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.rpc("enter_tournament", {
    p_user_id: user.id,
    p_tournament_id: tournamentId,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/tournaments")
  return { status: "success", message: "You're in." }
}
