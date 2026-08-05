/**
 * Authoritative match server.
 *
 * The client renders and proposes. This process decides. Every rule below
 * exists because the alternative was exploitable — see the threat notes on
 * each section.
 */

import { randomUUID, timingSafeEqual, createHmac } from "node:crypto"

import {
  applyMove,
  applyTimeout,
  createGame,
  opponentOf,
  redactStateFor,
  redactStateForSpectator,
  type GameState,
  type PlayerSlot,
} from "@/lib/game/engine"
import { getRuleset } from "@/lib/game/rulesets"
import { seedFromId, seededRandom } from "@/lib/game/bracket"
import { computeStrategicScore, isStrategicScoreEnabled, type ReplayEntry, type ScoreComponentId } from "@/lib/game/scoring"
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  MATCH_START_GRACE_MS,
  RATE_LIMIT,
  RECONNECT_GRACE_MS,
  errorMessage,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
} from "@/lib/game/protocol"

// --- Transport abstraction --------------------------------------------------

/**
 * Kept deliberately narrow so the server logic is testable without a socket
 * library and portable across ws/uWebSockets/Bun.
 */
export interface Socket {
  send(data: string): void
  close(code?: number, reason?: string): void
  readonly remoteAddress: string
}

export interface Clock {
  now(): number
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/**
 * Everything the server needs from persistence, as an interface so the match
 * loop never holds a database handle directly and can be driven in tests.
 */
export interface MatchStore {
  /**
   * Runs the eligibility gate and debits in one transaction.
   * Returns a reservation id, or null if refused.
   */
  reserveStake(userId: string, stakeCents: number): Promise<string | null>
  /**
   * Refunds by reservation id, not by amount. Naming the specific hold is what
   * makes this idempotent: a retry finds the hold already resolved and does
   * nothing. Refunding by (user, amount) double-credits on any retry.
   */
  refundStake(reservationId: string): Promise<void>
  settleMatch(
    input: SettlementInput
  ): Promise<{ eloDeltaWinner: number; eloDeltaLoser: number; winnerPayoutCents: number }>
  /** True if these two accounts must never be paired. */
  arePlayersLinked(a: string, b: string): Promise<boolean>
  getPlayerCard(userId: string): Promise<{ username: string; eloRating: number }>
  /**
   * Looks up a tournament_matches row. Null if the id doesn't exist, isn't
   * pending, or is missing a player — any of which means there is nothing to
   * connect two sockets to.
   */
  getTournamentMatchup(tournamentMatchId: string): Promise<TournamentMatchup | null>
  /**
   * Persists a decisive bracket result and, if that was the round's last
   * pending match, advances the tournament — next round, or final payout.
   * Never called for a draw: the caller replays a tournament match as sudden
   * death instead of settling it, since a bracket needs exactly one winner.
   */
  recordTournamentResult(input: TournamentSettlementInput): Promise<void>
  /**
   * Looks up an accepted challenges row by id. Null if it doesn't exist,
   * isn't accepted yet, or is missing either side's reservation — any of
   * which means there is nothing to connect two sockets to. Mirrors
   * getTournamentMatchup's contract exactly.
   */
  getWagerMatchup(challengeId: string): Promise<WagerMatchup | null>
  /**
   * Stamps challenges.started_at the moment both sides are actually in the
   * game, not when the challenge was accepted. expire_stale_wagers()'s
   * 30-minute accepted-but-never-started sweep keys off this column — an
   * accepted challenge whose players never both showed up should still be
   * refundable, but once real play begins it must not be swept out from
   * under a live match.
   */
  markWagerStarted(challengeId: string): Promise<void>
  /**
   * Wager equivalent of settleMatch: same idempotent-by-match_id,
   * conservation-checked settlement, but reads its stake reservations off
   * the challenges row (not a live queue reservation) and never touches Elo.
   */
  settleWagerMatch(input: WagerSettlementInput): Promise<{ winnerPayoutCents: number }>
  /**
   * Feature B (Elite Performance Benchmark) — pure gameplay analytics, no
   * money or rating involved. Idempotent by (match_id, user_id) at the
   * database layer (record_performance_snapshot's on-conflict-do-nothing),
   * so a retry from the fire-and-forget caller can never double-count one
   * match's contribution to a player's index.
   */
  recordPerformanceSnapshot(input: PerformanceSnapshotInput): Promise<void>
}

export interface PerformanceSnapshotPlayer {
  userId: string
  movesMade: number
  won: boolean
  /** scoring.ts's StrategicScoreLedger.componentTotals for this player — the only shape this ever reads from a match. */
  componentTotals: Record<ScoreComponentId, number>
}

export interface PerformanceSnapshotInput {
  matchId: string
  rulesetId: string
  player1: PerformanceSnapshotPlayer
  player2: PerformanceSnapshotPlayer
}

export interface TournamentMatchup {
  tournamentMatchId: string
  player1: string
  player2: string
  rulesetId: string
}

export interface TournamentSettlementInput {
  tournamentMatchId: string
  winnerId: string
  loserId: string
  matchId: string
  reason: "line" | "resign" | "abandon" | "no_legal_moves"
  moveSequence: string[]
  durationSeconds: number
}

export interface SettlementInput {
  matchId: string
  /** The holds funding this match, consumed atomically at settlement. */
  reservationIds: Record<PlayerSlot, string>
  winnerId: string | null
  loserId: string | null
  isDraw: boolean
  stakeCents: number
  reason: "line" | "resign" | "abandon" | "no_legal_moves" | "board_full"
  /** Server-measured, never client-reported. */
  moveLatenciesBySlot: Record<PlayerSlot, number[]>
  moveSequence: string[]
  durationSeconds: number
}

export interface WagerMatchup {
  challengeId: string
  /** Labeled by the challenges row's original role, not by board slot —
   * slot assignment is still coin-flipped at match start same as ranked
   * and tournament. */
  player1: string
  player1ReservationId: string
  player2: string
  player2ReservationId: string
  rulesetId: string
  stakeCents: number
}

export interface WagerSettlementInput {
  matchId: string
  challengeId: string
  winnerId: string | null
  loserId: string | null
  isDraw: boolean
  stakeCents: number
  reason: "line" | "resign" | "abandon" | "no_legal_moves" | "board_full"
  moveLatenciesBySlot: Record<PlayerSlot, number[]>
  moveSequence: string[]
  durationSeconds: number
}

// --- Connection tickets -----------------------------------------------------

/**
 * THREAT: a browser cannot set Authorization headers on a WebSocket handshake,
 * so the usual workaround is a token in the query string. Session JWTs must
 * not go there — URLs land in proxy logs, referrer headers, and browser
 * history.
 *
 * FIX: the client exchanges its session over authenticated HTTP for a
 * single-use ticket, valid for seconds, bound to the user id and signed. It is
 * useless once redeemed and useless to anyone else.
 */
const TICKET_TTL_MS = 30_000

export interface Ticket {
  userId: string
  issuedAt: number
  nonce: string
}

export function issueTicket(userId: string, secret: string, clock: Clock = systemClock): string {
  const payload = `${userId}.${clock.now()}.${randomUUID()}`
  const signature = createHmac("sha256", secret).update(payload).digest("base64url")
  return `${Buffer.from(payload).toString("base64url")}.${signature}`
}

export function verifyTicket(
  raw: string,
  secret: string,
  redeemed: Set<string>,
  clock: Clock = systemClock
): Ticket | null {
  const parts = raw.split(".")
  if (parts.length !== 2) return null
  const [encodedPayload, signature] = parts as [string, string]

  let payload: string
  try {
    payload = Buffer.from(encodedPayload, "base64url").toString("utf8")
  } catch {
    return null
  }

  const expected = createHmac("sha256", secret).update(payload).digest("base64url")

  // Constant-time compare: a length-or-content-dependent early exit leaks
  // enough timing to forge a signature byte by byte.
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  const segments = payload.split(".")
  if (segments.length !== 3) return null
  const [userId, issuedAtRaw, nonce] = segments as [string, string, string]

  const issuedAt = Number(issuedAtRaw)
  if (!Number.isFinite(issuedAt)) return null
  if (clock.now() - issuedAt > TICKET_TTL_MS) return null

  // Single use. Without this, a ticket captured from a log replays until TTL.
  if (redeemed.has(nonce)) return null
  redeemed.add(nonce)

  return { userId, issuedAt, nonce }
}

// --- Rate limiting ----------------------------------------------------------

/**
 * THREAT: an authenticated socket sending moves in a tight loop costs the
 * server a validation pass per frame. A handful of sockets saturate a core,
 * and the cost is asymmetric — trivial for the attacker, expensive for us.
 */
class TokenBucket {
  private tokens: number = RATE_LIMIT.capacity
  private lastRefill: number

