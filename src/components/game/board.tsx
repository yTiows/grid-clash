"use client"

import { useEffect, useMemo, useRef, useState } from "react"

import type { Board, Cell, PieceKind, PlayerSlot, RedactedGameState } from "@/lib/game/engine"
import { PieceTray } from "@/components/game/piece-tray"
import { cn } from "@/lib/utils"

/**
 * Which cells are legal targets for the currently selected piece kind.
 *
 * This surfaces legality only — which cells CAN be clicked — never which is
 * strongest. That distinction is the line between a UI affordance and
 * coaching: without it, bomb and swap (whose legality depends on ownership
 * and shield state) would be nearly unplayable, requiring guess-and-check
 * against server rejection on every attempt. Nothing here ranks options.
 */
function legalTargets(
  board: Board,
  you: PlayerSlot,
  kind: PieceKind,
  swapFirst: number | null
): Set<number> {
  const legal = new Set<number>()

  board.forEach((cell, i) => {
    if (kind === "normal" || kind === "shield") {
      if (cell === null) legal.add(i)
      return
    }
    if (kind === "bomb") {
      if (cell !== null && cell.owner !== you && !cell.shielded) legal.add(i)
      return
    }
    if (kind === "swap") {
      if (cell === null || cell.shielded) return
      if (swapFirst === null) {
        legal.add(i)
      } else {
        const firstCell = board[swapFirst]
        if (firstCell && cell.owner !== firstCell.owner) legal.add(i)
      }
    }
  })

  return legal
}

/** True once a cell's occupant/shield state has actually changed — the
 * trigger for the landing animation, whether the change came from an
 * optimistic local update or a server broadcast. */
function cellChanged(a: Cell | null, b: Cell | null): boolean {
  if (a === b) return false
  if (!a || !b) return true
  return a.owner !== b.owner || a.shielded !== b.shielded
}

const URGENT_THRESHOLD_MS = 1500

function TurnClock({ deadline, moveNumber }: { deadline: number; moveNumber: number }) {
  const durationMs = Math.max(0, deadline - Date.now())
  const [remainingMs, setRemainingMs] = useState(durationMs)

  useEffect(() => {
    const tick = () => setRemainingMs(Math.max(0, deadline - Date.now()))
    tick()
    const id = setInterval(tick, 100)
    return () => clearInterval(id)
  }, [deadline])

  const urgent = remainingMs > 0 && remainingMs <= URGENT_THRESHOLD_MS

  return (
    <div className="flex items-center gap-3">
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-secondary">
        <div
          key={moveNumber}
          className={cn("h-full origin-left", urgent ? "bg-rival" : "bg-primary")}
          style={{ animation: `clock-drain ${durationMs}ms linear forwards` }}
        />
      </div>
      <span
        className={cn(
          "tabular w-8 shrink-0 text-right text-xs",
          urgent ? "text-rival" : "text-muted-foreground"
        )}
      >
        {(remainingMs / 1000).toFixed(1)}s
      </span>
    </div>
  )
}

function CellView({
  cell,
  isYou,
  isWinning,
  isLegal,
  isSwapSelected,
  isJustPlaced,
  disabled,
  onClick,
}: {
  cell: Cell | null
  isYou: boolean
  isWinning: boolean
  isLegal: boolean
  isSwapSelected: boolean
  isJustPlaced: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled || !isLegal}
      onClick={onClick}
      className={cn(
        "cell aspect-square w-full",
        cell && (isYou ? "cell-p1" : "cell-p2"),
        cell && isJustPlaced && "cell-place",
        cell?.shielded && "cell-shielded",
        isWinning && "cell-winning ring-2 ring-gold",
        isLegal && !disabled && "ring-1 ring-inset ring-primary/40",
        isSwapSelected && "ring-2 ring-inset ring-accent",
        disabled && "cursor-not-allowed"
      )}
    />
  )
}

