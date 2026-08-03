"use client"

import { useState, useTransition } from "react"
import Link from "next/link"

import { searchUsersAction, sendFriendRequestAction, type FriendActionState } from "@/actions/friends"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

const initial: FriendActionState = { status: "idle", message: null }

export function FriendSearch() {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<{ id: string; username: string }[]>([])
  const [sent, setSent] = useState<Set<string>>(new Set())
  const [message, setMessage] = useState<FriendActionState>(initial)
  const [pending, startTransition] = useTransition()

  function handleChange(value: string) {
    setQuery(value)
    startTransition(async () => {
      const found = await searchUsersAction(value)
      setResults(found)
    })
  }

  function sendRequest(username: string) {
    startTransition(async () => {
      const formData = new FormData()
      formData.set("username", username)
      const result = await sendFriendRequestAction(initial, formData)
      setMessage(result)
      if (result.status === "success") {
        setSent((prev) => new Set(prev).add(username))
      }
    })
  }

  return (
    <div className="space-y-3">
      <Input
        type="text"
        placeholder="Search by username…"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
      />
      {message.status === "error" && <p className="text-xs text-rival">{message.message}</p>}
      {results.length > 0 && (
        <ul className="divide-y divide-white/15 rounded-md border border-border">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-3 py-2">
              <Link href={`/players/${r.username}`} className="text-sm font-medium hover:text-primary">
                {r.username}
              </Link>
              {sent.has(r.username) ? (
                <span className="text-xs text-muted-foreground">Sent</span>
              ) : (
                <Button size="sm" variant="outline" disabled={pending} onClick={() => sendRequest(r.username)}>
                  Add
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
