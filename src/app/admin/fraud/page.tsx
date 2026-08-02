import { listFraudFlagsAction, type FraudFlagSeverity, type FraudFlagWithUsername } from "@/actions/admin-moderation"
import { ReviewFraudFlagForm } from "@/components/admin/review-fraud-flag-form"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const SEVERITY_ORDER: FraudFlagSeverity[] = ["critical", "high", "medium", "low"]

const SEVERITY_BADGE: Record<FraudFlagSeverity, NonNullable<BadgeProps["variant"]>> = {
  critical: "rival",
  high: "rival",
  medium: "outline",
  low: "muted",
}

export default async function AdminFraudPage() {
  const flags = await listFraudFlagsAction()

  const bySeverity = new Map<FraudFlagSeverity, FraudFlagWithUsername[]>()
  for (const flag of flags) {
    const list = bySeverity.get(flag.severity) ?? []
    list.push(flag)
    bySeverity.set(flag.severity, list)
  }

  return (
    <div className="space-y-6">
      <h1 className="display text-2xl">Fraud review</h1>

      {flags.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No unreviewed flags.
          </CardContent>
        </Card>
      ) : (
        SEVERITY_ORDER.filter((severity) => (bySeverity.get(severity)?.length ?? 0) > 0).map(
          (severity) => (
            <Card key={severity}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <CardTitle className="text-lg capitalize">{severity}</CardTitle>
                  <Badge variant={SEVERITY_BADGE[severity]}>{bySeverity.get(severity)?.length}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {bySeverity.get(severity)!.map((flag) => (
                  <div
                    key={flag.id}
                    className="flex items-start justify-between gap-4 border-b border-white/15 py-3 last:border-0"
                  >
                    <div>
                      <div className="font-bold">{flag.username}</div>
                      <div className="text-xs text-muted-foreground">
                        {flag.flagType.replace(/_/g, " ")} · {new Date(flag.triggeredAt).toLocaleString()}
                      </div>
                      {flag.reason && <div className="mt-1 text-sm">{flag.reason}</div>}
                    </div>
                    <ReviewFraudFlagForm flagId={flag.id} />
                  </div>
                ))}
              </CardContent>
            </Card>
          )
        )
      )}
    </div>
  )
}
