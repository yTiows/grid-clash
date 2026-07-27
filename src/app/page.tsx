import Link from "next/link"

import { Button } from "@/components/ui/button"
import { breakEvenWinRate, formatPercent, FEE_TIERS } from "@/lib/game/fees"

const BREAK_EVEN = breakEvenWinRate(2000, "standard")
/**
 * FOUND BY: rendering this page in a browser and reading it — the headline
 * break-even figure above is computed from FEE_TIERS.standard (1%, fixed
 * per fees.ts's own comment: "It was drifting out of sync with the code,
 * which still charged 200bps... Fixed here, not in the copy"), but this
 * paragraph hardcoded the literal string "2%" — the exact rate that fix was
 * about, left behind in the one place a prospective player reads it before
 * ever seeing the dashboard. Derived now so the two numbers on this page
 * cannot disagree with each other again.
 */
const STANDARD_FEE_PERCENT = (FEE_TIERS.standard.bps / 100).toFixed(0)

const RULESETS = [
  { name: "Classic", blurb: "5×5, connect 4. One shield, one bomb, one swap." },
  { name: "Blitz", blurb: "Classic on a 3-second clock. Read faster." },
  { name: "Siege", blurb: "6×6, connect 5. Deeper board, heavier toolkit." },
  { name: "Demolition", blurb: "Four bombs each. Nothing you build is safe." },
]

export default function LandingPage() {
  return (
    <div className="halftone relative flex min-h-screen flex-col overflow-hidden">
      <header className="container relative flex items-center justify-between py-6">
        <span className="display text-2xl text-primary">Grid Clash</span>
        <nav className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild>
            <Link href="/signup">Sign up</Link>
          </Button>
        </nav>
      </header>

      <main className="container relative flex flex-1 flex-col items-center justify-center gap-8 py-20 text-center">
        <div className="foil inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold">
          Break-even at {formatPercent(BREAK_EVEN)} — a strong player clears it
        </div>

        <h1 className="display display-xl max-w-4xl text-foreground">
          Predict the board. <span className="text-primary">Clash</span> for real stakes.
        </h1>

        <p className="max-w-xl text-balance text-lg text-muted-foreground">
          A 5×5 tactical game with hidden pieces and a 5-second clock. {STANDARD_FEE_PERCENT}% fee
          on ranked matches — the lowest in the category, printed on every stake before you play.
        </p>

        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/signup">Create account — free</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">I already play</Link>
          </Button>
        </div>

        <Link href="/tutorial" className="text-sm font-bold text-primary hover:underline">
          New here? Try the tutorial →
        </Link>

        <div className="mt-8 grid w-full max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
          {RULESETS.map((r) => (
            <div key={r.name} className="sticker p-4 text-left">
              <div className="display text-sm text-primary">{r.name}</div>
              <p className="mt-1 text-xs text-muted-foreground">{r.blurb}</p>
            </div>
          ))}
        </div>

        <p className="max-w-lg text-xs text-muted-foreground">
          Grid Clash is a skill-based competitive platform. Matches are for entertainment, not a
          source of income. No purchase is necessary to play. Deposit limits and self-exclusion
          are available on every account. 18+.
        </p>
      </main>
    </div>
  )
}
