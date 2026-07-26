'use client';

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface DashboardMetrics {
  activeMatches: number;
  totalPlayersOnline: number;
  todaysRevenue: number;
  todaysRake: number;
  todaysPayouts: number;
  avgMatchDuration: number;
  suspiciousActivities: SuspiciousActivity[];
  payoutVerificationStatus: PayoutVerification;
  recentMatches: RecentMatch[];
}

interface SuspiciousActivity {
  id: string;
  type: 'rate_limit' | 'replay_detected' | 'money_leak' | 'concurrent_match' | 'invalid_move';
  player_id: string;
  severity: 'info' | 'warning' | 'error';
  description: string;
  timestamp: string;
}

interface PayoutVerification {
  total_matches_verified: number;
  total_matches_unverified: number;
  total_money_processed: number;
  total_house_rake: number;
  money_discrepancies: MoneyDiscrepancy[];
}

interface MoneyDiscrepancy {
  match_id: string;
  expected_payout: number;
  actual_payout: number;
  difference: number;
}

interface RecentMatch {
  id: string;
  player_1: string;
  player_2: string;
  winner: string;
  duration_seconds: number;
  payout_verified: boolean;
  entry_fee: number;
  rake: number;
  timestamp: string;
}

/**
 * Admin Monitoring Dashboard
 *
 * Real-time operational metrics for the platform:
 * - Active matches & player count
 * - Revenue tracking (rake, payouts)
 * - Fraud detection (rate limits, suspicious patterns)
 * - Payout verification (settlement ledger integrity)
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

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Active Matches"
          value={metrics.activeMatches}
          color="blue"
        />
        <MetricCard
          label="Players Online"
          value={metrics.totalPlayersOnline}
          color="green"
        />
        <MetricCard
          label="Today's Revenue"
          value={`$${(metrics.todaysRevenue / 100).toFixed(2)}`}
          color="purple"
        />
        <MetricCard
          label="House Rake"
          value={`$${(metrics.todaysRake / 100).toFixed(2)}`}
          color="orange"
        />
      </div>

      {/* Revenue Breakdown */}
      <Card className="bg-gray-800 border-gray-700 p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">Revenue Breakdown (Today)</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>Total Payouts:</span>
            <span className="font-mono">${(metrics.todaysPayouts / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>House Rake (1%):</span>
            <span className="font-mono text-green-400">
              ${(metrics.todaysRake / 100).toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between font-bold border-t border-gray-700 pt-2">
            <span>Net Revenue:</span>
            <span className="font-mono">
              ${((metrics.todaysRake - metrics.todaysPayouts) / 100).toFixed(2)}
            </span>
          </div>
        </div>
      </Card>

      {/* Suspicious Activities */}
      {metrics.suspiciousActivities.length > 0 && (
        <Card className="bg-red-900 border-red-700 p-6 mb-8">
          <h2 className="text-xl font-bold mb-4">⚠️ Suspicious Activities</h2>
          <div className="space-y-2 text-sm">
            {metrics.suspiciousActivities.slice(0, 10).map((activity) => (
              <div key={activity.id} className="flex justify-between">
                <span className="text-gray-300">{activity.type}</span>
                <span className="text-gray-400">{activity.description}</span>
              </div>
            ))}
          </div>
          {metrics.suspiciousActivities.length > 10 && (
            <p className="text-xs text-gray-400 mt-2">
              +{metrics.suspiciousActivities.length - 10} more activities
            </p>
          )}
        </Card>
      )}

      {/* Payout Verification Status */}
      <Card className="bg-gray-800 border-gray-700 p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">Settlement Verification</h2>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-400 text-sm">Total Money Processed</p>
              <p className="text-2xl font-bold">
                ${(metrics.payoutVerificationStatus.total_money_processed / 100).toFixed(2)}
              </p>
            </div>
            <div>
              <p className="text-gray-400 text-sm">House Rake Collected</p>
              <p className="text-2xl font-bold text-green-400">
                ${(metrics.payoutVerificationStatus.total_house_rake / 100).toFixed(2)}
              </p>
            </div>
          </div>

          <div className="border-t border-gray-700 pt-4">
            <div className="flex justify-between mb-2">
              <span>Verified Matches:</span>
              <span className="text-green-400">
                {metrics.payoutVerificationStatus.total_matches_verified}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Unverified Matches:</span>
              <span className="text-yellow-400">
                {metrics.payoutVerificationStatus.total_matches_unverified}
              </span>
            </div>
          </div>

          {/* Money Discrepancies */}
          {metrics.payoutVerificationStatus.money_discrepancies.length > 0 && (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>
                {metrics.payoutVerificationStatus.money_discrepancies.length} payout
                discrepancies detected
              </AlertDescription>
            </Alert>
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
                <th>Verified</th>
              </tr>
            </thead>
            <tbody>
              {metrics.recentMatches.map((match) => (
                <tr key={match.id} className="border-b border-gray-700">
                  <td className="py-2 font-mono text-xs">{match.id.slice(0, 8)}...</td>
                  <td>{match.player_1.slice(0, 4)}... vs {match.player_2.slice(0, 4)}...</td>
                  <td className="text-green-400">{match.winner.slice(0, 4)}...</td>
                  <td>{match.duration_seconds}s</td>
                  <td>${(match.entry_fee / 100).toFixed(2)}</td>
                  <td>${(match.rake / 100).toFixed(2)}</td>
                  <td>
                    <span
                      className={
                        match.payout_verified ? 'text-green-400' : 'text-yellow-400'
                      }
                    >
                      {match.payout_verified ? '✓' : '⧖'}
                    </span>
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
