"use client"

import { useFormState, useFormStatus } from "react-dom"

import { updateChallengePreferencesAction, type ChallengeActionState } from "@/actions/challenges"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const initial: ChallengeActionState = { status: "idle", message: null }

function SaveButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  )
}

/**
 * Self-only. challenge_preferences.accepts_challenges defaults to false —
 * without a real way to opt in, "invite to a 1v1 wager" would be dead on
 * arrival for every account. Friend-gating (create_challenge only accepts a
 * target you're already friends with) is the real harassment mitigation
 * here, per 20260801000006_social_tab.sql's own comment — this toggle is
 * just the target's own knob on top of that, not a second gate doing the
 * same job.
 */
export function ChallengePreferencesForm({
  accepts,
  minStakeCents,
  maxStakeCents,
}: {
  accepts: boolean
  minStakeCents: number | null
  maxStakeCents: number | null
}) {
  const [state, formAction] = useFormState(updateChallengePreferencesAction, initial)

  return (
    <form action={formAction} className="space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="acceptsChallenges"
          defaultChecked={accepts}
          className="h-4 w-4 rounded border border-border bg-transparent accent-[color:var(--primary)]"
        />
        Friends can send me 1v1 wager challenges
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="minStakeCents" className="text-xs">
            Min stake (cents, optional)
          </Label>
          <Input
            id="minStakeCents"
            name="minStakeCents"
            type="number"
            min={1}
            defaultValue={minStakeCents ?? ""}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="maxStakeCents" className="text-xs">
            Max stake (cents, optional)
          </Label>
          <Input
            id="maxStakeCents"
            name="maxStakeCents"
            type="number"
            min={1}
            defaultValue={maxStakeCents ?? ""}
          />
        </div>
      </div>

      <SaveButton />
      {state.status === "success" && <span className="ml-2 text-xs text-primary">Saved.</span>}
      {state.status === "error" && <p className="text-xs text-rival">{state.message}</p>}
    </form>
  )
}
