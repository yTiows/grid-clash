"use client"

import { useState, useTransition } from "react"

import {
  acceptOpenWagerAction,
  cancelWagerAction,
  respondChallengeAction,
  type ChallengeActionState,
} from "@/actions/challenges"
import { Button } from "@/components/ui/button"

const initial: ChallengeActionState = { status: "idle", message: null }

/**
 * Covers the three actionable states a pending/accepted challenges row can
 * be in from the current viewer's side — mirrors friend-request-button.tsx's
 * one-component-per-relationship-state shape:
 *   - "board": someone else's open post — the only action is accept.
 *   - "mine_pending": my own open post or outgoing friend challenge, still
 *     unanswered — the only action is cancel (refunds my held stake).
 *   - "incoming": a friend challenge aimed at me — accept or decline.
 * cancel_wager() doesn't distinguish open vs. direct by column, only by
 * "am I the poster and is it still pending" — so mine_pending covers both.
 */
export function WagerRowActions({
  challengeId,
  kind,
}: {
  challengeId: string
  kind: "board" | "mine_pending" | "incoming"
}) {
  const [done, setDone] = useState(false)
  const [message, setMessage] = useState<ChallengeActionState>(initial)
  const [pending, startTransition] = useTransition()

  if (done) {
    return <p className="text-xs font-bold text-primary">{message.message}</p>
  }

  function run(action: Promise<ChallengeActionState>) {
    startTransition(async () => {
      const result = await action
      setMessage(result)
      if (result.status === "success") setDone(true)
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {kind === "board" && (
        <Button size="sm" onClick={() => run(acceptOpenWagerAction(challengeId))} disabled={pending}>
          {pending ? "Accepting…" : "Accept"}
        </Button>
      )}

      {kind === "mine_pending" && (
        <Button size="sm" variant="outline" onClick={() => run(cancelWagerAction(challengeId))} disabled={pending}>
          {pending ? "Cancelling…" : "Cancel"}
        </Button>
      )}

      {kind === "incoming" && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => run(respondChallengeAction(challengeId, true))} disabled={pending}>
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => run(respondChallengeAction(challengeId, false))}
            disabled={pending}
          >
            Decline
          </Button>
        </div>
      )}

      {message.status === "error" && <p className="text-xs text-rival">{message.message}</p>}
    </div>
  )
}
