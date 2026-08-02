"use client"

import { useEffect, useState, type CSSProperties } from "react"

import { formatCents } from "@/lib/game/fees"

const CONFETTI_COLORS = ["var(--primary)", "var(--gold)", "var(--accent)"]
const CONFETTI_LIFETIME_MS = 3200

/**
 * Fires once on mount, cleans itself up. Purely decorative (aria-hidden,
 * pointer-events-none) — never gates anything, so a slow client never
 * blocks a real action behind a particle effect.
 */
export function Confetti({ pieces = 70 }: { pieces?: number }) {
  const [items] = useState(() =>
    Array.from({ length: pieces }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delayMs: Math.random() * 300,
      durationMs: 1800 + Math.random() * 1200,
      driftPx: Math.round((Math.random() - 0.5) * 160),
      spinDeg: Math.round(360 + Math.random() * 540),
      rotateDeg: Math.round(Math.random() * 360),
      wide: i % 3 === 0,
    }))
  )
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), CONFETTI_LIFETIME_MS)
    return () => clearTimeout(t)
  }, [])

  if (!visible) return null

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 overflow-hidden">
      {items.map((p) => (
        <span
          key={p.id}
          className="confetti-piece"
          style={
            {
              left: `${p.left}%`,
              width: p.wide ? "10px" : "6px",
              backgroundColor: p.color,
              animationDelay: `${p.delayMs}ms`,
              animationDuration: `${p.durationMs}ms`,
              transform: `rotate(${p.rotateDeg}deg)`,
              "--confetti-drift": `${p.driftPx}px`,
              "--confetti-spin": `${p.spinDeg}deg`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  )
}

const CHECK_PERIMETER = 730

/**
 * The big reveal for a real ranked/tournament win: a line-art check that
 * draws its own border in, then the payout amount counts up from zero.
 * Ranked-money only — never rendered for a practice win (no real payout to
 * reveal) or for a loss/draw (BRAND.md §6: "no consolation, no celebration
 * inflation" on a result screen — that rule is about not softening a loss,
 * not about underselling a real win).
 */
export function PayoutCheck({ amountCents }: { amountCents: number }) {
  const [displayCents, setDisplayCents] = useState(0)

  useEffect(() => {
    let raf = 0
    const durationMs = 1100
    const start = Date.now()

    function tick() {
      const t = Math.min(1, (Date.now() - start) / durationMs)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplayCents(Math.round(amountCents * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }

    const delay = setTimeout(() => {
      raf = requestAnimationFrame(tick)
    }, 650)

    return () => {
      clearTimeout(delay)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [amountCents])

  return (
    <div className="relative mx-auto max-w-xs">
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 h-full w-full"
        viewBox="0 0 240 148"
        preserveAspectRatio="none"
        fill="none"
      >
        <rect
          x="4"
          y="4"
          width="232"
          height="140"
          rx="10"
          stroke="var(--gold)"
          strokeWidth="3"
          strokeDasharray={CHECK_PERIMETER}
          strokeDashoffset={CHECK_PERIMETER}
          className="animate-check-draw"
          style={{ "--check-length": CHECK_PERIMETER } as CSSProperties}
        />
      </svg>

      <div className="relative space-y-3 p-5 text-left">
        <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <span>Payout</span>
          <span>Settled instantly</span>
        </div>
        <div className="payout-shine animate-payout-reveal tabular text-4xl font-black text-gold">
          {formatCents(displayCents)}
        </div>
      </div>
    </div>
  )
}
