"use client"

import { useState } from "react"
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js"
import type { StripeElementsOptions } from "@stripe/stripe-js"

import { createDepositIntentAction } from "@/actions/deposit"
import { getStripe } from "@/lib/stripe-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const PRESETS_CENTS = [1000, 2500, 10000]

/**
 * Money surfaces stay the plainest register in the product (BRAND.md §6) —
 * this isn't styled with the same playfulness as a match result. It's
 * "fully custom" in the sense that matters for a payment form: the actual
 * Grid Clash palette and type instead of Stripe's default blue/white
 * Checkout look, so a player never leaves the site or hits a jarring
 * context switch to pay. `theme: "night"` is the closest built-in base to
 * this app's dark panel surfaces; `variables`/`rules` below pull the exact
 * tokens from globals.css rather than approximating them.
 */
const STRIPE_APPEARANCE: NonNullable<StripeElementsOptions["appearance"]> = {
  theme: "night",
  variables: {
    colorPrimary: "#b8ff2e",
    colorBackground: "#1e1e24",
    colorText: "#f4f3ee",
    colorTextSecondary: "#a6a5b0",
    colorDanger: "#ff5470",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    borderRadius: "8px",
    spacingUnit: "4px",
  },
  rules: {
    ".Tab, .Input, .Block": {
      backgroundColor: "#28282f",
      border: "1px solid rgba(255, 255, 255, 0.16)",
      boxShadow: "none",
    },
    ".Tab:hover": {
      border: "1px solid rgba(255, 255, 255, 0.3)",
    },
    ".Tab--selected": {
      border: "1px solid #b8ff2e",
      backgroundColor: "#28282f",
    },
    ".Input:focus": {
      border: "1px solid #b8ff2e",
      boxShadow: "0 0 0 1px #b8ff2e",
    },
    ".Label": {
      color: "#a6a5b0",
    },
}}

function AmountStep({
  onStarted,
}: {
  onStarted: (clientSecret: string) => void
}) {
  const [presetCents, setPresetCents] = useState<number>(PRESETS_CENTS[0]!)
  const [customDollars, setCustomDollars] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountCents = customDollars.trim()
    ? Math.round(Number(customDollars) * 100)
    : presetCents

  async function handleContinue() {
    setError(null)
    setPending(true)
    const result = await createDepositIntentAction(amountCents)
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onStarted(result.clientSecret)
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {PRESETS_CENTS.map((c) => (
          <label key={c} className="panel panel-interactive cursor-pointer p-3 text-center">
            <input
              type="radio"
              name="amountCents"
              checked={!customDollars.trim() && presetCents === c}
              onChange={() => {
                setPresetCents(c)
                setCustomDollars("")
              }}
              className="sr-only"
            />
            <span className="tabular font-bold">${(c / 100).toFixed(0)}</span>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="custom-amount">Or a custom amount ($)</Label>
        <Input
          id="custom-amount"
          type="number"
          step="0.01"
          placeholder="15.00"
          min={5}
          max={5000}
          value={customDollars}
          onChange={(e) => setCustomDollars(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-rival">{error}</p>}
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={pending || !Number.isFinite(amountCents) || amountCents < 500}
        onClick={handleContinue}
      >
        {pending ? "Starting…" : `Continue — $${(amountCents / 100).toFixed(2)}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        Card details are entered on this page and go straight to Stripe. Grid Clash never sees or
        stores them.
      </p>
    </div>
  )
}

function PaymentStep({ onCancel }: { onCancel: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  async function handlePay(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return

    setPending(true)
    setError(null)

    // redirect: "if_required" keeps the whole flow on this page for a card
    // payment — Stripe only navigates away for payment methods that
    // structurally require it (e.g. certain bank redirects).
    const { error: confirmError } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: `${window.location.origin}/dashboard/wallet?deposit=success`,
      },
      redirect: "if_required",
    })

    setPending(false)

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Try again.")
      return
    }

    // Balance updates via the webhook, not this response — it's usually a
    // couple seconds behind. Told plainly rather than implying it's instant.
    setSubmitted(true)
  }

  if (submitted) {
    return (
      <div className="space-y-3 text-center">
        <p className="text-sm font-medium text-primary">Payment submitted.</p>
        <p className="text-sm text-muted-foreground">
          Your balance updates as soon as Stripe confirms the charge — usually a few seconds.
          Refresh this page to see it land.
        </p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Refresh balance
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handlePay} className="space-y-4">
      <PaymentElement />
      {error && <p className="text-sm text-rival">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" type="button" onClick={onCancel} disabled={pending}>
          Back
        </Button>
        <Button type="submit" size="lg" className="flex-1" disabled={!stripe || pending}>
          {pending ? "Processing…" : "Pay"}
        </Button>
      </div>
    </form>
  )
}

export function DepositForm() {
  const [clientSecret, setClientSecret] = useState<string | null>(null)

  if (!clientSecret) {
    return <AmountStep onStarted={setClientSecret} />
  }

  return (
    <Elements
      stripe={getStripe()}
      options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
    >
      <PaymentStep onCancel={() => setClientSecret(null)} />
    </Elements>
  )
}
