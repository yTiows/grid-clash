"use client"

import { useEffect, useState } from "react"
import Link from "next/link"

import { GameBoard } from "@/components/game/board"
import { CoinFlip } from "@/components/game/coin-flip"
import { MiniBoard } from "@/components/game/mini-board"
import { StartCountdown } from "@/components/game/start-countdown"
import { Confetti } from "@/components/game/win-celebration"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { chooseBotMove } from "@/lib/game/bot"
import {
  applyMove,
  applyTimeout,
  createGame,
  redactStateFor,
  type GameState,
  type PieceKind,
  type PlayerSlot,
} from "@/lib/game/engine"
import { CLASSIC, RULESETS } from "@/lib/game/rulesets"

type Stage = "setup" | "ritual" | "countdown" | "playing" | "over"

/** No server clock to match here (see start-countdown.tsx) — 3s reads the
 * same as ranked's MATCH_START_GRACE_MS for a consistent feel across both. */
const COUNTDOWN_MS = 3000

/**
 * Floor on the per-move clock in practice specifically — ranked/tournament
 * timing (3s Blitz, 5s Classic, up to 8s Sprawl) is untouched, it's a real
 * competitive mechanic ("Blitz: read faster") that shouldn't quietly change
 * everywhere just because practice felt rushed. This page's own setup copy
 * already promises "no clock pressure you can't reset by refreshing," but
 * it was silently running the exact same tight ranked clock underneath —
 * Math.max means a format's own timeout still applies if it's already
 * longer than this (nothing currently is), and every practice format gets
 * genuine breathing room to actually think, not just react.
 */
const PRACTICE_MIN_MOVE_TIMEOUT_MS = 15_000

const PRACTICE_FORMAT_IDS = ["classic", "blitz", "gambit", "feint", "demolition", "fortress", "shuffle"]

/**
 * Free, offline, no stakes, no server round trip — see bot.ts's header for
 * why this exists instead of a house bot that plays for money. Reuses the
 * exact GameBoard component ranked matches use; the only thing different
 * from a real match is what's on the other side of the board.
 */
