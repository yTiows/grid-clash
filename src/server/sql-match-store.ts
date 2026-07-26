/**
 * SQL-backed MatchStore.
 *
 * Runs in two contexts: bundled into the Next.js server and, via
 * src/server/entrypoint.ts, as a standalone Node process. It deliberately
 * avoids the `server-only` package for the same reason admin.ts does — that
 * guard is Next-bundler-specific and would crash the standalone process on
 * import.
 *
 * The seam between the match server and the ledger. Deliberately thin: every
 * operation delegates to a database function that owns the transaction, so
 * there is no window in which this process holds money-bearing state that the
 * database does not.
 *
 * Elo and fees are computed here rather than in SQL so the formulas have one
 * tested implementation (fees.ts). The database validates what it is given —
 * settle_ranked_match rejects any settlement where fee + payout does not equal
 * the pot — so a bug here fails loudly instead of silently mispaying.
 */

import { createAdminClient } from "@/lib/supabase/admin"
import {
  calculateMatchFee,
  calculateRatingChange,
  type FeeTier,
  type PrizePool,
} from "@/lib/game/fees"
import {
  initialStandings,
  planRound,
  advanceRound,
  finalPlacings,
  type Entrant,
  type StandingRow,
  type RoundResult,
} from "@/lib/game/bracket"
import { distributePrizePool, type FormatId } from "@/lib/game/formats"
import type { MatchStore, SettlementInput, TournamentMatchup, TournamentSettlementInput } from "@/server/match-server"
import type { PlayerSlot } from "@/lib/game/engine"

type Admin = ReturnType<typeof createAdminClient>

export class SqlMatchStore implements MatchStore {
  private readonly db: Admin
  /**
   * Per-tournament re-entrancy guard. Two matches in the same round can
   * complete within milliseconds of each other; without this, both calls
   * could observe "round complete" before either has created the next one.
   * Only coordinates within this process — sufficient for a single WS server
   * instance, not across a future multi-instance deployment.
   */
  private readonly advancing = new Set<string>()

  constructor(db?: Admin) {
    this.db = db ?? createAdminClient()
  }

  /**
   * Eligibility gate plus debit, atomically. Returns null on refusal — the
   * caller cannot distinguish "insufficient balance" from "self-excluded"
   * from "wrong jurisdiction", which is deliberate: the reason belongs in the
   * account page, not in a queue response that anyone can probe.
   */
  async reserveStake(userId: string, stakeCents: number): Promise<string | null> {
    const { data, error } = await this.db.rpc("reserve_stake", {
      p_user_id: userId,
      p_amount_cents: stakeCents,
    })

    if (error) {
      // Expected refusals (limits, exclusion, funds) surface as Postgres
      // exceptions. Log for operators; tell the player nothing specific.
      console.warn("[reserveStake] refused", { userId, stakeCents, message: error.message })
      return null
    }

    return (data as string | null) ?? null
  }

  /**
   * Idempotent: refund_stake locks the row and no-ops on a resolved hold, so a
   * retry after a network failure cannot double-credit.
   */
  async refundStake(reservationId: string): Promise<void> {
    const { error } = await this.db.rpc("refund_stake", {
      p_reservation_id: reservationId,
    })

    if (error) {
      // A failed refund leaves money out of a player's balance. The scheduled
      // reconcile_orphan_reservations() sweep is the backstop, which is why
      // this logs loudly rather than throwing into the socket handler.
      console.error("[refundStake] FAILED — orphan sweep will recover", {
        reservationId,
        message: error.message,
      })
    }
  }

