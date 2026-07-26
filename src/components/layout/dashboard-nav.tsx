import Link from "next/link"

import { signOutAction } from "@/actions/auth"
import { Button } from "@/components/ui/button"

export function DashboardNav({
  username,
  balanceCents,
}: {
  username: string
  balanceCents: number
}) {
  return (
    <header className="border-b-2 border-ink bg-card/60">
      <div className="container flex items-center justify-between py-4">
        <Link href="/dashboard" className="display text-xl text-primary">
          Grid Clash
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/dashboard/tournaments" className="text-sm font-semibold text-muted-foreground hover:text-primary">
            Tournaments
          </Link>
          <Link href="/dashboard/wallet" className="text-sm font-semibold text-muted-foreground hover:text-primary">
            Wallet
          </Link>
          <div className="sticker px-3 py-1.5 text-sm">
            <span className="text-muted-foreground">Balance </span>
            <span className="tabular font-bold text-gold">
              ${(balanceCents / 100).toFixed(2)}
            </span>
          </div>
          <span className="hidden text-sm text-muted-foreground sm:inline">{username}</span>
          <form action={signOutAction}>
            <Button variant="outline" size="sm" type="submit">
              Sign out
            </Button>
          </form>
        </div>
      </div>
    </header>
  )
}
