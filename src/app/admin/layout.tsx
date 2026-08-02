import { redirect } from "next/navigation"

import { DashboardNav } from "@/components/layout/dashboard-nav"
import { createClient } from "@/lib/supabase/server"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // is_admin() reads the caller's own row via auth.uid() — cannot be spoofed
  // by passing a different id, since there's no id parameter to pass.
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) redirect("/dashboard")

  const { data: profile } = await supabase
    .from("users")
    .select("username, balance_cents")
    .eq("id", user.id)
    .single()

  return (
    <div className="relative min-h-screen">
      <DashboardNav username={profile?.username ?? "Admin"} balanceCents={profile?.balance_cents ?? 0} />
      <main className="container relative py-8">
        <div className="mb-4 inline-block rounded-md border-2 border-gold bg-gold/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gold">
          Admin
        </div>
        {children}
      </main>
    </div>
  )
}
