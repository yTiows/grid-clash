/**
 * Match wire protocol.
 *
 * Everything inbound is untrusted and parsed through zod before it reaches
 * game logic. Everything outbound is constructed by the server, so it is typed
 * but not validated.
 *
 * Two things are deliberately absent from the client schemas, because
 * including them would hand the attacker the pen:
 *
 *  - No timing fields. Move latency is measured at server message arrival.
 *    A client-supplied duration is a client-supplied alibi, and bot detection
 *    keyed on it detects nothing.
 *
 *  - No board or result fields. The client never asserts state or outcome.
 *    It names an action; the server decides what that action did.
 */

import { z } from "zod"

import { BOARD_SIZE } from "./engine"

const MAX_CELL_INDEX = BOARD_SIZE * BOARD_SIZE - 1

/**
 * Hard ceiling on a single frame. Without this, one socket can drive the
 * server into memory pressure with a multi-megabyte JSON string before any
 * application-level check runs.
 */
export const CLIENT_MESSAGE_MAX_BYTES = 1024

/** Token bucket: sustained rate and burst allowance per connection. */
export const RATE_LIMIT = {
  capacity: 12,
  refillPerSecond: 6,
} as const

/** A turn is 5s; this is the grace window before a dropped player forfeits. */
export const RECONNECT_GRACE_MS = 30_000

/**
 * Extra time folded into a fresh board's very first turnDeadline — match
 * start and each sudden-death replay (match-server.ts's startMatch,
 * startTournamentMatch, replayAsSuddenDeath). Without it the clock is
 * already ticking the instant the coin flip resolves, which leaves no room
 * to even register who moves first before having to also decide what to
 * play. Every move after the first keeps the ruleset's plain moveTimeoutMs —
 * this is a one-time cushion on the reveal, not a permanently longer clock.
 *
 * Shared with the client (StartCountdown's durationMs) so the visible
 * countdown and the real server deadline run out together: the server bakes
 * this into turnDeadline, the client shows a countdown for exactly this long
 * before the board goes interactive, and by the time it hits zero the
 * remaining time on the wire is just the ruleset's normal clock.
 */
export const MATCH_START_GRACE_MS = 3_000

export const HEARTBEAT_INTERVAL_MS = 15_000
export const HEARTBEAT_TIMEOUT_MS = 40_000

// --- Client to server -------------------------------------------------------

/**
 * Ranked format choice. A closed enum, not an arbitrary rulesets.ts id — not
 * every format (Siege's 6x6 board, Sprawl's 7x7) is meant to pair with a
 * quick-queue stake; those stay tournament-only. Extending ranked to a new
 * format means adding it here deliberately, not automatically inheriting
 * whatever rulesets.ts grows next.
 */
export const RANKED_RULESET_IDS = ["classic", "blitz", "gambit"] as const
export type RankedRulesetId = (typeof RANKED_RULESET_IDS)[number]

const queueJoin = z.object({
  type: z.literal("queue:join"),
  stakeCents: z.number().int().positive(),
  rulesetId: z.enum(RANKED_RULESET_IDS).default("classic"),
})

const queueLeave = z.object({
  type: z.literal("queue:leave"),
})

/**
 * Tournament matches skip the queue entirely — the two players are already
 * known from the bracket. Each sends this once they're looking at the match;
 * the server starts the game the moment both have. No stake: the entry fee
 * was already taken at enter_tournament, and payout happens once at
 * complete_tournament, not per bracket match.
 */
const tournamentJoin = z.object({
  type: z.literal("tournament:join"),
  tournamentMatchId: z.string().uuid(),
})

/**
 * Wagers skip the queue too, same as tournament:join — the two players are
 * already decided (create_open_wager/accept_open_wager or a friend
 * challenge), and the stake was already reserved at that point, not here.
 * The server starts the game once both sides holding an accepted challenge
 * have sent this.
 */
const wagerJoin = z.object({
  type: z.literal("wager:join"),
  challengeId: z.string().uuid(),
})

const matchMove = z.object({
  type: z.literal("match:move"),
  matchId: z.string().uuid(),
  /**
   * Monotonic per match. The server rejects any move whose seq does not equal
   * the current move number, which closes both replay (resubmitting a
   * winning move) and race-driven double-submission from two tabs.
   */
  seq: z.number().int().nonnegative(),
  kind: z.enum(["normal", "shield", "bomb", "swap"]),
  index: z.number().int().min(0).max(MAX_CELL_INDEX),
  targetIndex: z.number().int().min(0).max(MAX_CELL_INDEX).optional(),
})

const matchResign = z.object({
  type: z.literal("match:resign"),
  matchId: z.string().uuid(),
})

/**
 * Read-only. A participant can't spectate their own match (match-server.ts
 * rejects it) — this is for an outside audience, not a second window into
 * a match you're playing.
 */
const spectateJoin = z.object({
  type: z.literal("spectate:join"),
  matchId: z.string().uuid(),
})

const spectateLeave = z.object({
  type: z.literal("spectate:leave"),
})

const heartbeat = z.object({
  type: z.literal("pong"),
})

export const clientMessageSchema = z.discriminatedUnion("type", [
  queueJoin,
  queueLeave,
  tournamentJoin,
  wagerJoin,
  matchMove,
  matchResign,
  spectateJoin,
  spectateLeave,
  heartbeat,
])