  async settleMatch(
    input: SettlementInput
  ): Promise<{ eloDeltaWinner: number; eloDeltaLoser: number }> {
    const { winnerId, loserId, isDraw, stakeCents } = input

    const participants = await this.loadParticipants(input)

    const rating = isDraw
      ? { winnerDelta: 0, loserDelta: 0 }
      : calculateRatingChange(
          participants.winner.eloRating,
          participants.winner.matchesPlayed,
          participants.loser.eloRating,
          participants.loser.matchesPlayed
        )

    // Fee is charged at the winner's tier. Read at settlement time so a tier
    // change mid-match cannot retroactively alter what was owed.
    const fee = calculateMatchFee(stakeCents, participants.winner.feeTier)

    const { data, error } = await this.db.rpc("settle_ranked_match", {
      p_match_id: input.matchId,
      p_reservation_1: input.reservationIds[1],
      p_reservation_2: input.reservationIds[2],
      p_winner_id: winnerId,
      p_loser_id: loserId,
      p_is_draw: isDraw,
      p_stake_cents: stakeCents,
      p_fee_cents: isDraw ? 0 : fee.feeCents,
      p_winner_payout_cents: isDraw ? stakeCents : fee.winnerPayoutCents,
      p_elo_delta_winner: rating.winnerDelta,
      p_elo_delta_loser: rating.loserDelta,
      p_reason: input.reason,
      p_duration_seconds: input.durationSeconds,
      p_replay: {
        reason: input.reason,
        moves: input.moveSequence.length,
        durationSeconds: input.durationSeconds,
      },
      p_move_sequence: input.moveSequence,
      // Server-measured. Never taken from a client.
      p_timings_1: input.moveLatenciesBySlot[1],
      p_timings_2: input.moveLatenciesBySlot[2],
    })

    if (error) {
      // Settlement is the one operation that must not fail silently: the
      // stakes are already debited and the players are waiting on a result.
      console.error("[settleMatch] FAILED", { matchId: input.matchId, message: error.message })
      throw new Error(`Settlement failed for match ${input.matchId}: ${error.message}`)
    }

    // false means already settled — a retry, or a second server instance
    // racing this one. Not an error.
    if (data === false) {
      console.warn("[settleMatch] already settled, ignoring", { matchId: input.matchId })
    }

    return {
      eloDeltaWinner: rating.winnerDelta,
      eloDeltaLoser: rating.loserDelta,
    }
  }

  /**
   * Linked accounts must never be paired. Checked at matchmaking rather than
   * in post-hoc review, because a settled collusive match has already moved
   * the money.
   *
   * Fails closed: if the check errors, the pairing is refused. A missed match
   * costs a few seconds of queue time; a missed collusion costs real money.
   */
  async arePlayersLinked(a: string, b: string): Promise<boolean> {
    const { data, error } = await this.db.rpc("accounts_are_linked", { a, b })

    if (error) {
      console.error("[arePlayersLinked] check failed, refusing pairing", {
        message: error.message,
      })
      return true
    }

    return data === true
  }

  async getPlayerCard(userId: string): Promise<{ username: string; eloRating: number }> {
    const { data, error } = await this.db
      .from("users")
      .select("username, elo_rating")
      .eq("id", userId)
      .single()

    if (error || !data) {
      return { username: "Unknown", eloRating: 1600 }
    }

    return { username: data.username, eloRating: data.elo_rating }
  }

  /**
   * Two plain queries joined in JS rather than a nested select — the same
   * convention used everywhere else here, because database.types.ts leaves
   * FK relationships unasserted (see the types file header).
   */
  async getTournamentMatchup(tournamentMatchId: string): Promise<TournamentMatchup | null> {
    const { data: match } = await this.db
      .from("tournament_matches")
      .select("id, tournament_id, player_1_id, player_2_id, status")
      .eq("id", tournamentMatchId)
      .maybeSingle()

    if (!match || match.status !== "pending") return null
    if (!match.player_1_id || !match.player_2_id) return null

    const { data: tournament } = await this.db
      .from("tournaments")
      .select("ruleset_id")
      .eq("id", match.tournament_id)
      .maybeSingle()

    if (!tournament) return null

    return {
      tournamentMatchId: match.id,
      player1: match.player_1_id,
      player2: match.player_2_id,
      rulesetId: tournament.ruleset_id,
    }
  }

  async recordTournamentResult(input: TournamentSettlementInput): Promise<void> {
    const { error } = await this.db.rpc("record_tournament_match_result", {
      p_tournament_match_id: input.tournamentMatchId,
      p_winner_id: input.winnerId,
      p_match_id: input.matchId,
    })

    if (error) {
      console.error("[recordTournamentResult] FAILED", {
        tournamentMatchId: input.tournamentMatchId,
        message: error.message,
      })
      throw new Error(`Failed to record tournament result: ${error.message}`)
    }

    await this.maybeAdvanceRound(input.tournamentMatchId)
  }

  /**
   * Formats this advances automatically. Bounty, ladder, and arena have
   * their own progression models (bounty claims, ladder runs) that don't map
   * onto tournament_matches/tournament_rounds the same way single-elim and
   * swiss do — left on the existing manual admin flow rather than guessed at
   * here. Nothing about ranked or the formats above changes for them.
   */
  private static readonly AUTO_ADVANCE_FORMATS: ReadonlySet<string> = new Set([
    "single_elimination",
    "satellite",
    "swiss",
    "survivor",
  ])

