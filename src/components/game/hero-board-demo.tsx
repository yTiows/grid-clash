"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * The landing page's one focal object. Scripted, not interactive — its job
 * is to show the mechanic (hidden pieces landing until someone connects
 * four) in about four seconds, because the copy around it can describe the
 * rules but only the board can demonstrate them.
 */
type Step = { index: number; player: 1 | 2 }

const SEQUENCE: Step[] = [
  { index: 10, player: 1 },
  { index: 6, player: 2 },
  { index: 11, player: 1 },
  { index: 7, player: 2 },
  { index: 12, player: 1 },
  { index: 17, player: 2 },
  { index: 13, player: 1 },
]

const WINNING_LINE = [10, 11, 12, 13]
const STEP_MS = 500
const HOLD_MS = 1700
const RESET_MS = 400

function emptyBoard(): Array<1 | 2 | null> {
  return Array(25).fill(null)
}

export function HeroBoardDemo() {
  const [board, setBoard] = useState<Array<1 | 2 | null>>(emptyBoard)
  const [won, setWon] = useState(false)

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches

    if (prefersReduced) {
      const solved = emptyBoard()
      SEQUENCE.forEach((s) => {
        solved[s.index] = s.player
      })
      setBoard(solved)
      setWon(true)
      return
    }

    let cancelled = false
    const timers: ReturnType<typeof setTimeout>[] = []
    const schedule = (fn: () => void, ms: number) => {
      const t = setTimeout(() => {
        if (!cancelled) fn()
      }, ms)
      timers.push(t)
    }

    function playFrom(step: number) {
      if (step >= SEQUENCE.length) {
        setWon(true)
        schedule(() => {
          setWon(false)
          setBoard(emptyBoard())
          schedule(() => playFrom(0), RESET_MS)
        }, HOLD_MS)
        return
      }
      const move = SEQUENCE[step]
      if (!move) return
      const { index, player } = move
      setBoard((b) => {
        const updated = [...b]
        updated[index] = player
        return updated
      })
      schedule(() => playFrom(step + 1), STEP_MS)
    }

    schedule(() => playFrom(0), STEP_MS)

    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
    }
  }, [])

  return (
    <div
      aria-hidden="true"
      className="mx-auto grid w-full max-w-[300px] grid-cols-5 gap-1.5 sm:max-w-[340px]"
    >
      {board.map((owner, i) => (
        <div
          key={i}
          className={cn(
            "cell aspect-square",
            owner === 1 && "cell-p1 cell-place",
            owner === 2 && "cell-p2 cell-place",
            won && WINNING_LINE.includes(i) && "cell-winning"
          )}
        />
      ))}
    </div>
  )
}
