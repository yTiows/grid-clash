"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { WAGER_MIN_STAKE_CENTS, WAGER_MAX_STAKE_CENTS } from "@/lib/game/fees"

export type ChallengeActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/**
 * Creates a challenge — the "invite to a 1v1 wager" from a friend's
 * profile. All the real validation (friendship, target's own opt-in, stake
 * bounds and range, collusion, repeat-pairing rate limit) lives in
 * create_challenge() itself (20260801000009_wager_marketplace.sql); this
 * just forwards the form and turns the raised exception's message into what
 * the button shows. The caller's stake is reserved immediately on success —
 * the resulting row sits at status='pending' with challenger_reservation_id
 * set. Accepting it (respondChallengeAction) is what turns it into a live
 * match, via the WS server's wager:join rendezvous.
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
  if (stakeCents < WAGER_MIN_STAKE_CENTS || stakeCents > WAGER_MAX_STAKE_CENTS) {
    return {
      status: "error",
      message: `Stake must be between $${(WAGER_MIN_STAKE_CENTS / 100).toFixed(0)} and $${(WAGER_MAX_STAKE_CENTS / 100).toFixed(0)}.`,
    }
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
  revalidatePath("/dashboard/wagers")
  return {
    status: "success",
    message: accept
      ? "Challenge accepted — both stakes are held. Head to the match to play it out."
      : "Challenge declined.",
  }
}

/**
 * Posts an open wager to the public board — anyone (not just a friend) can
 * accept it. Reserves the poster's stake immediately, same as
 * createChallengeAction. Bounds/ruleset/eligibility validation lives in
 * create_open_wager() itself.
 */
export async function createOpenWagerAction(
  _prevState: ChallengeActionState,
  formData: FormData
): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const stakeCents = Math.round(Number(formData.get("stakeCents")) || 0)
  const rulesetId = String(formData.get("rulesetId") ?? "classic")

  if (stakeCents < WAGER_MIN_STAKE_CENTS || stakeCents > WAGER_MAX_STAKE_CENTS) {
    return {
      status: "error",
      message: `Stake must be between $${(WAGER_MIN_STAKE_CENTS / 100).toFixed(0)} and $${(WAGER_MAX_STAKE_CENTS / 100).toFixed(0)}.`,
    }
  }

  const { error } = await supabase.rpc("create_open_wager", {
    p_stake_cents: stakeCents,
    p_ruleset_id: rulesetId,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/wagers")
  return { status: "success", message: `Wager posted — $${(stakeCents / 100).toFixed(2)} stake.` }
}

export async function acceptOpenWagerAction(challengeId: string): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.rpc("accept_open_wager", {
    p_challenge_id: challengeId,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/wagers")
  return { status: "success", message: "Wager accepted — both stakes are held. Head to the match to play it out." }
}

/**
 * Only the poster can cancel, and only while it's still pending — enforced
 * in cancel_wager() itself, this just surfaces whatever it says.
 */
export async function cancelWagerAction(challengeId: string): Promise<ChallengeActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.rpc("cancel_wager", {
    p_challenge_id: challengeId,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/wagers")
  return { status: "success", message: "Wager cancelled and your stake refunded." }
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
