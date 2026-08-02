import Link from "next/link"

import { StakePicker } from "@/components/lobby/stake-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FEE_TIERS, BRACKETS, newAccountStakeCeilingCents, type FeeTier } from "@/lib/game/fees"
import { createClient } from "@/lib/supabase/server"

/**
 * Was a hardcoded table (2.00% / 1.75% / 1.25%) that had drifted out of sync
 * with FEE_TIERS' real rates (1.00% / 0.85% / 0.60% — fees.ts's own comment
 * explains the 1% figure is the number BRAND.md's whole positioning is built
 * on). A player was being told a rate nearly double what they were actually
 * charged. Derived from FEE_TIERS directly now so the two cannot drift again.
 */
function tierLabel(tier: FeeTier): string {
  const def = FEE_TIERS[tier]
  return `${def.name} — ${(def.bps / 100).toFixed(2)}%`
}

/**
 * Tournament title tiers are keyed to entry fee, not Skill Index (see
 * complete_tournament()'s v_tier logic) — there's no formal skill->tier
 * mapping in this codebase to gate against. BRACKETS (fees.ts) already
 * defines skill thresholds for an unrelated, unwired "financial leagues"
 * concept; reusing its numbers here is purely informational (a hint, never a
 * gate) rather than inventing a second, disconnected set of thresholds.
 */
const TOURNAMENT_TIER_HINT: { minSkillIndex: number; tierName: string }[] = [
  { minSkillIndex: BRACKETS.elite.minSkillIndex, tierName: "Obsidian" },
  { minSkillIndex: BRACKETS.gold.minSkillIndex, tierName: "Gold" },
  { minSkillIndex: BRACKETS.silver.minSkillIndex, tierName: "Silver" },
]

function nextTournamentTierHint(skillIndex: number): string | null {
  for (const tier of TOURNAMENT_TIER_HINT) {
    if (skillIndex >= tier.minSkillIndex) {
      return `Your Skill Index already puts you in range for ${tier.tierName}-tier tournaments.`
    }
  }
  return null
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Milestone progress is intentionally not queried here — see BRAND.md §9/§11.
  // The event still fires server-side the moment scheduling.ts's threshold is
  // crossed; players never see it coming.
  const [{ data: profile }, { data: standing }, { data: bests }] = await Promise.all([
    supabase.from("users").select("*").eq("id", user.id).single(),
    supabase.from("player_standing").select("*").eq("user_id", user.id).maybeSingle(),
    supabase.from("personal_bests").select("*").eq("user_id", user.id).maybeSingle(),
  ])

  if (!profile) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>We couldn&apos;t load your profile</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Please refresh. If this keeps happening, contact support.
        </CardContent>
      </Card>
    )
  }

  const ceiling = newAccountStakeCeilingCents(profile.matches_played)
  const feeTier = (standing?.fee_tier ?? "standard") as FeeTier
  const netProfit = bests?.net_profit_cents ?? 0
  const tierHint = standing ? nextTournamentTierHint(standing.skill_index) : null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="display text-2xl">Welcome back, {profile.username}</h1>
          <p className="text-sm text-muted-foreground">
            {profile.matches_played} matches · {profile.matches_won} wins
          </p>
        </div>
        <Badge variant={feeTier === "elite" ? "gold" : feeTier === "established" ? "default" : "muted"}>
          {tierLabel(feeTier)}
        </Badge>
      </div>

      {/* Personalised, concrete invitation toward tournaments — CLAUDE_CODE_BRIEF.md
          §5.5. Only shown once there's a real Skill Index to point at. */}
      {tierHint && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm font-medium">{tierHint}</p>
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/tournaments">Browse contests</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stat tiles are board cells, not admin-panel rectangles — Skill Index
          is your standing in the actual game, so it's the one filled in your
          color, sized up, the way a piece on the board would be. The other
          three are real numbers but not the point of the page. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <div className="cell cell-p1 col-span-2 flex flex-col justify-center gap-1 px-5 py-4 sm:col-span-1">
          <span className="text-xs font-medium uppercase tracking-wide text-primary-foreground/70">
            Skill Index
          </span>
          <span className="tabular text-3xl font-bold text-primary-foreground">
            {standing?.skill_index ?? "—"}
          </span>
        </div>

        <div className="cell flex flex-col justify-center gap-1 px-5 py-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Elo
          </span>
          <span className="tabular text-xl font-semibold">{profile.elo_rating}</span>
        </div>

        <div className="cell flex flex-col justify-center gap-1 px-5 py-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Win streak
          </span>
          <span className="text-xl font-semibold">
            <span className="tabular">{bests?.current_win_streak ?? 0}</span> 🔥
          </span>
        </div>

        {/* Always shown, positive or negative — it's the player's own money. */}
        <div className="cell flex flex-col justify-center gap-1 px-5 py-4">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Net profit
          </span>
          <span
            className={`tabular text-xl font-semibold ${netProfit >= 0 ? "text-primary" : "text-rival"}`}
          >
            {netProfit >= 0 ? "+" : ""}
            {(netProfit / 100).toFixed(2)}
          </span>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ranked match</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StakePicker feeTier={feeTier as "standard" | "established" | "elite"} ceilingCents={ceiling} />
            <Link
              href="/practice"
              className="block text-center text-xs text-muted-foreground hover:text-foreground"
            >
              New here? Try a free practice match against a bot first →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tournaments</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Bracket and Swiss contests with published prize pools.
            </p>
            <Button asChild className="w-full">
              <Link href="/dashboard/tournaments">Browse open contests</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Milestone progress used to be shown here (CLAUDE_CODE_BRIEF.md §5.4).
          Reversed per brand/BRAND.md §9/§11 — the event is a secret until it
          fires, not a publicly trackable meter. The threshold/progress data
          isn't even fetched on this page anymore (see the query above), so
          there's nothing to leak via devtools either. Once a Milestone event
          resolves, the winner's earned title is exactly as public as any
          other title (§9) — only the countdown to the next one is hidden. */}

      <p className="max-w-2xl text-xs text-muted-foreground">
        Matches are for entertainment, not a source of income. Rankings are determined solely
        by skill.
      </p>
    </div>
  )
}
