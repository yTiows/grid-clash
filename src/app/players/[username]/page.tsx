import Link from "next/link"
import { notFound } from "next/navigation"

import { AvatarUpload } from "@/components/social/avatar-upload"
import { ChallengeInviteForm } from "@/components/social/challenge-invite-form"
import { ChallengePreferencesForm } from "@/components/social/challenge-preferences-form"
import { FriendRequestButton } from "@/components/social/friend-request-button"
import { PerformanceBenchmarkCard } from "@/components/social/performance-benchmark-card"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"
import { TITLE_TIER_MARK } from "@/lib/game/titles"

/**
 * Reads public_players (the RLS-safe projection — see friends.ts's note;
 * extended with avatar_url in 20260801000007_public_players_avatar.sql),
 * not users directly. If the requested username isn't there (most likely:
 * account_status isn't 'active' yet — public_players filters to active
 * only), falls back to the viewer's own row via users_select_own so a
 * brand-new account can still see its own profile before finishing phone
 * verification.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: { username: string }
}) {
  const supabase = createClient()
  const {
    data: { user: viewer },
  } = await supabase.auth.getUser()

  let profile: {
    id: string
    username: string
    elo_rating: number
    matches_played: number
    matches_won: number
    created_at: string
    avatar_url: string | null
  } | null = null

  const { data: publicRow } = await supabase
    .from("public_players")
    .select("id, username, elo_rating, matches_played, matches_won, created_at, avatar_url")
    .eq("username", params.username)
    .maybeSingle()

  // View columns are typed nullable by the generator regardless of the
  // underlying NOT NULL columns on users (id/username/elo_rating/
  // matches_played/matches_won/created_at are never actually null —
  // public_players joins FROM users, never right-joins it away).
  if (publicRow && publicRow.id && publicRow.username && publicRow.created_at) {
    profile = {
      id: publicRow.id,
      username: publicRow.username,
      elo_rating: publicRow.elo_rating ?? 1600,
      matches_played: publicRow.matches_played ?? 0,
      matches_won: publicRow.matches_won ?? 0,
      created_at: publicRow.created_at,
      avatar_url: publicRow.avatar_url,
    }
  } else if (viewer) {
    const { data: ownRow } = await supabase
      .from("users")
      .select("id, username, elo_rating, matches_played, matches_won, created_at, avatar_url")
      .eq("id", viewer.id)
      .eq("username", params.username)
      .maybeSingle()
    if (ownRow) profile = ownRow
  }

  if (!profile) notFound()

  const isSelf = viewer?.id === profile.id
  const avatarUrl = profile.avatar_url

  const [{ data: standing }, { data: titleRow }] = await Promise.all([
    supabase
      .from("player_standing")
      .select(
        "skill_index, trust_band, performance_index, pi_tactical, pi_threat_creation, pi_defense, pi_conversion, pi_consistency"
      )
      .eq("user_id", profile.id)
      .maybeSingle(),
    supabase
      .from("player_titles")
      .select("tier")
      .eq("user_id", profile.id)
      .eq("is_equipped", true)
      .maybeSingle(),
  ])

  /**
   * Feature B — Elite Performance Benchmark. Both queries read only
   * gameplay-shaped columns (performance_index_snapshots has none of any
   * other kind — see the migration's own structural self-test). Top-10%
   * average is computed client-side over a small row set rather than a
   * dedicated view: this platform's target scale (~5,000 users,
   * CLAUDE_CODE_BRIEF.md §6) makes that cheap, and it avoids a second
   * schema object for a number only ever needed on this one page.
   */
  const [{ data: topTierRows }, { data: recentSnapshots }] = await Promise.all([
    supabase.from("player_standing").select("performance_index").lte("performance_index_percentile", 10),
    supabase
      .from("performance_index_snapshots")
      .select(
        "moves_made, score_four_in_a_row, score_board_control, score_threat_density, score_dual_threat, score_positional_dominance, score_forced_response, score_strategic_pressure, score_threat_neutralized, computed_at"
      )
      .eq("user_id", profile.id)
      .order("computed_at", { ascending: false })
      .limit(30), // matches recompute-standing's PERFORMANCE_INDEX_WINDOW_MATCHES, so "matches considered" on this card and the cached performance_index below are describing the same window
  ])

  const topTenPercentAverage =
    topTierRows && topTierRows.length > 0
      ? Math.round(topTierRows.reduce((sum, r) => sum + r.performance_index, 0) / topTierRows.length)
      : null

  const recentTrend = (recentSnapshots ?? [])
    .slice()
    .reverse() // oldest first, for the sparkline's left-to-right reading direction
    .map((s) => {
      const total =
        s.score_four_in_a_row +
        s.score_board_control +
        s.score_threat_density +
        s.score_dual_threat +
        s.score_positional_dominance +
        s.score_forced_response +
        s.score_strategic_pressure +
        s.score_threat_neutralized
      return s.moves_made > 0 ? Math.round((total / s.moves_made) * 10) / 10 : 0
    })

  let friendshipState:
    | { kind: "none" }
    | { kind: "pending_outgoing"; friendshipId: string }
    | { kind: "pending_incoming"; friendshipId: string }
    | { kind: "friends"; friendshipId: string } = { kind: "none" }
  let targetPrefs: { accepts_challenges: boolean; min_stake_cents: number | null; max_stake_cents: number | null } | null = null
  let ownPrefs: { accepts_challenges: boolean; min_stake_cents: number | null; max_stake_cents: number | null } | null = null

  if (viewer && !isSelf) {
    const { data: friendship } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(
        `and(requester_id.eq.${viewer.id},addressee_id.eq.${profile.id}),and(requester_id.eq.${profile.id},addressee_id.eq.${viewer.id})`
      )
      .in("status", ["pending", "accepted"])
      .maybeSingle()

    if (friendship) {
      if (friendship.status === "accepted") {
        friendshipState = { kind: "friends", friendshipId: friendship.id }
      } else if (friendship.requester_id === viewer.id) {
        friendshipState = { kind: "pending_outgoing", friendshipId: friendship.id }
      } else {
        friendshipState = { kind: "pending_incoming", friendshipId: friendship.id }
      }
    }

    if (friendshipState.kind === "friends") {
      const { data } = await supabase
        .from("challenge_preferences")
        .select("accepts_challenges, min_stake_cents, max_stake_cents")
        .eq("user_id", profile.id)
        .maybeSingle()
      targetPrefs = data
    }
  }

  if (isSelf) {
    const { data } = await supabase
      .from("challenge_preferences")
      .select("accepts_challenges, min_stake_cents, max_stake_cents")
      .eq("user_id", profile.id)
      .maybeSingle()
    ownPrefs = data
  }

  const tier = titleRow?.tier ?? null

  return (
    <div className="container max-w-2xl space-y-6 py-8">
      <Link href="/dashboard" className="text-sm font-semibold text-muted-foreground hover:text-primary">
        ← Back to dashboard
      </Link>

      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col items-center gap-3 sm:flex-row">
            {isSelf ? (
              <AvatarUpload userId={profile.id} username={profile.username} currentUrl={avatarUrl} />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-white/[0.06]">
                {avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- Storage URL, not a static asset.
                  <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-2xl font-bold text-muted-foreground">
                    {profile.username.slice(0, 1).toUpperCase()}
                  </span>
                )}
              </div>
            )}
            <div className="text-center sm:text-left">
              <div className="flex items-center gap-2">
                <h1 className="display text-xl">{profile.username}</h1>
                {tier && (
                  <span
                    className={`inline-flex items-center rounded-sm border-2 px-1.5 py-0 text-[10px] font-bold uppercase tracking-wide ${TITLE_TIER_MARK[tier] ?? TITLE_TIER_MARK.dollar}`}
                  >
                    {tier}
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {profile.matches_played} matches · {profile.matches_won} wins
              </p>
              {standing && (
                <Badge variant="outline" className="mt-1 capitalize">
                  {standing.trust_band} · Skill Index {standing.skill_index}
                </Badge>
              )}
            </div>
          </div>

          {!isSelf && viewer && (
            <div className="flex flex-col items-end gap-2">
              <FriendRequestButton targetUsername={profile.username} initialState={friendshipState} />
              {friendshipState.kind === "friends" &&
                targetPrefs?.accepts_challenges && (
                  <ChallengeInviteForm
                    targetId={profile.id}
                    targetUsername={profile.username}
                    minStakeCents={targetPrefs.min_stake_cents}
                    maxStakeCents={targetPrefs.max_stake_cents}
                  />
                )}
              {friendshipState.kind === "friends" && targetPrefs && !targetPrefs.accepts_challenges && (
                <p className="text-xs text-muted-foreground">Not accepting challenges right now</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PerformanceBenchmarkCard
        data={{
          performanceIndex: standing?.performance_index ?? 0,
          matchesConsidered: recentSnapshots?.length ?? 0,
          breakdown: {
            tactical: standing?.pi_tactical ?? 0,
            threatCreation: standing?.pi_threat_creation ?? 0,
            defense: standing?.pi_defense ?? 0,
            conversion: standing?.pi_conversion ?? 0,
            consistency: standing?.pi_consistency ?? 0,
          },
          topTenPercentAverage: topTenPercentAverage,
          recentTrend,
        }}
      />

      {isSelf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Wager challenges</CardTitle>
          </CardHeader>
          <CardContent>
            <ChallengePreferencesForm
              accepts={ownPrefs?.accepts_challenges ?? false}
              minStakeCents={ownPrefs?.min_stake_cents ?? null}
              maxStakeCents={ownPrefs?.max_stake_cents ?? null}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
