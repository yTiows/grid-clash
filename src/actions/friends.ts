"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type FriendActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/**
 * Reads public_players, not users — 20260724000006_security_hardening.sql
 * (Finding 1) locked users down to users_select_own only (auth.uid() = id),
 * specifically because a broad "select true" policy on the base table once
 * leaked email/phone/balance/KYC to anyone. public_players is the column-
 * allowlisted view built for exactly this: looking up ANOTHER player.
 * (public_players also only lists account_status = 'active' accounts —
 * an unverified account isn't findable as a friend yet, same as it isn't
 * listed on /leaderboard.)
 */
export async function searchUsersAction(
  query: string
): Promise<{ id: string; username: string }[]> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return []

  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const { data } = await supabase
    .from("public_players")
    .select("id, username")
    .ilike("username", `%${trimmed}%`)
    .neq("id", user.id)
    .limit(10)

  // View columns are typed nullable by the generator regardless of the
  // underlying NOT NULL columns — id/username can never actually be null
  // here (public_players joins from users, never right-joins), so this is
  // a type-narrowing filter, not a real runtime possibility.
  return (data ?? []).filter(
    (row): row is { id: string; username: string } => row.id !== null && row.username !== null
  )
}

/**
 * Inserts a pending friendship row as the requester. RLS
 * (friendships_insert_as_requester) enforces auth.uid() = requester_id and
 * status = 'pending' — this action can't be tricked into anything the
 * database wouldn't already refuse, it just turns a generic RLS violation
 * into a readable message.
 */
export async function sendFriendRequestAction(
  _prevState: FriendActionState,
  formData: FormData
): Promise<FriendActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const targetUsername = String(formData.get("username") ?? "").trim()
  if (!targetUsername) {
    return { status: "error", message: "Enter a username." }
  }

  const { data: target } = await supabase
    .from("public_players")
    .select("id")
    .eq("username", targetUsername)
    .maybeSingle()

  if (!target || !target.id) {
    return { status: "error", message: "No player with that username." }
  }
  if (target.id === user.id) {
    return { status: "error", message: "That's you." }
  }

  const { error } = await supabase
    .from("friendships")
    .insert({ requester_id: user.id, addressee_id: target.id })

  if (error) {
    // unique_violation from friendships_one_active_per_pair — already
    // friends, or a request is already pending in either direction.
    const message =
      error.code === "23505"
        ? "You're already friends, or a request is already pending."
        : `Could not send request: ${error.message}`
    return { status: "error", message }
  }

  revalidatePath("/dashboard/friends")
  return { status: "success", message: `Friend request sent to ${targetUsername}.` }
}

export async function respondFriendRequestAction(
  friendshipId: string,
  accept: boolean
): Promise<FriendActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.rpc("respond_to_friend_request", {
    p_friendship_id: friendshipId,
    p_accept: accept,
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/friends")
  return { status: "success", message: accept ? "Friend added." : "Request declined." }
}

/**
 * Covers both cancelling a still-pending outgoing request and ending an
 * accepted friendship — friendships_delete_involved (RLS) allows either
 * party to remove the row in both cases, so one action covers both.
 */
export async function removeFriendAction(friendshipId: string): Promise<FriendActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { error } = await supabase.from("friendships").delete().eq("id", friendshipId)

  if (error) {
    return { status: "error", message: error.message }
  }

  revalidatePath("/dashboard/friends")
  return { status: "success", message: null }
}
