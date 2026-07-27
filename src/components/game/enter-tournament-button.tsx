"use client"

import { useState, useTransition } from "react"

import { enterTournamentAction } from "@/actions/tournaments"
import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/game/fees"

export function EnterTournamentButton({
  tournamentId,
  entryFeeCents,
  loyaltyPointsCents = 0,
}: {
  tournamentId: string
  /** Entry fee, for computing how much a points redemption would cover. */
  entryFeeCents?: number
  /** The signed-in player's current loyalty_points balance, in cents. */
  loyaltyPointsCents?: number
}) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [usePoints, setUsePoints] = useState(false)

  const redeemableCents =
    entryFeeCents !== undefined ? Math.min(loyaltyPointsCents, entryFeeCents) : 0

  function handleEnter() {
    startTransition(async () => {
      const result = await enterTournamentAction(tournamentId, usePoints ? redeemableCents : 0)
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <span className="text-sm font-bold text-primary">You&apos;re in ✓</span>
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {redeemableCents > 0 && (
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={usePoints}
            onChange={(e) => setUsePoints(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Use {formatCents(loyaltyPointsCents)} in points ({formatCents(redeemableCents)} off)
        </label>
      )}
      <Button size="sm" onClick={handleEnter} disabled={pending}>
        {pending ? "Entering…" : "Enter"}
      </Button>
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
    </div>
  )
}
