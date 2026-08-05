"use client"

import { useEffect, useState } from "react"

import { createClient } from "@/lib/supabase/client"
import { calculatePerformanceIndex } from "@/lib/game/performance-index"
import { buildPerformanceGapReport, type PerformanceGapReport } from "@/lib/game/performance-gap"
import { getRuleset } from "@/lib/game/rulesets"

/**
 * Feature C — Performance Gap. Purely additive to the match-result screen:
 * renders nothing while loading and nothing on failure, never a spinner or
 * error state competing with the primary win/loss message above it. This
 * is enrichment, not part of the critical path.
 *
 * DATA TIMING: match-server.ts's recordPerformanceSnapshot is
 * fire-and-forget (see its own comment — analytics must never add latency
 * to a real settlement), so the row this reads may not exist the instant
 * match:over arrives over the socket. Retried a few times with a short
 * backoff rather than blocking the result screen on it; gives up silently
 * if it never shows, since a missing report is a non-event, not an error a
 * player should ever see.
 */
export function PerformanceGapCard({ matchId }: { matchId: string }) {
  const [report, setReport] = useState<PerformanceGapReport | null>(null)

  useEffect(() => {
    let cancelled = false
    const supabase = createClient()

    async function attempt(retriesLeft: number): Promise<void> {
      if (cancelled) return

      // RLS (performance_index_snapshots_select_own) scopes this to the
      // caller's own row automatically — no need to filter by user_id here.
      const { data: thisSnapshot } = await supabase
        .from("performance_index_snapshots")
        .select(
          "moves_made, ruleset_id, score_four_in_a_row, score_board_control, score_threat_density, score_dual_threat, score_positional_dominance, score_forced_response, score_strategic_pressure, score_threat_neutralized"
        )
        .eq("match_id", matchId)
        .maybeSingle()

      if (!thisSnapshot) {
        if (retriesLeft > 0 && !cancelled) {
          setTimeout(() => void attempt(retriesLeft - 1), 1200)
        }
        return
      }

      // Excludes this match explicitly — history is meant to be "everything
      // before this one," which recentAverageIndex/priorPersonalBestIndex/
      // priorMatchCount below all depend on being true (see
      // performance-gap.ts's own header on why comparing against a
      // benchmark that already includes the match being evaluated is
      // exactly the kind of bug the adversarial review caught once).
      const { data: history } = await supabase
        .from("performance_index_snapshots")
        .select(
          "moves_made, score_four_in_a_row, score_board_control, score_threat_density, score_dual_threat, score_positional_dominance, score_forced_response, score_strategic_pressure, score_threat_neutralized"
        )
        .neq("match_id", matchId)
        .order("computed_at", { ascending: false })
        .limit(30) // matches recompute-standing's PERFORMANCE_INDEX_WINDOW_MATCHES

      if (cancelled) return

      const toSnapshot = (row: {
        moves_made: number
        score_four_in_a_row: number
        score_board_control: number
        score_threat_density: number
        score_dual_threat: number
        score_positional_dominance: number
        score_forced_response: number
        score_strategic_pressure: number
        score_threat_neutralized: number
      }) => ({
        movesMade: row.moves_made,
        scoreFourInARow: row.score_four_in_a_row,
        scoreBoardControl: row.score_board_control,
        scoreThreatDensity: row.score_threat_density,
        scoreDualThreat: row.score_dual_threat,
        scorePositionalDominance: row.score_positional_dominance,
        scoreForcedResponse: row.score_forced_response,
        scoreStrategicPressure: row.score_strategic_pressure,
        scoreThreatNeutralized: row.score_threat_neutralized,
      })

      const priorSnapshots = (history ?? []).map(toSnapshot)
      const thisMatchIndex = calculatePerformanceIndex({ matches: [toSnapshot(thisSnapshot)] }).total
      // Reuses calculatePerformanceIndex itself for "recent average" — the
      // same rolling-window formula Feature B's player_standing.
      // performance_index is built from, computed fresh here rather than
      // read from that (periodically cron-refreshed, so potentially stale)
      // cached value.
      const recentAverageIndex = calculatePerformanceIndex({ matches: priorSnapshots }).total
      const priorPersonalBestIndex = priorSnapshots.reduce(
        (best, s) => Math.max(best, calculatePerformanceIndex({ matches: [s] }).total),
        0
      )

      let rulesetName = thisSnapshot.ruleset_id
      try {
        rulesetName = getRuleset(thisSnapshot.ruleset_id).name
      } catch {
        // Unknown ruleset id (shouldn't happen — FK-constrained). Falls
        // back to the raw id rather than failing the whole card.
      }

      setReport(
        buildPerformanceGapReport({
          thisMatch: toSnapshot(thisSnapshot),
          thisMatchIndex,
          recentAverageIndex,
          priorPersonalBestIndex,
          priorMatchCount: priorSnapshots.length,
          rulesetName,
        })
      )
    }

    void attempt(3)
    return () => {
      cancelled = true
    }
  }, [matchId])

  if (!report) return null

  return (
    <div className="panel mx-auto max-w-xs space-y-1.5 p-4 text-sm">
      <div className="font-semibold">{report.headline}</div>
      <p className="text-muted-foreground">{report.note}</p>
      {/* "Try it free" rather than "risk-free" (banned vocabulary) — the
          adversarial review noted the tutorial is a genuinely safe,
          no-stakes destination but the previous "See how it works" label
          didn't signal that, which matters most for exactly the player
          most likely to hesitate to click anything after a loss. */}
      <a href={report.tutorialHref} className="inline-block text-xs font-medium text-primary underline underline-offset-2">
        Try it free
      </a>
    </div>
  )
}
