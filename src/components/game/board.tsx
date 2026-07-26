"use client"

import { useEffect, useMemo, useState } from "react"

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

function TurnClock({ deadline, moveNumber }: { deadline: number; moveNumber: number }) {
  const durationMs = Math.max(0, deadline - Date.now())
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full border border-ink bg-black/30">
      <div
        key={moveNumber}
        className="h-full bg-primary"
        style={{ animation: `clock-drain ${durationMs}ms linear forwards` }}
      />
    </div>
  )
}

function CellView({
  cell,
  isYou,
  isWinning,
  isLegal,
  isSwapSelected,
  disabled,
  onClick,
}: {
  cell: Cell | null
  isYou: boolean
  isWinning: boolean
  isLegal: boolean
  isSwapSelected: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled || !isLegal}
      onClick={onClick}
      className={cn(
        "cell relative aspect-square w-full",
        cell && (isYou ? "bg-primary" : "bg-rival"),
        isWinning && "cell-winning ring-4 ring-gold",
        isLegal && !disabled && "outline outline-2 outline-offset-2 outline-white/40",
        isSwapSelected && "outline outline-2 outline-offset-2 outline-accent",
        disabled && "cursor-not-allowed"
      )}
    >
      {cell?.shielded && (
        <span className="absolute inset-1 rounded-sm border-2 border-dashed border-accent" />
      )}
    </button>
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

  // Reset swap selection and default back to Place whenever the turn changes.
  useEffect(() => {
    setSwapFirst(null)
    setSelectedKind("normal")
  }, [state.moveNumber])

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
        <span className={cn("font-bold", isMyTurn ? "text-primary" : "text-muted-foreground")}>
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
        disabled={!isMyTurn}
      />

      <p className="text-center text-xs text-muted-foreground">
        Opponent pieces remaining: {state.opponentPiecesRemaining}
      </p>
    </div>
  )
}
