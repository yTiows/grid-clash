import { listAutomationReviewsAction } from "@/actions/admin-automation"
import { ResolveAutomationReviewForm } from "@/components/admin/resolve-automation-review-form"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const ACTION_BADGE: Record<string, NonNullable<BadgeProps["variant"]>> = {
  freeze: "rival",
  review: "outline",
  monitor: "muted",
}

/**
 * Open automation_reviews — see src/lib/game/anti-cheat.ts for how
 * suspicion_score is computed and src/app/api/cron/detect-automation for
 * what writes rows here. Signal values are shown because this screen is
 * the one place they're meant to be seen: the migration's own comment says
 * they're withheld from every other surface specifically so publishing
 * thresholds doesn't write the evasion guide.
 */
export default async function AdminAutomationPage() {
  const reviews = await listAutomationReviewsAction()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="display text-2xl">Automation review</h1>
        <p className="text-sm text-muted-foreground">
          Confirming refunds the humans this account beat, in the last 30 days of ranked play.
          Clearing restores an account this system suspended.
        </p>
      </div>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No open reviews.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {reviews.length} open review{reviews.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {reviews.map((r) => (
              <div key={r.id} className="space-y-3 border-b border-white/15 pb-4 last:border-0 last:pb-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{r.username}</span>
                    <Badge variant={ACTION_BADGE[r.action] ?? "muted"} className="capitalize">
                      {r.action}
                    </Badge>
                  </div>
                  <span className="tabular text-xs text-muted-foreground">
                    opened {new Date(r.openedAt).toLocaleString()}
                  </span>
                </div>

                <div className="tabular grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-4">
                  <div>
                    Suspicion <span className="font-semibold text-foreground">{r.suspicionScore}/100</span>
                  </div>
                  <div>
                    Latency σ{" "}
                    <span className="font-semibold text-foreground">
                      {r.latencyStdDevMs !== null ? `${Math.round(r.latencyStdDevMs)}ms` : "—"}
                    </span>
                  </div>
                  <div>
                    Longest session{" "}
                    <span className="font-semibold text-foreground">
                      {r.longestSessionHours !== null ? `${r.longestSessionHours.toFixed(1)}h` : "—"}
                    </span>
                  </div>
                  <div>
                    Active hours{" "}
                    <span className="font-semibold text-foreground">
                      {r.activeHoursSpread !== null ? `${r.activeHoursSpread}/24` : "—"}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sampled from {r.matchesSampled} ranked matches.
                </p>

                <ResolveAutomationReviewForm reviewId={r.id} />
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
