"use client"

import { useState, useTransition } from "react"

import {
  removeFriendAction,
  respondFriendRequestAction,
  sendFriendRequestAction,
  type FriendActionState,
} from "@/actions/friends"
import { Button } from "@/components/ui/button"

type FriendshipState =
  | { kind: "none" }
  | { kind: "pending_outgoing"; friendshipId: string }
  | { kind: "pending_incoming"; friendshipId: string }
  | { kind: "friends"; friendshipId: string }

const initial: FriendActionState = { status: "idle", message: null }

/**
 * One component covering every relationship state between the viewer and
 * the profile they're looking at — a friend's profile is exactly where
 * Phase 4's wager-invite hands off from, so this and challenge-invite-
 * form.tsx are meant to sit side by side on the same page.
 */
export function FriendRequestButton({
  targetUsername,
  initialState,
}: {
  targetUsername: string
  initialState: FriendshipState
}) {
  const [state, setState] = useState(initialState)
  const [message, setMessage] = useState<FriendActionState>(initial)
  const [pending, startTransition] = useTransition()

  function send() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set("username", targetUsername)
      const result = await sendFriendRequestAction(initial, formData)
      setMessage(result)
      if (result.status === "success") {
        setState({ kind: "pending_outgoing", friendshipId: "" })
      }
    })
  }

  function respond(friendshipId: string, accept: boolean) {
    startTransition(async () => {
      const result = await respondFriendRequestAction(friendshipId, accept)
      setMessage(result)
      if (result.status === "success") {
        setState(accept ? { kind: "friends", friendshipId } : { kind: "none" })
      }
    })
  }

  function remove(friendshipId: string) {
    startTransition(async () => {
      const result = await removeFriendAction(friendshipId)
      if (result.status === "success") {
        setState({ kind: "none" })
      }
      setMessage(result)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {state.kind === "none" && (
        <Button size="sm" onClick={send} disabled={pending}>
          {pending ? "Sending…" : "Add friend"}
        </Button>
      )}
      {state.kind === "pending_outgoing" && (
        <Button size="sm" variant="outline" disabled>
          Request sent
        </Button>
      )}
      {state.kind === "pending_incoming" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => respond(state.friendshipId, true)} disabled={pending}>
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => respond(state.friendshipId, false)}
            disabled={pending}
          >
            Decline
          </Button>
        </div>
      )}
      {state.kind === "friends" && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-primary">Friends ✓</span>
          <Button size="sm" variant="outline" onClick={() => remove(state.friendshipId)} disabled={pending}>
            Remove
          </Button>
        </div>
      )}
      {message.status === "error" && <p className="text-xs text-rival">{message.message}</p>}
    </div>
  )
}
