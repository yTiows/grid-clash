"use client"

import { useFormState, useFormStatus } from "react-dom"

import { createOpenWagerAction, type ChallengeActionState } from "@/actions/challenges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RULESETS } from "@/lib/game/rulesets"
import { WAGER_MIN_STAKE_CENTS, WAGER_MAX_STAKE_CENTS } from "@/lib/game/fees"

const initial: ChallengeActionState = { status: "idle", message: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Posting…" : "Post wager"}
    </Button>
  )
}

/**
 * Posts to the public open board — anyone, not just a friend, can accept it.
 * Bounds/ruleset validation is enforced again server-side by
 * create_open_wager() itself; the min/max here just keep the form from
 * offering a stake that's guaranteed to be rejected.
 */
export function PostWagerForm() {
  const [state, formAction] = useFormState(createOpenWagerAction, initial)

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="stakeCents" className="text-xs">
          Stake ($)
        </Label>
        <Input
          id="stakeDollars"
          type="number"
          min={WAGER_MIN_STAKE_CENTS / 100}
          max={WAGER_MAX_STAKE_CENTS / 100}
          step="1"
          defaultValue={WAGER_MIN_STAKE_CENTS / 100}
          required
          className="w-28"
          onChange={(e) => {
            // Dollars shown to the player, cents on the wire — the hidden
            // "stakeCents" input is the one createOpenWagerAction actually
            // reads (this field is deliberately unnamed so it's never
            // itself submitted).
            const cents = document.getElementById("stakeCents") as HTMLInputElement | null
            if (cents) cents.value = String(Math.round(Number(e.target.value) * 100))
          }}
        />
        <input id="stakeCents" type="hidden" name="stakeCents" defaultValue={WAGER_MIN_STAKE_CENTS} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="rulesetId" className="text-xs">
          Ruleset
        </Label>
        <select
          id="rulesetId"
          name="rulesetId"
          defaultValue="classic"
          className="flex h-9 w-40 rounded-md border border-border bg-white/[0.06] px-2 text-sm"
        >
          {Object.values(RULESETS)
            .filter((r) => r.id !== "purist")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
      </div>

      <SubmitButton />

      {state.status === "error" && <p className="w-full text-xs text-rival">{state.message}</p>}
      {state.status === "success" && <p className="w-full text-xs text-primary">{state.message}</p>}
    </form>
  )
}
