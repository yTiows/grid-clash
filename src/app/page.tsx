import Link from "next/link"
import { redirect } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { HeroBoardDemo } from "@/components/game/hero-board-demo"
import { Countdown } from "@/components/game/countdown"
import { formatCents } from "@/lib/game/fees"
import { RULESETS } from "@/lib/game/rulesets"
import { createClient } from "@/lib/supabase/server"

/**
 * Was a hand-typed array duplicating rulesets.ts — exactly the "two sources
 * of truth" shape that's already bitten this codebase on fees (fees.ts) and
 * milestone thresholds (scheduling.ts). Derived now so a new format (or a
 * rebalanced one) shows up here automatically, correctly, or not at all.
 */
const FORMATS = Object.values(RULESETS)

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

/**
 * This used to be a marketing page with a pitch, a hero headline and a
 * compliance paragraph at the bottom. It isn't one anymore: this is a
 * browser game, not a storefront, and a returning player should land in
 * the game, not a sales page — see the redirect below. What's left here is
 * for the one visitor who hasn't signed up yet: real activity, not staged
 * copy. Terms, age, and responsible-play consent moved to signup, where
 * they're an actual decision instead of scenery — see signup-form.tsx.
 */
export default async function LandingPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // A returning player opens the site and is already in it — no pitch to
  // read past on the way to the dashboard they actually want.
  if (user) redirect("/dashboard")

  const [{ data: leaders }, { data: tournaments }, { data: recentMatches }] = await Promise.all([
    supabase
      .from("leaderboard")
      .select("id, username, skill_index, rank")
      .order("rank", { ascending: true })
      .limit(5),
    supabase
      .from("tournaments")
      .select("id, name, entry_fee_cents, field_size, prize_pool_cents, starts_at, tournament_entries(user_id)")
      .in("status", ["open", "full"])
      .order("starts_at", { ascending: true, nullsFirst: false })
      .limit(4),
    supabase
      .from("matches")
      .select("id, winner_id, loser_id, entry_fee_cents, winner_payout_cents, completed_at")
      .eq("ranked", true)
      .order("completed_at", { ascending: false })
      .limit(6),
  ])

  const matches = recentMatches ?? []
  const playerIds = Array.from(new Set(matches.flatMap((m) => [m.winner_id, m.loser_id])))
  const { data: players } =
    playerIds.length > 0
      ? await supabase.from("users").select("id, username").in("id", playerIds)
      : { data: [] as { id: string; username: string }[] }
  const usernameById = new Map((players ?? []).map((p) => [p.id, p.username]))

  const openTournaments = tournaments ?? []
  const topLeaders = leaders ?? []

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="container flex items-center justify-between py-4">
          <span className="text-[0.9375rem] font-semibold tracking-tight">Grid Clash</span>
          <nav className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/login">Log in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/signup">Play free</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {/* The pulse strip replaces the old hero headline — a caption, not
            a pitch. Real numbers, derived at request time. */}
        <div className="border-b border-border">
          <div className="container flex flex-wrap items-center justify-between gap-4 py-6">
            <p className="max-w-sm text-sm text-muted-foreground">
              A 5×5 board game with hidden pieces and a five-second clock. Real stakes, published
              fee.
            </p>
            <div className="tabular flex items-center gap-5 text-xs text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground">{matches.length}</span> recent
                ranked matches
              </span>
              <span>
                <span className="font-semibold text-foreground">{openTournaments.length}</span>{" "}
                contests open
              </span>
            </div>
          </div>
        </div>

        <div className="container grid gap-8 py-8 lg:grid-cols-[1.4fr_1fr] lg:gap-10 lg:py-10">
          <div className="space-y-8">
            {/* Live activity */}
            <section className="panel">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Recent matches</h2>
                <Link
                  href="/leaderboard"
                  className="text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  Leaderboard →
                </Link>
              </div>

              {matches.length === 0 ? (
                <div className="space-y-4 p-5">
                  <p className="text-sm text-muted-foreground">
                    No matches recorded yet — here&apos;s what one looks like.
                  </p>
                  <HeroBoardDemo />
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {matches.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="cell cell-p1 h-2.5 w-2.5 shrink-0 rounded-sm" />
                        <span className="truncate font-medium">
                          {usernameById.get(m.winner_id) ?? "Player"}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">beat</span>
                        <span className="truncate text-muted-foreground">
                          {usernameById.get(m.loser_id) ?? "Player"}
                        </span>
                      </div>
                      <div className="tabular flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                        <span className="money">{formatCents(m.winner_payout_cents)}</span>
                        <span>{timeAgo(m.completed_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Formats */}
            <section>
              <h2 className="mb-3 text-sm font-semibold tracking-tight">Formats</h2>
              <div className="panel divide-y divide-border">
                {FORMATS.map((f) => (
                  <div
                    key={f.id}
                    className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3"
                  >
                    <span className="font-medium">{f.name}</span>
                    <span className="text-sm text-muted-foreground">{f.blurb}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="space-y-8">
            {/* Leaderboard preview */}
            <section className="panel">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Top skill index</h2>
              </div>
              {topLeaders.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">No ranked players yet.</p>
              ) : (
                <div className="divide-y divide-border">
                  {topLeaders.map((row) => (
                    <div key={row.id} className="flex items-center justify-between px-5 py-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="tabular w-4 text-muted-foreground">{row.rank}</span>
                        <span className="font-medium">{row.username}</span>
                      </div>
                      <span className="tabular font-semibold text-primary">{row.skill_index}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Open contests */}
            <section className="panel">
              <div className="border-b border-border px-5 py-3">
                <h2 className="text-sm font-semibold tracking-tight">Contests open now</h2>
              </div>
              {openTournaments.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">Nothing open right now — check back soon.</p>
              ) : (
                <div className="divide-y divide-border">
                  {openTournaments.map((t) => {
                    const seated = Array.isArray(t.tournament_entries) ? t.tournament_entries.length : 0
                    return (
                      <div key={t.id} className="space-y-1.5 px-5 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate font-medium">{t.name}</span>
                          <span className="tabular money shrink-0 font-semibold">
                            {formatCents(t.prize_pool_cents)}
                          </span>
                        </div>
                        <div className="tabular flex items-center justify-between text-xs text-muted-foreground">
                          <span>
                            {formatCents(t.entry_fee_cents)} entry · {seated}/{t.field_size} seated
                          </span>
                          {t.starts_at ? (
                            <Countdown target={t.starts_at} />
                          ) : (
                            <Badge variant="outline" className="normal-case">
                              Sit-and-go
                            </Badge>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div className="border-t border-border p-3">
                <Button size="sm" className="w-full" asChild>
                  <Link href="/signup">Sign up to enter</Link>
                </Button>
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
