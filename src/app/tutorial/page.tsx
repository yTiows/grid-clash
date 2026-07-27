"use client"

/**
 * Tutorial mode (CLAUDE_CODE_BRIEF.md §4.8).
 *
 * A one-time, stateless onboarding walkthrough — not an ongoing free-to-play
 * mode. No Supabase, no server actions, no persistence: nothing here is worth
 * protecting from the player themselves, so it never needs to be
 * authoritative. It drives the exact same board rules as real play
 * (createGame / applyMove / applyTimeout / redactStateFor from
 * @/lib/game/engine) and renders them with the exact same UI components real
 * ranked and tournament play use (GameBoard, PieceTray) — see board.tsx and
 * piece-tray.tsx. The only thing missing, deliberately, is
 * use-match-socket.ts: no WebSocket, no match server, no stake, because
 * nothing of value is at risk here.
 *
 * Three stages: learn the pieces, play a local board against a scripted
 * bot, then see what a tournament looks like and a way out to real play.
 */

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"

import { GameBoard } from "@/components/game/board"
import { PieceTray } from "@/components/game/piece-tray"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CONTEST_FEE_BPS, calculatePrizePool, formatCents } from "@/lib/game/fees"
import { applyMove, applyTimeout, createGame, redactStateFor } from "@/lib/game/engine"
import type { GameState, Move, PieceKind, PlayerSlot } from "@/lib/game/engine"
import { CLASSIC } from "@/lib/game/rulesets"

const PLAYER: PlayerSlot = 1
const BOT: PlayerSlot = 2

/** How long the bot "thinks" before answering. Always well inside the 5s clock. */
const BOT_THINK_MS = 900

const PIECE_COPY: Record<PieceKind, { title: string; body: string }> = {
  normal: { title: "Place", body: "Occupies an empty cell. You start with 8." },
  shield: {
    title: "Shield",
    body: "Occupies a cell that can't be bombed or swapped. One per match.",
  },
  bomb: { title: "Bomb", body: "Clears an unshielded opponent cell. One per match." },
  swap: {
    title: "Swap",
    body: "Trades an unshielded cell with one of the opponent's. One per match.",
  },
}

/**
 * Every structurally possible move on the board — not every *legal* one.
 * Ownership, shield, and occupancy rules are already encoded once, in
 * engine.ts's applyMove(). Reimplementing them here just to pick a bot move
 * would be a second copy of the rules that can drift from the first, which
 * is exactly the kind of duplication this codebase has been damaged by
 * before. Instead the bot proposes candidates and asks applyMove() — the
 * same function the server trusts — whether each one is actually legal.
 */
function enumerateCandidates(boardSize: number): Move[] {
  const cells = boardSize * boardSize
  const moves: Move[] = []
  for (let i = 0; i < cells; i++) {
    moves.push({ kind: "normal", index: i })
    moves.push({ kind: "shield", index: i })
    moves.push({ kind: "bomb", index: i })
  }
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if (i !== j) moves.push({ kind: "swap", index: i, targetIndex: j })
    }
  }
  return moves
}

/**
 * Picks a uniformly random legal move for the bot by shuffling every
 * candidate shape and returning the first one applyMove() accepts.
 */
function pickBotMove(state: GameState): Move | null {
  const candidates = enumerateCandidates(state.ruleset.boardSize)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    // Indices are always in bounds: i counts down from length-1 and j is
    // drawn from [0, i], so noUncheckedIndexedAccess's Move|undefined here
    // is a real guarantee the loop already provides.
    ;[candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!]
  }
  for (const move of candidates) {
    if (applyMove(state, BOT, move).ok) return move
  }
  return null
}

const MOCK_TOURNAMENT = {
  name: "Example: Friday Night Classic",
  entryFeeCents: 2000,
  fieldSize: 32,
  formatId: "single_elimination",
}

/**
 * A mock/example tournament card, styled with the same Card/Badge components
 * the real /dashboard/tournaments cards use (see EnterTournamentButton and
 * that page for the live version), but with no entry action and no DB read —
 * it exists to show a brand-new player the shape of a bracket contest
 * (entry fee, prize pool, fee, field size) before they've ever seen one.
 * The numbers are real math (calculatePrizePool, the same function real
 * tournament cards are built from) run on made-up inputs, not fabricated
 * figures — labeled unambiguously as a preview in three separate ways below:
 * the badge, the disabled button, and the prose.
 */
