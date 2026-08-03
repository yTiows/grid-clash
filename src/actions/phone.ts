"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { twilioClient, TWILIO_VERIFY_SERVICE_SID } from "@/lib/twilio"

export type PhoneActionState = {
  status: "idle" | "sent" | "verified" | "error"
  message: string | null
  /** The number actually used, once normalizePhoneNumber has run — the
   * verify step's hidden field is updated to this so a user who typed
   * "18623206326" (no +) still verifies against what was actually texted. */
  normalizedPhone?: string
}

const RATE_LIMIT_ATTEMPTS = 5

/**
 * Twilio requires strict E.164 (+15551234567) but nobody types that
 * unprompted — this accepts what a person actually types (spaces, dashes,
 * parens, a leading 1, no +) and normalizes it instead of rejecting
 * anything that isn't already exact. Defaults a bare 10-digit number to US
 * (+1) since that's who a 10-digit number with no country code is from in
 * practice; an 11-digit number already starting with 1 just gets a +
 * prepended. Anything else falls through to the E.164 check unchanged, so
 * a correctly-typed international number still works.
 */
function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim()
  const digitsOnly = trimmed.replace(/[^\d]/g, "")

  let candidate: string
  if (trimmed.startsWith("+")) {
    candidate = "+" + digitsOnly
  } else if (digitsOnly.length === 10) {
    candidate = "+1" + digitsOnly
  } else if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    candidate = "+" + digitsOnly
  } else {
    candidate = "+" + digitsOnly
  }

  return /^\+[1-9]\d{7,14}$/.test(candidate) ? candidate : null
}

/**
 * Starts a Twilio Verify check. Accepts whatever format the player typed —
 * see normalizePhoneNumber — and only fails if it can't be turned into a
 * valid E.164 number at all.
 */
export async function sendPhoneCodeAction(
  _prevState: PhoneActionState,
  formData: FormData
): Promise<PhoneActionState> {
  const raw = String(formData.get("phoneNumber") ?? "")
  const phoneNumber = normalizePhoneNumber(raw)
  if (!phoneNumber) {
    return { status: "error", message: "That doesn't look like a valid phone number. Include your country code if you're outside the US." }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: existing } = await supabase
    .from("phone_verifications")
    .select("verification_attempts")
    .eq("user_id", user.id)
    .eq("phone_number", phoneNumber)
    .maybeSingle()

  if (existing && existing.verification_attempts >= RATE_LIMIT_ATTEMPTS) {
    return { status: "error", message: "Too many attempts for this number. Try a different one." }
  }

  try {
    await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phoneNumber, channel: "sms" })
  } catch {
    return { status: "error", message: "Could not send a code. Check the number and try again." }
  }

  await supabase.from("phone_verifications").upsert(
    {
      user_id: user.id,
      phone_number: phoneNumber,
      verification_attempts: (existing?.verification_attempts ?? 0) + 1,
      last_attempt_at: new Date().toISOString(),
    },
    { onConflict: "user_id,phone_number" }
  )

  return { status: "sent", message: `Code sent to ${phoneNumber}.`, normalizedPhone: phoneNumber }
}

export async function verifyPhoneCodeAction(
  _prevState: PhoneActionState,
  formData: FormData
): Promise<PhoneActionState> {
  // The hidden field is set from sendPhoneCodeAction's normalizedPhone, so
  // this is already E.164 in the normal flow — re-normalizing defensively
  // in case a caller ever posts here with the raw, unnormalized value.
  const phoneNumber = normalizePhoneNumber(String(formData.get("phoneNumber") ?? "")) ?? ""
  const code = String(formData.get("code") ?? "").trim()

  if (!phoneNumber) return { status: "error", message: "Send a code first." }
  if (!code) return { status: "error", message: "Enter the code you received." }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  let approved = false
  try {
    const check = await twilioClient.verify.v2
      .services(TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phoneNumber, code })
    approved = check.status === "approved"
  } catch {
    return { status: "error", message: "That code didn't work. Try again." }
  }

  if (!approved) {
    return { status: "error", message: "Incorrect or expired code." }
  }

  // FOUND BROKEN (2026-08-01): both writes below silently no-op on the
  // plain session client — phone_verifications has only a SELECT RLS
  // policy for authenticated ("updates only via service-role" per
  // 20260724000003_rls_policies.sql's own comment), and users has
  // insert/update/delete revoked from authenticated entirely
  // (20260724000006_security_hardening.sql). Confirmed live: both real
  // accounts on this project show account_status still 'phone_pending'
  // despite Twilio verification succeeding. Fixed by using the
  // service-role client, same fix as auth.ts's signUpAction.
  const admin = createAdminClient()

  const { error: verificationError } = await admin
    .from("phone_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("phone_number", phoneNumber)
  if (verificationError) {
    console.error("[verifyPhoneCodeAction] failed to record verified_at", verificationError)
  }

  const { error: userError } = await admin
    .from("users")
    .update({ phone_verified: true, phone_number: phoneNumber })
    .eq("id", user.id)
  if (userError) {
    console.error("[verifyPhoneCodeAction] failed to update users.phone_verified", userError)
    return { status: "error", message: "Verified, but couldn't update your account. Try again." }
  }

  // ALSO FOUND MISSING (2026-08-01), not just broken: handle_new_user sets
  // every new account to account_status = 'phone_pending', but grepping the
  // entire codebase for anywhere that ever sets account_status = 'active'
  // found exactly one place — admin-automation.ts clearing a fraud/bot
  // review, which is the wrong trigger for this. Nothing has ever
  // transitioned a normal signup out of 'phone_pending', meaning every real
  // account (not created by hand in SQL) has been permanently blocked from
  // assert_can_wager/check_deposit_allowed regardless of this fix. Phone
  // verification succeeding is the obvious, minimal condition to add —
  // scoped to only flip FROM 'phone_pending' so an admin's suspended/banned/
  // kyc_pending decision is never silently overwritten by a player just
  // verifying their phone.
  const { error: activateError } = await admin
    .from("users")
    .update({ account_status: "active" })
    .eq("id", user.id)
    .eq("account_status", "phone_pending")
  if (activateError) {
    console.error("[verifyPhoneCodeAction] failed to activate account", activateError)
  }

  return { status: "verified", message: "Phone verified." }
}
