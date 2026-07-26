"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { stripe } from "@/lib/stripe"

export type WithdrawalActionState = {
  status: "idle" | "error"
  message: string | null
}

/**
 * Creates (if needed) a Stripe Connect Express account for the user and sends
 * them to Stripe's hosted onboarding. Express, not Standard or Custom: Stripe
 * owns the KYC capture, bank-detail collection, and compliance UI, which
 * means this platform never stores a bank account number or handles raw
 * identity documents for payouts — only Stripe does.
 */
export async function startConnectOnboardingAction(): Promise<void> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_connect_account_id, email")
    .eq("id", user.id)
    .single()

  if (!profile) redirect("/dashboard/wallet?error=profile_not_found")

  let accountId = profile.stripe_connect_account_id
  if (!accountId) {
    const account = await stripe.accounts.create({
      type: "express",
      email: profile.email,
      capabilities: { transfers: { requested: true } },
      metadata: { supabase_user_id: user.id },
    })
    accountId = account.id
    await supabase
      .from("users")
      .update({ stripe_connect_account_id: accountId })
      .eq("id", user.id)
  }

  const origin = headers().get("origin")

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${origin}/dashboard/wallet?connect=refresh`,
    return_url: `${origin}/dashboard/wallet?connect=return`,
  })

  redirect(accountLink.url)
}

/**
 * Debits the user's balance and creates a Stripe Transfer to their connected
 * account. The debit happens inside request_withdrawal() before this
 * function ever calls Stripe — if the Stripe call then fails, the caller
 * must roll back explicitly (see the catch block), rather than the debit and
 * the transfer being two independent steps that could disagree.
 */
export async function requestWithdrawalAction(
  _prevState: WithdrawalActionState,
  formData: FormData
): Promise<WithdrawalActionState> {
  const amountCents = Math.round(Number(formData.get("amountCents")) || 0)
  if (!Number.isFinite(amountCents) || amountCents < 1000) {
    return { status: "error", message: "Minimum withdrawal is $10.00." }
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { status: "error", message: "Sign in and try again." }

  const { data: payoutId, error: reserveError } = await supabase.rpc("request_withdrawal", {
    p_user_id: user.id,
    p_amount_cents: amountCents,
  })

  if (reserveError || !payoutId) {
    // request_withdrawal's exceptions are specific (KYC, Connect readiness,
    // balance) and safe to show — none of them leak information a user
    // shouldn't already know about their own account.
    return { status: "error", message: reserveError?.message ?? "Withdrawal could not be started." }
  }

  const { data: profile } = await supabase
    .from("users")
    .select("stripe_connect_account_id")
    .eq("id", user.id)
    .single()

  if (!profile?.stripe_connect_account_id) {
    // Should be unreachable — request_withdrawal already checked payouts are
    // enabled, which implies an account id exists — but if it ever happens,
    // reverse the hold rather than leave money debited with nowhere to go.
    await supabase.rpc("record_withdrawal_outcome", {
      p_payout_id: payoutId,
      p_stripe_transfer_id: null,
      p_status: "failed",
      p_failure_reason: "No connected account on file",
    })
    return { status: "error", message: "Payout account not found. Your balance was not charged." }
  }

  try {
    const transfer = await stripe.transfers.create({
      amount: amountCents,
      currency: "usd",
      destination: profile.stripe_connect_account_id,
      metadata: { payout_id: payoutId, supabase_user_id: user.id },
    })

    await supabase.rpc("record_withdrawal_outcome", {
      p_payout_id: payoutId,
      p_stripe_transfer_id: transfer.id,
      p_status: "in_transit",
      p_failure_reason: null,
    })
  } catch (err) {
    // The transfer call itself failed (network, Stripe-side rejection): undo
    // the hold immediately rather than waiting on a webhook that will never
    // arrive for a transfer that was never created.
    await supabase.rpc("record_withdrawal_outcome", {
      p_payout_id: payoutId,
      p_stripe_transfer_id: null,
      p_status: "failed",
      p_failure_reason: err instanceof Error ? err.message : "Transfer failed",
    })
    return { status: "error", message: "Withdrawal failed. Your balance was not charged." }
  }

  redirect("/dashboard/wallet?withdrawal=started")
}
