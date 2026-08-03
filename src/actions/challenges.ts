"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type ChallengeActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/**
 * Creates a challenge — the "invite to a 1v1 wager" from a friend's
 * profile. All the real validation (friendship, target's own opt-in,
 * stake range) lives in create_challenge() itself
 * (20260801000006_social_tab.sql); this just forwards the form and turns
 * the raised exception's message into what the button shows. Deliberately
 * stops here: the resulting row sits at status='pending' with match_id
 * still null. Turning an accepted challenge into a live match is the
 * wager-marketplace phase's job, not this action's — see that migration's
 * header comment.
 */
export async function createChallengeAction(
  _prevState: ChallengeActionState,
  formData: FormData
): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const targetId = String(formData.get("targetId") ?? "").trim()
  const stakeCents = Math.round(Number(formData.get("stakeCents")) || 0)
  const rulesetId = String(formData.get("rulesetId") ?? "classic")

  if (!targetId) {
    return { status: "error", message: "No target player." }
  }
  if (stakeCents <= 0) {
    return { status: "error", message: "Stake must be positive." }
  }

  const { error } = await supabase.rpc("create_challenge", {
    p_target_id: targetId,
    p_stake_cents: stakeCents,
    p_ruleset_id: rulesetId,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/friends")
  return { status: "success", message: `Challenge sent — $${(stakeCents / 100).toFixed(2)} stake.` }
}

export async function respondChallengeAction(
  challengeId: string,
  accept: boolean
): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.rpc("respond_to_challenge", {
    p_challenge_id: challengeId,
    p_accept: accept,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/friends")
  return {
    status: "success",
    message: accept
      ? "Challenge accepted. The match itself isn't live yet — that's still being built."
      : "Challenge declined.",
  }
}

/**
 * Upserts the caller's own challenge_preferences row. Plain RLS
 * (insert/update-own), no RPC needed — this is a preference, not a state
 * transition another party consents to.
 */
export async function updateChallengePreferencesAction(
  _prevState: ChallengeActionState,
  formData: FormData
): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const acceptsChallenges = formData.get("acceptsChallenges") === "on"
  const minStakeRaw = String(formData.get("minStakeCents") ?? "").trim()
  const maxStakeRaw = String(formData.get("maxStakeCents") ?? "").trim()
  const minStakeCents = minStakeRaw ? Math.round(Number(minStakeRaw)) : null
  const maxStakeCents = maxStakeRaw ? Math.round(Number(maxStakeRaw)) : null

  if (minStakeCents !== null && maxStakeCents !== null && minStakeCents > maxStakeCents) {
    return { status: "error", message: "Minimum stake can't be higher than the maximum." }
  }

  const { error } = await supabase.from("challenge_preferences").upsert({
    user_id: user.id,
    accepts_challenges: acceptsChallenges,
    min_stake_cents: minStakeCents,
    max_stake_cents: maxStakeCents,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/players")
  return { status: "success", message: "Saved." }
}
