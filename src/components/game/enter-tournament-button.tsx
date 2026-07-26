"use client"

import { useState, useTransition } from "react"

import { enterTournamentAction } from "@/actions/tournaments"
import { Button } from "@/components/ui/button"

export function EnterTournamentButton({ tournamentId }: { tournamentId: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  function handleEnter() {
    startTransition(async () => {
      const result = await enterTournamentAction(tournamentId)
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <span className="text-sm font-bold text-primary">You&apos;re in ✓</span>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={handleEnter} disabled={pending}>
        {pending ? "Entering…" : "Enter"}
      </Button>
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
    </div>
  )
}