  private async maybeAdvanceRound(tournamentMatchId: string): Promise<void> {
    const { data: match } = await this.db
      .from("tournament_matches")
      .select("tournament_id, round_id")
      .eq("id", tournamentMatchId)
      .maybeSingle()
    if (!match) return

    const { data: tournament } = await this.db
      .from("tournaments")
      .select(
        "id, format_id, ruleset_id, entry_fee_cents, field_size, gross_cents, rake_cents, prize_pool_cents, status"
      )
      .eq("id", match.tournament_id)
      .maybeSingle()
    if (!tournament) return
    if (tournament.status === "completed") return
    if (!SqlMatchStore.AUTO_ADVANCE_FORMATS.has(tournament.format_id)) return

    const { data: roundMatches } = await this.db
      .from("tournament_matches")
      .select("id, player_1_id, player_2_id, winner_id, is_bye, status, round_id")
      .eq("round_id", match.round_id)
    if (!roundMatches || roundMatches.length === 0) return

    const stillPending = roundMatches.some((m) => m.status === "pending" || m.status === "in_progress")
    if (stillPending) return

    // Synchronous check-and-add: no await between them, so two calls racing
    // on the same tournament cannot both pass.
    if (this.advancing.has(tournament.id)) return
    this.advancing.add(tournament.id)
    try {
      await this.advanceTournament(tournament, match.round_id)
    } catch (err) {
      console.error("[advanceTournament] FAILED", { tournamentId: tournament.id, message: String(err) })
    } finally {
      this.advancing.delete(tournament.id)
    }
  }

  /**
   * Replays every round played so far through the same tested advanceRound()
   * used everywhere else, to reconstruct running standings rather than
   * persist a duplicate copy of them. Cheap at tournament field sizes this
   * platform runs (up to 1024 entrants, a handful of rounds) and guarantees
   * the standings here can never drift from what advanceRound would compute
   * from scratch.
   */
  private async advanceTournament(
    tournament: {
      id: string
      format_id: string
      ruleset_id: string
      entry_fee_cents: number
      field_size: number
      gross_cents: number
      rake_cents: number
      prize_pool_cents: number
    },
    justCompletedRoundId: string
  ): Promise<void> {
    const { data: rounds } = await this.db
      .from("tournament_rounds")
      .select("id, round_number")
      .eq("tournament_id", tournament.id)
      .order("round_number", { ascending: true })
    if (!rounds || rounds.length === 0) return

    const roundIds = rounds.map((r) => r.id)
    const { data: allMatches } = await this.db
      .from("tournament_matches")
      .select("round_id, player_1_id, player_2_id, winner_id, is_bye")
      .in("round_id", roundIds)
    if (!allMatches) return

    const { data: entries } = await this.db
      .from("tournament_entries")
      .select("user_id, seat_number")
      .eq("tournament_id", tournament.id)
    if (!entries || entries.length === 0) return

    const userIds = entries.map((e) => e.user_id)
    const [{ data: users }, { data: standing }] = await Promise.all([
      this.db.from("users").select("id, elo_rating").in("id", userIds),
      this.db.from("player_standing").select("user_id, skill_index").in("user_id", userIds),
    ])

    const eloById = new Map((users ?? []).map((u) => [u.id, u.elo_rating]))
    const skillById = new Map((standing ?? []).map((s) => [s.user_id, s.skill_index]))

    const entrants: Entrant[] = entries.map((e) => ({
      userId: e.user_id,
      seatNumber: e.seat_number,
      eloRating: eloById.get(e.user_id) ?? 1600,
      skillIndex: skillById.get(e.user_id) ?? 0,
    }))

    let standings = initialStandings(entrants)
    const previousOpponents = new Map<string, Set<string>>()
    const formatId = tournament.format_id as FormatId

    for (const round of rounds) {
      const matchesInRound = allMatches.filter((m) => m.round_id === round.id)
      const results: RoundResult[] = matchesInRound.map((m) => ({
        player1: m.player_1_id as string,
        player2: m.player_2_id,
        winner: m.winner_id,
        isBye: m.is_bye,
      }))

      for (const r of results) {
        if (r.isBye || !r.player2) continue
        const a = previousOpponents.get(r.player1) ?? new Set<string>()
        a.add(r.player2)
        previousOpponents.set(r.player1, a)
        const b = previousOpponents.get(r.player2) ?? new Set<string>()
        b.add(r.player1)
        previousOpponents.set(r.player2, b)
      }

      const outcome = advanceRound(formatId, standings, results, round.round_number)
      standings = outcome.standings

      if (round.id === justCompletedRoundId) {
        if (outcome.complete) {
          await this.payoutTournament(tournament, standings)
        } else {
          await this.createNextRound(tournament, round.round_number + 1, formatId, entrants, standings, previousOpponents)
        }
        return
      }
    }
  }

