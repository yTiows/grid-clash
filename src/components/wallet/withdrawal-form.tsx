"use client"

import { useFormState, useFormStatus } from "react-dom"

import { requestWithdrawalAction, type WithdrawalActionState } from "@/actions/withdrawal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const initial: WithdrawalActionState = { status: "idle", message: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" variant="gold" disabled={pending}>
      {pending ? "Processing…" : "Withdraw"}
    </Button>
  )
}

export function WithdrawalForm({ maxCents }: { maxCents: number }) {
  const [state, formAction] = useFormState(requestWithdrawalAction, initial)

  return (
    <form action={formAction} className="space-y-3 pt-2">
      <Input
        type="number"
        name="amountCents"
        placeholder="Amount in cents (min 1000 = $10)"
        min={1000}
        max={maxCents}
        required
      />
      {state.status === "error" && <p className="text-xs text-rival">{state.message}</p>}
      <SubmitButton />
    </form>
  )
}
