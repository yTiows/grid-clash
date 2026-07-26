"use server"

import { createClient } from "@/lib/supabase/server"
import { twilioClient, TWILIO_VERIFY_SERVICE_SID } from "@/lib/twilio"

export type PhoneActionState = {
  status: "idle" | "sent" | "verified" | "error"
  message: string | null
}

const RATE_LIMIT_ATTEMPTS = 5

/**
 * Starts a Twilio Verify check. E.164 formatting (+15551234567) is required
 * by Twilio — validated loosely here; Twilio itself rejects malformed
 * numbers, so this is a fast-fail rather than the source of truth.
 */
export async function sendPhoneCodeAction(
  _prevState: PhoneActionState,
  formData: FormData
): Promise<PhoneActionState> {
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim()
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return { status: "error", message: "Enter your number in international format, e.g. +15551234567." }
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

  return { status: "sent", message: `Code sent to ${phoneNumber}.` }
}

export async function verifyPhoneCodeAction(
  _prevState: PhoneActionState,
  formData: FormData
): Promise<PhoneActionState> {
  const phoneNumber = String(formData.get("phoneNumber") ?? "").trim()
  const code = String(formData.get("code") ?? "").trim()

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

  await supabase
    .from("phone_verifications")
    .update({ verified_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("phone_number", phoneNumber)

  await supabase
    .from("users")
    .update({ phone_verified: true, phone_number: phoneNumber })
    .eq("id", user.id)

  return { status: "verified", message: "Phone verified." }
}
