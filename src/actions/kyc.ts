"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

/**
 * Creates a Stripe Identity VerificationSession and sends the user to
 * Stripe's hosted capture flow. The hosted redirect, not the embedded modal:
 * it keeps a real ID document off this platform's servers entirely — Stripe
 * captures, stores, and verifies it, and only tells this app pass/fail plus
 * the minimum verified fields (name, DOB, country) via webhook.
 *
 * Stripe Identity must be turned on once for the account at
 * dashboard.stripe.com > Settings > Identity before this call succeeds.
 */
export async function startKycVerificationAction(): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const origin = headers().get("origin")

  const session = await stripe.identity.verificationSessions.create({
    type: "document",
    metadata: { supabase_user_id: user.id },
    options: {
      document: { require_matching_selfie: true },
    },
    return_url: `${origin}/dashboard/wallet?kyc=return`,
  })

  await supabase.from("kyc_records").insert({
    user_id: user.id,
    provider: "stripe_identity",
    provider_verification_id: session.id,
    status: "pending",
  })

  if (!session.url) {
    redirect("/dashboard/wallet?kyc=error")
  }
  redirect(session.url)
}
