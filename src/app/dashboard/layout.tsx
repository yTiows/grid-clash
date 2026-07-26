import { redirect } from "next/navigation"

import { DashboardNav } from "@/components/layout/dashboard-nav"
import { createClient } from "@/lib/supabase/server"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect("/login")

  const { data: profile } = await supabase
    .from("users")
    .select("username, balance_cents")
    .eq("id", user.id)
    .single()

  return (
    <div className="halftone relative min-h-screen">
      <DashboardNav username={profile?.username ?? "Player"} balanceCents={profile?.balance_cents ?? 0} />
      <main className="container relative py-8">{children}</main>
    </div>
  )
}
