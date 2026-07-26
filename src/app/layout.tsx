import type { Metadata } from "next"

import "./globals.css"

export const metadata: Metadata = {
  title: "Grid Clash — Predict the market. Prove your skill.",
  description:
    "A skill-based 1v1 and tournament game. 2% fee on ranked matches. Break-even at 51%, printed on every stake.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  )
}
