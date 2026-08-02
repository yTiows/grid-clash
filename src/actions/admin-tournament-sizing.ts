"use server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { FORMATS, type FormatId } from "@/lib/game/formats"
import { sizeFieldForDemand, type DemandSnapshot } from "@/lib/game/scheduling"

export interface SizingSuggestion {
  demand: DemandSnapshot
  suggestedFieldSize: number
}

const LOOKBACK_HOUR_MS = 60 * 60 * 1000
const RECENT_TOURNAMENTS_SAMPLE = 10

/**
 * Suggests a field size from measured demand (scheduling.ts sizeFieldForDemand),
 * which was fully built and never called from anywhere in src/ until now.
 *
 * concurrentPlayers has no live signal to read here — match-server.ts's
 * in-memory session/queue state lives in a separate process with nothing
 * exporting it, and standing up that export is real infrastructure, not a
 * suggestion-tool change. Approximated instead from distinct accounts
 * active (a ranked match or a tournament entry) in the last 30 minutes,
 * which is the same "recent activity as a liquidity proxy" the rest of this
 * codebase already leans on (recompute-standing's own batch-over-recent-
 * matches approach). historicalFillRate comes from the last 10 completed
 * or cancelled contests of any format — the field is a suggestion; the
 * admin still sets the real number.
 */
export async function suggestFieldSizeAction(formatId: FormatId): Promise<SizingSuggestion | null> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return null

  const admin = createAdminClient()

  const sinceActiveIso = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const sinceHourIso = new Date(Date.now() - LOOKBACK_HOUR_MS).toISOString()

  const [{ data: recentMatches }, { data: recentEntries }, { data: recentTournaments }] =
    await Promise.all([
      admin
        .from("matches")
        .select("player_1_id, player_2_id, entry_fee_cents, completed_at")
        .eq("ranked", true)
        .gte("completed_at", sinceHourIso)
        .limit(5_000),
      admin
        .from("tournament_entries")
        .select("user_id, entered_at")
        .gte("entered_at", sinceHourIso)
        .limit(5_000),
      admin
        .from("tournaments")
        .select("field_size, tournament_entries(user_id)")
        .in("status", ["completed", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(RECENT_TOURNAMENTS_SAMPLE),
    ])

  const activeUserIds = new Set<string>()
  for (const m of recentMatches ?? []) {
    if (m.completed_at < sinceActiveIso) continue
    if (m.player_1_id) activeUserIds.add(m.player_1_id)
    if (m.player_2_id) activeUserIds.add(m.player_2_id)
  }
  for (const e of recentEntries ?? []) {
    if (e.entered_at >= sinceActiveIso) activeUserIds.add(e.user_id)
  }

  const registeredLastHour = new Set([
    ...(recentEntries ?? []).map((e) => e.user_id),
    ...(recentMatches ?? []).flatMap((m) => [m.player_1_id, m.player_2_id].filter(Boolean) as string[]),
  ]).size

  const stakes = (recentMatches ?? []).map((m) => m.entry_fee_cents).sort((a, b) => a - b)
  const medianStakeCents = stakes.length > 0 ? (stakes[Math.floor(stakes.length / 2)] as number) : 500

  const fillRates = (recentTournaments ?? [])
    .map((t) => {
      const seated = Array.isArray(t.tournament_entries) ? t.tournament_entries.length : 0
      return t.field_size > 0 ? seated / t.field_size : null
    })
    .filter((r): r is number => r !== null)
  const historicalFillRate =
    fillRates.length > 0 ? fillRates.reduce((s, r) => s + r, 0) / fillRates.length : 0.6

  const demand: DemandSnapshot = {
    concurrentPlayers: activeUserIds.size,
    registeredLastHour,
    medianStakeCents,
    historicalFillRate,
  }

  return {
    demand,
    suggestedFieldSize: sizeFieldForDemand(demand, formatId),
  }
}
