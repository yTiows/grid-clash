# Integration Examples

## Overview

This document shows concrete code examples for integrating the match orchestration system into the tournament workflow.

---

## 1. Admin Tournament Pairing UI

**Location**: `src/components/admin/tournament-pairing-form.tsx`

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Database } from "@/lib/types/database.types";

interface TournamentPairingProps {
  tournamentId: string;
  currentRound: number;
  totalRounds: number;
}

export function TournamentPairingForm({
  tournamentId,
  currentRound,
  totalRounds,
}: TournamentPairingProps) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  async function handlePairRound() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/tournaments/${tournamentId}/pair-round`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundNumber: currentRound }),
      });

      if (!res.ok) {
        throw new Error("Pairing failed");
      }

      const data = await res.json();
      setResult(data);
    } catch (err) {
      setResult({
        created: 0,
        skipped: 0,
        errors: [err instanceof Error ? err.message : "Unknown error"],
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="p-6 bg-slate-800 border-slate-700">
      <h3 className="text-lg font-bold mb-4">Pair Round {currentRound}</h3>

      <div className="mb-4 text-sm text-gray-300">
        <p>
          This will pair all pending matches in Round {currentRound} where both
          players are ready.
        </p>
        <p className="mt-2">
          Progress: {currentRound} / {totalRounds}
        </p>
      </div>

      <Button
        onClick={handlePairRound}
        disabled={loading}
        className="w-full"
      >
        {loading ? "Pairing..." : `Pair Round ${currentRound}`}
      </Button>

      {result && (
        <div className="mt-4 p-4 bg-slate-900 rounded text-sm">
          <p className="text-green-400">
            ✓ Created: {result.created} sessions
          </p>
          <p className="text-yellow-400">⊘ Skipped: {result.skipped} byes</p>
          {result.errors.length > 0 && (
            <div className="mt-2">
              <p className="text-red-400 font-bold">Errors:</p>
              <ul className="list-disc list-inside text-red-300 text-xs">
                {result.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
```

**Usage** (in admin tournament page):

```tsx
import { TournamentPairingForm } from "@/components/admin/tournament-pairing-form";

export async function AdminTournamentPage({
  params,
}: {
  params: { id: string };
}) {
  // Fetch tournament details
  const tournament = await fetchTournament(params.id);

  return (
    <div>
      <h1>{tournament.name}</h1>
      <p>Status: {tournament.status}</p>

      {tournament.status === "in_progress" && (
        <TournamentPairingForm
          tournamentId={tournament.id}
          currentRound={tournament.current_round || 1}
          totalRounds={calculateRounds(tournament.field_size)}
        />
      )}
    </div>
  );
}
```

---

## 2. Pair Round API Handler

**Location**: `src/app/api/admin/tournaments/[id]/pair-round/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { pairRound } from "@/lib/game/match-pairing";
import type { Database } from "@/lib/types/database.types";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const tournamentId = params.id;
  const { roundNumber } = await request.json();

  const cookieStore = await cookies();
  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { get, set, remove } }
  );

  try {
    // Verify user is admin (fetch from RLS policy)
    const { data: isAdmin } = await supabase.rpc("is_admin");
    if (!isAdmin) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 403 }
      );
    }

    // Pair the round
    const result = await pairRound(tournamentId, roundNumber);

    // Mark round as in_progress if all matches paired
    if (result.errors.length === 0 && result.created > 0) {
      await supabase
        .from("tournament_rounds")
        .update({ status: "in_progress" })
        .eq("tournament_id", tournamentId)
        .eq("round_number", roundNumber);
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Pairing failed" },
      { status: 500 }
    );
  }
}
```

---

## 3. Tournament Dashboard Integration

**Location**: `src/app/dashboard/tournaments/[id]/page.tsx`

Shows a player their current tournament status, including active match (if any).

