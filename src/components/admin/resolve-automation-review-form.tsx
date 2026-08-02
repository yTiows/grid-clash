"use client"

import { useState, useTransition } from "react"

import { resolveAutomationReviewAction, type AutomationResolution } from "@/actions/admin-automation"
import { Button } from "@/components/ui/button"

const RESOLUTIONS: AutomationResolution[] = ["cleared", "confirmed_automation", "inconclusive"]

const RESOLUTION_LABELS: Record<AutomationResolution, string> = {
  cleared: "Clear",
  confirmed_automation: "Confirm automation",
  inconclusive: "Inconclusive",
}

export function ResolveAutomationReviewForm({ reviewId }: { reviewId: string }) {
  const [note, setNote] = useState("")
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  function handleResolve(resolution: AutomationResolution) {
    if (!note.trim()) {
      setMessage({ text: "A reviewer note is required.", error: true })
      return
    }
    startTransition(async () => {
      const result = await resolveAutomationReviewAction(reviewId, resolution, note)
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <p className="text-sm font-semibold text-primary">{message.text}</p>
  }

  return (
    <div className="w-full max-w-sm space-y-2">
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="What did you check — timing pattern, session length, manual replay review?"
        rows={2}
        maxLength={2000}
        className="flex w-full rounded-md border border-border bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
      />
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
      <div className="flex flex-wrap gap-2">
        {RESOLUTIONS.map((resolution) => (
          <Button
            key={resolution}
            size="sm"
            variant={resolution === "confirmed_automation" ? "rival" : "outline"}
            disabled={pending}
            onClick={() => handleResolve(resolution)}
          >
            {RESOLUTION_LABELS[resolution]}
          </Button>
        ))}
      </div>
    </div>
  )
}
