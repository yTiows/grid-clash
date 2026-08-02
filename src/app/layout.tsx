import type { Metadata } from "next"
import { Inter, JetBrains_Mono } from "next/font/google"

import "./globals.css"
import { breakEvenWinRate, formatPercent, FEE_TIERS } from "@/lib/game/fees"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
})

/**
 * Every number that matters — the clock, Elo, stakes, coordinates — renders
 * in mono. It's the one typographic signature the whole system hangs off:
 * precision as a visual idea, not just a claim in the copy.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
  display: "swap",
})

// FOUND BY: the same "2% fee" drift already fixed on the landing page
// (src/app/page.tsx) and caught here by a parallel review of this session's
// own work — this file had the identical stale figure (2% / 51%) in its
// <meta name="description">, which search engines and social link previews
// read directly. Derived from FEE_TIERS.standard so it can't drift again.
const standardFeePercent = (FEE_TIERS.standard.bps / 100).toFixed(0)
const breakEven = formatPercent(breakEvenWinRate(2000, "standard"))

export const metadata: Metadata = {
  title: "Grid Clash — Predict the market. Prove your skill.",
  description: `A skill-based 1v1 and tournament game. ${standardFeePercent}% fee on ranked matches. Break-even at ${breakEven}, printed on every stake.`,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  )
}
