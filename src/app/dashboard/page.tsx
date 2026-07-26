import Link from "next/link"

import { StakePicker } from "@/components/lobby/stake-picker"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { newAccountStakeCeilingCents } from "@/lib/game/fees"
import { createClient } from "@/lib/supabase/server"

const TIER_LABEL: Record<string, string> = {
  standard: "Standard — 2.00%",
  established: "Established — 1.75%",
  elite: "Elite — 1.25%",
}

export default async function DashboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

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
  const feeTier = standing?.fee_tier ?? "standard"
  const netProfit = bests?.net_profit_cents ?? 0

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
          {TIER_LABEL[feeTier]}
        </Badge>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium normal-case text-muted-foreground">
              Elo rating
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">{profile.elo_rating}</CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium normal-case text-muted-foreground">
              Skill Index
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold text-primary">
            {standing?.skill_index ?? "—"}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium normal-case text-muted-foreground">
              Win streak
            </CardTitle>
          </CardHeader>
          <CardContent className="text-3xl font-bold">
            {bests?.current_win_streak ?? 0} 🔥
          </CardContent>
        </Card>

        {/* Always shown, positive or negative — it's the player's own money. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium normal-case text-muted-foreground">
              Net profit
            </CardTitle>
          </CardHeader>
          <CardContent
            className={`text-3xl font-bold ${netProfit >= 0 ? "text-primary" : "text-rival"}`}
          >
            {netProfit >= 0 ? "+" : ""}
            {(netProfit / 100).toFixed(2)}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Ranked match</CardTitle>
          </CardHeader>
          <CardContent>
            <StakePicker feeTier={feeTier as "standard" | "established" | "elite"} ceilingCents={ceiling} />
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

      <p className="max-w-2xl text-xs text-muted-foreground">
        Matches are for entertainment, not a source of income. Rankings are determined solely
        by skill.
      </p>
    </div>
  )
}
