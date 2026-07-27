"use client"

import { useState, useTransition } from "react"

import { reviewFraudFlagAction } from "@/actions/admin-moderation"
import { Button } from "@/components/ui/button"
import { REVIEW_ACTIONS, type FraudReviewAction } from "@/lib/moderation"

const ACTION_LABELS: Record<FraudReviewAction, string> = {
  cleared: "Clear",
  confirmed: "Confirm",
  escalated: "Escalate",
}

export function ReviewFraudFlagForm({ flagId }: { flagId: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  function handleReview(action: FraudReviewAction) {
    startTransition(async () => {
      const result = await reviewFraudFlagAction(flagId, action)
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <p className="text-xs font-bold text-primary">{message.text}</p>
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-1">
        {REVIEW_ACTIONS.map((action) => (
          <Button
            key={action}
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => handleReview(action)}
          >
            {ACTION_LABELS[action]}
          </Button>
        ))}
      </div>
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
    </div>
  )
}
