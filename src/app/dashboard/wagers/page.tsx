import Link from "next/link"

import { PostWagerForm } from "@/components/social/post-wager-form"
import { WagerRowActions } from "@/components/social/wager-row-actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCents } from "@/lib/game/fees"
import { RULESETS } from "@/lib/game/rulesets"
import { createClient } from "@/lib/supabase/server"

export default async function WagersPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Every challenges row this viewer could plausibly act on, in one query —
  // RLS (challenges_select_involved plus the new challenges_select_open_board)
  // is what actually scopes this to "mine, or genuinely open" server-side;
  // the .or() below just avoids pulling every open post system-wide when
  // most of them will never render as anything but the public board list.
  const { data: rows } = await supabase
    .from("challenges")
    .select("id, challenger_id, target_id, stake_cents, ruleset_id, status, created_at, expires_at")
    .or(`challenger_id.eq.${user.id},target_id.eq.${user.id},and(status.eq.pending,target_id.is.null)`)
    .order("created_at", { ascending: false })

  const all = rows ?? []

  const board = all.filter((r) => r.status === "pending" && r.target_id === null && r.challenger_id !== user.id)
  const minePendingOpen = all.filter((r) => r.status === "pending" && r.target_id === null && r.challenger_id === user.id)
  const incoming = all.filter((r) => r.status === "pending" && r.target_id === user.id)
  const outgoing = all.filter((r) => r.status === "pending" && r.challenger_id === user.id && r.target_id !== null)
  const accepted = all.filter(
    (r) => r.status === "accepted" && (r.challenger_id === user.id || r.target_id === user.id)
  )

  const otherIds = new Set<string>()
  for (const r of [...board, ...incoming, ...outgoing, ...accepted]) {
    otherIds.add(r.challenger_id === user.id ? (r.target_id ?? r.challenger_id) : r.challenger_id)
  }

  const { data: otherUsers } = await supabase
    .from("public_players")
    .select("id, username")
    .in("id", Array.from(otherIds))
  const usernameById = new Map((otherUsers ?? []).map((u) => [u.id, u.username]))

  const rulesetName = (id: string) => RULESETS[id as keyof typeof RULESETS]?.name ?? id

  return (
    <div className="container max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="display text-2xl">Wagers</h1>
        <p className="text-sm text-muted-foreground">
          Equal-stake 1v1s. Post to the open board, or accept someone else&apos;s — both stakes are
          held the moment a wager is accepted, and paid out the moment the match ends.
        </p>
      </div>

      {accepted.length > 0 && (
        <Card className="border-primary/40 bg-primary/5">
          <CardHeader>
            <CardTitle className="text-base">Ready to play</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {accepted.map((r) => {
              const opponentId = r.challenger_id === user.id ? r.target_id : r.challenger_id
              const opponentName = opponentId ? (usernameById.get(opponentId) ?? "Unknown") : "Unknown"
              return (
                <div key={r.id} className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">vs {opponentName}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatCents(r.stake_cents)} · {rulesetName(r.ruleset_id)}
                    </div>
                  </div>
                  <Button size="sm" asChild>
                    <Link href={`/play/wager/${r.id}`}>Play</Link>
                  </Button>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Post an open wager</CardTitle>
        </CardHeader>
        <CardContent>
          <PostWagerForm />
        </CardContent>
      </Card>

      {incoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Challenges sent to you</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incoming.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/players/${usernameById.get(r.challenger_id) ?? ""}`}
                    className="text-sm font-medium hover:text-primary"
                  >
                    {usernameById.get(r.challenger_id) ?? "Unknown"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatCents(r.stake_cents)} · {rulesetName(r.ruleset_id)}
                  </div>
                </div>
                <WagerRowActions challengeId={r.id} kind="incoming" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Open board ({board.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {board.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open wagers right now — post one above.</p>
          ) : (
            board.map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <div>
                  <Link
                    href={`/players/${usernameById.get(r.challenger_id) ?? ""}`}
                    className="text-sm font-medium hover:text-primary"
                  >
                    {usernameById.get(r.challenger_id) ?? "Unknown"}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {formatCents(r.stake_cents)} · {rulesetName(r.ruleset_id)}
                  </div>
                </div>
                <WagerRowActions challengeId={r.id} kind="board" />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {(minePendingOpen.length > 0 || outgoing.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your pending wagers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {[...minePendingOpen, ...outgoing].map((r) => (
              <div key={r.id} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">
                    {r.target_id
                      ? `To ${usernameById.get(r.target_id) ?? "Unknown"}`
                      : "Open to anyone"}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatCents(r.stake_cents)} · {rulesetName(r.ruleset_id)}
                  </div>
                </div>
                <WagerRowActions challengeId={r.id} kind="mine_pending" />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
