"use client"

import { useState } from "react"
import { useFormState, useFormStatus } from "react-dom"

import { createChallengeAction, type ChallengeActionState } from "@/actions/challenges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RULESETS } from "@/lib/game/rulesets"

const initial: ChallengeActionState = { status: "idle", message: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Sending…" : "Send challenge"}
    </Button>
  )
}

/**
 * Shown only on a friend's profile, and only once they've opted in
 * (challenge_preferences.accepts_challenges) — both gates are checked
 * server-side too by create_challenge() itself, this is just the UI not
 * offering a button that would fail. Submitting creates a challenges row
 * at status='pending' and stops there; see createChallengeAction's own
 * comment for why this doesn't create a live match.
 */
export function ChallengeInviteForm({
  targetId,
  targetUsername,
  minStakeCents,
  maxStakeCents,
}: {
  targetId: string
  targetUsername: string
  minStakeCents: number | null
  maxStakeCents: number | null
}) {
  const [state, formAction] = useFormState(createChallengeAction, initial)
  const [open, setOpen] = useState(false)

  if (state.status === "success") {
    return <p className="text-sm font-bold text-primary">{state.message}</p>
  }

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Invite to 1v1 wager
      </Button>
    )
  }

  return (
    <form action={formAction} className="w-64 space-y-3 rounded-md border border-border p-3">
      <input type="hidden" name="targetId" value={targetId} />
      <p className="text-xs text-muted-foreground">Challenge {targetUsername} to a 1v1.</p>

      <div className="space-y-1">
        <Label htmlFor="stakeCents" className="text-xs">
          Stake (cents)
          {(minStakeCents || maxStakeCents) && (
            <span className="normal-case text-muted-foreground">
              {" "}
              ({minStakeCents ?? "any"}–{maxStakeCents ?? "any"})
            </span>
          )}
        </Label>
        <Input
          id="stakeCents"
          name="stakeCents"
          type="number"
          min={minStakeCents ?? 1}
          max={maxStakeCents ?? undefined}
          defaultValue={minStakeCents ?? 500}
          required
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="rulesetId" className="text-xs">
          Ruleset
        </Label>
        <select
          id="rulesetId"
          name="rulesetId"
          defaultValue="classic"
          className="flex h-9 w-full rounded-md border border-border bg-white/[0.06] px-2 text-sm"
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

      <div className="flex items-center gap-2">
        <SubmitButton />
        <Button type="button" size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      {state.status === "error" && <p className="text-xs text-rival">{state.message}</p>}
    </form>
  )
}