```tsx
"use client";

import { useEffect, useState } from "react";
import { MatchArena } from "@/components/game/match-arena";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface TournamentMatch {
  id: string;
  player_1_id: string;
  player_2_id: string;
  winner_id?: string;
  status: "pending" | "in_progress" | "completed" | "forfeited";
}

export function TournamentDashboard({ tournamentId }: { tournamentId: string }) {
  const [tournament, setTournament] = useState<any>(null);
  const [currentSession, setCurrentSession] = useState<string | null>(null);
  const [matches, setMatches] = useState<TournamentMatch[]>([]);

  useEffect(() => {
    // Fetch tournament and player's matches
    fetchTournamentData();
    const interval = setInterval(fetchTournamentData, 5000); // Poll every 5s
    return () => clearInterval(interval);
  }, [tournamentId]);

  async function fetchTournamentData() {
    const res = await fetch(`/api/tournaments/${tournamentId}`);
    const data = await res.json();
    setTournament(data);

    // Check if player has an active session
    const sessionRes = await fetch(
      `/api/tournaments/${tournamentId}/active-session`
    );
    const sessionData = await sessionRes.json();
    if (sessionData.sessionId) {
      setCurrentSession(sessionData.sessionId);
    }

    // Fetch player's matches
    const matchesRes = await fetch(
      `/api/tournaments/${tournamentId}/my-matches`
    );
    const matchesData = await matchesRes.json();
    setMatches(matchesData);
  }

  // If player has an active match, show the arena
  if (currentSession) {
    return (
      <MatchArena
        sessionId={currentSession}
        playerId={tournament.playerId}
        opponentId={tournament.opponentId}
        tournamentId={tournamentId}
        entryFee={tournament.entryFee}
        winnerPayout={tournament.winnerPayout}
        loserPayout={tournament.loserPayout}
      />
    );
  }

  // Otherwise, show tournament bracket and status
  return (
    <div className="space-y-6">
      <Card className="p-6 bg-slate-800 border-slate-700">
        <h2 className="text-xl font-bold mb-2">{tournament.name}</h2>
        <p className="text-gray-300">Status: {tournament.status}</p>
        <p className="text-gray-300">
          Players: {tournament.currentEntries} / {tournament.fieldSize}
        </p>
      </Card>

      <Card className="p-6 bg-slate-800 border-slate-700">
        <h3 className="text-lg font-bold mb-4">Your Matches</h3>
        <div className="space-y-2">
          {matches.map((match) => (
            <div key={match.id} className="p-3 bg-slate-900 rounded">
              <p className="text-sm text-gray-300">
                Status: <span className="font-mono">{match.status}</span>
              </p>
              {match.winner_id && (
                <p className="text-sm text-green-400">
                  Winner: {match.winner_id === tournament.playerId ? "You" : "Opponent"}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6 bg-slate-800 border-slate-700">
        <h3 className="text-lg font-bold mb-4">Bracket</h3>
        <p className="text-gray-300 text-sm">
          Bracket visualization coming soon. For now, check your matches above.
        </p>
      </Card>
    </div>
  );
}
```

---

## 4. Match Flow: From Entry to Settlement

**Complete tournament entry → play → settlement workflow:**

