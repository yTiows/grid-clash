"use client"

import { useRef, useState, useTransition } from "react"
import { useFormState, useFormStatus } from "react-dom"

import { createTournamentAction, type AdminActionState } from "@/actions/admin-tournaments"
import { suggestFieldSizeAction, type SizingSuggestion } from "@/actions/admin-tournament-sizing"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FORMATS, FORMAT_TIER_RAKE_BPS, type FormatId } from "@/lib/game/formats"
import { RULESETS } from "@/lib/game/rulesets"
import { FEE_TIERS, type FeeTier } from "@/lib/game/fees"

const PLAYER_TIERS = Object.values(FEE_TIERS)

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
  const [minPlayerTier, setMinPlayerTier] = useState<FeeTier>("standard")
  const fieldSizeRef = useRef<HTMLInputElement>(null)
  const [sizing, setSizing] = useState<SizingSuggestion | null>(null)
  const [suggesting, startSuggesting] = useTransition()

  const format = FORMATS[formatId as keyof typeof FORMATS]
  const isSatellite = formatId === "satellite"

  function handleSuggest() {
    setSizing(null)
    startSuggesting(async () => {
      const result = await suggestFieldSizeAction(formatId as FormatId)
      if (result) {
        setSizing(result)
        if (fieldSizeRef.current) fieldSizeRef.current.value = String(result.suggestedFieldSize)
      }
    })
  }

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
            className="flex h-10 w-full rounded-md border border-border bg-white/[0.06] px-3 text-sm"
          >
            {Object.values(FORMATS).map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({FORMAT_TIER_RAKE_BPS[f.id][minPlayerTier] / 100}%)
              </option>
            ))}
          </select>
          {format && <p className="text-xs text-muted-foreground">{format.rakeRationale}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="minPlayerTier">
            Player tier required{" "}
            <span className="normal-case text-muted-foreground">(gates entry, sets the rake)</span>
          </Label>
          <select
            id="minPlayerTier"
            name="minPlayerTier"
            value={minPlayerTier}
            onChange={(e) => setMinPlayerTier(e.target.value as FeeTier)}
            className="flex h-10 w-full rounded-md border border-border bg-white/[0.06] px-3 text-sm"
          >
            {PLAYER_TIERS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} — {FORMAT_TIER_RAKE_BPS[formatId as FormatId][t.id] / 100}%
              </option>
            ))}
          </select>
          {minPlayerTier !== "standard" && (
            <p className="text-xs text-muted-foreground">
              Only players at {FEE_TIERS[minPlayerTier].name} tier or above (player_standing.fee_tier) can enter.
              Consider demand-sizing below — this tier&apos;s field is likely thinner than standard.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="rulesetId">Ruleset</Label>
        <select
          id="rulesetId"
          name="rulesetId"
          defaultValue="classic"
          className="flex h-10 w-full rounded-md border border-border bg-white/[0.06] px-3 text-sm"
        >
          {Object.values(RULESETS)
            // Purist has no specials and no hidden information on a small
            // enough board to be solved outright — createTournamentAction
            // rejects it server-side since every tournament here is real
            // money; left out of the picklist too so there's nothing to
            // pick in the first place.
            .filter((r) => r.id !== "purist")
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
        </select>
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
          <div className="flex gap-2">
            <Input
              ref={fieldSizeRef}
              id="fieldSize"
              name="fieldSize"
              type="number"
              min={format?.minField ?? 2}
              max={format?.maxField ?? 256}
              placeholder="32"
              required
            />
            <Button type="button" variant="outline" size="sm" disabled={suggesting} onClick={handleSuggest}>
              {suggesting ? "…" : "Suggest"}
            </Button>
          </div>
          {sizing && (
            <p className="tabular text-xs text-muted-foreground">
              {sizing.demand.concurrentPlayers} active last 30m ·{" "}
              {Math.round(sizing.demand.historicalFillRate * 100)}% recent fill rate → suggesting{" "}
              {sizing.suggestedFieldSize} seats
            </p>
          )}
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
                className="flex h-10 w-full rounded-md border border-border bg-white/[0.06] px-3 text-sm"
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
          Starts at{" "}
          <span className="normal-case text-muted-foreground">
            (shows a live countdown; required if demand-sized below)
          </span>
        </Label>
        <Input id="startsAt" name="startsAt" type="datetime-local" />
      </div>

      <div className="flex items-start gap-2 rounded-md border border-border p-3">
        <input id="demandSized" name="demandSized" type="checkbox" className="mt-1" />
        <Label htmlFor="demandSized" className="normal-case font-normal">
          Demand-sized — field size above is a ceiling. The real field commits
          from actual signups at the start time, refunding any shortfall
          (below {format?.minField ?? "the format minimum"}, contest cancels
          and everyone is refunded) or overflow (bracket formats snap down to
          a clean power of two; latest registrants refunded).
        </Label>
      </div>

      {state.status === "error" && <p className="text-sm text-rival">{state.message}</p>}
      {state.status === "success" && <p className="text-sm text-primary">{state.message}</p>}

      <SubmitButton />
    </form>
  )
}
