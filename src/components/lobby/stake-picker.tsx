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

  const available = RANKED_STAKE_TIERS_CENTS.filter((c: number) => c <= ceilingCents)
  const fee = calculateMatchFee(selected, feeTier)
  const breakEven = breakEvenWinRate(selected, feeTier)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {RANKED_STAKE_TIERS_CENTS.map((cents: number) => {
          const locked = cents > ceilingCents
          return (
            <button
              key={cents}
              type="button"
              disabled={locked}
              onClick={() => setSelected(cents)}
              className={`sticker-lift sticker py-3 text-center font-bold transition-opacity ${
                selected === cents ? "bg-primary text-primary-foreground" : ""
              } ${locked ? "opacity-30" : ""}`}
            >
              {formatCents(cents)}
              {locked && <div className="text-[10px] font-normal normal-case">Placement</div>}
            </button>
          )
        })}
      </div>

      <div className="sticker space-y-1.5 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Pot</span>
          <span className="tabular font-semibold">{formatCents(fee.potCents)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Fee ({fee.bps / 100}%)</span>
          <span className="tabular font-semibold">{formatCents(fee.feeCents)}</span>
        </div>
        <div className="flex justify-between border-t border-white/10 pt-1.5">
          <span className="text-muted-foreground">Winner takes</span>
          <span className="tabular font-bold text-primary">{formatCents(fee.winnerPayoutCents)}</span>
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

      <Button
        size="lg"
        className="w-full"
        disabled={selected > ceilingCents}
        onClick={() => router.push(`/play?stake=${selected}`)}
      >
        Queue for {formatCents(selected)}
      </Button>
    </div>
  )
}
