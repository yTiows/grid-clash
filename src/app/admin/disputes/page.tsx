import { ResolveDisputeForm } from "@/components/admin/resolve-dispute-form"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { createClient } from "@/lib/supabase/server"

export default async function AdminDisputesPage() {
  const supabase = createClient()

  // list_open_disputes() is `security definer` and internally re-checks
  // is_admin() via auth.uid() — called under the caller's own RLS-scoped
  // session, same as every read this admin surface needs no service-role
  // client for.
  const { data: disputes } = await supabase.rpc("list_open_disputes")

  // Two plain queries joined in JS, not a nested select — see
  // src/app/dashboard/tournaments/page.tsx's comment on why this codebase
  // never relies on PostgREST's automatic relationship inference.
  const filerIds = [...new Set((disputes ?? []).map((d) => d.filed_by_user_id))]
  const { data: users } = await supabase
    .from("users")
    .select("id, username")
    .in("id", filerIds.length > 0 ? filerIds : ["__none__"])

  const usernameById = new Map((users ?? []).map((u) => [u.id, u.username]))

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Match disputes</h1>

      <Card>
        <CardHeader>
          <CardTitle>Open &amp; reviewing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {!disputes || disputes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open disputes.</p>
          ) : (
            disputes.map((dispute) => (
              <div key={dispute.id} className="space-y-3 border-b border-white/10 py-4 last:border-0">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-bold">
                      {usernameById.get(dispute.filed_by_user_id) ?? dispute.filed_by_user_id.slice(0, 8)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Match {dispute.match_id.slice(0, 8)} · filed{" "}
                      {new Date(dispute.created_at).toLocaleString()}
                    </div>
                    <p className="mt-2 text-sm">{dispute.reason}</p>
                  </div>
                  <Badge variant={dispute.status === "reviewing" ? "outline" : "muted"}>
                    {dispute.status}
                  </Badge>
                </div>

                <ResolveDisputeForm disputeId={dispute.id} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