  private async createNextRound(
    tournament: { id: string },
    nextRoundNumber: number,
    formatId: FormatId,
    entrants: Entrant[],
    standings: StandingRow[],
    previousOpponents: Map<string, Set<string>>
  ): Promise<void> {
    // Defensive re-check: catches a duplicate-round race the in-memory lock
    // in maybeAdvanceRound cannot see across process boundaries.
    const { data: existing } = await this.db
      .from("tournament_rounds")
      .select("id")
      .eq("tournament_id", tournament.id)
      .eq("round_number", nextRoundNumber)
      .maybeSingle()
    if (existing) return

    const plan = planRound(tournament.id, formatId, nextRoundNumber, entrants, standings, previousOpponents)

    const { error } = await this.db.rpc("create_tournament_round", {
      p_tournament_id: tournament.id,
      p_round_number: nextRoundNumber,
      p_pairings: plan.pairings.map((p) => ({
        board_position: p.boardPosition,
        player1: p.player1,
        player2: p.player2,
        is_bye: p.isBye,
      })),
    })

    if (error) {
      console.error("[createNextRound] FAILED", { tournamentId: tournament.id, nextRoundNumber, message: error.message })
      throw new Error(`Failed to create round ${nextRoundNumber}: ${error.message}`)
    }
  }

  private async payoutTournament(
    tournament: {
      id: string
      entry_fee_cents: number
      field_size: number
      gross_cents: number
      rake_cents: number
      prize_pool_cents: number
    },
    standings: StandingRow[]
  ): Promise<void> {
    const order = finalPlacings(standings)

    const pool: PrizePool = {
      // Not read by distributePrizePool (it only uses fieldSize and
      // prizePoolCents below) — filled in for type completeness, not
      // because it drives the payout curve.
      kind: "tournament_standard",
      entryFeeCents: tournament.entry_fee_cents,
      fieldSize: tournament.field_size,
      grossCents: tournament.gross_cents,
      feeCents: tournament.rake_cents,
      prizePoolCents: tournament.prize_pool_cents,
      returnToPlayer: tournament.prize_pool_cents / tournament.gross_cents,
    }

    const placings = distributePrizePool(pool)
      .map((p) => ({ user_id: order[p.place - 1], place: p.place, amount_cents: p.amountCents }))
      .filter((p): p is { user_id: string; place: number; amount_cents: number } => Boolean(p.user_id))

    const { error } = await this.db.rpc("complete_tournament", {
      p_tournament_id: tournament.id,
      p_placings: placings,
    })

    if (error) {
      console.error("[payoutTournament] FAILED", { tournamentId: tournament.id, message: error.message })
      throw new Error(`Failed to complete tournament ${tournament.id}: ${error.message}`)
    }
  }

  // --- internals ------------------------------------------------------------

  private async loadParticipants(input: SettlementInput): Promise<{
    winner: Participant
    loser: Participant
  }> {
    const slots: PlayerSlot[] = [1, 2]
    const ids = slots
      .map((s) => (s === 1 ? input.winnerId : input.loserId))
      .filter((id): id is string => id !== null)

    if (ids.length < 2) {
      // Draw, or an abandoned match with one side missing. Ratings do not move.
      return { winner: DEFAULT_PARTICIPANT, loser: DEFAULT_PARTICIPANT }
    }

    const { data } = await this.db
      .from("users")
      .select("id, elo_rating, matches_played")
      .in("id", ids)

    const standing = await this.db
      .from("player_standing")
      .select("user_id, fee_tier")
      .in("user_id", ids)

    const tierOf = new Map<string, FeeTier>(
      (standing.data ?? []).map((r) => [r.user_id, r.fee_tier as FeeTier])
    )

    const byId = new Map<string, Participant>(
      (data ?? []).map((r) => [
        r.id,
        {
          eloRating: r.elo_rating,
          matchesPlayed: r.matches_played,
          feeTier: tierOf.get(r.id) ?? "standard",
        },
      ])
    )

    return {
      winner: (input.winnerId && byId.get(input.winnerId)) || DEFAULT_PARTICIPANT,
      loser: (input.loserId && byId.get(input.loserId)) || DEFAULT_PARTICIPANT,
    }
  }
}

interface Participant {
  eloRating: number
  matchesPlayed: number
  feeTier: FeeTier
}

const DEFAULT_PARTICIPANT: Participant = {
  eloRating: 1600,
  matchesPlayed: 0,
  feeTier: "standard",
}