  constructor(private readonly clock: Clock) {
    this.lastRefill = clock.now()
  }

  take(): boolean {
    const now = this.clock.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000
    this.tokens = Math.min(
      RATE_LIMIT.capacity,
      this.tokens + elapsedSeconds * RATE_LIMIT.refillPerSecond
    )
    this.lastRefill = now

    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

// --- Session and match state ------------------------------------------------

interface Session {
  userId: string
  socket: Socket
  bucket: TokenBucket
  matchId: string | null
  queuedStakeCents: number | null
  /** Paired with queuedStakeCents to form the queue key — see queueKey(). */
  queuedRulesetId: string | null
  /** Set on queue join (getPlayerCard), used for proximity pairing. Stale
   * for the lifetime of the queue wait, same tradeoff match:start's own
   * opponent-card lookup already makes — a mid-queue rating change is not
   * worth a re-fetch per pairing attempt. */
  eloRating: number
  /** Epoch ms this session entered its current queue. Null when not
   * queued. Drives eloBandForWaitMs — see joinQueue. */
  queuedAt: number | null
  reservationId: string | null
  /** At most one match at a time — same one-live-thing-per-account posture
   * as matchId. Independent of matchId: a session can't spectate its own
   * match (joinSpectate rejects it), but isn't blocked from spectating
   * some other match while idle. */
  spectatingMatchId: string | null
  lastSeenAt: number
  violations: number
}

interface LiveMatch {
  id: string
  /** Ranked pays per match and moves Elo; tournament does neither — money and
   * placement are settled once, at contest completion, not per bracket game.
   * Wager pays per match like ranked, but never moves Elo — it's an
   * equal-stake money contest, not a ladder contest. */
  kind: "ranked" | "tournament" | "wager"
  tournamentMatchId?: string
  challengeId?: string
  rulesetId: string
  stakeCents: number
  state: GameState
  players: Record<PlayerSlot, string>
  reservations: Record<PlayerSlot, string>
  /** Absolute epoch ms. Owned by the server; the client's copy is cosmetic. */
  turnDeadline: number
  turnStartedAt: number
  turnTimer: unknown
  startedAt: number
  latencies: Record<PlayerSlot, number[]>
  moveSequence: string[]
  /**
   * Structured mirror of moveSequence (Feature A) — the same moves/timeouts,
   * kept as ReplayEntry objects instead of display strings so
   * computeStrategicScore can replay them exactly. Reset to [] on every
   * sudden-death round (see replayAsSuddenDeath) rather than appended,
   * because computeStrategicScore replays from a fresh board and throws if
   * fed moves past a completed game — a settlement should only ever score
   * the one round that actually produced the result being settled, not
   * every drawn round that preceded it.
   */
  strategicReplay: ReplayEntry[]
  /** Incremented by replayAsSuddenDeath. Caps ranked's exposure — see
   * MAX_RANKED_SUDDEN_DEATH_ROUNDS. Tournament is left uncapped, matching
   * its pre-existing behavior from before ranked also started replaying. */
  suddenDeathRounds: number
  disconnected: Partial<Record<PlayerSlot, { since: number; timer: unknown }>>
  /** Read-only observers. Userids, not sockets — looked up in this.sessions
   * at broadcast time the same way players/reservations already are. */
  spectatorUserIds: Set<string>
  settled: boolean
}

/**
 * Five consecutive board-fills between the same two players is not
 * something real play produces — it's a signal something is wrong
 * (collusion, a rules exploit) rather than an unlucky match. Ranked money
 * shouldn't sit in escrow indefinitely waiting to find out which: past
 * this, the match settles as a genuine draw (pot split, no winner) instead
 * of replaying again, via the normal isDraw settlement path below.
 */
const MAX_RANKED_SUDDEN_DEATH_ROUNDS = 5

/**
 * Elo band a queued ticket accepts, widening the longer it's waited — same
 * shape as fees.ts's bracketsOpenAfterWait (20s steps), applied to
 * matchmaking instead of stake brackets. A tight band protects a new
 * player's very first queue from facing a 500-match veteran; the widening
 * is what keeps a thin queue (an odd stake, an off-peak hour) from stalling
 * on a match nobody in it would otherwise accept.
 */
function eloBandForWaitMs(waitedMs: number): number {
  const steps = Math.floor(waitedMs / 20_000)
  return 150 + steps * 150
}

/**
 * Who moves first is a real, measurable edge on a board this small — see the
 * design note above applyOptimisticMove in engine.ts. Without this, slot 1
 * always went to whichever side of a pairing happened to be listed first
 * (the player already waiting in queue; the higher bracket seed), which
 * handed the same population the first-move edge on every single match
 * instead of it washing out across a season.
 *
 * Seeded from matchId rather than Math.random() for the same reason bracket
 * pairings are seeded (see bracket.ts's file header): matchId is unknown to
 * either player before the match exists, so it can't be predicted or
 * steered, but it is a permanent, inspectable record — a disputed "why did
 * they always move first against me" has a verifiable answer instead of
 * "trust the server."
 */
/**
 * `round` re-derives a fresh, deterministic (auditable — same replay
 * property as the rest of this seeding scheme) flip per sudden-death round.
 * The initial board is round 0. Without a per-round flip, slot 1 — fixed
 * for the whole match; see replayAsSuddenDeath's own comment on why slot
 * assignment itself is never reshuffled — held the first-move edge on
 * every single board a match went to sudden death on, not just the
 * original one. The "unbiased across a season" fairness argument for the
 * coin flip only holds if each board gets its own flip; one flip governing
 * every board of a match that draws repeatedly concentrates the edge on
 * whichever physical player happened to win it, against that one opponent,
 * for the rest of that contest.
 */
function coinFlipGivesFirstSlotTo(matchId: string, round = 0): boolean {
  return seededRandom(seedFromId(matchId) + round * 104_729)() < 0.5
}

export interface MatchServerOptions {
  store: MatchStore
  ticketSecret: string
  clock?: Clock
  /** Allowed Origin values for the handshake. */
  allowedOrigins: string[]
}

export class MatchServer {
  private readonly sessions = new Map<string, Session>()
  private readonly matches = new Map<string, LiveMatch>()
  /** Keyed by queueKey(stakeCents, rulesetId) — players only match others
   * queued at the same stake AND the same format. */
  private readonly queues = new Map<string, string[]>()
  /**
   * First player to send tournament:join for a given tournamentMatchId waits
   * here for the second. Unlike the ranked queues, there's exactly one valid
   * opponent — the bracket already decided it — so this is a lookup by
   * tournamentMatchId, not a FIFO list.
   */
  private readonly tournamentWaiting = new Map<string, Session>()
  /** Same rendezvous shape as tournamentWaiting, keyed by challengeId
   * instead of tournamentMatchId — an accepted wager has exactly one valid
   * opponent (already decided by create_open_wager/accept_open_wager or a
   * friend challenge), not a pool to match against. */
  private readonly wagerWaiting = new Map<string, Session>()
  private readonly redeemedTickets = new Set<string>()
  private readonly clock: Clock

  constructor(private readonly options: MatchServerOptions) {
    this.clock = options.clock ?? systemClock
  }

  /**
   * THREAT: WebSocket handshakes are not subject to the same-origin policy and
   * carry cookies. Without an Origin check, any page on the internet can open
   * an authenticated socket in a visitor's browser — CSRF over WS.
   */
  isOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return false
    return this.options.allowedOrigins.includes(origin)
  }

  handleConnection(socket: Socket, ticketRaw: string): string | null {
    const ticket = verifyTicket(
      ticketRaw,
      this.options.ticketSecret,
      this.redeemedTickets,
      this.clock
    )

    if (!ticket) {
      socket.send(JSON.stringify(errorMessage("unauthenticated")))
      socket.close(4401, "unauthenticated")
      return null
    }

    /**
     * THREAT: two sockets for one account allows double-submission from two
     * tabs, and lets a player keep a zombie connection alive to dodge the
     * abandon timer. One live session per account; the newest wins.
     */
    const existing = this.sessions.get(ticket.userId)
    if (existing) {
      existing.socket.close(4409, "superseded")
      this.sessions.delete(ticket.userId)
    }

    this.sessions.set(ticket.userId, {
      userId: ticket.userId,
      socket,
      bucket: new TokenBucket(this.clock),
      matchId: null,
      queuedStakeCents: null,
      queuedRulesetId: null,
      eloRating: 1600,
      queuedAt: null,
      reservationId: null,
      spectatingMatchId: null,
      lastSeenAt: this.clock.now(),
      violations: 0,
    })

    // Reattach to a match in progress. The clock kept running while they were
    // gone; reconnecting does not buy time.
    for (const match of this.matches.values()) {
      const slot = this.slotOf(match, ticket.userId)
      if (slot && !match.settled) {
        this.reattach(match, slot, ticket.userId)
        break
      }
    }

    return ticket.userId
  }

  async handleMessage(userId: string, raw: string): Promise<void> {
    const session = this.sessions.get(userId)
    if (!session) return

    session.lastSeenAt = this.clock.now()

    if (!session.bucket.take()) {
      this.send(session, errorMessage("rate_limited"))
      this.penalise(session)
      return
    }

    const message = parseClientMessage(raw)
    if (!message) {
      this.send(session, errorMessage("malformed"))
      this.penalise(session)
      return
    }

    switch (message.type) {
      case "pong":
        return
      case "queue:join":
        return this.joinQueue(session, message.stakeCents, message.rulesetId)
      case "queue:leave":
        return this.leaveQueue(session)
      case "tournament:join":
        return this.joinTournamentMatch(session, message.tournamentMatchId)
      case "wager:join":
        return this.joinWagerMatch(session, message.challengeId)
      case "match:move":
        return this.handleMove(session, message)
      case "match:resign":
        return this.handleResign(session, message.matchId)
      case "spectate:join":
        return this.joinSpectate(session, message.matchId)
      case "spectate:leave":
        return this.leaveSpectate(session, session.spectatingMatchId)
    }
  }

  /**
   * Repeated malformed or rate-limited frames are not user error; a real
   * client cannot produce them. Escalating to disconnect keeps a probing
   * socket from grinding indefinitely.
   */
  private penalise(session: Session): void {
    session.violations += 1
    if (session.violations >= 10) {
      session.socket.close(4429, "too many invalid messages")
      this.sessions.delete(session.userId)
    }
  }

  // --- Matchmaking ----------------------------------------------------------

  /** Ranked queues partition by format as well as stake — a Classic $5 queue
   * and a Gambit $5 queue never pair with each other. */
  private queueKey(stakeCents: number, rulesetId: string): string {
    return `${stakeCents}:${rulesetId}`
  }

  private async joinQueue(session: Session, stakeCents: number, rulesetId: string): Promise<void> {
    if (session.matchId) return this.send(session, errorMessage("not_in_match"))

    /**
     * The stake is reserved before the player is queued, not when a match is
     * found. Reserving at match time means a player can sit in several queues
     * with one balance and win a race they should have lost.
     */
    const reservationId = await this.options.store.reserveStake(session.userId, stakeCents)
    if (!reservationId) return this.send(session, errorMessage("ineligible"))
    session.reservationId = reservationId
    session.eloRating = (await this.options.store.getPlayerCard(session.userId)).eloRating

    const key = this.queueKey(stakeCents, rulesetId)
    const queue = this.queues.get(key) ?? []

    /**
     * Elo-proximity pairing, not first-in-line: a brand-new account and a
     * 500-match veteran queuing the same stake at the same instant is the
     * single worst thing this queue could do to either of them. Every
     * candidate is scored; the closest-rated one within the accepted band
     * wins, and the band widens the longer a ticket has waited
     * (eloBandForWaitMs) so a thin queue still resolves instead of stalling
     * on a match nobody in it would accept.
     *
     * THREAT: two colluders queue at the same instant at an unusual stake to
     * be paired, then dump the match to move money between accounts while
     * every individual transaction looks ordinary.
     *
     * FIX: never pair linked accounts. The check runs here rather than in
     * post-hoc review because a settled collusive match has already moved
     * money.
     */
    let bestIndex = -1
    let bestCandidate: Session | null = null
    let bestDistance = Infinity

    for (let i = 0; i < queue.length; i++) {
      const candidateId = queue[i]
      if (!candidateId) continue
      if (candidateId === session.userId) continue

      const candidate = this.sessions.get(candidateId)
      if (!candidate) {
        queue.splice(i, 1)
        i--
        continue
      }

      const linked = await this.options.store.arePlayersLinked(session.userId, candidateId)
      if (linked) continue

      const waitedMs = this.clock.now() - (candidate.queuedAt ?? this.clock.now())
      const band = eloBandForWaitMs(waitedMs)
      const distance = Math.abs(candidate.eloRating - session.eloRating)
      if (distance > band) continue

      if (distance < bestDistance) {
        bestDistance = distance
        bestIndex = i
        bestCandidate = candidate
      }
    }

    if (bestCandidate && bestIndex >= 0) {
      queue.splice(bestIndex, 1)
      this.queues.set(key, queue)
      await this.startMatch(bestCandidate, session, stakeCents, rulesetId)
      return
    }

    session.queuedAt = this.clock.now()
    queue.push(session.userId)
    this.queues.set(key, queue)
    session.queuedStakeCents = stakeCents
    session.queuedRulesetId = rulesetId
    this.send(session, { type: "queue:waiting", position: queue.length, stakeCents })
  }

  private async leaveQueue(session: Session): Promise<void> {
    const stake = session.queuedStakeCents
    const rulesetId = session.queuedRulesetId
    if (stake === null || rulesetId === null) return

    const key = this.queueKey(stake, rulesetId)
    const queue = this.queues.get(key) ?? []
    const index = queue.indexOf(session.userId)
    if (index >= 0) queue.splice(index, 1)
    this.queues.set(key, queue)

    session.queuedStakeCents = null
    session.queuedRulesetId = null
    session.queuedAt = null
    if (session.reservationId) {
      await this.options.store.refundStake(session.reservationId)
      session.reservationId = null
    }
    this.send(session, { type: "queue:left" })
  }

  private async startMatch(
    a: Session,
    b: Session,
    stakeCents: number,
    rulesetId: string
  ): Promise<void> {
    const matchId = randomUUID()
    const ruleset = getRuleset(rulesetId)
    const state = createGame(ruleset)

    // Coin flip: matchId doesn't exist until the line above, so neither
    // player nor queue order can influence who gets it.
    const [p1, p2] = coinFlipGivesFirstSlotTo(matchId) ? [a, b] : [b, a]

    const match: LiveMatch = {
      id: matchId,
      kind: "ranked",
      rulesetId,
      stakeCents,
      state,
      players: { 1: p1.userId, 2: p2.userId },
      reservations: { 1: p1.reservationId ?? "", 2: p2.reservationId ?? "" },
      turnDeadline: this.clock.now() + ruleset.moveTimeoutMs + MATCH_START_GRACE_MS,
      turnStartedAt: this.clock.now(),
      turnTimer: null,
      startedAt: this.clock.now(),
      latencies: { 1: [], 2: [] },
      moveSequence: [],
      strategicReplay: [],
      suddenDeathRounds: 0,
      disconnected: {},
      spectatorUserIds: new Set(),
      settled: false,
    }

    this.matches.set(matchId, match)
    a.matchId = matchId
    b.matchId = matchId
    a.queuedStakeCents = null
    a.queuedRulesetId = null
    a.queuedAt = null
    b.queuedStakeCents = null
    b.queuedRulesetId = null
    b.queuedAt = null
    a.reservationId = null
    b.reservationId = null

    const [card1, card2] = await Promise.all([
      this.options.store.getPlayerCard(p1.userId),
      this.options.store.getPlayerCard(p2.userId),
    ])

    this.send(p1, {
      type: "match:start",
      matchId,
      opponent: card2,
      stakeCents,
      state: redactStateFor(state, 1),
      turnDeadline: match.turnDeadline,
    })
    this.send(p2, {
      type: "match:start",
      matchId,
      opponent: card1,
      stakeCents,
      state: redactStateFor(state, 2),
      turnDeadline: match.turnDeadline,
    })

    this.armTurnTimer(match)
  }

  // --- Tournament matches -----------------------------------------------

  /**
   * THREAT: a tournament match has exactly two legitimate players, already
   * decided by the bracket — unlike ranked, there's no queue to poison, but
   * there's still a caller-supplied id to distrust. Every branch below
   * re-verifies the caller is one of the two names on the row; there is no
   * step that trusts "the client asked for this match" on its own.
   */
  private async joinTournamentMatch(session: Session, tournamentMatchId: string): Promise<void> {
    // Already the live match for this id — a reconnect resending join rather
    // than waiting on the automatic reattach. Idempotent: just resend state.
    if (session.matchId) {
      const current = this.matches.get(session.matchId)
      if (current?.tournamentMatchId === tournamentMatchId) {
        const slot = this.slotOf(current, session.userId)
        if (slot) {
          return this.send(session, {
            type: "tournament:start",
            matchId: current.id,
            tournamentMatchId,
            opponent: await this.options.store.getPlayerCard(current.players[opponentOf(slot)]),
            state: redactStateFor(current.state, slot),
            turnDeadline: current.turnDeadline,
          })
        }
      }
      return this.send(session, errorMessage("not_in_match"))
    }

    const matchup = await this.options.store.getTournamentMatchup(tournamentMatchId)
    if (!matchup) return this.send(session, errorMessage("not_in_match"))

    if (matchup.player1 !== session.userId && matchup.player2 !== session.userId) {
      return this.send(session, errorMessage("not_in_match"))
    }

    const waiting = this.tournamentWaiting.get(tournamentMatchId)

    // Same user reconnecting to the waiting room (refreshed the tab before
    // the opponent arrived) — replace the stale session, don't double-wait.
    if (waiting && waiting.userId === session.userId) {
      this.tournamentWaiting.set(tournamentMatchId, session)
      return this.send(session, { type: "tournament:waiting", tournamentMatchId })
    }

    if (waiting) {
      this.tournamentWaiting.delete(tournamentMatchId)
      await this.startTournamentMatch(waiting, session, matchup)
      return
    }

    this.tournamentWaiting.set(tournamentMatchId, session)
    this.send(session, { type: "tournament:waiting", tournamentMatchId })
  }

  private async startTournamentMatch(a: Session, b: Session, matchup: TournamentMatchup): Promise<void> {
    /**
     * THREAT: the exact collusion pattern joinQueue already guards against
     * for ranked (see its comment above) — two linked accounts drawn into
     * the same bracket, one dumping the match to the other — but bracket.ts's
     * pairing (planRound/pairSwissRound/pairKnockoutRound) is a pure
     * function of entrant list, standings, and a deterministic seed with no
     * store access, so it can't be the enforcement point. This is the last
     * gate before a live match — and, for Bounty, real money — is at stake.
     * A caught pair is refused here rather than started and reviewed after
     * the fact, matching ranked's "never pair, don't just flag" posture.
     * This leaves the tournament_matches row unresolved for this pairing,
     * same as any other stuck bracket slot — an admin resolves it manually,
     * the same path a disputed or automation-flagged match already needs.
     */
    if (await this.options.store.arePlayersLinked(a.userId, b.userId)) {
      this.send(a, errorMessage("ineligible"))
      this.send(b, errorMessage("ineligible"))
      return
    }

    const matchId = randomUUID()
    const ruleset = getRuleset(matchup.rulesetId)
    const state = createGame(ruleset)

    // Bracket seeding (matchup.player1/player2) decided the *pairing* — who
    // plays whom — and stays exactly as seeded; recordTournamentResult below
    // looks players up by match.players, never by this local p1/p2, so
    // renaming who holds engine slot 1 here has no effect on the bracket.
    // But which physical player gets the first-move edge is a different
    // question, and handing it to whichever side the seed happened to list
    // first would double the higher seed's advantage (easier path AND first
    // move, every round) instead of leaving it purely to seeding as
    // intended. Coin-flipped the same way ranked is.
    const [p1, p2] = coinFlipGivesFirstSlotTo(matchId) ? [a, b] : [b, a]

    const match: LiveMatch = {
      id: matchId,
      kind: "tournament",
      tournamentMatchId: matchup.tournamentMatchId,
      rulesetId: matchup.rulesetId,
      stakeCents: 0,
      state,
      players: { 1: p1.userId, 2: p2.userId },
      reservations: { 1: "", 2: "" },
      turnDeadline: this.clock.now() + ruleset.moveTimeoutMs + MATCH_START_GRACE_MS,
      turnStartedAt: this.clock.now(),
      turnTimer: null,
      startedAt: this.clock.now(),
      latencies: { 1: [], 2: [] },
      moveSequence: [],
      strategicReplay: [],
      suddenDeathRounds: 0,
      disconnected: {},
      spectatorUserIds: new Set(),
      settled: false,
    }

    this.matches.set(matchId, match)
    p1.matchId = matchId
    p2.matchId = matchId

    const [card1, card2] = await Promise.all([
      this.options.store.getPlayerCard(p1.userId),
      this.options.store.getPlayerCard(p2.userId),
    ])

    this.send(p1, {
      type: "tournament:start",
      matchId,
      tournamentMatchId: matchup.tournamentMatchId,
      opponent: card2,
      state: redactStateFor(state, 1),
      turnDeadline: match.turnDeadline,
    })
    this.send(p2, {
      type: "tournament:start",
      matchId,
      tournamentMatchId: matchup.tournamentMatchId,
      opponent: card1,
      state: redactStateFor(state, 2),
      turnDeadline: match.turnDeadline,
    })

    this.armTurnTimer(match)
  }

  // --- Wager matches ------------------------------------------------------

  /**
   * Same rendezvous shape as joinTournamentMatch, keyed by challengeId. The
   * SQL layer (accept_open_wager/respond_to_challenge) already decided who
   * the two players are and already reserved both stakes — this method's
   * only job is connecting two live sockets to that decision.
   */
  private async joinWagerMatch(session: Session, challengeId: string): Promise<void> {
    if (session.matchId) {
      const current = this.matches.get(session.matchId)
      if (current?.challengeId === challengeId) {
        const slot = this.slotOf(current, session.userId)
        if (slot) {
          return this.send(session, {
            type: "wager:start",
            matchId: current.id,
            challengeId,
            opponent: await this.options.store.getPlayerCard(current.players[opponentOf(slot)]),
            stakeCents: current.stakeCents,
            state: redactStateFor(current.state, slot),
            turnDeadline: current.turnDeadline,
          })
        }
      }
      return this.send(session, errorMessage("not_in_match"))
    }

    const matchup = await this.options.store.getWagerMatchup(challengeId)
    if (!matchup) return this.send(session, errorMessage("not_in_match"))

    if (matchup.player1 !== session.userId && matchup.player2 !== session.userId) {
      return this.send(session, errorMessage("not_in_match"))
    }

    const waiting = this.wagerWaiting.get(challengeId)

    if (waiting && waiting.userId === session.userId) {
      this.wagerWaiting.set(challengeId, session)
      return this.send(session, { type: "wager:waiting", challengeId })
    }

    if (waiting) {
      this.wagerWaiting.delete(challengeId)
      await this.startWagerMatch(waiting, session, matchup)
      return
    }

    this.wagerWaiting.set(challengeId, session)
    this.send(session, { type: "wager:waiting", challengeId })
  }

  private async startWagerMatch(a: Session, b: Session, matchup: WagerMatchup): Promise<void> {
    /**
     * Defense in depth, same reasoning as startTournamentMatch's own check:
     * create_challenge/accept_open_wager/respond_to_challenge already refuse
     * a linked pair at accept time, but an accepted wager can sit for up to
     * the 30-minute expire_stale_wagers grace window before both sides show
     * up here. A link discovered in that window should still stop the match
     * from actually starting rather than only being caught after the fact.
     */
    if (await this.options.store.arePlayersLinked(a.userId, b.userId)) {
      this.send(a, errorMessage("ineligible"))
      this.send(b, errorMessage("ineligible"))
      return
    }

    const matchId = randomUUID()
    const ruleset = getRuleset(matchup.rulesetId)
    const state = createGame(ruleset)

    const [p1, p2] = coinFlipGivesFirstSlotTo(matchId) ? [a, b] : [b, a]
    const reservationFor = (userId: string): string =>
      userId === matchup.player1 ? matchup.player1ReservationId : matchup.player2ReservationId

    const match: LiveMatch = {
      id: matchId,
      kind: "wager",
      challengeId: matchup.challengeId,
      rulesetId: matchup.rulesetId,
      stakeCents: matchup.stakeCents,
      state,
      players: { 1: p1.userId, 2: p2.userId },
      reservations: { 1: reservationFor(p1.userId), 2: reservationFor(p2.userId) },
      turnDeadline: this.clock.now() + ruleset.moveTimeoutMs + MATCH_START_GRACE_MS,
      turnStartedAt: this.clock.now(),
      turnTimer: null,
      startedAt: this.clock.now(),
      latencies: { 1: [], 2: [] },
      moveSequence: [],
      strategicReplay: [],
      suddenDeathRounds: 0,
      disconnected: {},
      spectatorUserIds: new Set(),
      settled: false,
    }

    this.matches.set(matchId, match)
    p1.matchId = matchId
    p2.matchId = matchId

    const [card1, card2] = await Promise.all([
      this.options.store.getPlayerCard(p1.userId),
      this.options.store.getPlayerCard(p2.userId),
    ])

    this.send(p1, {
      type: "wager:start",
      matchId,
      challengeId: matchup.challengeId,
      opponent: card2,
      stakeCents: matchup.stakeCents,
      state: redactStateFor(state, 1),
      turnDeadline: match.turnDeadline,
    })
    this.send(p2, {
      type: "wager:start",
      matchId,
      challengeId: matchup.challengeId,
      opponent: card1,
      stakeCents: matchup.stakeCents,
      state: redactStateFor(state, 2),
      turnDeadline: match.turnDeadline,
    })

    this.armTurnTimer(match)

    // Stamped after both sockets are actually in the game, not at accept
    // time — see the markWagerStarted doc on the MatchStore interface.
    await this.options.store.markWagerStarted(matchup.challengeId)
  }

  // --- Play -----------------------------------------------------------------

  private async handleMove(
    session: Session,
    message: Extract<ClientMessage, { type: "match:move" }>
  ): Promise<void> {
    const match = this.matches.get(message.matchId)

    /**
     * A caller who is not a participant gets the same response as one naming a
     * match that does not exist. Distinguishing them turns this into an
     * oracle for enumerating live match ids.
     */
    if (!match || match.settled) return this.send(session, errorMessage("not_in_match"))

    const slot = this.slotOf(match, session.userId)
    if (!slot) return this.send(session, errorMessage("not_in_match"))

    if (match.state.turn !== slot) return this.send(session, errorMessage("not_your_turn"))

    /**
     * Replay guard. seq must match the current move number exactly, so a
     * resubmitted frame or a second tab racing the first is rejected rather
     * than applied twice.
     */
    if (message.seq !== match.state.moveNumber) {
      return this.send(session, errorMessage("stale_sequence"))
    }

    const result = applyMove(match.state, slot, {
      kind: message.kind,
      index: message.index,
      ...(message.targetIndex !== undefined ? { targetIndex: message.targetIndex } : {}),
    })

    if (!result.ok) return this.send(session, errorMessage("illegal_move"))

    // Measured here, at arrival. Never taken from the client.
    match.latencies[slot].push(this.clock.now() - match.turnStartedAt)
    match.moveSequence.push(
      `${slot}:${message.kind}:${message.index}${
        message.targetIndex !== undefined ? `>${message.targetIndex}` : ""
      }`
    )
    match.strategicReplay.push({
      kind: "move",
      slot,
      move: {
        kind: message.kind,
        index: message.index,
        ...(message.targetIndex !== undefined ? { targetIndex: message.targetIndex } : {}),
      },
    })

    match.state = result.state
    this.advanceTurn(match)

    if (match.state.status !== "active") {
      await this.settle(match, match.state.status === "draw" ? "board_full" : "line")
      return
    }

    this.broadcastState(match)
  }

  private async handleResign(session: Session, matchId: string): Promise<void> {
    const match = this.matches.get(matchId)
    if (!match || match.settled) return this.send(session, errorMessage("not_in_match"))

    const slot = this.slotOf(match, session.userId)
    if (!slot) return this.send(session, errorMessage("not_in_match"))

    await this.settle(match, "resign", opponentOf(slot))
  }

  /**
   * THREAT: if the turn clock were driven by client timers, a player losing on
   * time could simply stop sending frames. The deadline is server-held and the
   * timeout fires regardless of what any client is doing.
   */
  private armTurnTimer(match: LiveMatch): void {
    if (match.turnTimer) this.clock.clearTimeout(match.turnTimer)

    match.turnTimer = this.clock.setTimeout(() => {
      if (match.settled) return

      const slot = match.state.turn
      match.latencies[slot].push(getRuleset(match.rulesetId).moveTimeoutMs)
      match.strategicReplay.push({ kind: "timeout", slot })
      match.state = applyTimeout(match.state, slot)
      this.advanceTurn(match)

      if (match.state.status !== "active") {
        void this.settle(match, "no_legal_moves")
        return
      }

      this.broadcastState(match, true)
    }, Math.max(0, match.turnDeadline - this.clock.now()))
  }

  /**
   * graceMs is nonzero only for a fresh board (replayAsSuddenDeath) — every
   * ordinary move keeps the plain ruleset clock, so a normal turn can never
   * gain time by design.
   */
  private advanceTurn(match: LiveMatch, graceMs = 0): void {
    match.turnStartedAt = this.clock.now()
    match.turnDeadline = match.turnStartedAt + getRuleset(match.rulesetId).moveTimeoutMs + graceMs
    this.armTurnTimer(match)
  }

  private broadcastState(match: LiveMatch, timedOut = false): void {
    for (const slot of [1, 2] as const) {
      const session = this.sessions.get(match.players[slot])
      if (!session) continue
      this.send(session, {
        type: "match:state",
        matchId: match.id,
        // Redacted per recipient. Sending full state and hiding the opponent's
        // inventory in the UI would put it one devtools panel away.
        state: redactStateFor(match.state, slot),
        turnDeadline: match.turnDeadline,
        ...(timedOut ? { timedOut: true } : {}),
      })
    }
    this.broadcastToSpectators(match)
  }

  // --- Spectating -------------------------------------------------------

  /**
   * THREAT: a spectator with a private channel to one player (voice call,
   * second monitor) becomes that player's scout if they can see anything
   * the opponent can't. redactStateForSpectator is symmetric by
   * construction — neither player's inventory breakdown, and a
   * hiddenShields format stays masked for both, not just the opponent —
   * so watching is never better than either player's own view.
   */
  private joinSpectate(session: Session, matchId: string): void {
    if (session.spectatingMatchId && session.spectatingMatchId !== matchId) {
      this.leaveSpectate(session, session.spectatingMatchId)
    }

    const match = this.matches.get(matchId)
    if (!match || match.settled) return this.send(session, errorMessage("not_in_match"))
    if (this.slotOf(match, session.userId)) return this.send(session, errorMessage("not_in_match"))

    match.spectatorUserIds.add(session.userId)
    session.spectatingMatchId = matchId
    this.send(session, {
      type: "spectate:state",
      matchId,
      state: redactStateForSpectator(match.state),
      turnDeadline: match.turnDeadline,
    })
  }

  private leaveSpectate(session: Session, matchId: string | null): void {
    if (!matchId) return
    const match = this.matches.get(matchId)
    if (match) match.spectatorUserIds.delete(session.userId)
    if (session.spectatingMatchId === matchId) session.spectatingMatchId = null
  }

  private broadcastToSpectators(match: LiveMatch): void {
    if (match.spectatorUserIds.size === 0) return
    const message: ServerMessage = {
      type: "spectate:state",
      matchId: match.id,
      state: redactStateForSpectator(match.state),
      turnDeadline: match.turnDeadline,
    }
    for (const userId of match.spectatorUserIds) {
      const session = this.sessions.get(userId)
      if (session) this.send(session, message)
    }
  }

  /** Called once, at settlement, instead of broadcastToSpectators — a
   * different message shape (spectate:over, with a winner rather than a
   * ticking clock) and the last thing a spectator hears about this match. */
  private notifySpectatorsOfResult(match: LiveMatch, winnerSlot: PlayerSlot | null): void {
    if (match.spectatorUserIds.size === 0) return
    const message: ServerMessage = {
      type: "spectate:over",
      matchId: match.id,
      state: redactStateForSpectator(match.state),
      winnerSlot,
    }
    for (const userId of match.spectatorUserIds) {
      const session = this.sessions.get(userId)
      if (session) {
        this.send(session, message)
        session.spectatingMatchId = null
      }
    }
  }

  // --- Disconnect handling --------------------------------------------------

  handleDisconnect(userId: string): void {
    const session = this.sessions.get(userId)
    if (!session) return

    this.sessions.delete(userId)

    if (session.queuedStakeCents !== null && session.queuedRulesetId !== null) {
      const key = this.queueKey(session.queuedStakeCents, session.queuedRulesetId)
      const queue = this.queues.get(key) ?? []
      const index = queue.indexOf(userId)
      if (index >= 0) queue.splice(index, 1)
      if (session.reservationId) {
        void this.options.store.refundStake(session.reservationId)
      }
    }

    // Left the tab open on the "waiting for opponent" screen, then closed it.
    // No stake to refund here — nothing was reserved for a tournament match.
    for (const [tournamentMatchId, waitingSession] of this.tournamentWaiting) {
      if (waitingSession.userId === userId) {
        this.tournamentWaiting.delete(tournamentMatchId)
      }
    }

    // No refund here either: the stake was already reserved back at
    // accept_open_wager/respond_to_challenge time, not at wager:join. If
    // this leaves the challenge accepted but never started,
    // expire_stale_wagers()'s 30-minute grace sweep is the backstop that
    // refunds it — same "cron sweep as backstop" posture as refundStake's
    // own orphan-reservation sweep.
    for (const [challengeId, waitingSession] of this.wagerWaiting) {
      if (waitingSession.userId === userId) {
        this.wagerWaiting.delete(challengeId)
      }
    }

    if (session.spectatingMatchId) {
      const spectated = this.matches.get(session.spectatingMatchId)
      if (spectated) spectated.spectatorUserIds.delete(userId)
    }

    if (!session.matchId) return
    const match = this.matches.get(session.matchId)
    if (!match || match.settled) return

    const slot = this.slotOf(match, userId)
    if (!slot) return

    /**
     * THREAT: rage-quitting a losing position to avoid settlement. A dropped
     * player has a grace window to return; past it the match settles against
     * them. The turn clock is untouched by any of this, so disconnecting is
     * never cheaper than playing on.
     */
    const graceEndsAt = this.clock.now() + RECONNECT_GRACE_MS
    const timer = this.clock.setTimeout(() => {
      if (match.settled) return
      void this.settle(match, "abandon", opponentOf(slot))
    }, RECONNECT_GRACE_MS)

    match.disconnected[slot] = { since: this.clock.now(), timer }

    const opponentSession = this.sessions.get(match.players[opponentOf(slot)])
    if (opponentSession) {
      this.send(opponentSession, {
        type: "match:opponent_disconnected",
        matchId: match.id,
        graceEndsAt,
      })
    }
  }

  private reattach(match: LiveMatch, slot: PlayerSlot, userId: string): void {
    const pending = match.disconnected[slot]
    if (pending) {
      this.clock.clearTimeout(pending.timer)
      delete match.disconnected[slot]
    }

    const session = this.sessions.get(userId)
    if (session) {
      session.matchId = match.id
      this.send(session, {
        type: "match:state",
        matchId: match.id,
        state: redactStateFor(match.state, slot),
        turnDeadline: match.turnDeadline,
      })
    }

    const opponentSession = this.sessions.get(match.players[opponentOf(slot)])
    if (opponentSession) {
      this.send(opponentSession, { type: "match:opponent_reconnected", matchId: match.id })
    }
  }

  // --- Settlement -----------------------------------------------------------

  private async settle(
    match: LiveMatch,
    reason: SettlementInput["reason"],
    forcedWinner?: PlayerSlot
  ): Promise<void> {
    /**
     * Idempotency guard. A timeout firing as a winning move lands, or an
     * abandon timer racing a resignation, would otherwise pay a pot twice.
     */
    if (match.settled) return

    let winnerSlot: PlayerSlot | null = forcedWinner ?? null
    if (!winnerSlot) {
      if (match.state.status === "player_1_won") winnerSlot = 1
      else if (match.state.status === "player_2_won") winnerSlot = 2
    }
    let isDraw = winnerSlot === null

    /**
     * A competitive match — ranked or bracket — should produce exactly one
     * winner. Resign and abandon always pass forcedWinner, so the only way
     * here is a natural board_full/no_legal_moves draw: replayed as sudden
     * death on a fresh board rather than settled as a draw. Stakes and
     * reservations are untouched, so nothing about a ranked player's held
     * funds changes by replaying instead of settling. match.settled stays
     * false: this match is not over.
     *
     * Ranked stops replaying past MAX_RANKED_SUDDEN_DEATH_ROUNDS and falls
     * through to a real draw settlement instead — see that constant's
     * comment. Tournament has no cap, unchanged from before ranked also
     * started replaying: a bracket needs a winner, and an unresolved
     * bracket match is the pre-existing, already-accepted behavior this
     * change didn't introduce.
     */
    if (isDraw && (match.kind === "tournament" || match.suddenDeathRounds < MAX_RANKED_SUDDEN_DEATH_ROUNDS)) {
      this.replayAsSuddenDeath(match)
      return
    }

    /**
     * Feature A — Strategic Score win condition (CLAUDE_CODE_BRIEF.md
     * Phase 6A freeze lifted by explicit, logged owner override; see §3/§4).
     * STRATEGIC_SCORE_ENABLED_RULESETS is empty by default (scoring.ts) —
     * this block is a live no-op for every ruleset until a human
     * deliberately populates it, which is a separate decision from having
     * this code path exist. Scoped to ranked only for this pass: tournament
     * brackets never reach here with isDraw (they always replay instead,
     * see the branch above) and have their own no-draw settlement
     * semantics this hasn't been validated against; wager mirrors ranked's
     * shape closely enough to extend later but wasn't part of Phase 2's
     * simulation. forcedWinner is excluded on purpose — a resign/abandon
     * has no "who played better" question for Strategic Score to answer
     * (see scoring.ts's own header).
     *
     * THREAT: a bug in scoring.ts (or a genuinely malformed replay) must
     * never be able to block or corrupt a real-money settlement. FIX: any
     * throw here is caught and logged, and settlement falls back to the
     * traditional winner exactly as if this block didn't run — the
     * strategic engine can only ever change who wins when it succeeds
     * cleanly, never leave a match unsettled.
     *
     * Computed unconditionally for a natural ranked ending (not just when
     * STRATEGIC_SCORE_ENABLED_RULESETS includes this ruleset) because
     * Feature B (Elite Performance Benchmark) reuses the same ledger for
     * pure analytics below, regardless of whether Strategic Score is this
     * match's actual win condition — see recordPerformanceSnapshot's own
     * comment on why that reuse is safe (analytics never feeds back into
     * settlement).
     */
    let strategicScoreForAnalytics: ReturnType<typeof computeStrategicScore> | null = null
    if (!forcedWinner && match.kind === "ranked") {
      try {
        strategicScoreForAnalytics = computeStrategicScore(getRuleset(match.rulesetId), match.strategicReplay)
        if (isStrategicScoreEnabled(match.rulesetId)) {
          winnerSlot = strategicScoreForAnalytics.strategicWinner
        }
      } catch (err) {
        console.error(
          `[strategic-score] falling back to traditional winner for match ${match.id} (ruleset ${match.rulesetId}):`,
          err
        )
      }
    }
    isDraw = winnerSlot === null

    match.settled = true
    if (match.turnTimer) this.clock.clearTimeout(match.turnTimer)
    for (const entry of Object.values(match.disconnected)) {
      if (entry) this.clock.clearTimeout(entry.timer)
    }

    const loserSlot = winnerSlot ? opponentOf(winnerSlot) : null

    if (match.kind === "tournament") {
      // isDraw was handled above and returned, so both slots are set here.
      const winnerId = match.players[winnerSlot as PlayerSlot]
      const loserId = match.players[loserSlot as PlayerSlot]

      await this.options.store.recordTournamentResult({
        tournamentMatchId: match.tournamentMatchId as string,
        winnerId,
        loserId,
        matchId: match.id,
        reason: reason as TournamentSettlementInput["reason"],
        moveSequence: match.moveSequence,
        durationSeconds: Math.round((this.clock.now() - match.startedAt) / 1000),
      })

      for (const slot of [1, 2] as const) {
        const session = this.sessions.get(match.players[slot])
        if (!session) continue
        this.send(session, {
          type: "tournament:over",
          matchId: match.id,
          tournamentMatchId: match.tournamentMatchId as string,
          // Showdown reveal: true shield state, not the in-match masked
          // view — a hiddenShields format's bluffs are meant to resolve at
          // the end, not stay a mystery forever. See engine.ts's
          // redactStateFor.
          state: redactStateFor(match.state, slot, true),
          result: slot === winnerSlot ? "won" : "lost",
          reason: reason as TournamentSettlementInput["reason"],
        })
        session.matchId = null
      }

      this.notifySpectatorsOfResult(match, winnerSlot)
      this.matches.delete(match.id)
      return
    }

    if (match.kind === "wager") {
      const wagerSettlement = await this.options.store.settleWagerMatch({
        matchId: match.id,
        challengeId: match.challengeId as string,
        winnerId: winnerSlot ? match.players[winnerSlot] : null,
        loserId: loserSlot ? match.players[loserSlot] : null,
        isDraw,
        stakeCents: match.stakeCents,
        reason,
        moveLatenciesBySlot: match.latencies,
        moveSequence: match.moveSequence,
        durationSeconds: Math.round((this.clock.now() - match.startedAt) / 1000),
      })

      for (const slot of [1, 2] as const) {
        const session = this.sessions.get(match.players[slot])
        if (!session) continue

        const isWinner = slot === winnerSlot
        this.send(session, {
          type: "wager:over",
          matchId: match.id,
          challengeId: match.challengeId as string,
          state: redactStateFor(match.state, slot, true),
          result: isDraw ? "draw" : isWinner ? "won" : "lost",
          reason,
          payoutCents: isDraw || isWinner ? wagerSettlement.winnerPayoutCents : 0,
        })
        session.matchId = null
      }

      this.notifySpectatorsOfResult(match, winnerSlot)
      this.matches.delete(match.id)
      return
    }

    const settlement = await this.options.store.settleMatch({
      matchId: match.id,
      reservationIds: match.reservations,
      winnerId: winnerSlot ? match.players[winnerSlot] : null,
      loserId: loserSlot ? match.players[loserSlot] : null,
      isDraw,
      stakeCents: match.stakeCents,
      reason,
      moveLatenciesBySlot: match.latencies,
      moveSequence: match.moveSequence,
      durationSeconds: Math.round((this.clock.now() - match.startedAt) / 1000),
    })

    /**
     * Feature B — Performance Index analytics. Fire-and-forget, not
     * awaited: this is pure analytics with no money or bracket state behind
     * it, so it must never add latency to a player waiting on their
     * match:over message, and a failure here is even less consequential
     * than Feature A's THREAT above — logged, never surfaced to the player,
     * never retried (a missed snapshot is one data point out of many
     * feeding a rolling index, not a settlement).
     */
    if (strategicScoreForAnalytics) {
      const scored = strategicScoreForAnalytics
      const movesMade = scored.finalState.moveNumber
      void this.options.store
        .recordPerformanceSnapshot({
          matchId: match.id,
          rulesetId: match.rulesetId,
          player1: {
            userId: match.players[1],
            movesMade,
            won: winnerSlot === 1,
            componentTotals: scored.ledger.componentTotals[1],
          },
          player2: {
            userId: match.players[2],
            movesMade,
            won: winnerSlot === 2,
            componentTotals: scored.ledger.componentTotals[2],
          },
        })
        .catch((err) => {
          console.error(`[performance-index] failed to record snapshot for match ${match.id}:`, err)
        })
    }

    for (const slot of [1, 2] as const) {
      const session = this.sessions.get(match.players[slot])
      if (!session) continue

      const isWinner = slot === winnerSlot
      this.send(session, {
        type: "match:over",
        matchId: match.id,
        // Showdown reveal — see the tournament:over send above.
        state: redactStateFor(match.state, slot, true),
        result: isDraw ? "draw" : isWinner ? "won" : "lost",
        reason,
        // A draw refunds both stakes (settleMatch's winnerPayoutCents ==
        // stakeCents in that case); a decisive result pays only the actual
        // winner — the loser gets 0, not the winner's number. Was
        // hardcoded to 0 unconditionally before, so the result screen
        // never showed a real amount for anyone, winner included, even
        // though the wallet credit itself was already correct.
        payoutCents: isDraw || isWinner ? settlement.winnerPayoutCents : 0,
        eloDelta: isWinner ? settlement.eloDeltaWinner : settlement.eloDeltaLoser,
      })
      session.matchId = null
    }

    this.notifySpectatorsOfResult(match, winnerSlot)
    this.matches.delete(match.id)
  }

  /**
   * Board filled, or both ran out of legal moves, with no line completed.
   * Same two players, fresh board, same ruleset, same stake/reservations —
   * the match stays in `this.matches` under the same id so reconnection
   * during sudden death still finds it via the normal reattach path in
   * handleConnection.
   *
   * Slot 1 vs 2 is NOT re-flipped between rounds: doing so would mean
   * reshuffling which reservation belongs to which slot mid-match, and that
   * bookkeeping is a real-money correctness risk this rare a tail case
   * doesn't justify.
   *
   * WHO MOVES FIRST on the fresh board is re-flipped every round, though —
   * createGame() defaults turn:1, which used to mean slot 1 held the
   * first-move edge on every single sudden-death board, not just the
   * original one, concentrating a real structural advantage on one physical
   * player against one specific opponent for the rest of that match. The
   * per-round flip below is what actually makes "unbiased across the
   * population of matches" true within a match that draws repeatedly, not
   * just across separate matches.
   */
  private replayAsSuddenDeath(match: LiveMatch): void {
    const ruleset = getRuleset(match.rulesetId)
    match.state = createGame(ruleset)
    match.suddenDeathRounds += 1

    if (!coinFlipGivesFirstSlotTo(match.id, match.suddenDeathRounds)) {
      match.state = { ...match.state, turn: 2 }
    }

    // Appended, not reset. The eventual settlement record (matches.duration
    // and match_replays' move/timing history — the same data bracket.ts's
    // header calls "resolvable" evidence for a dispute) needs every round
    // that was actually played, not just the one that happened to decide
    // it. startedAt stays at the true match start for the same reason:
    // durationSeconds should reflect the real time both players spent, not
    // just the final board.
    match.moveSequence.push(`--- sudden death round ${match.suddenDeathRounds}: fresh board ---`)

    // strategicReplay IS reset here, unlike moveSequence above — see the
    // field's own comment on LiveMatch. Whichever round actually settles is
    // the only one Strategic Score should ever see.
    match.strategicReplay = []

    this.advanceTurn(match, MATCH_START_GRACE_MS)

    for (const slot of [1, 2] as const) {
      const session = this.sessions.get(match.players[slot])
      if (!session) continue
      this.send(
        session,
        match.kind === "tournament"
          ? {
              type: "tournament:sudden_death",
              tournamentMatchId: match.tournamentMatchId as string,
              state: redactStateFor(match.state, slot),
              turnDeadline: match.turnDeadline,
            }
          : match.kind === "wager"
          ? {
              type: "wager:sudden_death",
              challengeId: match.challengeId as string,
              state: redactStateFor(match.state, slot),
              turnDeadline: match.turnDeadline,
            }
          : {
              type: "match:sudden_death",
              matchId: match.id,
              state: redactStateFor(match.state, slot),
              turnDeadline: match.turnDeadline,
            }
      )
    }
    this.broadcastToSpectators(match)
  }

  // --- Liveness -------------------------------------------------------------

  /** Call on an interval. Reaps sockets that stopped answering heartbeats. */
  sweep(): void {
    const now = this.clock.now()
    for (const [userId, session] of this.sessions) {
      if (now - session.lastSeenAt > HEARTBEAT_TIMEOUT_MS) {
        session.socket.close(4408, "heartbeat timeout")
        this.handleDisconnect(userId)
        continue
      }
      this.send(session, { type: "ping" })
    }

    // Bound the replay-guard set so a long-running process does not leak.
    if (this.redeemedTickets.size > 100_000) this.redeemedTickets.clear()
  }

  static get heartbeatIntervalMs(): number {
    return HEARTBEAT_INTERVAL_MS
  }

  // --- Helpers --------------------------------------------------------------

  private slotOf(match: LiveMatch, userId: string): PlayerSlot | null {
    if (match.players[1] === userId) return 1
    if (match.players[2] === userId) return 2
    return null
  }

  private send(session: Session, message: ServerMessage): void {
    try {
      session.socket.send(JSON.stringify(message))
    } catch {
      // A failed write means the socket is gone; the sweep will reap it.
    }
  }
}