export type ClientMessage = z.infer<typeof clientMessageSchema>
export type MoveMessage = z.infer<typeof matchMove>

// --- Server to client -------------------------------------------------------

import type { PlayerSlot, RedactedGameState, SpectatorGameState } from "./engine"

export type ServerMessage =
  | { type: "queue:waiting"; position: number; stakeCents: number }
  | { type: "queue:left" }
  | {
      type: "match:start"
      matchId: string
      opponent: { username: string; eloRating: number }
      stakeCents: number
      state: RedactedGameState
      /** Server-authoritative deadline as an epoch ms timestamp. */
      turnDeadline: number
    }
  | {
      type: "tournament:waiting"
      tournamentMatchId: string
    }
  | {
      type: "tournament:start"
      matchId: string
      tournamentMatchId: string
      opponent: { username: string; eloRating: number }
      state: RedactedGameState
      turnDeadline: number
    }
  | {
      type: "match:state"
      matchId: string
      state: RedactedGameState
      turnDeadline: number
      /** Present when the previous action was a forced timeout. */
      timedOut?: boolean
    }
  | {
      type: "match:over"
      matchId: string
      state: RedactedGameState
      result: "won" | "lost" | "draw"
      reason: "line" | "resign" | "abandon" | "no_legal_moves" | "board_full"
      payoutCents: number
      eloDelta: number
    }
  | {
      /**
       * Tournament bracket matches cannot end in a draw — exactly one player
       * must advance. A board-full/no-legal-moves draw restarts as sudden
       * death between the same two instead of settling, so this never
       * reports "draw" as a result the way match:over can.
       */
      type: "tournament:over"
      matchId: string
      tournamentMatchId: string
      state: RedactedGameState
      result: "won" | "lost"
      reason: "line" | "resign" | "abandon" | "no_legal_moves"
    }
  | { type: "tournament:sudden_death"; tournamentMatchId: string; state: RedactedGameState; turnDeadline: number }
  /**
   * Ranked's equivalent of tournament:sudden_death — a paid match should
   * still produce exactly one winner, so a natural board-full/no-legal-move
   * draw replays on a fresh board (same two players, same stake, same
   * reservations) instead of settling as a draw payout. See match-server.ts
   * settle().
   */
  | { type: "match:sudden_death"; matchId: string; state: RedactedGameState; turnDeadline: number }
  | {
      type: "wager:waiting"
      challengeId: string
    }
  | {
      type: "wager:start"
      matchId: string
      challengeId: string
      opponent: { username: string; eloRating: number }
      stakeCents: number
      state: RedactedGameState
      turnDeadline: number
    }
  | { type: "wager:sudden_death"; challengeId: string; state: RedactedGameState; turnDeadline: number }
  | {
      /**
       * Wagers get their own settlement message rather than reusing
       * match:over's shape (as tournament:over does, not match:over) —
       * match:over carries a mandatory eloDelta, and wagers deliberately
       * never move Elo (see settle_wager_match). A field that's always 0
       * reads as "trust me it didn't move"; omitting it entirely makes "no
       * rating is at stake here" a property of the wire protocol itself.
       */
      type: "wager:over"
      matchId: string
      challengeId: string
      state: RedactedGameState
      result: "won" | "lost" | "draw"
      reason: "line" | "resign" | "abandon" | "no_legal_moves" | "board_full"
      payoutCents: number
    }
  | { type: "match:opponent_disconnected"; matchId: string; graceEndsAt: number }
  | { type: "match:opponent_reconnected"; matchId: string }
  /** Neutral view — see engine.ts redactStateForSpectator. Sent once on
   * spectate:join, then on every subsequent state change until the match
   * ends or the viewer leaves. */
  | { type: "spectate:state"; matchId: string; state: SpectatorGameState; turnDeadline: number }
  | { type: "spectate:over"; matchId: string; state: SpectatorGameState; winnerSlot: PlayerSlot | null }
  | { type: "ping" }
  | { type: "error"; code: ErrorCode; message: string }

/**
 * Error codes are a closed set and messages are fixed strings. Echoing
 * attacker input back, or leaking whether a matchId exists versus belongs to
 * someone else, turns error handling into an enumeration oracle.
 */
export type ErrorCode =
  | "unauthenticated"
  | "malformed"
  | "rate_limited"
  | "not_in_match"
  | "not_your_turn"
  | "illegal_move"
  | "stale_sequence"
  | "ineligible"
  | "internal"

export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  unauthenticated: "Session is not valid. Sign in again.",
  malformed: "Message could not be read.",
  rate_limited: "Too many messages. Slow down.",
  not_in_match: "No active match.",
  not_your_turn: "It is not your turn.",
  illegal_move: "That move is not legal.",
  stale_sequence: "That move is out of date.",
  ineligible: "This account cannot enter paid contests right now.",
  internal: "Something went wrong. The match is unaffected.",
}

export function errorMessage(code: ErrorCode): ServerMessage {
  return { type: "error", code, message: ERROR_MESSAGES[code] }
}

/**
 * Parses one raw frame. Returns null rather than throwing so the caller can
 * treat every failure identically — a parse error and a schema violation are
 * the same event from the attacker's point of view and should be
 * indistinguishable in the response.
 */
export function parseClientMessage(raw: string): ClientMessage | null {
  if (raw.length > CLIENT_MESSAGE_MAX_BYTES) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  const result = clientMessageSchema.safeParse(parsed)
  return result.success ? result.data : null
}
