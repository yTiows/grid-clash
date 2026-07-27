"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
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
  // self-attested DOB and consent timestamp to it. Best-effort: if the
  // trigger hasn't fired yet (email confirmation pending, no session), the
  // callback route or dashboard load fills this in on first authenticated
  // request instead.
  if (data.user) {
    await supabase
      .from("users")
      .update({
        date_of_birth_self_attested: parsed.data.dateOfBirth,
        terms_accepted_at: new Date().toISOString(),
      })
      .eq("id", data.user.id)
  }

  return {
    status: "success",
    message: "We sent you a confirmation link — click it to activate your account.",
  }
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
