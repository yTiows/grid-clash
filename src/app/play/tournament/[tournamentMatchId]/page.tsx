"use client"

import { useEffect } from "react"
import { useParams, useRouter } from "next/navigation"

import { GameBoard } from "@/components/game/board"
import { MatchResultCard } from "@/components/game/match-result"
import { Button } from "@/components/ui/button"
import { useMatchSocket } from "@/lib/game/use-match-socket"

export default function TournamentPlayPage() {
  const router = useRouter()
  const params = useParams<{ tournamentMatchId: string }>()
  const tournamentMatchId = params.tournamentMatchId

  const { state, connectTournament, submitMove, resign, disconnect } = useMatchSocket()

  useEffect(() => {
    if (tournamentMatchId && state.phase === "idle") {
      void connectTournament(tournamentMatchId)
    }
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tournamentMatchId])

  return (
    <div className="halftone relative min-h-screen">
      <div className="container relative flex min-h-screen flex-col items-center justify-center py-12">
        <div className="w-full max-w-md">
          {(state.phase === "connecting" || state.phase === "tournament_waiting") && (
            <div className="sticker space-y-4 p-8 text-center">
              <div className="display text-2xl text-primary">
                {state.phase === "connecting" ? "Connecting…" : "Waiting for your opponent"}
              </div>
              <p className="text-sm text-muted-foreground">
                The match starts the moment they&apos;re here too.
              </p>
              <div className="mx-auto h-2 w-32 overflow-hidden rounded-full border border-ink bg-black/30">
                <div className="h-full w-1/3 animate-pulse bg-primary" />
              </div>
            </div>
          )}

          {(state.phase === "matched" || state.phase === "disconnected") && state.gameState && (
            <div className="sticker space-y-4 p-5">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-muted-foreground">Opponent</div>
                  <div className="font-bold">{state.opponent?.username}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-muted-foreground">Elo</div>
                  <div className="tabular font-bold">{state.opponent?.eloRating}</div>
                </div>
              </div>

              {state.opponentDisconnected && (
                <div className="rounded-md border-2 border-gold bg-gold/10 p-2 text-center text-xs font-bold text-gold">
                  Opponent disconnected. The clock is still running — if they don&apos;t return in
                  time, you advance.
                </div>
              )}

              {state.phase === "disconnected" && (
                <div className="rounded-md border-2 border-rival bg-rival/10 p-2 text-center text-xs font-bold text-rival">
                  Reconnecting…
                </div>
              )}

              {state.turnDeadline && (
                <GameBoard
                  state={state.gameState}
                  turnDeadline={state.turnDeadline}
                  onMove={(kind, index, targetIndex) =>
                    submitMove(state.matchId!, kind, index, targetIndex)
                  }
                />
              )}

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-rival"
                onClick={() => state.matchId && resign(state.matchId)}
              >
                Forfeit
              </Button>
            </div>
          )}

          {state.phase === "over" && state.result && (
            <MatchResultCard result={state.result} backHref="/dashboard/tournaments" />
          )}

          {state.phase === "error" && (
            <div className="sticker space-y-4 p-8 text-center">
              <p className="text-rival">{state.errorMessage}</p>
              <Button onClick={() => router.push("/dashboard/tournaments")}>Back to tournaments</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
