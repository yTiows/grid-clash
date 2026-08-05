"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { FileDisputeButton } from "@/components/game/file-dispute-button"
import { MiniBoard } from "@/components/game/mini-board"
import { Confetti, PayoutCheck } from "@/components/game/win-celebration"
import { formatCents } from "@/lib/game/fees"
import type { MatchResult as Result } from "@/lib/game/use-match-socket"

/**
 * Loss states never attribute outcomes to luck. "Better luck next time" from
 * a skill-contest operator undercuts its own classification. These attribute
 * to play.
 */
const REASON_COPY: Record<string, { won: string; lost: string; draw: string }> = {
  line: { won: "You connected the line.", lost: "They connected the line first.", draw: "" },
  resign: { won: "Opponent resigned.", lost: "You resigned.", draw: "" },
  abandon: { won: "Opponent left the match.", lost: "You disconnected.", draw: "" },
  no_legal_moves: { won: "They ran out of legal moves.", lost: "You ran out of legal moves.", draw: "" },
  board_full: { won: "", lost: "", draw: "Board filled with no line." },
}

export function MatchResultCard({
  result,
  matchId,
  onPlayAgain,
  backHref = "/dashboard",
}: {
  result: Result
  /** Ranked matches only — a tournament result has no dispute affordance here. */
  matchId?: string
  /** Omitted for tournament results — there's no queue to rejoin. */
  onPlayAgain?: () => void
  backHref?: string
}) {
  const copy = REASON_COPY[result.reason]
  const message =
    result.result === "draw"
      ? (copy?.draw ?? "Draw.")
      : result.result === "won"
        ? (copy?.won ?? "You won.")
        : (copy?.lost ?? "You lost.")

  const isWin = result.result === "won"
  const isDraw = result.result === "draw"
  // Tracked separately, not as one combined "ranked terms" flag: a wager
  // result always has a payout (real money moved) but never an eloDelta
  // (settle_wager_match deliberately doesn't touch it) — a flag that
  // required both present would silently hide the payout, the win
  // celebration, and the dispute affordance on every wager win.
  const hasPayout = result.payoutCents !== undefined
  const hasEloDelta = result.eloDelta !== undefined
  const hasMoneyTerms = hasPayout || hasEloDelta

  // The full check-and-confetti treatment is reserved for a real ranked/
  // tournament/wager win with a nonzero payout — never for practice (no real
  // money to reveal) and never for a loss/draw (BRAND.md §6: result screens
  // stay "flat and factual," no celebration inflation on a loss).
  const isBigWin = isWin && hasPayout && (result.payoutCents ?? 0) > 0

  return (
    <div className="panel space-y-5 p-8 text-center">
      {isBigWin && <Confetti />}

      <div
        className={`display text-3xl ${isWin ? "text-primary" : isDraw ? "text-foreground" : "text-rival"}`}
      >
        {isWin ? "Victory" : isDraw ? "Draw" : "Beaten on the board"}
      </div>
      <p className="text-muted-foreground">{message}</p>

      <MiniBoard board={result.board} you={result.you} winningLine={result.winningLine} />

      {isBigWin && <PayoutCheck amountCents={result.payoutCents!} />}

      {hasMoneyTerms && (
        <div className="panel mx-auto max-w-xs space-y-2 p-4 text-sm">
          {hasPayout && !isBigWin && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Payout</span>
              <span className="tabular money font-medium">{formatCents(result.payoutCents!)}</span>
            </div>
          )}
          {hasEloDelta && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Elo change</span>
              <span className={`tabular font-medium ${result.eloDelta! >= 0 ? "text-primary" : "text-rival"}`}>
                {result.eloDelta! >= 0 ? "+" : ""}
                {result.eloDelta}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        {onPlayAgain && (
          <Button onClick={onPlayAgain} size="lg">
            Queue again
          </Button>
        )}
        <Button variant={onPlayAgain ? "outline" : "default"} size="lg" asChild>
          <Link href={backHref}>Back to lobby</Link>
        </Button>
      </div>

      {matchId && (
        <div className="flex justify-center pt-1">
          <FileDisputeButton matchId={matchId} />
        </div>
      )}
    </div>
  )
}
