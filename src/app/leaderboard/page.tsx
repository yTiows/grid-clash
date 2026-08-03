import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/server"
import { TITLE_TIER_MARK } from "@/lib/game/titles"

/**
 * public.leaderboard (supabase/migrations/20260724000009_reputation.sql) is
 * skill-only by design — every financial column is excluded there on
 * purpose, so nothing here ever queries or renders a dollar figure. Do not
 * add one.
 */

const TRUST_BADGE_VARIANT: Record<string, "default" | "outline" | "muted" | "rival"> = {
  new: "muted",
  building: "outline",
  trusted: "default",
  veteran: "rival",
}

export default async function LeaderboardPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: rows } = await supabase.from("leaderboard").select("*").order("rank").limit(100)

  return (
    <div className="relative min-h-screen">
      <div className="container relative space-y-6 py-8">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="display text-2xl">Leaderboard</h1>
            <p className="text-sm text-muted-foreground">
              Ranked by Skill Index. Provisional accounts aren&apos;t shown.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-semibold text-muted-foreground hover:text-primary"
          >
            Back to dashboard
          </Link>
        </div>

        {!rows || rows.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No ranked players yet. Queue up.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Top {rows.length}</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-border-strong text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-3 pl-6 pr-2 font-bold">Rank</th>
                    <th className="px-2 py-3 font-bold">Player</th>
                    <th className="px-2 py-3 text-right font-bold">Elo</th>
                    <th className="px-2 py-3 text-right font-bold">Skill Index</th>
                    <th className="hidden px-2 py-3 text-right font-bold sm:table-cell">Played</th>
                    <th className="hidden px-2 py-3 text-right font-bold sm:table-cell">Won</th>
                    <th className="px-2 py-3 text-right font-bold">Win rate</th>
                    <th className="py-3 pl-2 pr-6 text-right font-bold">Trust</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isMe = !!user && row.id === user.id
                    const played = row.matches_played ?? 0
                    const won = row.matches_won ?? 0
                    const winRate = played > 0 ? Math.round((won / played) * 100) : null
                    const trustBand = row.trust_band ?? "new"
                    const tier = row.equipped_title_tier

                    return (
                      <tr
                        key={row.id ?? `${row.username}-${row.rank}`}
                        className={cn("border-b border-white/15", isMe && "bg-primary/10")}
                      >
                        <td
                          className={cn(
                            "tabular py-3 pl-6 pr-2 font-bold",
                            isMe && "border-l-4 border-l-primary"
                          )}
                        >
                          {row.rank}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex items-center gap-2">
                            <Link
                              href={`/players/${row.username}`}
                              className={cn("font-bold hover:underline", isMe && "text-primary")}
                            >
                              {row.username}
                            </Link>
                            {tier && (
                              <span
                                className={cn(
                                  "inline-flex items-center rounded-sm border-2 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide",
                                  TITLE_TIER_MARK[tier] ?? TITLE_TIER_MARK.dollar
                                )}
                              >
                                {tier}
                              </span>
                            )}
                            {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                          </div>
                        </td>
                        <td className="tabular px-2 py-3 text-right">{row.elo_rating ?? "—"}</td>
                        <td className="tabular px-2 py-3 text-right font-bold text-primary">
                          {row.skill_index ?? "—"}
                        </td>
                        <td className="tabular hidden px-2 py-3 text-right sm:table-cell">
                          {played}
                        </td>
                        <td className="tabular hidden px-2 py-3 text-right sm:table-cell">{won}</td>
                        <td className="tabular px-2 py-3 text-right">
                          {winRate === null ? "—" : `${winRate}%`}
                        </td>
                        <td className="py-3 pl-2 pr-6 text-right">
                          <Badge
                            variant={TRUST_BADGE_VARIANT[trustBand] ?? "muted"}
                            className="capitalize"
                          >
                            {trustBand}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
