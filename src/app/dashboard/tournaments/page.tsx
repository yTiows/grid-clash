import { EnterTournamentButton } from "@/components/game/enter-tournament-button"
import { Countdown } from "@/components/game/countdown"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { RULESETS } from "@/lib/game/rulesets"
import { formatCents, FEE_TIERS, type FeeTier } from "@/lib/game/fees"

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

  const { data: loyalty } = await supabase
    .from("loyalty_points")
    .select("balance_cents")
    .eq("user_id", user.id)
    .maybeSingle()
  const loyaltyPointsCents = loyalty?.balance_cents ?? 0

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

  // Satellite target names/pools — CLAUDE_CODE_BRIEF.md §5.3: "a satellite's
  // card should say what it's a satellite into, by name, with the target
  // tournament's prize pool front and center." One extra query, same joined-
  // in-JS convention as everything else on this page.
  const satelliteTargetIds = [
    ...new Set(
      (tournaments ?? [])
        .filter((t) => t.format_id === "satellite" && t.satellite_target_tournament_id)
        .map((t) => t.satellite_target_tournament_id as string)
    ),
  ]
  let satelliteTargets = new Map<string, { name: string; prizePoolCents: number }>()
  if (satelliteTargetIds.length > 0) {
    const { data: targets } = await supabase
      .from("tournaments")
      .select("id, name, prize_pool_cents")
      .in("id", satelliteTargetIds)
    satelliteTargets = new Map((targets ?? []).map((t) => [t.id, { name: t.name, prizePoolCents: t.prize_pool_cents }]))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="display text-2xl">Tournaments</h1>
        {loyaltyPointsCents > 0 && (
          <p className="text-sm text-muted-foreground">
            <span className="tabular font-bold text-gold">{formatCents(loyaltyPointsCents)}</span> in points
          </p>
        )}
      </div>

      {readyMatches && readyMatches.length > 0 && (
        <div className="space-y-3">
          {readyMatches.map((m) => (
            <Card key={m.id} className="panel-interactive border-2 border-primary">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-wide text-primary">
                    Your match is ready
                  </div>
                  <div className="font-bold">{readyTournamentNames.get(m.tournament_id) ?? "Tournament"}</div>
                </div>
                <a
                  href={`/play/tournament/${m.id}`}
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
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
            const seatsLeft = t.field_size - seatsTaken
            const alreadyEntered = enteredIds.has(t.id)
            const ruleset = RULESETS[t.ruleset_id as keyof typeof RULESETS]
            const isSatellite = t.format_id === "satellite"
            const target = t.satellite_target_tournament_id
              ? satelliteTargets.get(t.satellite_target_tournament_id)
              : undefined

            // Urgency per CLAUDE_CODE_BRIEF.md §5.7 — low seats or an
            // upcoming start are real, checkable facts, not manufactured
            // pressure, so this only lights up when actually true.
            const lowSeats = seatsLeft > 0 && seatsLeft <= Math.max(2, Math.ceil(t.field_size * 0.15))

            return (
              <Card key={t.id} className={`panel-interactive ${isSatellite ? "border-2 border-gold" : ""}`}>
                {isSatellite && target && (
                  <div className="border-b-2 border-gold bg-gold/10 px-4 py-2 text-xs font-bold uppercase tracking-wide text-gold">
                    Satellite → seat in {target.name} (
                    <span className="tabular">${(target.prizePoolCents / 100).toFixed(2)}</span> pool)
                  </div>
                )}
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{t.name}</CardTitle>
                    <Badge
                      variant={t.status === "full" ? "muted" : lowSeats ? "gold" : "default"}
                      className="tabular"
                    >
                      {seatsTaken}/{t.field_size}
                    </Badge>
                  </div>
                  {ruleset && <p className="text-xs text-muted-foreground">{ruleset.blurb}</p>}
                  <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                    {t.min_player_tier !== "standard" && (
                      <Badge variant="gold">
                        {FEE_TIERS[t.min_player_tier as FeeTier].name} tier required
                      </Badge>
                    )}
                    {lowSeats && t.status !== "full" && (
                      <span className="font-bold text-gold">
                        <span className="tabular">{seatsLeft}</span> seat{seatsLeft === 1 ? "" : "s"} left
                      </span>
                    )}
                    {t.starts_at && new Date(t.starts_at).getTime() > Date.now() && (
                      <Countdown target={t.starts_at} />
                    )}
                  </div>
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
                      <div className="text-xs text-muted-foreground">
                        {isSatellite ? "Seat value" : "Prize pool"}
                      </div>
                      <div className="tabular font-bold text-gold">
                        $
                        {(
                          (isSatellite ? t.satellite_seat_value_cents ?? t.prize_pool_cents : t.prize_pool_cents) /
                          100
                        ).toFixed(2)}
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
                      <EnterTournamentButton
                        tournamentId={t.id}
                        entryFeeCents={t.entry_fee_cents}
                        loyaltyPointsCents={loyaltyPointsCents}
                      />
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