export default function PracticePage() {
  const [stage, setStage] = useState<Stage>("setup")
  const [rulesetId, setRulesetId] = useState("classic")
  const [game, setGame] = useState<GameState>(() => createGame(CLASSIC))
  const [humanSlot, setHumanSlot] = useState<PlayerSlot>(1)
  const [turnDeadline, setTurnDeadline] = useState<number>(() => Date.now() + CLASSIC.moveTimeoutMs)

  const botSlot: PlayerSlot = humanSlot === 1 ? 2 : 1

  function startMatch(id: string) {
    const base = RULESETS[id] ?? CLASSIC
    const ruleset = {
      ...base,
      moveTimeoutMs: Math.max(base.moveTimeoutMs, PRACTICE_MIN_MOVE_TIMEOUT_MS),
    }
    setGame(createGame(ruleset))
    setHumanSlot(Math.random() < 0.5 ? 1 : 2)
    setStage("ritual")
  }

  // Deadline resets on every move, by either side — same as the real
  // server's advanceTurn. Gated on "playing" so the ritual/countdown beat
  // before the first move doesn't silently burn real clock time: the
  // deadline is only ever computed from the moment the board actually goes
  // interactive, never from when the match object was created.
  useEffect(() => {
    if (stage !== "playing") return
    setTurnDeadline(Date.now() + game.ruleset.moveTimeoutMs)
  }, [stage, game.moveNumber, game.ruleset.moveTimeoutMs])

  // Human's clock. A real timeout, not just a display — forfeits a piece
  // and passes the turn, exactly like a real match (applyTimeout).
  useEffect(() => {
    if (stage !== "playing" || game.status !== "active" || game.turn !== humanSlot) return
    const msLeft = Math.max(0, turnDeadline - Date.now())
    const t = setTimeout(() => {
      setGame((g) => (g.status === "active" && g.turn === humanSlot ? applyTimeout(g, humanSlot) : g))
    }, msLeft)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.moveNumber, game.turn, game.status, turnDeadline, stage, humanSlot])

  // Bot's turn. A short delay so a move doesn't appear to teleport in —
  // this is a UI courtesy, not a rule; the bot doesn't get its own clock.
  useEffect(() => {
    if (stage !== "playing" || game.status !== "active" || game.turn !== botSlot) return
    const t = setTimeout(() => {
      setGame((g) => {
        if (g.status !== "active" || g.turn !== botSlot) return g
        const move = chooseBotMove(g, botSlot)
        const result = applyMove(g, botSlot, move)
        return result.ok ? result.state : g
      })
    }, 450 + Math.random() * 500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.moveNumber, game.turn, game.status, stage, botSlot])

  useEffect(() => {
    if (stage === "playing" && game.status !== "active") setStage("over")
  }, [game.status, stage])

  function handleHumanMove(kind: PieceKind, index: number, targetIndex?: number) {
    setGame((g) => {
      if (g.turn !== humanSlot || g.status !== "active") return g
      const result = applyMove(g, humanSlot, { kind, index, targetIndex })
      return result.ok ? result.state : g
    })
  }

  if (stage === "setup") {
    return (
      <div className="container flex min-h-screen flex-col items-center justify-center py-12">
        <div className="panel w-full max-w-md space-y-4 p-6">
          <div>
            <h1 className="display text-2xl">Practice</h1>
            <p className="text-sm text-muted-foreground">
              Free, offline, against a simple bot — no stake, no clock pressure you can&apos;t
              reset by refreshing. Good for trying a format before you queue for real.
            </p>
          </div>

          <div className="space-y-1.5">
            {PRACTICE_FORMAT_IDS.map((id) => {
              const r = RULESETS[id]
              if (!r) return null
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setRulesetId(id)}
                  className={`panel panel-interactive flex w-full items-center justify-between px-4 py-2.5 text-left text-sm ${
                    rulesetId === id ? "border-primary" : ""
                  }`}
                >
                  <span className="font-semibold">{r.name}</span>
                  <span className="text-xs text-muted-foreground">{r.blurb}</span>
                </button>
              )
            })}
          </div>

          <Button size="lg" className="w-full" onClick={() => startMatch(rulesetId)}>
            Play vs bot
          </Button>
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/dashboard">Back to lobby</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="container flex min-h-screen flex-col items-center justify-center py-12">
      <div className="w-full max-w-md">
        {stage === "ritual" && (
          <CoinFlip youFirst={humanSlot === 1} onDone={() => setStage("countdown")} />
        )}

        {stage === "countdown" && (
          <StartCountdown durationMs={COUNTDOWN_MS} onDone={() => setStage("playing")} />
        )}

        {stage === "playing" && (
          <div className="panel space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge variant="muted">Practice · vs Bot</Badge>
                <span className="text-xs text-muted-foreground">{game.ruleset.name}</span>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStage("setup")}>
                Quit
              </Button>
            </div>
            <GameBoard
              state={redactStateFor(game, humanSlot)}
              turnDeadline={turnDeadline}
              onMove={handleHumanMove}
            />
          </div>
        )}

        {stage === "over" && (
          <div className="panel space-y-5 p-8 text-center">
            {game.status === `player_${humanSlot}_won` && <Confetti />}
            <div className="flex justify-center">
              <Badge variant="muted">Practice · vs Bot</Badge>
            </div>
            {(() => {
              const won = game.status === `player_${humanSlot}_won`
              const isDraw = game.status === "draw"
              return (
                <div
                  className={`display text-3xl ${isDraw ? "text-foreground" : won ? "text-primary" : "text-rival"}`}
                >
                  {isDraw ? "Draw" : won ? "Victory" : "Beaten on the board"}
                </div>
              )
            })()}

            <MiniBoard board={game.board} you={humanSlot} winningLine={game.winningLine} />

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button size="lg" onClick={() => startMatch(rulesetId)}>
                Play again
              </Button>
              <Button variant="outline" size="lg" onClick={() => setStage("setup")}>
                Change format
              </Button>
              <Button variant="ghost" size="lg" asChild>
                <Link href="/dashboard">Back to lobby</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
