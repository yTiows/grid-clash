import { cancelTournamentAction } from "@/actions/admin-tournaments"
import { CompleteTournamentForm } from "@/components/admin/complete-tournament-form"
import { CreateTournamentForm } from "@/components/admin/create-tournament-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export default async function AdminTournamentsPage() {
  const supabase = createClient()

  const { data: tournaments } = await supabase
    .from("tournaments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50)

  const tournamentIds = (tournaments ?? []).map((t) => t.id)

  const { data: allEntries } = await supabase
    .from("tournament_entries")
    .select("tournament_id, user_id")
    .in("tournament_id", tournamentIds.length > 0 ? tournamentIds : ["__none__"])

  const entrantIds = [...new Set((allEntries ?? []).map((e) => e.user_id))]

  const { data: allUsers } = await supabase
    .from("users")
    .select("id, username")
    .in("id", entrantIds.length > 0 ? entrantIds : ["__none__"])

  const usernameById = new Map((allUsers ?? []).map((u) => [u.id, u.username]))
  const entriesByTournament = new Map<string, { userId: string; username: string }[]>()
  for (const e of allEntries ?? []) {
    const list = entriesByTournament.get(e.tournament_id) ?? []
    list.push({ userId: e.user_id, username: usernameById.get(e.user_id) ?? e.user_id.slice(0, 8) })
    entriesByTournament.set(e.tournament_id, list)
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Tournaments</h1>

      <Card>
        <CardHeader>
          <CardTitle>Create contest</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateTournamentForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>All contests</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!tournaments || tournaments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No contests yet.</p>
          ) : (
            tournaments.map((t) => (
              <div
                key={t.id}
                className="border-b border-white/10 py-3 last:border-0"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-bold">{t.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {t.format_id} · {t.field_size} seats · ${(t.entry_fee_cents / 100).toFixed(2)} entry
                      · pool ${(t.prize_pool_cents / 100).toFixed(2)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge
                      variant={
                        t.status === "open" ? "default" : t.status === "cancelled" ? "outline" : "muted"
                      }
                    >
                      {t.status}
                    </Badge>
                    {(t.status === "open" || t.status === "full") && (
                      <form
                        action={async () => {
                          "use server"
                          await cancelTournamentAction(t.id)
                        }}
                      >
                        <Button size="sm" variant="outline" type="submit">
                          Cancel &amp; refund
                        </Button>
                      </form>
                    )}
                  </div>
                </div>

                {(t.status === "in_progress" || t.status === "full") &&
                  (entriesByTournament.get(t.id)?.length ?? 0) > 0 && (
                    <div className="mt-3">
                      <CompleteTournamentForm
                        tournamentId={t.id}
                        entrants={entriesByTournament.get(t.id) ?? []}
                      />
                    </div>
                  )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
