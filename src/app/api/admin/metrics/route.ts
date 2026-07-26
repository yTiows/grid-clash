import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * GET /api/admin/metrics
 *
 * Operational metrics for the admin monitoring dashboard. Live match/queue
 * counts live in the WS server's in-memory state, not this database — this
 * route only ever reports on what's persisted (revenue, completed matches,
 * payout verification). A live-concurrency figure would need its own read
 * from the WS process and isn't wired here.
 *
 * Returns:
 * {
 *   "todaysRevenue": cents,      // platform_ledger entries today, ranked + tournament
 *   "todaysRankedRake": cents,
 *   "todaysTournamentRake": cents,
 *   "avgMatchDurationSeconds": number,
 *   "payoutVerificationStatus": {...},
 *   "recentMatches": [...]
 * }
 */
export async function GET() {
  // Same gate every admin surface in this app uses — a real session plus
  // is_admin(), not a bearer secret. Consistent with src/app/admin/layout.tsx
  // and src/actions/admin-tournaments.ts.
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { data: isAdmin } = await supabase.rpc('is_admin');
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  try {
    const todayStart = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

    // platform_ledger is the single source of truth for house revenue —
    // ranked_rake (settle_ranked_match) and tournament_rake
    // (complete_tournament) both land here. Summing matches.platform_rake_cents
    // instead would silently miss every tournament, which never touches
    // that column.
    const { data: ledgerToday, error: ledgerError } = await admin
      .from('platform_ledger')
      .select('entry_type, amount_cents')
      .gte('created_at', todayStart);
    if (ledgerError) throw ledgerError;

    let todaysRankedRake = 0;
    let todaysTournamentRake = 0;
    for (const row of ledgerToday ?? []) {
      if (row.entry_type === 'ranked_rake') todaysRankedRake += row.amount_cents;
      else if (row.entry_type === 'tournament_rake') todaysTournamentRake += row.amount_cents;
    }
    const todaysRevenue = todaysRankedRake + todaysTournamentRake;

    const { data: durations, error: durationError } = await admin
      .from('matches')
      .select('duration_seconds')
      .not('duration_seconds', 'is', null)
      .gte('completed_at', todayStart);
    if (durationError) throw durationError;

    const avgMatchDurationSeconds =
      durations && durations.length > 0
        ? Math.round(
            durations.reduce((sum, m) => sum + (m.duration_seconds ?? 0), 0) / durations.length
          )
        : 0;

    const { data: recentMatches, error: recentError } = await admin
      .from('matches')
      .select(
        'id, player_1_id, player_2_id, winner_id, duration_seconds, entry_fee_cents, platform_rake_cents, completed_at'
      )
      .order('completed_at', { ascending: false })
      .limit(10);
    if (recentError) throw recentError;

    // Money-conservation spot-check over ranked matches (settle_ranked_match
    // already asserts this inline at settlement time — this is a second,
    // independent read-side check, not the only guard).
    const { data: allRankedMatches, error: verifyError } = await admin
      .from('matches')
      .select('id, entry_fee_cents, winner_payout_cents, loser_payout_cents, platform_rake_cents')
      .eq('ranked', true);
    if (verifyError) throw verifyError;

    const moneyDiscrepancies: Array<{ matchId: string; expectedPot: number; distributed: number }> = [];
    for (const m of allRankedMatches ?? []) {
      const pot = m.entry_fee_cents * 2;
      const distributed = (m.winner_payout_cents ?? 0) + (m.loser_payout_cents ?? 0) + (m.platform_rake_cents ?? 0);
      if (distributed !== pot) {
        moneyDiscrepancies.push({ matchId: m.id, expectedPot: pot, distributed });
      }
    }

    return NextResponse.json({
      todaysRevenue,
      todaysRankedRake,
      todaysTournamentRake,
      avgMatchDurationSeconds,
      payoutVerificationStatus: {
        matchesChecked: (allRankedMatches ?? []).length,
        discrepancies: moneyDiscrepancies,
      },
      recentMatches: (recentMatches ?? []).map((m) => ({
        id: m.id,
        player1: m.player_1_id,
        player2: m.player_2_id,
        winner: m.winner_id,
        durationSeconds: m.duration_seconds ?? 0,
        entryFeeCents: m.entry_fee_cents ?? 0,
        rakeCents: m.platform_rake_cents ?? 0,
        completedAt: m.completed_at,
      })),
    });
  } catch (error) {
    console.error('Error fetching admin metrics:', error);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }
}
