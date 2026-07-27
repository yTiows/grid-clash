"use client"

import { useEffect, useState } from "react"

/**
 * Live "starts in..." countdown. CLAUDE_CODE_BRIEF.md §5.7 — a scheduled
 * start is the one urgency lever ranked structurally cannot use (it's
 * play-anytime by design), so where a tournament has one, it should read as
 * a real clock, not a static timestamp.
 */
export function Countdown({ target }: { target: string }) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  // Nothing rendered on the server or before the first client tick, so a
  // deployment's server clock skew never flashes a wrong number before
  // hydration settles.
  if (now === null) return null

  const diffMs = new Date(target).getTime() - now
  if (diffMs <= 0) {
    return <span className="font-bold text-primary">Starting now</span>
  }

  const totalSeconds = Math.floor(diffMs / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  const label =
    hours > 0
      ? `${hours}h ${minutes}m`
      : minutes > 0
        ? `${minutes}m ${seconds}s`
        : `${seconds}s`

  return <span className="tabular font-bold">Starts in {label}</span>
}
