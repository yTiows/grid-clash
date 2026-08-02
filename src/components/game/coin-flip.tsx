"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

const SPIN_MS = 900
const HOLD_MS = 900

/**
 * Who moves first is decided server-side by a coin flip seeded from the
 * match id (see match-server.ts's coinFlipGivesFirstSlotTo) — this is
 * purely the reveal. The point isn't the animation, it's the sentence at
 * the end: before either player has made a decision, both should be able
 * to see that the edge of moving first was handed out fairly.
 */
export function CoinFlip({ youFirst, onDone }: { youFirst: boolean; onDone: () => void }) {
  const [settled, setSettled] = useState(false)

  useEffect(() => {
    const settle = setTimeout(() => setSettled(true), SPIN_MS)
    const done = setTimeout(onDone, SPIN_MS + HOLD_MS)
    return () => {
      clearTimeout(settle)
      clearTimeout(done)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="panel flex flex-col items-center gap-5 p-10 text-center">
      <div
        className={cn(
          "flex h-16 w-16 items-center justify-center rounded-full border border-border-strong text-xl font-semibold",
          settled ? (youFirst ? "bg-primary text-primary-foreground" : "bg-rival text-rival-foreground") : "bg-secondary"
        )}
        style={
          settled
            ? undefined
            : { animation: `coin-spin ${SPIN_MS}ms cubic-bezier(0.3, 0, 0.2, 1) forwards` }
        }
      >
        {settled ? (youFirst ? "Y" : "O") : ""}
      </div>
      <p className="text-sm text-muted-foreground">
        {settled ? (
          <span className="font-medium text-foreground">
            {youFirst ? "You move first." : "Opponent moves first."}
          </span>
        ) : (
          "Flipping for first move…"
        )}
      </p>
    </div>
  )
}
