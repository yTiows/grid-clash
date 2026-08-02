"use client"

import { useState, useTransition } from "react"

import { completeTournamentAction } from "@/actions/admin-tournaments"
import { Button } from "@/components/ui/button"

interface Entrant {
  userId: string
  username: string
}

export function CompleteTournamentForm({
  tournamentId,
  entrants,
}: {
  tournamentId: string
  entrants: Entrant[]
}) {
  const [ordered, setOrdered] = useState<Entrant[]>(entrants)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  function move(index: number, delta: number) {
    setOrdered((current) => {
      const next = [...current]
      const target = index + delta
      if (target < 0 || target >= next.length) return current
      const [item] = next.splice(index, 1)
      if (item) next.splice(target, 0, item)
      return next
    })
  }

  function handleComplete() {
    startTransition(async () => {
      const result = await completeTournamentAction(
        tournamentId,
        ordered.map((e) => e.userId)
      )
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <p className="text-sm font-bold text-primary">{message.text}</p>
  }

  return (
    <div className="space-y-3 rounded-md border-2 border-white/15 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Finish order (1st place first)
      </p>
      {ordered.map((entrant, i) => (
        <div key={entrant.userId} className="flex items-center justify-between text-sm">
          <span>
            {i + 1}. {entrant.username}
          </span>
          <div className="flex gap-1">
            <Button size="sm" variant="outline" onClick={() => move(i, -1)} disabled={i === 0}>
              ↑
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => move(i, 1)}
              disabled={i === ordered.length - 1}
            >
              ↓
            </Button>
          </div>
        </div>
      ))}
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
      <Button size="sm" onClick={handleComplete} disabled={pending || ordered.length === 0}>
        {pending ? "Completing…" : "Complete & pay out"}
      </Button>
    </div>
  )
}
