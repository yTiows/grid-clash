"use client"

import { useState } from "react"
import Link from "next/link"

import { signOutAction } from "@/actions/auth"
import { Button } from "@/components/ui/button"

const LINKS = [
  { href: "/practice", label: "Practice" },
  { href: "/dashboard/tournaments", label: "Tournaments" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/dashboard/friends", label: "Friends" },
  { href: "/dashboard/wagers", label: "Wagers" },
  { href: "/dashboard/wallet", label: "Wallet" },
  { href: "/tutorial", label: "Tutorial" },
]

/**
 * Every link plus the balance chip plus username plus sign-out, all in one
 * unwrapping row, is exactly what overflowed a real narrow viewport —
 * caught by an actual screenshot, not by testing only the anonymous
 * landing page (which never has this many nav items). Below `md`, the full
 * row collapses to the wordmark + a compact balance chip + a menu toggle;
 * everything else moves into a stacked panel instead of fighting for the
 * same line.
 */
export function DashboardNav({
  username,
  balanceCents,
}: {
  username: string
  balanceCents: number
}) {
  const [open, setOpen] = useState(false)

  return (
    <header className="border-b border-border">
      <div className="container flex items-center justify-between py-4">
        <Link href="/dashboard" className="text-[0.9375rem] font-semibold tracking-tight">
          Grid Clash
        </Link>

        <div className="hidden items-center gap-4 md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
          <div className="panel px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Balance </span>
            <span className="tabular money font-medium">${(balanceCents / 100).toFixed(2)}</span>
          </div>
          <Link href={`/players/${username}`} className="text-sm text-muted-foreground hover:text-foreground">
            {username}
          </Link>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>

        <div className="flex items-center gap-2 md:hidden">
          <div className="panel px-2.5 py-1 text-xs">
            <span className="tabular money font-medium">${(balanceCents / 100).toFixed(2)}</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label="Menu"
            className="panel flex h-9 w-9 items-center justify-center text-foreground"
          >
            {open ? "✕" : "☰"}
          </button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border md:hidden">
          <div className="container flex flex-col gap-1 py-3">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-sm font-medium text-muted-foreground hover:bg-white/[0.06] hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
            <div className="flex items-center justify-between px-2 py-2 text-sm text-muted-foreground">
              <Link href={`/players/${username}`} onClick={() => setOpen(false)} className="hover:text-foreground">
                {username}
              </Link>
              <form action={signOutAction}>
                <Button variant="outline" size="sm" type="submit">
                  Sign out
                </Button>
              </form>
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
