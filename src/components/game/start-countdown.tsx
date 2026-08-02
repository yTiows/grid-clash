"use client"

import { useEffect, useState } from "react"

const TICK_MS = 1000

/**
 * The beat between "you move first" (or a sudden-death reveal) and the turn
 * clock actually starting. Without this the timer is already draining the
 * instant the coin flip resolves — no room to even register who moves first
 * before also having to decide what to play.
 *
 * durationMs should match the server's grace window (protocol.ts's
 * MATCH_START_GRACE_MS) for a ranked/tournament match — the real
 * turnDeadline already has that grace baked in, so this is purely the
 * visible half of it. Practice has no server clock to match and can pass
 * whatever feels right.
 */
export function StartCountdown({ durationMs, onDone }: { durationMs: number; onDone: () => void }) {
  const [remaining, setRemaining] = useState(Math.max(1, Math.ceil(durationMs / TICK_MS)))

  useEffect(() => {
    if (remaining <= 0) {
      const t = setTimeout(onDone, 450)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setRemaining((n) => n - 1), TICK_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining])

  return (
    <div className="panel flex flex-col items-center gap-4 p-10 text-center">
      <div key={remaining} className="display animate-countdown-pop text-6xl text-primary">
        {remaining > 0 ? remaining : "Go"}
      </div>
      <p className="text-sm text-muted-foreground">Get ready…</p>
    </div>
  )
}
