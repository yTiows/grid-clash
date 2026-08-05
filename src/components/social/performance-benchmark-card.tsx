import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/**
 * Elite Performance Benchmark (CLAUDE_CODE_BRIEF.md Feature B). Gameplay
 * only — every prop here traces to player_standing's pi_ columns and
 * performance_index_snapshots, never to balance/stake/payout data. This
 * component has no access to money data to leak even by mistake: nothing
 * financial is in its prop types.
 */

export interface PerformanceBenchmarkData {
  performanceIndex: number
  matchesConsidered: number
  breakdown: {
    tactical: number
    threatCreation: number
    defense: number
    conversion: number
    consistency: number
  }
  /** Current average performance_index among players at or above the 90th percentile. Null when there isn't a real top-10% cohort yet (pre-launch, or too few active players) — shown honestly as "not enough data yet", never backfilled with a guess. */
  topTenPercentAverage: number | null
  /** Oldest-first per-match "quality density" (total ledger points / moves made) for the sparkline — recent form, not lifetime average. */
  recentTrend: number[]
}

const MAX_INDEX = 1000

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Dependency-free inline sparkline — this project has no charting library and one data series of at most 30 points doesn't need one. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null

  const width = 280
  const height = 48
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = max - min || 1

  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width
      const y = height - ((v - min) / range) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(" ")

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-12 w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2" className="text-primary" />
    </svg>
  )
}

export function PerformanceBenchmarkCard({ data }: { data: PerformanceBenchmarkData }) {
  const { performanceIndex, matchesConsidered, breakdown, topTenPercentAverage, recentTrend } = data

  if (matchesConsidered === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Performance Benchmark</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No ranked matches yet. Queue up — this fills in after your first one.</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Performance Benchmark</CardTitle>
        <p className="text-xs text-muted-foreground">
          Gameplay only. Measures decision quality across your last {matchesConsidered} ranked{" "}
          {matchesConsidered === 1 ? "match" : "matches"} — never entry fees, stakes, or winnings.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-3xl font-bold">{performanceIndex}</div>
            <div className="text-xs text-muted-foreground">out of {MAX_INDEX}</div>
          </div>
          {topTenPercentAverage !== null ? (
            <div className="text-right">
              <div className="text-lg font-semibold text-muted-foreground">{topTenPercentAverage}</div>
              <div className="text-xs text-muted-foreground">Top 10% average</div>
            </div>
          ) : (
            <div className="text-right text-xs text-muted-foreground">Not enough data yet for a top-10% average</div>
          )}
        </div>

        {recentTrend.length >= 2 && (
          <div>
            <div className="mb-1 text-xs text-muted-foreground">Recent form</div>
            <Sparkline values={recentTrend} />
          </div>
        )}

        <div className="space-y-3">
          <Bar label="Tactical (board control, position)" value={breakdown.tactical} max={350} />
          <Bar label="Threat creation" value={breakdown.threatCreation} max={250} />
          <Bar label="Defense" value={breakdown.defense} max={200} />
          <Bar label="Conversion" value={breakdown.conversion} max={100} />
          <Bar label="Consistency" value={breakdown.consistency} max={100} />
        </div>
      </CardContent>
    </Card>
  )
}
