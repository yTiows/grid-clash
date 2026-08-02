"use client"

import { useState } from "react"
import { useFormState, useFormStatus } from "react-dom"

import { requestWithdrawalAction, type WithdrawalActionState } from "@/actions/withdrawal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: WithdrawalActionState = { status: "idle", message: null }
const MIN_WITHDRAWAL_CENTS = 1000

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" variant="gold" disabled={disabled || pending}>
      {pending ? "Processing…" : "Withdraw"}
    </Button>
  )
}

/**
 * Takes a dollar amount, same as DepositForm — the underlying action still
 * wants cents (that's the ledger's unit everywhere else in the app too),
 * this just does the *100 conversion here instead of asking the player to
 * do it themselves. Previously this field's placeholder literally said
 * "Amount in cents (min 1000 = $10)" — no other money input in the product
 * asks for cents directly.
 */
export function WithdrawalForm({ maxCents }: { maxCents: number }) {
  const [state, formAction] = useFormState(requestWithdrawalAction, initial)
  const [dollars, setDollars] = useState("")

  const amountCents = Math.round((Number(dollars) || 0) * 100)
  const maxDollars = (maxCents / 100).toFixed(2)
  const isValid = amountCents >= MIN_WITHDRAWAL_CENTS && amountCents <= maxCents

  return (
    <form action={formAction} className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <Label htmlFor="withdraw-amount">Amount ($)</Label>
        <div className="flex items-center gap-2">
          <Input
            id="withdraw-amount"
            type="number"
            step="0.01"
            min={MIN_WITHDRAWAL_CENTS / 100}
            max={maxCents / 100}
            placeholder="10.00"
            value={dollars}
            onChange={(e) => setDollars(e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => setDollars(maxDollars)}>
            Max
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Min $10.00 · up to ${maxDollars} available
        </p>
      </div>
      <input type="hidden" name="amountCents" value={amountCents} />
      {state.status === "error" && <p className="text-xs text-rival">{state.message}</p>}
      <SubmitButton disabled={!isValid} />
    </form>
  )
}
