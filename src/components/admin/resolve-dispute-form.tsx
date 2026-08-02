"use client"

import { useState, useTransition } from "react"

import { resolveDisputeAction } from "@/actions/admin-disputes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const STATUS_OPTIONS = [
  { value: "reviewing", label: "Reviewing" },
  { value: "upheld", label: "Upheld" },
  { value: "denied", label: "Denied" },
] as const

export function ResolveDisputeForm({ disputeId }: { disputeId: string }) {
  const [status, setStatus] = useState<string>("reviewing")
  const [note, setNote] = useState("")
  const [adjustmentUserId, setAdjustmentUserId] = useState("")
  const [adjustmentDollars, setAdjustmentDollars] = useState("")
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  function handleSubmit() {
    startTransition(async () => {
      const result = await resolveDisputeAction(
        disputeId,
        status,
        note,
        adjustmentUserId,
        adjustmentDollars
      )
      setMessage({ text: result.message ?? "", error: result.status === "error" })
    })
  }

  if (message && !message.error) {
    return <p className="text-sm font-bold text-primary">{message.text}</p>
  }

  return (
    <div className="panel space-y-3 p-3">
      <div className="space-y-1">
        <Label htmlFor={`status-${disputeId}`}>Resolution</Label>
        <select
          id={`status-${disputeId}`}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="flex h-10 w-full rounded-md border border-border bg-white/[0.06] px-3 py-2 text-sm text-foreground focus-visible:border-primary focus-visible:outline-none sm:max-w-xs"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor={`note-${disputeId}`}>Resolution note</Label>
        <textarea
          id={`note-${disputeId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="What did you check, and what did you decide?"
          className="flex w-full rounded-md border border-border bg-white/[0.06] px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor={`adj-user-${disputeId}`}>Adjustment target user id (optional)</Label>
          <Input
            id={`adj-user-${disputeId}`}
            value={adjustmentUserId}
            onChange={(e) => setAdjustmentUserId(e.target.value)}
            placeholder="user uuid"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`adj-amount-${disputeId}`}>Adjustment amount, $ (optional)</Label>
          <Input
            id={`adj-amount-${disputeId}`}
            value={adjustmentDollars}
            onChange={(e) => setAdjustmentDollars(e.target.value)}
            placeholder="e.g. 5.00 or -5.00"
          />
        </div>
      </div>

      {message?.error && <p className="text-xs text-rival">{message.text}</p>}
      <Button size="sm" onClick={handleSubmit} disabled={pending || !note.trim()}>
        {pending ? "Saving…" : "Resolve"}
      </Button>
    </div>
  )
}
