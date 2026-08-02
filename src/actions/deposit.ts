"use server"

import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"
import { checkRateLimit, formatRetryAfter } from "@/lib/middleware/rate-limit"

const MIN_DEPOSIT_CENTS = 500
const MAX_DEPOSIT_CENTS = 500_000

export type CreateDepositIntentResult =
  | { ok: true; clientSecret: string }
  | { ok: false; message: string }

/**
 * Creates a PaymentIntent for an embedded, on-page card form (Stripe
 * Elements/PaymentElement) rather than redirecting to Stripe's own hosted
 * Checkout page — the deposit form stays fully custom-styled and the player
 * never leaves the site.
 *
 * The balance is NEVER credited here. This only starts a payment — crediting
 * happens exclusively in the webhook handler (handleDepositSucceeded) once
 * Stripe confirms the charge actually settled. That handler reacts to
 * payment_intent.succeeded generically, regardless of whether the
 * PaymentIntent came from Checkout or was created directly here, so nothing
 * about it needed to change for this to work.
 */
export async function createDepositIntentAction(amountCents: number): Promise<CreateDepositIntentResult> {
  const rounded = Math.round(amountCents)

  if (!Number.isFinite(rounded) || rounded < MIN_DEPOSIT_CENTS) {
    return { ok: false, message: "Minimum deposit is $5.00." }
  }
  if (rounded > MAX_DEPOSIT_CENTS) {
    return { ok: false, message: "Maximum single deposit is $5,000.00." }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, message: "Sign in and try again." }

  const rateLimit = await checkRateLimit("deposit", user.id)
  if (!rateLimit.allowed) {
    return {
      ok: false,
      message: `Too many deposit attempts. Try again in ${formatRetryAfter(rateLimit.retryAfterMs)}.`,
    }
  }

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_customer_id, email")
    .eq("id", user.id)
    .single()

  if (!profile) return { ok: false, message: "Profile not found." }

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

  try {
    const intent = await stripe.paymentIntents.create({
      amount: rounded,
      currency: "usd",
      customer: customerId,
      // automatic_payment_methods relies on the Dashboard having payment
      // methods explicitly activated for this currency (Settings > Payment
      // methods) — on a freshly-connected account nothing is turned on
      // there yet, and the PaymentIntent fails immediately with "No valid
      // payment method types" before the player ever sees a card field.
      // Hardcoding "card" needs no Dashboard setup step and is the one
      // method every Stripe account supports out of the box; swap back to
      // automatic_payment_methods (or add to this list) once wallets/bank
      // methods are deliberately turned on.
      payment_method_types: ["card"],
      metadata: {
        // Read by the webhook to know which account to credit and how much,
        // without needing to look anything else up.
        supabase_user_id: user.id,
        kind: "deposit",
      },
    })

    if (!intent.client_secret) {
      return { ok: false, message: "Could not start payment. Try again." }
    }

    return { ok: true, clientSecret: intent.client_secret }
  } catch (err) {
    console.error("[createDepositIntentAction] Stripe error", err)
    const detail = err instanceof Error ? err.message : "Unknown error"
    return { ok: false, message: `Could not start payment: ${detail}` }
  }
}
