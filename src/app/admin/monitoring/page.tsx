'use client';

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/**
 * Shape matches src/app/api/admin/metrics/route.ts's actual JSON response,
 * field for field. Live match/queue counts ("active matches", "players
 * online") live in the WS server's separate in-memory process state, not
 * this database-backed route — see that route's own comment block. This
 * page only ever renders what it can actually get: persisted revenue,
 * completed-match stats, and a read-side settlement spot-check.
 */
interface MoneyDiscrepancy {
  matchId: string;
  expectedPot: number;
  distributed: number;
}

interface PayoutVerification {
  matchesChecked: number;
  discrepancies: MoneyDiscrepancy[];
}

interface RecentMatch {
  id: string;
  player1: string;
  player2: string;
  winner: string;
  durationSeconds: number;
  entryFeeCents: number;
  rakeCents: number;
  completedAt: string;
}

interface DashboardMetrics {
  todaysRevenue: number;
  todaysRankedRake: number;
  todaysTournamentRake: number;
  avgMatchDurationSeconds: number;
  payoutVerificationStatus: PayoutVerification;
  recentMatches: RecentMatch[];
}

/**
 * Admin Monitoring Dashboard
 *
 * Real operational metrics, backed only by what /api/admin/metrics actually
 * returns:
 * - Revenue tracking (ranked rake, tournament rake, total)
 * - Average completed-match duration
 * - Payout verification (settlement ledger integrity spot-check)
 * - Recent completed matches
 *
 * Live match/player counts are not shown here — see the note in the header
 * grid below.
 */

export default function MonitoringDashboard() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchMetrics = async () => {
    try {
      const res = await fetch('/api/admin/metrics');
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setMetrics(data);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  // Fetch metrics on mount and auto-refresh every 5 seconds
  useEffect(() => {
    fetchMetrics();
    if (!autoRefresh) return;

    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  if (loading) {
    return <div className="p-8 text-muted-foreground">Loading metrics…</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-8">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!metrics) {
    return <div className="p-8 text-muted-foreground">No data available</div>;
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <h1 className="display text-2xl">Platform monitoring</h1>
        <div className="flex items-center gap-4">
          <label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-transparent accent-[color:var(--primary)]"
            />
            Auto-refresh (5s)
          </label>
          <Button size="sm" variant="outline" onClick={fetchMetrics}>
            Refresh now
          </Button>
        </div>
      </div>

      {/* Live counts note — this route is DB-only and cannot see the WS
          server's in-memory state, so there is no fake "0" or stale number
          shown in its place. */}
      <div className="panel mb-8 px-4 py-3 text-sm text-muted-foreground">
        Active matches and players online live in the WS match server&apos;s own
        in-memory state, not this database — that live count isn&apos;t wired into
        this route and isn&apos;t shown here.
      </div>

      {/* Key Metrics Grid — the numbers get the emphasis (mono, larger),
          not four different decorative colors */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Today's revenue" value={metrics.todaysRevenue} money />
        <MetricCard label="Ranked rake" value={metrics.todaysRankedRake} money />
        <MetricCard label="Tournament rake" value={metrics.todaysTournamentRake} money />
        <MetricCard label="Avg match duration" value={`${metrics.avgMatchDurationSeconds}s`} />
      </div>

      {/* Revenue Breakdown */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Revenue breakdown (today)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Ranked rake</span>
            <span className="tabular money">${(metrics.todaysRankedRake / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tournament rake</span>
            <span className="tabular money">${(metrics.todaysTournamentRake / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>Total revenue</span>
            <span className="tabular money">${(metrics.todaysRevenue / 100).toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      {/* Payout Verification Status */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle>Settlement verification</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Ranked matches checked</span>
            <span className="tabular">{metrics.payoutVerificationStatus.matchesChecked}</span>
          </div>

          {metrics.payoutVerificationStatus.discrepancies.length > 0 ? (
            <>
              <Alert variant="destructive">
                <AlertDescription>
                  {metrics.payoutVerificationStatus.discrepancies.length} payout discrepancies
                  detected
                </AlertDescription>
              </Alert>
              <div className="space-y-2 text-sm">
                {metrics.payoutVerificationStatus.discrepancies.slice(0, 10).map((d) => (
                  <div key={d.matchId} className="flex justify-between border-b border-border pb-1">
                    <span className="tabular text-xs text-muted-foreground">{d.matchId.slice(0, 8)}...</span>
                    <span className="tabular">
                      expected ${(d.expectedPot / 100).toFixed(2)}, distributed $
                      {(d.distributed / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-primary">No discrepancies found.</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Matches */}
      <Card>
        <CardHeader>
          <CardTitle>Recent matches</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2 pl-6 font-medium">Match ID</th>
                <th className="font-medium">Players</th>
                <th className="font-medium">Winner</th>
                <th className="font-medium">Duration</th>
                <th className="font-medium">Entry fee</th>
                <th className="font-medium">Rake</th>
                <th className="py-2 pr-6 font-medium">Completed</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recentMatches.map((match) => (
                <tr key={match.id} className="border-b border-border">
                  <td className="tabular py-2 pl-6 text-xs text-muted-foreground">{match.id.slice(0, 8)}...</td>
                  <td className="tabular text-xs">
                    {match.player1.slice(0, 4)}… vs {match.player2.slice(0, 4)}…
                  </td>
                  <td className="tabular text-xs text-primary">{match.winner.slice(0, 4)}…</td>
                  <td className="tabular">{match.durationSeconds}s</td>
                  <td className="tabular money">${(match.entryFeeCents / 100).toFixed(2)}</td>
                  <td className="tabular money">${(match.rakeCents / 100).toFixed(2)}</td>
                  <td className="tabular pr-6 text-xs text-muted-foreground">
                    {new Date(match.completedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Metric Card Component
 */
function MetricCard({
  label,
  value,
  money = false,
}: {
  label: string;
  value: string | number;
  money?: boolean;
}) {
  const display = typeof value === 'number' ? `$${(value / 100).toFixed(2)}` : value;

  return (
    <Card>
      <CardContent className="p-6">
        <p className="mb-2 text-sm text-muted-foreground">{label}</p>
        <p className={`tabular text-3xl font-bold ${money ? 'money' : ''}`}>{display}</p>
      </CardContent>
    </Card>
  );
}
