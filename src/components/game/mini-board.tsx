import type { Board, PlayerSlot } from "@/lib/game/engine"
import { cn } from "@/lib/utils"

/**
 * A frozen, non-interactive read of a finished board — used on the result
 * screen so a win is something you look at, not just a word and a number.
 * Same cell module as the live board (board.tsx), just smaller and inert.
 */
export function MiniBoard({
  board,
  you,
  winningLine,
}: {
  board: Board
  you: PlayerSlot
  winningLine: number[] | null
}) {
  const boardSize = Math.sqrt(board.length)

  return (
    <div
      className="mx-auto grid w-full max-w-[200px] gap-1"
      style={{ gridTemplateColumns: `repeat(${boardSize}, minmax(0, 1fr))` }}
    >
      {board.map((cell, i) => (
        <div
          key={i}
          className={cn(
            "cell aspect-square",
            cell && (cell.owner === you ? "cell-p1" : "cell-p2"),
            winningLine?.includes(i) && "cell-winning ring-2 ring-gold"
          )}
        />
      ))}
    </div>
  )
}
