"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

const MIN_DEPOSIT_CENTS = 500
const MAX_DEPOSIT_CENTS = 500_000

export type DepositActionState = {
  status: "idle" | "error"
  message: string | null
}

/**
 * Creates a Checkout Session and redirects to Stripe's hosted page.
 *
 * The balance is NEVER credited here. This action only starts a payment —
 * crediting happens exclusively in the webhook handler once Stripe confirms
 * the charge actually settled. A client-trusted "it worked, credit me" call
 * would let anyone fund their account by hitting this endpoint and closing
 * the tab before paying.
 */
export async function createDepositAction(
  _prevState: DepositActionState,
  formData: FormData
): Promise<DepositActionState> {
  // The custom field is entered in dollars (real UX for a money input) and
  // converted to cents here; the presets are already cents. When both are
  // present, the custom field wins — it means the user actively typed
  // something rather than leaving the preset radio at its default.
  const customDollars = formData.get("amountDollarsCustom")
  const presetCents = formData.get("amountCents")
  const hasCustom = customDollars !== null && String(customDollars).trim() !== ""

  const amountCents = hasCustom
    ? Math.round(Number(customDollars) * 100)
    : Math.round(Number(presetCents) || 0)

  if (!Number.isFinite(amountCents) || amountCents < MIN_DEPOSIT_CENTS) {
    return { status: "error", message: "Minimum deposit is $5.00." }
  }
  if (amountCents > MAX_DEPOSIT_CENTS) {
    return { status: "error", message: "Maximum single deposit is $5,000.00." }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single()

  if (!profile) return { status: "error", message: "Profile not found." }

  // Reuse the existing Stripe Customer if one exists, so repeat deposits and
  // any future subscription/receipt history land on one customer record
  // instead of fragmenting across a new one per deposit.
  let customerId = profile.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: profile.email,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id

    // Best-effort persistence. If this write fails, the next deposit simply
    // creates (and this time saves) another customer — a minor annoyance,
    // never a money-safety issue, since crediting is keyed off the webhook's
    // payment_intent id, not the customer id.
    await supabase.from("users").update({ stripe_customer_id: customerId }).eq("id", user.id)
  }

  const origin = headers().get("origin")

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customerId,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: { name: "Grid Clash balance deposit" },
          unit_amount: amountCents,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // Read by the webhook to know which account to credit and how much,
      // without needing to look anything else up.
      metadata: { supabase_user_id: user.id, kind: "deposit" },
    },
    success_url: `${origin}/dashboard/wallet?deposit=success`,
    cancel_url: `${origin}/dashboard/wallet?deposit=cancelled`,
  })

  if (!session.url) {
    return { status: "error", message: "Could not start checkout. Try again." }
  }

  redirect(session.url)
}