function MockTournamentPreview() {
  const pool = calculatePrizePool(
    "tournament_standard",
    MOCK_TOURNAMENT.entryFeeCents,
    MOCK_TOURNAMENT.fieldSize
  )
  const feePercent = CONTEST_FEE_BPS.tournament_standard / 100

  return (
    <Card className="border-dashed">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg">{MOCK_TOURNAMENT.name}</CardTitle>
          <Badge variant="outline">Preview</Badge>
        </div>
        <p className="text-xs text-muted-foreground">{CLASSIC.blurb}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Entry</div>
            <div className="tabular font-bold">{formatCents(MOCK_TOURNAMENT.entryFeeCents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Prize pool</div>
            <div className="tabular font-bold text-gold">{formatCents(pool.prizePoolCents)}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Fee</div>
            <div className="tabular">{feePercent}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Field size</div>
            <div>{MOCK_TOURNAMENT.fieldSize} players</div>
          </div>
        </div>
        <p className="text-xs capitalize text-muted-foreground">
          Format: {MOCK_TOURNAMENT.formatId.replace(/_/g, " ")}
        </p>
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="outline" disabled>
            Example only — not enterable
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

type Stage = "intro" | "board" | "done"

export default function TutorialPage() {
  const [stage, setStage] = useState<Stage>("intro")
  const [focusedPiece, setFocusedPiece] = useState<PieceKind>("normal")
  const [game, setGame] = useState<GameState>(() => createGame(CLASSIC))
  const [turnDeadline, setTurnDeadline] = useState(() => Date.now() + CLASSIC.moveTimeoutMs)

  const redacted = useMemo(() => redactStateFor(game, PLAYER), [game])

  const outcome = useMemo(() => {
    switch (game.status) {
      case "player_1_won":
        return { heading: "Victory", body: "You connected the line.", className: "text-primary" }
      case "player_2_won":
        return {
          heading: "Beaten on the read",
          body: "The bot connected the line first.",
          className: "text-rival",
        }
      case "draw":
        return { heading: "Draw", body: "Board filled with no line completed.", className: "" }
      default:
        return { heading: "Board complete", body: "", className: "" }
    }
  }, [game.status])

  // Turn clock: mirrors the real 5-second-per-move rule with the same
  // applyTimeout() the server calls, for both sides. The bot always answers
  // well inside the window (see the effect below), so in practice this only
  // ever fires against the player — same as it would in a real match.
  useEffect(() => {
    if (stage !== "board" || game.status !== "active") return
    const timeoutMs = game.ruleset.moveTimeoutMs
    setTurnDeadline(Date.now() + timeoutMs)
    const timer = setTimeout(() => {
      setGame((current) =>
        current.status === "active" ? applyTimeout(current, current.turn) : current
      )
    }, timeoutMs)
    return () => clearTimeout(timer)
  }, [stage, game.status, game.moveNumber, game.ruleset.moveTimeoutMs])

  // Opponent-simulation decision: a scripted random-legal-move bot, not a
  // pass-and-play "play both sides" mode. Reasoning: the emotional core of
  // this game (BRAND.md §5) is reading an opponent under hidden information
  // and a clock — a shared-screen mode where the same person plays both
  // sides teaches turn-taking, not that. A bot that always answers keeps the
  // walkthrough moving without asking a brand-new player to role-play their
  // own opponent. It's also the smaller amount of code: no second board
  // state, no "pass the device" screen, just the existing engine functions
  // called for slot 2 on a short delay.
  useEffect(() => {
    if (stage !== "board" || game.status !== "active" || game.turn !== BOT) return
    const timer = setTimeout(() => {
      setGame((current) => {
        if (current.status !== "active" || current.turn !== BOT) return current
        const move = pickBotMove(current)
        if (!move) return current
        const result = applyMove(current, BOT, move)
        return result.ok ? result.state : current
      })
    }, BOT_THINK_MS)
    return () => clearTimeout(timer)
  }, [stage, game.status, game.turn, game.moveNumber])

  // Advance to the completion step once the local match ends.
  useEffect(() => {
    if (stage === "board" && game.status !== "active") setStage("done")
  }, [stage, game.status])

  function handleMove(kind: PieceKind, index: number, targetIndex?: number) {
    setGame((current) => {
      if (current.status !== "active" || current.turn !== PLAYER) return current
      const result = applyMove(current, PLAYER, { kind, index, targetIndex })
      return result.ok ? result.state : current
    })
  }

  function resetBoard() {
    setGame(createGame(CLASSIC))
    setStage("board")
  }

  return (
    <div className="halftone relative min-h-screen">
      <header className="container relative flex items-center justify-between py-6">
        <Link href="/" className="display text-2xl text-primary">
          Grid Clash
        </Link>
        <Button variant="ghost" asChild>
          <Link href="/dashboard">Skip tutorial</Link>
        </Button>
      </header>

      <main className="container relative mx-auto max-w-xl space-y-8 pb-20">
        <div className="flex items-center justify-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          <span className={stage === "intro" ? "text-primary" : undefined}>1. Pieces</span>
          <span>—</span>
          <span className={stage === "board" ? "text-primary" : undefined}>2. Board</span>
          <span>—</span>
          <span className={stage === "done" ? "text-primary" : undefined}>3. Tournaments</span>
        </div>

        {stage === "intro" && (
          <Card>
            <CardHeader>
              <CardTitle>Learn the board</CardTitle>
              <p className="text-sm text-muted-foreground">
                5×5 grid. Connect four in a row — across, up-down, or diagonal — before your
                opponent does. Both sides hold the same four piece kinds every match.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <PieceTray
                inventory={CLASSIC.inventory}
                selected={focusedPiece}
                onSelect={setFocusedPiece}
                disabled={false}
              />
              <div className="sticker p-4">
                <div className="display text-sm text-primary">
                  {PIECE_COPY[focusedPiece].title}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {PIECE_COPY[focusedPiece].body}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Your opponent&apos;s inventory stays hidden. You&apos;ll see how many pieces they
                have left, never which ones.
              </p>
              <Button size="lg" className="w-full" onClick={() => setStage("board")}>
                Try the board
              </Button>
            </CardContent>
          </Card>
        )}

        {stage === "board" && (
          <div className="sticker space-y-4 p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-muted-foreground">You</div>
                <div className="font-bold text-primary">Player One</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Opponent</div>
                <div className="font-bold text-rival">Bot</div>
              </div>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Five seconds a move — same clock as a real match. No entry fee, nothing on the
              line.
            </p>

            <GameBoard state={redacted} turnDeadline={turnDeadline} onMove={handleMove} />

            <Button variant="ghost" size="sm" className="w-full" onClick={resetBoard}>
              Start over
            </Button>
          </div>
        )}

        {stage === "done" && (
          <div className="space-y-6">
            <div className="sticker space-y-3 p-8 text-center">
              <div className={`display text-3xl ${outcome.className}`}>{outcome.heading}</div>
              {outcome.body && <p className="text-sm text-muted-foreground">{outcome.body}</p>}
              <Button variant="outline" size="sm" onClick={resetBoard}>
                Run the board again
              </Button>
            </div>

            <div className="space-y-3">
              <h2 className="display text-xl">What a tournament looks like</h2>
              <p className="text-sm text-muted-foreground">
                Ranked is one match, one stake. A tournament is a bracket built from one entry
                fee per player, paying out a shared prize pool. Here&apos;s the shape of one —
                this card is a worked example, not a live contest. It can&apos;t be entered.
              </p>
              <MockTournamentPreview />
            </div>

            <div className="sticker space-y-3 p-6 text-center">
              <p className="text-sm text-muted-foreground">Ready to play for real?</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
                <Button size="lg" asChild>
                  <Link href="/dashboard">Go to the dashboard</Link>
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link href="/dashboard/tournaments">Browse tournaments</Link>
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                New here?{" "}
                <Link href="/signup" className="font-bold text-primary hover:underline">
                  Create an account
                </Link>
              </p>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
