"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"

/**
 * Unobtrusive by design — this is a real-money result screen, not a form
 * that should compete with it. Starts as a small text affordance; only
 * expands into a reason field once the player actually intends to file.
 *
 * file_match_dispute (20260726000034_match_disputes.sql) does its own
 * eligibility checks (participant-only, 7-day window, one per match per
 * filer) under the caller's own session — this component just surfaces
 * whatever it returns, success or error, verbatim.
 */
export function FileDisputeButton({ matchId }: { matchId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  if (message && !message.error) {
    return <p className="text-xs text-muted-foreground">{message.text}</p>
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        onClick={() => setOpen(true)}
      >
        Dispute this result
      </button>
    )
  }

  async function handleSubmit() {
    if (!reason.trim()) {
      setMessage({ text: "A reason is required.", error: true })
      return
    }
    setSubmitting(true)
    setMessage(null)

    const supabase = createClient()
    const { error } = await supabase.rpc("file_match_dispute", {
      p_match_id: matchId,
      p_reason: reason.trim(),
    })

    setSubmitting(false)

    if (error) {
      setMessage({ text: error.message, error: true })
      return
    }

    setMessage({ text: "Dispute filed. An admin will review it.", error: false })
  }

  return (
    <div className="w-full max-w-xs space-y-2 text-left">
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="What looked wrong?"
        rows={3}
        maxLength={2000}
        className="flex w-full rounded-md border border-border bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
      />
      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={submitting}>
          Cancel
        </Button>
        <Button size="sm" variant="outline" onClick={() => void handleSubmit()} disabled={submitting}>
          {submitting ? "Filing…" : "File dispute"}
        </Button>
      </div>
    </div>
  )
}
