"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

export type ProfileActionState = {
  status: "idle" | "error" | "success"
  message: string | null
}

/**
 * Persists users.avatar_url after the file itself is already uploaded to
 * the avatars storage bucket (client-side, via storage RLS — see
 * 20260801000006_social_tab.sql's avatars_insert_own policy). The users
 * table row update needs the service-role client like every other
 * users-table write in this codebase (insert/update/delete is revoked from
 * authenticated — 20260724000006_security_hardening.sql), so this exists
 * even though the upload itself didn't need a server action at all.
 */
export async function updateAvatarUrlAction(
  avatarUrl: string,
  username: string
): Promise<ProfileActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const admin = createAdminClient()
  const { error } = await admin.from("users").update({ avatar_url: avatarUrl }).eq("id", user.id)

  if (error) {
    return { status: "error", message: "Could not save avatar." }
  }

  revalidatePath(`/players/${username}`)
  return { status: "success", message: null }
}
