"use client"

import { useEffect, useState } from "react"

import type { SpectatorGameState } from "@/lib/game/engine"
import { cn } from "@/lib/utils"

/** Read-only — no click handlers, no legality highlighting. A spectator
 * doesn't get an affordance to imply they could move. */
export function SpectatorBoard({
  state,
  turnDeadline,
}: {
  state: SpectatorGameState
  turnDeadline: number | null
}) {
  const boardSize = Math.sqrt(state.board.length)
  const [remainingMs, setRemainingMs] = useState(0)

  useEffect(() => {
    if (!turnDeadline) return
    const tick = () => setRemainingMs(Math.max(0, turnDeadline - Date.now()))
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [turnDeadline])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold">
          Player {state.turn}&apos;s move
        </span>
        {turnDeadline && (
          <span className="tabular text-xs text-muted-foreground">
            {(remainingMs / 1000).toFixed(1)}s · move {state.moveNumber + 1}
          </span>
        )}
      </div>

      <div
        className="mx-auto grid max-w-md gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
      >
        {state.board.map((cell, i) => (
          <div
            key={i}
            className={cn(
              "cell aspect-square w-full",
              cell && (cell.owner === 1 ? "cell-p1" : "cell-p2"),
              state.winningLine?.includes(i) && "cell-winning ring-2 ring-gold"
            )}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Player 1 pieces: <span className="tabular text-foreground">{state.player1PiecesRemaining}</span>
        </span>
        <span>
          Player 2 pieces: <span className="tabular text-foreground">{state.player2PiecesRemaining}</span>
        </span>
      </div>
    </div>
  )
}
