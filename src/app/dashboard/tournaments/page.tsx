import { EnterTournamentButton } from "@/components/game/enter-tournament-button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { RULESETS } from "@/lib/game/rulesets"

export default async function TournamentsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("*, tournament_entries(user_id)")
    .in("status", ["open", "full"])
    .order("created_at", { ascending: false })

  const { data: myEntries } = await supabase
    .from("tournament_entries")
    .select("tournament_id")
    .eq("user_id", user.id)

  const enteredIds = new Set((myEntries ?? []).map((e) => e.tournament_id))

  // Two plain queries joined in JS, not a nested select — database.types.ts
  // leaves FK relationships unasserted, so nested selects aren't relied on
  // anywhere in this codebase.
  const { data: readyMatches } = await supabase
    .from("tournament_matches")
    .select("id, tournament_id, player_1_id, player_2_id")
    .eq("status", "pending")
    .or(`player_1_id.eq.${user.id},player_2_id.eq.${user.id}`)
    .not("player_1_id", "is", null)
    .not("player_2_id", "is", null)

  let readyTournamentNames = new Map<string, string>()
  if (readyMatches && readyMatches.length > 0) {
    const { data: names } = await supabase
      .from("tournaments")
      .select("id, name")
      .in("id", readyMatches.map((m) => m.tournament_id))
    readyTournamentNames = new Map((names ?? []).map((t) => [t.id, t.name]))
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Tournaments</h1>

      {readyMatches && readyMatches.length > 0 && (
        <div className="space-y-3">
          {readyMatches.map((m) => (
            <Card key={m.id} className="sticker-lift border-2 border-primary">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-primary">
                    Your match is ready
                  </div>
                  <div className="font-bold">{readyTournamentNames.get(m.tournament_id) ?? "Tournament"}</div>
                </div>
                <a
                  href={`/play/tournament/${m.id}`}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border-2 border-ink bg-primary px-4 py-2 text-sm font-bold uppercase tracking-wide text-primary-foreground shadow-[4px_4px_0_0_var(--ink)] transition-all hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_var(--ink)]"
                >
                  Play now
                </a>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!tournaments || tournaments.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No open contests right now. Check back soon.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tournaments.map((t) => {
            const seatsTaken = t.tournament_entries?.length ?? 0
            const alreadyEntered = enteredIds.has(t.id)
            const ruleset = RULESETS[t.ruleset_id as keyof typeof RULESETS]

            return (
              <Card key={t.id} className="sticker-lift">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{t.name}</CardTitle>
                    <Badge variant={t.status === "full" ? "muted" : "default"}>
                      {seatsTaken}/{t.field_size}
                    </Badge>
                  </div>
                  {ruleset && <p className="text-xs text-muted-foreground">{ruleset.blurb}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Every money term stated explicitly, per brand rule: money is
                      never left to discovery, only cosmetics are. */}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">Entry</div>
                      <div className="tabular font-bold">${(t.entry_fee_cents / 100).toFixed(2)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Prize pool</div>
                      <div className="tabular font-bold text-gold">
                        ${(t.prize_pool_cents / 100).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Fee</div>
                      <div className="tabular">{t.rake_bps / 100}%</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Format</div>
                      <div className="capitalize">{t.format_id.replace(/_/g, " ")}</div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    {alreadyEntered ? (
                      <span className="text-sm font-bold text-primary">You&apos;re in ✓</span>
                    ) : seatsTaken >= t.field_size ? (
                      <Badge variant="muted">Full</Badge>
                    ) : (
                      <EnterTournamentButton tournamentId={t.id} />
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
