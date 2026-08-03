import Link from "next/link"

import { FriendRequestButton } from "@/components/social/friend-request-button"
import { FriendSearch } from "@/components/social/friend-search"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export default async function FriendsPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const [{ data: friendships }, { data: me }] = await Promise.all([
    supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`),
    supabase.from("users").select("invited_by_user_id").eq("id", user.id).single(),
  ])

  const rows = friendships ?? []
  const otherIds = new Set(rows.map((f) => (f.requester_id === user.id ? f.addressee_id : f.requester_id)))
  if (me?.invited_by_user_id) otherIds.add(me.invited_by_user_id)

  // Two plain queries joined in JS, not a nested select — this codebase's
  // stated convention (database.types.ts leaves FK relationships
  // unasserted), and public_players is the only RLS-permitted way to read
  // another player's row at all (see friends.ts's note).
  const { data: otherUsers } = await supabase
    .from("public_players")
    .select("id, username")
    .in("id", Array.from(otherIds))
  const usernameById = new Map((otherUsers ?? []).map((u) => [u.id, u.username]))

  const friends = rows.filter((f) => f.status === "accepted")
  const incoming = rows.filter((f) => f.status === "pending" && f.addressee_id === user.id)
  const outgoing = rows.filter((f) => f.status === "pending" && f.requester_id === user.id)

  const referrerUsername = me?.invited_by_user_id ? usernameById.get(me.invited_by_user_id) : null
  const alreadyConnectedToReferrer = rows.some(
    (f) =>
      (f.requester_id === me?.invited_by_user_id || f.addressee_id === me?.invited_by_user_id) &&
      f.status !== "declined"
  )

  return (
    <div className="container max-w-2xl space-y-6 py-8">
      <div>
        <h1 className="display text-2xl">Friends</h1>
        <p className="text-sm text-muted-foreground">
          Add friends to challenge them to a 1v1 wager from their profile.
        </p>
      </div>

      {referrerUsername && !alreadyConnectedToReferrer && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <p className="text-sm font-medium">
              You joined via <span className="font-bold">{referrerUsername}</span>&apos;s invite.
            </p>
            <FriendRequestButton targetUsername={referrerUsername} initialState={{ kind: "none" }} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a friend</CardTitle>
        </CardHeader>
        <CardContent>
          <FriendSearch />
        </CardContent>
      </Card>

      {incoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {incoming.map((f) => (
              <div key={f.id} className="flex items-center justify-between">
                <Link
                  href={`/players/${usernameById.get(f.requester_id) ?? ""}`}
                  className="text-sm font-medium hover:text-primary"
                >
                  {usernameById.get(f.requester_id) ?? "Unknown"}
                </Link>
                <FriendRequestButton
                  targetUsername={usernameById.get(f.requester_id) ?? ""}
                  initialState={{ kind: "pending_incoming", friendshipId: f.id }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your friends ({friends.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {friends.length === 0 ? (
            <p className="text-sm text-muted-foreground">No friends yet — search above to add one.</p>
          ) : (
            friends.map((f) => {
              const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id
              const username = usernameById.get(otherId) ?? "Unknown"
              return (
                <div key={f.id} className="flex items-center justify-between">
                  <Link href={`/players/${username}`} className="text-sm font-medium hover:text-primary">
                    {username}
                  </Link>
                  <FriendRequestButton
                    targetUsername={username}
                    initialState={{ kind: "friends", friendshipId: f.id }}
                  />
                </div>
              )
            })
          )}
        </CardContent>
      </Card>

      {outgoing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sent requests</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {outgoing.map((f) => (
              <div key={f.id} className="flex items-center justify-between">
                <Link
                  href={`/players/${usernameById.get(f.addressee_id) ?? ""}`}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  {usernameById.get(f.addressee_id) ?? "Unknown"}
                </Link>
                <FriendRequestButton
                  targetUsername={usernameById.get(f.addressee_id) ?? ""}
                  initialState={{ kind: "pending_outgoing", friendshipId: f.id }}
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