```ts
// File: src/actions/tournament-workflow.ts

import { createClient } from "@supabase/supabase-js";
import { pairRound } from "@/lib/game/match-pairing";
import { settleMatch } from "@/lib/game/match-settlement";
import type { Database } from "@/lib/types/database.types";

const supabaseAdmin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

/**
 * Complete tournament workflow (for reference/testing):
 * 1. Create tournament
 * 2. Players enter
 * 3. Admin triggers round pairing
 * 4. Players play matches (via MatchArena UI)
 * 5. On match win, system settles and advances bracket
 */

// 1. Create tournament (existing)
export async function createTournament(input: {
  name: string;
  entryFee: number;
  fieldSize: number;
  rulesetId: string;
}) {
  return supabaseAdmin.from("tournaments").insert({
    kind: "tournament_standard",
    name: input.name,
    entry_fee_cents: input.entryFee * 100,
    field_size: input.fieldSize,
    rake_bps: 500, // 5%
    gross_cents: (input.entryFee * 100) * input.fieldSize,
    rake_cents: Math.floor((input.entryFee * 100 * input.fieldSize * 500) / 10000),
    prize_pool_cents: Math.floor(
      (input.entryFee * 100) * input.fieldSize -
        (input.entryFee * 100 * input.fieldSize * 500) / 10000
    ),
    status: "open",
    ruleset_id: input.rulesetId,
    format_id: "single_elimination",
  });
}

// 2. Player enters tournament (existing)
export async function enterTournament(tournamentId: string, userId: string) {
  return supabaseAdmin.rpc("enter_tournament", {
    p_tournament_id: tournamentId,
    p_user_id: userId,
  });
}

// 3. Admin initiates tournament (creates rounds and bracket)
export async function startTournament(tournamentId: string) {
  // Calculate number of rounds for single-elimination
  const { data: tournament } = await supabaseAdmin
    .from("tournaments")
    .select("field_size")
    .eq("id", tournamentId)
    .single();

  if (!tournament) throw new Error("Tournament not found");

  const numRounds = Math.ceil(Math.log2(tournament.field_size));

  // Create tournament_rounds
  for (let i = 1; i <= numRounds; i++) {
    await supabaseAdmin.from("tournament_rounds").insert({
      tournament_id: tournamentId,
      round_number: i,
      status: "pending",
    });
  }

  // Create initial matches for Round 1 (seeds from tournament_entries)
  const { data: entries } = await supabaseAdmin
    .from("tournament_entries")
    .select("id, user_id, seat_number")
    .eq("tournament_id", tournamentId)
    .order("seat_number");

  if (!entries) throw new Error("No entries found");

  const { data: round1 } = await supabaseAdmin
    .from("tournament_rounds")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("round_number", 1)
    .single();

  // Pair round 1 by seeding: 1 vs 2, 3 vs 4, etc.
  let matchCount = 0;
  for (let i = 0; i < entries.length; i += 2) {
    if (i + 1 < entries.length) {
      await supabaseAdmin.from("tournament_matches").insert({
        tournament_id: tournamentId,
        round_id: round1.id,
        player_1_id: entries[i].user_id,
        player_2_id: entries[i + 1].user_id,
        is_bye: false,
        board_position: matchCount + 1,
        status: "pending",
      });
    } else {
      // Odd player: bye
      await supabaseAdmin.from("tournament_matches").insert({
        tournament_id: tournamentId,
        round_id: round1.id,
        player_1_id: entries[i].user_id,
        is_bye: true,
        board_position: matchCount + 1,
        status: "pending",
      });
    }
    matchCount++;
  }

  // Update tournament status
  await supabaseAdmin
    .from("tournaments")
    .update({ status: "in_progress", starts_at: new Date().toISOString() })
    .eq("id", tournamentId);
}

// 4. Admin pairs a round (creates match_sessions)
export async function pairRoundAction(tournamentId: string, roundNumber: number) {
  return pairRound(tournamentId, roundNumber);
}

// 5. After a match is won, settle and advance bracket
export async function settleAndAdvance(
  sessionId: string,
  winnerId: string,
  entryFee: number
) {
  // Calculate payouts (simplified: 80% to winner, 20% rake)
  const prizePool = Math.floor((entryFee * 100 * 0.8) / 2); // Assuming 2 players
  const rakeCents = Math.floor(entryFee * 100 * 0.2);

  // Settle the match
  const result = await settleMatch({
    sessionId,
    winnerId,
    winCondition: "connect_n",
    entryFeeCents: entryFee * 100,
    winnerPayoutCents: prizePool,
    loserPayoutCents: 0,
    platformRakeCents: rakeCents,
  });

  // Get the tournament_match to find tournament and round
  const { data: session } = await supabaseAdmin
    .from("match_sessions")
    .select("tournament_match_id")
    .eq("id", sessionId)
    .single();

  const { data: tournamentMatch } = await supabaseAdmin
    .from("tournament_matches")
    .select("tournament_id, round_id")
    .eq("id", session.tournament_match_id)
    .single();

  // Check if round is complete
  const { data: pendingMatches } = await supabaseAdmin
    .from("tournament_matches")
    .select("id")
    .eq("round_id", tournamentMatch.round_id)
    .neq("status", "completed");

  if (!pendingMatches || pendingMatches.length === 0) {
    // Round complete: advance to next round
    await advanceRound(tournamentMatch.tournament_id);
  }

  return result;
}

// 6. Advance to next round (create matches for winners)
async function advanceRound(tournamentId: string) {
  // Find current round and next round
  const { data: currentRound } = await supabaseAdmin
    .from("tournament_rounds")
    .select("id, round_number")
    .eq("tournament_id", tournamentId)
    .eq("status", "in_progress")
    .order("round_number", { ascending: false })
    .limit(1)
    .single();

  if (!currentRound) return; // No current round

  const nextRoundNum = currentRound.round_number + 1;

  // Get or create next round
  let nextRound = await supabaseAdmin
    .from("tournament_rounds")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("round_number", nextRoundNum)
    .single();

  if (!nextRound.data) {
    const { data: created } = await supabaseAdmin
      .from("tournament_rounds")
      .insert({
        tournament_id: tournamentId,
        round_number: nextRoundNum,
        status: "pending",
      })
      .select()
      .single();

    nextRound = { data: created };
  }

  // Get all winners from current round
  const { data: winners } = await supabaseAdmin
    .from("tournament_matches")
    .select("winner_id")
    .eq("round_id", currentRound.id)
    .not("winner_id", "is", null);

  if (!winners || winners.length === 0) return;

  // Pair winners for next round (1 vs 2, 3 vs 4, etc.)
  let matchCount = 0;
  for (let i = 0; i < winners.length; i += 2) {
    if (i + 1 < winners.length) {
      await supabaseAdmin.from("tournament_matches").insert({
        tournament_id: tournamentId,
        round_id: nextRound.data!.id,
        player_1_id: winners[i].winner_id,
        player_2_id: winners[i + 1].winner_id,
        is_bye: false,
        board_position: matchCount + 1,
        status: "pending",
      });
    } else {
      // Bye for odd winner
      await supabaseAdmin.from("tournament_matches").insert({
        tournament_id: tournamentId,
        round_id: nextRound.data!.id,
        player_1_id: winners[i].winner_id,
        is_bye: true,
        board_position: matchCount + 1,
        status: "pending",
      });
    }
    matchCount++;
  }

  // Mark current round as completed
  await supabaseAdmin
    .from("tournament_rounds")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", currentRound.id);

  // Check if this was the finals (only 1 match in next round)
  if (winners.length === 2) {
    // Finals: check if complete
    const { data: finalMatch } = await supabaseAdmin
      .from("tournament_matches")
      .select("winner_id")
      .eq("round_id", currentRound.id)
      .eq("round_number", currentRound.round_number)
      .single();

    if (finalMatch?.winner_id) {
      // Tournament complete
      await supabaseAdmin
        .from("tournaments")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", tournamentId);
    }
  }
}
```

