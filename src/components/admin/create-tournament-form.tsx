"use client"

import { useState } from "react"
import { useFormState, useFormStatus } from "react-dom"

import { createTournamentAction, type AdminActionState } from "@/actions/admin-tournaments"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FORMATS } from "@/lib/game/formats"
import { RULESETS } from "@/lib/game/rulesets"

const initial: AdminActionState = { status: "idle", message: null }

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Creating…" : "Create contest"}
    </Button>
  )
}

export function CreateTournamentForm({
  satelliteTargets,
}: {
  /** Open tournament_standard contests a satellite could feed into. */
  satelliteTargets: { id: string; name: string; entry_fee_cents: number }[]
}) {
  const [state, formAction] = useFormState(createTournamentAction, initial)
  const [formatId, setFormatId] = useState("single_elimination")

  const format = FORMATS[formatId as keyof typeof FORMATS]
  const isSatellite = formatId === "satellite"

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="name">Name</Label>
        <Input id="name" name="name" placeholder="Friday Night Knockout" required />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="formatId">Format</Label>
          <select
            id="formatId"
            name="formatId"
            value={formatId}
            onChange={(e) => setFormatId(e.target.value)}
            className="flex h-11 w-full rounded-md border-2 border-white/15 bg-black/20 px-3 text-sm"
          >
            {Object.values(FORMATS).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.rakeBps / 100}%)
              </option>
            ))}
          </select>
          {format && <p className="text-xs text-muted-foreground">{format.rakeRationale}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="rulesetId">Ruleset</Label>
          <select
            id="rulesetId"
            name="rulesetId"
            defaultValue="classic"
            className="flex h-11 w-full rounded-md border-2 border-white/15 bg-black/20 px-3 text-sm"
          >
            {Object.values(RULESETS).map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="entryFeeCents">Entry fee (cents)</Label>
          <Input id="entryFeeCents" name="entryFeeCents" type="number" min={1} placeholder="2000" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fieldSize">
            Field size{" "}
            {format && (
              <span className="normal-case text-muted-foreground">
                ({format.minField}–{format.maxField})
              </span>
            )}
          </Label>
          <Input
            id="fieldSize"
            name="fieldSize"
            type="number"
            min={format?.minField ?? 2}
            max={format?.maxField ?? 256}
            placeholder="32"
            required
          />
        </div>
      </div>

      {/* A satellite's entire mechanic is "prize = a seat in a bigger
          contest" (CLAUDE_CODE_BRIEF.md §5.3) — the DB refuses to create one
          without a target (tournaments_satellite_shape), so this field isn't
          optional polish, it's required for the format to exist at all. */}
      {isSatellite && (
        <div className="space-y-2 rounded-md border-2 border-gold/40 bg-gold/5 p-3">
          <Label htmlFor="satelliteTargetTournamentId">Satellite target</Label>
          {satelliteTargets.length === 0 ? (
            <p className="text-xs text-rival">
              No open standard contests to target yet — create the target tournament first.
            </p>
          ) : (
            <>
              <select
                id="satelliteTargetTournamentId"
                name="satelliteTargetTournamentId"
                required
                className="flex h-11 w-full rounded-md border-2 border-white/15 bg-black/20 px-3 text-sm"
              >
                {satelliteTargets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} — ${(t.entry_fee_cents / 100).toFixed(2)} entry
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                The seat value is the target&apos;s own entry fee. This satellite&apos;s entry fee
                must be lower than that.
              </p>
            </>
          )}
        </div>
      )}

      <div className="space-y-2">
        <Label htmlFor="startsAt">
          Starts at <span className="normal-case text-muted-foreground">(optional — shows a live countdown)</span>
        </Label>
        <Input id="startsAt" name="startsAt" type="datetime-local" />
      </div>

      {state.status === "error" && <p className="text-sm text-rival">{state.message}</p>}
      {state.status === "success" && <p className="text-sm text-primary">{state.message}</p>}

      <SubmitButton />
    </form>
  )
}