export function GameBoard({
  state,
  turnDeadline,
  onMove,
}: {
  state: RedactedGameState
  turnDeadline: number
  onMove: (kind: PieceKind, index: number, targetIndex?: number) => void
}) {
  const [selectedKind, setSelectedKind] = useState<PieceKind>("normal")
  const [swapFirst, setSwapFirst] = useState<number | null>(null)

  const boardSize = Math.sqrt(state.board.length)
  const isMyTurn = state.turn === state.you && state.status === "active"

  const legal = useMemo(
    () =>
      isMyTurn
        ? legalTargets(state.board, state.you, selectedKind, swapFirst)
        : new Set<number>(),
    [state.board, state.you, selectedKind, swapFirst, isMyTurn]
  )

  // Reset swap selection and default back to Place — but only when MY turn
  // just ENDED (true -> false), not when it just started (false -> true).
  // Resetting on every moveNumber change (the old behavior) meant a kind
  // pre-armed via the tray during the opponent's turn — see PieceTray's
  // disabled prop below — got wiped the instant it became my turn, right
  // before I could use it. On Blitz's 3s clock, that "select tool" click
  // was the difference between swap being usable at all and a click you
  // can't complete in time; see start-countdown.tsx's sibling fix for the
  // same class of problem on the countdown side. Still resets on my own
  // turn ending (my move, or a timeout) so a half-picked swap source
  // doesn't linger into a turn it no longer applies to.
  const wasMyTurnRef = useRef(isMyTurn)
  useEffect(() => {
    if (wasMyTurnRef.current && !isMyTurn) {
      setSwapFirst(null)
      setSelectedKind("normal")
    }
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn])

  // Tracks which cells changed since the last render — optimistic or
  // server-confirmed alike — so a newly landed piece gets a landing
  // animation instead of just appearing.
  const prevBoardRef = useRef<Board>(state.board)
  const [justChanged, setJustChanged] = useState<ReadonlySet<number>>(new Set())

  useEffect(() => {
    const prev = prevBoardRef.current
    prevBoardRef.current = state.board
    if (prev === state.board) return

    const changed = new Set<number>()
    state.board.forEach((cell, i) => {
      if (cellChanged(prev[i] ?? null, cell)) changed.add(i)
    })
    if (changed.size === 0) return

    setJustChanged(changed)
    const t = setTimeout(() => setJustChanged(new Set()), 200)
    return () => clearTimeout(t)
  }, [state.board])

  function handleCellClick(index: number) {
    if (!isMyTurn || !legal.has(index)) return

    if (selectedKind === "swap") {
      if (swapFirst === null) {
        setSwapFirst(index)
        return
      }
      onMove("swap", swapFirst, index)
      setSwapFirst(null)
      return
    }

    onMove(selectedKind, index)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <span className={cn("font-semibold", isMyTurn ? "text-primary" : "text-muted-foreground")}>
          {isMyTurn ? "Your move" : "Opponent thinking…"}
        </span>
        <span className="tabular text-xs text-muted-foreground">Move {state.moveNumber + 1}</span>
      </div>

      <TurnClock deadline={turnDeadline} moveNumber={state.moveNumber} />

      <div
        className="mx-auto grid max-w-md gap-1.5 sm:gap-2"
        style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
      >
        {state.board.map((cell, i) => (
          <CellView
            key={i}
            cell={cell}
            isYou={cell?.owner === state.you}
            isWinning={state.winningLine?.includes(i) ?? false}
            isLegal={legal.has(i)}
            isSwapSelected={swapFirst === i}
            isJustPlaced={justChanged.has(i)}
            disabled={!isMyTurn}
            onClick={() => handleCellClick(i)}
          />
        ))}
      </div>

      {selectedKind === "swap" && swapFirst !== null && (
        <p className="text-center text-xs text-accent">
          Pick an unshielded opponent cell to trade with.
        </p>
      )}

      <PieceTray
        inventory={state.yourInventory}
        selected={selectedKind}
        onSelect={(k) => {
          setSelectedKind(k)
          setSwapFirst(null)
        }}
        // Selecting a kind is pure client state — nothing is sent to the
        // server until an actual cell click, which stays gated on
        // isMyTurn below. Letting this stay enabled during the opponent's
        // turn is what makes pre-arming (see the reset effect above)
        // possible at all.
        disabled={false}
      />

      <p className="text-center text-xs text-muted-foreground">
        Opponent pieces remaining: <span className="tabular">{state.opponentPiecesRemaining}</span>
      </p>
    </div>
  )
}
