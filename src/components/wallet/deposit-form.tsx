"use client"

import { useFormState, useFormStatus } from "react-dom"

import { createDepositAction, type DepositActionState } from "@/actions/deposit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: DepositActionState = { status: "idle", message: null }
const PRESETS_CENTS = [1000, 2500, 10000]

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Starting checkout…" : "Deposit"}
    </Button>
  )
}

export function DepositForm() {
  const [state, formAction] = useFormState(createDepositAction, initial)

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {PRESETS_CENTS.map((c) => (
          <label key={c} className="sticker-lift sticker cursor-pointer p-3 text-center">
            <input
              type="radio"
              name="amountCents"
              value={c}
              defaultChecked={c === PRESETS_CENTS[0]}
              className="sr-only"
            />
            <span className="font-bold">${(c / 100).toFixed(0)}</span>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        <Label htmlFor="custom-amount">Or a custom amount ($)</Label>
        <Input
          id="custom-amount"
          name="amountDollarsCustom"
          type="number"
          step="0.01"
          placeholder="15.00"
          min={5}
          max={5000}
        />
      </div>
      {state.status === "error" && <p className="text-sm text-rival">{state.message}</p>}
      <SubmitButton />
      <p className="text-xs text-muted-foreground">
        You&apos;ll be redirected to Stripe to complete payment securely. We never see or store
        your card details.
      </p>
    </form>
  )
}
