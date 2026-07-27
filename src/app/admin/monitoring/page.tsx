'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

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
    return <div className="p-8">Loading metrics...</div>;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="m-8">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (!metrics) {
    return <div className="p-8">No data available</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8">
      {/* Header */}
      <div className="mb-8 flex justify-between items-center">
        <h1 className="text-3xl font-bold">Platform Monitoring</h1>
        <div className="space-x-4">
          <label className="inline-flex items-center">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="mr-2"
            />
            Auto-refresh (5s)
          </label>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700"
          >
            Refresh Now
          </button>
        </div>
      </div>

      {/* Live counts note — this route is DB-only and cannot see the WS
          server's in-memory state, so there is no fake "0" or stale number
          shown in its place. */}
      <div className="mb-8 rounded border-2 border-gray-700 bg-gray-800/60 px-4 py-3 text-sm text-gray-400">
        Active matches and players online live in the WS match server&apos;s own
        in-memory state, not this database — that live count isn&apos;t wired into
        this route and isn&apos;t shown here.
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Today's Revenue"
          value={`$${(metrics.todaysRevenue / 100).toFixed(2)}`}
          color="purple"
        />
        <MetricCard
          label="Ranked Rake"
          value={`$${(metrics.todaysRankedRake / 100).toFixed(2)}`}
          color="green"
        />
        <MetricCard
          label="Tournament Rake"
          value={`$${(metrics.todaysTournamentRake / 100).toFixed(2)}`}
          color="orange"
        />
        <MetricCard
          label="Avg Match Duration"
          value={`${metrics.avgMatchDurationSeconds}s`}
          color="blue"
        />
      </div>

      {/* Revenue Breakdown */}
      <Card className="bg-gray-800 border-gray-700 p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">Revenue Breakdown (Today)</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Ranked Rake:</span>
            <span className="font-mono">${(metrics.todaysRankedRake / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>Tournament Rake:</span>
            <span className="font-mono">${(metrics.todaysTournamentRake / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold border-t border-gray-700 pt-2">
            <span>Total Revenue:</span>
            <span className="font-mono text-green-400">
              ${(metrics.todaysRevenue / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </Card>

      {/* Payout Verification Status */}
      <Card className="bg-gray-800 border-gray-700 p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">Settlement Verification</h2>
        <div className="space-y-4">
          <div className="flex justify-between">
            <span>Ranked Matches Checked:</span>
            <span className="text-gray-300">{metrics.payoutVerificationStatus.matchesChecked}</span>
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
                  <div key={d.matchId} className="flex justify-between border-b border-gray-700 pb-1">
                    <span className="font-mono text-xs text-gray-400">{d.matchId.slice(0, 8)}...</span>
                    <span>
                      expected ${(d.expectedPot / 100).toFixed(2)}, distributed $
                      {(d.distributed / 100).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-green-400">No discrepancies found.</p>
          )}
        </div>
      </Card>

      {/* Recent Matches */}
      <Card className="bg-gray-800 border-gray-700 p-6">
        <h2 className="text-xl font-bold mb-4">Recent Matches</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-700">
                <th className="text-left py-2">Match ID</th>
                <th>Players</th>
                <th>Winner</th>
                <th>Duration</th>
                <th>Entry Fee</th>
                <th>Rake</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recentMatches.map((match) => (
                <tr key={match.id} className="border-b border-gray-700">
                  <td className="py-2 font-mono text-xs">{match.id.slice(0, 8)}...</td>
                  <td>
                    {match.player1.slice(0, 4)}... vs {match.player2.slice(0, 4)}...
                  </td>
                  <td className="text-green-400">{match.winner.slice(0, 4)}...</td>
                  <td>{match.durationSeconds}s</td>
                  <td>${(match.entryFeeCents / 100).toFixed(2)}</td>
                  <td>${(match.rakeCents / 100).toFixed(2)}</td>
                  <td className="text-xs text-gray-400">
                    {new Date(match.completedAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  const colorClasses = {
    blue: 'border-blue-500 bg-blue-900/20',
    green: 'border-green-500 bg-green-900/20',
    purple: 'border-purple-500 bg-purple-900/20',
    orange: 'border-orange-500 bg-orange-900/20',
  };

  return (
    <Card
      className={`${colorClasses[color as keyof typeof colorClasses]} border-2 p-6`}
    >
      <p className="text-gray-400 text-sm mb-2">{label}</p>
      <p className="text-3xl font-bold">{value}</p>
    </Card>
  );
}
