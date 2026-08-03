"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { signInSchema, signUpSchema } from "@/lib/validations/auth"
import { checkRateLimit, formatRetryAfter } from "@/lib/middleware/rate-limit"

export type AuthActionState = {
  status: "idle" | "error" | "success"
  message: string | null
  fieldErrors?: Record<string, string[] | undefined>
}

/** Best-effort client identifier for pre-auth rate limiting. No user id exists yet. */
function clientIp(): string {
  const forwardedFor = headers().get("x-forwarded-for")
  return forwardedFor?.split(",")[0]?.trim() || headers().get("x-real-ip") || "unknown"
}

export async function signUpAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const rateLimit = await checkRateLimit("signup", clientIp())
  if (!rateLimit.allowed) {
    return {
      status: "error",
      message: `Too many signup attempts. Try again in ${formatRetryAfter(rateLimit.retryAfterMs)}.`,
    }
  }

  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    dateOfBirth: formData.get("dateOfBirth"),
    acceptedTerms: formData.get("acceptedTerms"),
    referredBy: formData.get("referredBy"),
  })

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  const supabase = createClient()
  const origin = headers().get("origin")

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  })

  if (error) {
    return { status: "error", message: error.message }
  }

  // The handle_new_user trigger creates the row; this attaches the
  // self-attested DOB and consent timestamp to it.
  //
  // FOUND BROKEN (2026-08-01): this ran on the plain session client, but
  // 20260724000006_security_hardening.sql revokes insert/update/delete on
  // public.users from `authenticated` entirely (Finding 1 — full PII
  // disclosure fix). The update below has been failing permission-denied on
  // every real signup since that migration, silently, because its result
  // was never checked. Confirmed live: both real accounts on this project
  // (paulogamet95, orcainf) have date_of_birth_self_attested and
  // terms_accepted_at still null and account_status still 'phone_pending'
  // despite having signed up — meaning assert_can_wager/check_deposit_
  // allowed have been refusing them outright the whole time. Fixed by
  // using the service-role client for this specific write, matching how
  // every other users-table mutation in this codebase already does it
  // (phone.ts's verifyPhoneCodeAction had the identical bug, fixed
  // alongside this). A dashboard-level prompt (CompleteAttestationPrompt)
  // covers the two accounts already stuck with a null value from before
  // this fix — the app itself is real evidence a self-attested DOB isn't
  // fabricatable by an agent, so those rows are not backfilled here.
  if (data.user) {
    // Referral attribution — best-effort, never blocks signup. A typo'd or
    // unknown username just means no referrer is recorded, not an error;
    // this is pure attribution for the friends-tab "add via invite" prompt,
    // not a gated/rewarded flow (see 20260801000006_social_tab.sql).
    let invitedByUserId: string | null = null
    if (parsed.data.referredBy) {
      // public_players, not users — users_select_own (RLS) only permits
      // reading your own row; public_players is the allowlisted view for
      // looking up another player (see the same note on friends.ts).
      const { data: referrer } = await supabase
        .from("public_players")
        .select("id")
        .eq("username", parsed.data.referredBy)
        .maybeSingle()
      if (referrer && referrer.id !== data.user.id) {
        invitedByUserId = referrer.id
      }
    }

    const admin = createAdminClient()
    const { error: attestError } = await admin
      .from("users")
      .update({
        date_of_birth_self_attested: parsed.data.dateOfBirth,
        terms_accepted_at: new Date().toISOString(),
        ...(invitedByUserId ? { invited_by_user_id: invitedByUserId } : {}),
      })
      .eq("id", data.user.id)

    if (attestError) {
      console.error("[signUpAction] failed to attach DOB/terms", attestError)
    }
  }

  return {
    status: "success",
    message: "We sent you a confirmation link — click it to activate your account.",
  }
}

/**
 * Fallback completion path for an account whose date_of_birth_self_attested/
 * terms_accepted_at never got attached at signup — specifically the two
 * real accounts on this project caught by the bug fixed above in
 * signUpAction (2026-08-01). Same age-18+ validation as signup itself
 * (reuses signUpSchema's own dateOfBirth check rather than a second,
 * possibly-drifting copy of the rule). Not a general "edit your DOB"
 * feature — assert_can_wager/check_deposit_allowed treat this as a
 * one-time attestation, so this only ever fires the write for an account
 * that doesn't already have one.
 */
export async function completeAttestationAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const dobResult = signUpSchema.shape.dateOfBirth.safeParse(formData.get("dateOfBirth"))
  if (!dobResult.success) {
    return {
      status: "error",
      message: "Please fix the errors below.",
      fieldErrors: { dateOfBirth: dobResult.error.flatten().formErrors },
    }
  }
  if (formData.get("acceptedTerms") !== "on") {
    return {
      status: "error",
      message: "Please fix the errors below.",
      fieldErrors: { acceptedTerms: ["You must accept the terms to continue"] },
    }
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from("users")
    .update({
      date_of_birth_self_attested: dobResult.data,
      terms_accepted_at: new Date().toISOString(),
    })
    .eq("id", user.id)
    .is("date_of_birth_self_attested", null)

  if (error) {
    return { status: "error", message: "Could not save. Try again." }
  }

  return { status: "success", message: "Saved." }
}

export async function signInAction(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  })

  if (!parsed.success) {
    return {
      status: "error",
      message: "Please fix the errors below.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    }
  }

  // Keyed on email, not IP: the threat is credential stuffing against one
  // account, which an IP-based limit alone wouldn't catch from a botnet.
  const rateLimit = await checkRateLimit("login", parsed.data.email.toLowerCase())
  if (!rateLimit.allowed) {
    return {
      status: "error",
      message: `Too many attempts. Try again in ${formatRetryAfter(rateLimit.retryAfterMs)}.`,
    }
  }

  const supabase = createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Deliberately generic — do not reveal whether the email is registered.
    return { status: "error", message: "Invalid email or password." }
  }

  redirect("/dashboard")
}

export async function signOutAction(): Promise<void> {
  const supabase = createClient()
  await supabase.auth.signOut()
  redirect("/login")
}