---

## 5. Testing: 4-Player Tournament End-to-End

```bash
# 1. Create tournament
POST /api/tournaments
{
  "name": "Test Tournament",
  "entryFee": 10,
  "fieldSize": 4,
  "rulesetId": "classic"
}
# Returns: tournamentId = "t1"

# 2. Enter 4 players
POST /api/tournaments/t1/enter  (player A)
POST /api/tournaments/t1/enter  (player B)
POST /api/tournaments/t1/enter  (player C)
POST /api/tournaments/t1/enter  (player D)

# 3. Admin starts tournament
POST /api/admin/tournaments/t1/start
# Creates Round 1 with 2 matches: A vs B, C vs D

# 4. Admin pairs Round 1
POST /api/admin/tournaments/t1/pair-round
{ "roundNumber": 1 }
# Returns: created: 2, skipped: 0

# 5. Player A and B play (via MatchArena UI)
# - A wins match
# Settlement creates matches table entry, advances bracket

# 6. Player C and D play
# - C wins match

# 7. System advances to Round 2
# Creates match: A vs C (finals)

# 8. Admin pairs Round 2
POST /api/admin/tournaments/t1/pair-round
{ "roundNumber": 2 }

# 9. Player A and C play finals
# - A wins

# 10. System marks tournament as completed
# A receives prize, B, C, D receive consolation (or 0)
```

---

## Summary

The integration flow is:

1. **Admin** creates tournament and players enter
2. **Admin** starts tournament (creates bracket rounds)
3. **Admin** (or cron) pairs each round via `/api/admin/tournaments/[id]/pair-round`
4. **Players** view active match in dashboard, click into MatchArena
5. **Players** play match (move validation, clock sync, win detection)
6. **System** settles match when won, auto-advances bracket
7. **Repeat** steps 3-6 for each round until tournament complete

All the infrastructure is in place; the main remaining work is WebSocket integration for real-time movement and clock sync.
