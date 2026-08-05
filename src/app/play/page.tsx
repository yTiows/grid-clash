"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import { CoinFlip } from "@/components/game/coin-flip"
import { GameBoard } from "@/components/game/board"
import { MatchResultCard } from "@/components/game/match-result"
import { StartCountdown } from "@/components/game/start-countdown"
import { Button } from "@/components/ui/button"
import { formatCents } from "@/lib/game/fees"
import { MATCH_START_GRACE_MS, RANKED_RULESET_IDS, type RankedRulesetId } from "@/lib/game/protocol"
import { useMatchSocket } from "@/lib/game/use-match-socket"

function isRankedRulesetId(value: string | null): value is RankedRulesetId {
  return (RANKED_RULESET_IDS as readonly string[]).includes(value ?? "")
}

function PlayPageInner() {
  const router = useRouter()
  const params = useSearchParams()
  const stakeCents = Number(params.get("stake") ?? 0)
  const formatParam = params.get("format")
  const rulesetId: RankedRulesetId = isRankedRulesetId(formatParam) ? formatParam : "classic"

  const { state, connect, leaveQueue, submitMove, resign, disconnect } = useMatchSocket()
  const [ritualDismissedFor, setRitualDismissedFor] = useState<string | null>(null)
  const showRitual =
    state.phase === "matched" &&
    !!state.matchId &&
    !!state.gameState &&
    state.gameState.moveNumber === 0 &&
    !state.suddenDeath &&
    ritualDismissedFor !== state.matchId

  // The beat after the coin flip and before the board goes interactive —
  // durationMs matches match-server.ts's MATCH_START_GRACE_MS, which is
  // already baked into turnDeadline for this first move, so the visible
  // countdown and the real clock run out together.
  const [countdownDoneFor, setCountdownDoneFor] = useState<string | null>(null)
  const showCountdown =
    state.phase === "matched" &&
    !!state.matchId &&
    !!state.gameState &&
    state.gameState.moveNumber === 0 &&
    !state.suddenDeath &&
    ritualDismissedFor === state.matchId &&
    countdownDoneFor !== state.matchId

  useEffect(() => {
    if (stakeCents > 0 && state.phase === "idle") {
      void connect(stakeCents, rulesetId)
    }
    return () => {
      disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stakeCents, rulesetId])

  if (!stakeCents) {
    return (
      <div className="mx-auto max-w-sm py-20 text-center">
        <p className="text-muted-foreground">No stake selected.</p>
        <Button className="mt-4" onClick={() => router.push("/dashboard")}>
          Back to lobby
        </Button>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen">
      <div className="container relative flex min-h-screen flex-col items-center justify-center py-12">
        <div className="w-full max-w-md">
          {(state.phase === "connecting" || state.phase === "queued") && (
            <div className="panel space-y-4 p-8 text-center">
              <div className="display text-2xl text-primary">
                {state.phase === "connecting" ? "Connecting…" : "Finding an opponent"}
              </div>
              <p className="text-sm text-muted-foreground">
                Stake {formatCents(stakeCents)}
                {state.queuePosition ? ` · position ${state.queuePosition}` : ""}
              </p>
              <div className="mx-auto h-2 w-32 overflow-hidden rounded-full border border-border bg-black/30">
                <div className="h-full w-1/3 animate-pulse bg-primary" />
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  leaveQueue()
                  router.push("/dashboard")
                }}
              >
                Cancel
              </Button>
            </div>
          )}

          {(state.phase === "matched" || state.phase === "disconnected") &&
            state.gameState &&
            (showRitual ? (
              <CoinFlip
                youFirst={state.gameState.turn === state.gameState.you}
                onDone={() => setRitualDismissedFor(state.matchId)}
              />
            ) : showCountdown ? (
              <StartCountdown
                durationMs={MATCH_START_GRACE_MS}
                onDone={() => setCountdownDoneFor(state.matchId)}
              />
            ) : (
              <div className="panel space-y-4 p-5">
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

              {state.suddenDeath && (
                <div className="rounded-md border border-accent bg-accent/10 p-2 text-center text-xs font-medium text-accent">
                  Board filled with no line — sudden death. Fresh board, same stake.
                </div>
              )}

              {state.opponentDisconnected && (
                <div className="rounded-md border-2 border-gold bg-gold/10 p-2 text-center text-xs font-bold text-gold">
                  Opponent disconnected. The clock is still running — if they don&apos;t return in
                  time, the match settles in your favor.
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
                Resign
              </Button>
              </div>
            ))}

          {state.phase === "over" && state.result && (
            <MatchResultCard
              result={state.result}
              matchId={state.matchId ?? undefined}
              onPlayAgain={() => void connect(stakeCents, rulesetId)}
              showPerformanceGap
            />
          )}

          {state.phase === "error" && (
            <div className="panel space-y-4 p-8 text-center">
              <p className="text-rival">{state.errorMessage}</p>
              <Button onClick={() => router.push("/dashboard")}>Back to lobby</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


export default function PlayPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted-foreground">
          Loading…
        </div>
      }
    >
      <PlayPageInner />
    </Suspense>
  )
}
