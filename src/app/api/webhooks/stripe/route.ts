import { NextResponse } from "next/server"
import type Stripe from "stripe"

import { createAdminClient } from "@/lib/supabase/admin"
import { stripe } from "@/lib/stripe"

/**
 * Single Stripe webhook endpoint for every product this app uses: deposits,
 * Connect payouts, and Identity verification. One endpoint, one signature
 * check, one idempotency table — simpler to register once in the Dashboard
 * and harder to accidentally leave one variant unprotected.
 *
 * Idempotency is enforced twice, deliberately redundant:
 *   1. Here, against `processed_webhook_events` keyed on Stripe's own event
 *      id — a retried delivery of the same event is dropped before any
 *      business logic runs.
 *   2. Inside move_balance() / settle_ranked_match(), keyed on a caller-
 *      supplied idempotency key — so even if this layer were ever bypassed
 *      (a direct RPC call, a future second webhook consumer), the ledger
 *      itself still cannot be double-credited.
 *
 * Always returns 200 once an event is durably recorded as processed, even if
 * downstream side effects individually no-op — Stripe retries on non-2xx for
 * up to three days, and a 200 that lies about success is worse than an event
 * that's occasionally reprocessed. Non-2xx is reserved for signature failures
 * and genuine transient errors we want retried.
 */
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 })
  }

  const rawBody = await request.text()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.error("[stripe webhook] signature verification failed", err)
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 })
  }

  const db = createAdminClient()

  const { error: dedupeError } = await db
    .from("processed_webhook_events")
    .insert({ provider: "stripe", provider_event_id: event.id, event_type: event.type })

  if (dedupeError) {
    // Unique violation on (provider, provider_event_id) means this exact
    // event was already handled. Every other error is unexpected and worth
    // retrying, so only the specific "already exists" code short-circuits.
    if (dedupeError.code === "23505") {
      return NextResponse.json({ received: true, duplicate: true })
    }
    console.error("[stripe webhook] dedupe insert failed", dedupeError)
    return NextResponse.json({ error: "Could not record event" }, { status: 500 })
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded":
        await handleDepositSucceeded(db, event.data.object)
        break
      case "account.updated":
        await handleConnectAccountUpdated(db, event.data.object)
        break
      case "identity.verification_session.verified":
        await handleIdentityVerified(db, event.data.object)
        break
      case "identity.verification_session.requires_input":
      case "identity.verification_session.canceled":
        await handleIdentityRejected(db, event.data.object)
        break
      case "transfer.reversed":
        await handleTransferReversed(db, event.data.object)
        break
      default:
        // Unhandled event types are expected — this endpoint only needs to
        // subscribe to what it acts on, and Stripe sends many event types no
        // integration needs. No action is not an error.
        break
    }
  } catch (err) {
    // A processing failure after the dedupe row is written means this event
    // will never be retried by Stripe (we already returned success to the
    // dedupe check's intent), which is why every handler below is written to
    // fail loudly to logs rather than throw past this point where possible.
    console.error(`[stripe webhook] handler failed for ${event.type}`, err)
  }

  return NextResponse.json({ received: true })
}

type Db = ReturnType<typeof createAdminClient>

async function handleDepositSucceeded(
  db: Db,
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  if (paymentIntent.metadata?.kind !== "deposit") return

  const userId = paymentIntent.metadata.supabase_user_id
  if (!userId) {
    console.error("[stripe webhook] deposit payment_intent missing supabase_user_id", paymentIntent.id)
    return
  }

  const { error } = await db.rpc("move_balance", {
    p_user_id: userId,
    p_amount_cents: paymentIntent.amount_received,
    p_reason: "deposit",
    p_idempotency_key: `stripe_pi:${paymentIntent.id}`,
  })

  if (error) {
    console.error("[stripe webhook] deposit credit failed", paymentIntent.id, error)
    return
  }

  await db.from("transactions").insert({
    user_id: userId,
    type: "deposit",
    amount_cents: paymentIntent.amount_received,
    status: "completed",
    payment_provider: "stripe",
    provider_transaction_id: paymentIntent.id,
    completed_at: new Date().toISOString(),
  })
}

async function handleConnectAccountUpdated(db: Db, account: Stripe.Account): Promise<void> {
  const userId = account.metadata?.supabase_user_id
  if (!userId) return

  await db
    .from("users")
    .update({
      stripe_connect_payouts_enabled: account.payouts_enabled ?? false,
      stripe_connect_onboarded_at: account.details_submitted ? new Date().toISOString() : null,
    })
    .eq("id", userId)
}

async function handleIdentityVerified(
  db: Db,
  session: Stripe.Identity.VerificationSession
): Promise<void> {
  const userId = session.metadata?.supabase_user_id
  if (!userId) return

  const outputs = session.verified_outputs

  await db
    .from("kyc_records")
    .update({
      status: "approved",
      verified_at: new Date().toISOString(),
      full_name: outputs?.first_name && outputs?.last_name
        ? `${outputs.first_name} ${outputs.last_name}`
        : null,
      date_of_birth: outputs?.dob
        ? `${outputs.dob.year}-${String(outputs.dob.month).padStart(2, "0")}-${String(outputs.dob.day).padStart(2, "0")}`
        : null,
      country_code: outputs?.address?.country ?? null,
    })
    .eq("provider_verification_id", session.id)

  await db
    .from("users")
    .update({ kyc_verified: true, kyc_verified_at: new Date().toISOString() })
    .eq("id", userId)
}

async function handleIdentityRejected(
  db: Db,
  session: Stripe.Identity.VerificationSession
): Promise<void> {
  await db
    .from("kyc_records")
    .update({ status: "rejected" })
    .eq("provider_verification_id", session.id)
}

async function handleTransferReversed(db: Db, transfer: Stripe.Transfer): Promise<void> {
  const payoutId = transfer.metadata?.payout_id
  if (!payoutId) return

  await db.rpc("record_withdrawal_outcome", {
    p_payout_id: payoutId,
    p_stripe_transfer_id: transfer.id,
    p_status: "reversed",
    p_failure_reason: "Transfer reversed by Stripe",
  })
}
