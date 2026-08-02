"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  RANKED_STAKE_TIERS_CENTS,
  breakEvenWinRate,
  calculateMatchFee,
  formatCents,
  formatPercent,
  type FeeTier,
} from "@/lib/game/fees"
import { RANKED_RULESET_IDS, type RankedRulesetId } from "@/lib/game/protocol"
import { getRuleset } from "@/lib/game/rulesets"

export function StakePicker({
  feeTier,
  ceilingCents,
}: {
  feeTier: FeeTier
  /** New-account stake ceiling. Number.MAX_SAFE_INTEGER once lifted. */
  ceilingCents: number
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<number>(RANKED_STAKE_TIERS_CENTS[0])
  const [format, setFormat] = useState<RankedRulesetId>("classic")

  const available = RANKED_STAKE_TIERS_CENTS.filter((c: number) => c <= ceilingCents)
  const fee = calculateMatchFee(selected, feeTier)
  const breakEven = breakEvenWinRate(selected, feeTier)

  return (
    <div className="space-y-4">
      {/* Format is a distinct choice from stake — Gambit isn't a "harder"
          version of the same queue, it's a different toolkit on the same
          board, so it gets its own row rather than folding into the stake
          grid. */}
      <div className="flex gap-2">
        {RANKED_RULESET_IDS.map((id) => {
          const isSelected = format === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFormat(id)}
              title={getRuleset(id).blurb}
              className={`panel panel-interactive flex-1 py-2 text-center text-xs font-semibold transition-colors ${
                isSelected ? "border-primary text-primary" : "text-muted-foreground"
              }`}
            >
              {getRuleset(id).name}
            </button>
          )
        })}
      </div>

      {/* Stakes as board cells, not a picker of rectangles — the square you
          choose here is the same module the match is played on. */}
      <div className="grid grid-cols-3 gap-2">
        {RANKED_STAKE_TIERS_CENTS.map((cents: number) => {
          const locked = cents > ceilingCents
          const isSelected = selected === cents
          return (
            <button
              key={cents}
              type="button"
              disabled={locked}
              onClick={() => setSelected(cents)}
              className={`cell flex aspect-square flex-col items-center justify-center gap-0.5 text-sm font-semibold transition-opacity ${
                isSelected ? "cell-p1" : ""
              } ${locked ? "opacity-30" : ""}`}
            >
              {formatCents(cents)}
              {locked && (
                <span className="text-[9px] font-normal normal-case opacity-80">Placement</span>
              )}
            </button>
          )
        })}
      </div>

      <div className="panel space-y-1.5 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pot</span>
          <span className="tabular font-semibold">{formatCents(fee.potCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            Fee {fee.isFlatFee ? "(flat, entry-tier)" : `(${fee.bps / 100}%)`}
          </span>
          <span className="tabular font-semibold">{formatCents(fee.feeCents)}</span>
        </div>
        <div className="flex justify-between border-t border-white/15 pt-1.5">
          <span className="text-muted-foreground">Winner takes</span>
          <span className="tabular money font-semibold">{formatCents(fee.winnerPayoutCents)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Break-even win rate</span>
          <span className="tabular font-semibold">{formatPercent(breakEven)}</span>
        </div>
      </div>

      {available.length === 0 && (
        <p className="text-xs text-muted-foreground">
          New accounts unlock higher stakes as placement matches complete.
        </p>
      )}

      <div className="flex items-center gap-3">
        {/* The two seats at the table. Yours is already filled in; the
            other is empty until the queue finds someone — the button below
            is what fills it, not a form submit. */}
        <div className="flex shrink-0 gap-1">
          <div className="cell cell-p1 h-8 w-8" />
          <div className="cell h-8 w-8 border-dashed opacity-60" />
        </div>
        <Button
          size="lg"
          className="flex-1"
          disabled={selected > ceilingCents}
          onClick={() => router.push(`/play?stake=${selected}&format=${format}`)}
        >
          Take a seat — {formatCents(selected)}
        </Button>
      </div>
    </div>
  )
}
