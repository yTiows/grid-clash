"use client"

import Link from "next/link"
import { useParams } from "next/navigation"

import { SpectatorBoard } from "@/components/game/spectator-board"
import { Button } from "@/components/ui/button"
import { useSpectatorSocket } from "@/lib/game/use-spectator-socket"

/**
 * v1, deliberately minimal: this page requires knowing a matchId (a shared
 * link), not a "browse live matches" surface — that needs the web app to
 * see the WS match server's live match list, which is a cross-process API
 * this codebase doesn't have yet (see detect-automation's own note on the
 * same gap for concurrentPlayers). Watching a specific match, once you have
 * its id, doesn't need that.
 */
export default function WatchPage() {
  const params = useParams<{ matchId: string }>()
  const matchId = params.matchId

  const state = useSpectatorSocket(matchId)

  return (
    <div className="container flex min-h-screen flex-col items-center justify-center py-12">
      <div className="w-full max-w-md space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold tracking-tight">Spectating</span>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard">Back to lobby</Link>
          </Button>
        </div>

        {state.phase === "connecting" && (
          <div className="panel p-8 text-center text-sm text-muted-foreground">Connecting…</div>
        )}

        {(state.phase === "watching" || state.phase === "over") && state.gameState && (
          <div className="panel space-y-4 p-5">
            <SpectatorBoard state={state.gameState} turnDeadline={state.turnDeadline} />
            {state.phase === "over" && (
              <div className="display text-center text-2xl text-primary">
                {state.winnerSlot ? `Player ${state.winnerSlot} wins` : "Draw"}
              </div>
            )}
          </div>
        )}

        {state.phase === "error" && (
          <div className="panel space-y-4 p-8 text-center">
            <p className="text-rival">{state.errorMessage ?? "This match isn't available to watch."}</p>
            <Button asChild>
              <Link href="/dashboard">Back to lobby</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
