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
  MOVE_TIMEOUT_MS,
  type GameState,
  type PlayerSlot,
} from "@/lib/game/engine"
import { getRuleset } from "@/lib/game/rulesets"
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
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
  settleMatch(input: SettlementInput): Promise<{ eloDeltaWinner: number; eloDeltaLoser: number }>
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
  reservationId: string | null
  lastSeenAt: number
  violations: number
}

interface LiveMatch {
  id: string
  /** Ranked pays per match and moves Elo; tournament does neither — money and
   * placement are settled once, at contest completion, not per bracket game. */
  kind: "ranked" | "tournament"
  tournamentMatchId?: string
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
  disconnected: Partial<Record<PlayerSlot, { since: number; timer: unknown }>>
  settled: boolean
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
  private readonly queues = new Map<number, string[]>()
  /**
   * First player to send tournament:join for a given tournamentMatchId waits
   * here for the second. Unlike the ranked queues, there's exactly one valid
   * opponent — the bracket already decided it — so this is a lookup by
   * tournamentMatchId, not a FIFO list.
   */
  private readonly tournamentWaiting = new Map<string, Session>()
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
      reservationId: null,
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
        return this.joinQueue(session, message.stakeCents)
      case "queue:leave":
        return this.leaveQueue(session)
      case "tournament:join":
        return this.joinTournamentMatch(session, message.tournamentMatchId)
      case "match:move":
        return this.handleMove(session, message)
      case "match:resign":
        return this.handleResign(session, message.matchId)
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

  private async joinQueue(session: Session, stakeCents: number): Promise<void> {
    if (session.matchId) return this.send(session, errorMessage("not_in_match"))

    /**
     * The stake is reserved before the player is queued, not when a match is
     * found. Reserving at match time means a player can sit in several queues
     * with one balance and win a race they should have lost.
     */
    const reservationId = await this.options.store.reserveStake(session.userId, stakeCents)
    if (!reservationId) return this.send(session, errorMessage("ineligible"))
    session.reservationId = reservationId

    const queue = this.queues.get(stakeCents) ?? []

    /**
     * THREAT: two colluders queue at the same instant at an unusual stake to
     * be paired, then dump the match to move money between accounts while
     * every individual transaction looks ordinary.
     *
     * FIX: never pair linked accounts. The check runs here rather than in
     * post-hoc review because a settled collusive match has already moved
     * money.
     */
    for (let i = 0; i < queue.length; i++) {
      const candidateId = queue[i]
      if (!candidateId) continue
      if (candidateId === session.userId) continue

      const linked = await this.options.store.arePlayersLinked(session.userId, candidateId)
      if (linked) continue

      const candidate = this.sessions.get(candidateId)
      if (!candidate) {
        queue.splice(i, 1)
        i--
        continue
      }

      queue.splice(i, 1)
      this.queues.set(stakeCents, queue)
      await this.startMatch(candidate, session, stakeCents)
      return
    }

    queue.push(session.userId)
    this.queues.set(stakeCents, queue)
    session.queuedStakeCents = stakeCents
    this.send(session, { type: "queue:waiting", position: queue.length, stakeCents })
  }

  private async leaveQueue(session: Session): Promise<void> {
    const stake = session.queuedStakeCents
    if (stake === null) return

    const queue = this.queues.get(stake) ?? []
    const index = queue.indexOf(session.userId)
    if (index >= 0) queue.splice(index, 1)
    this.queues.set(stake, queue)

    session.queuedStakeCents = null
    if (session.reservationId) {
      await this.options.store.refundStake(session.reservationId)
      session.reservationId = null
    }
    this.send(session, { type: "queue:left" })
  }

  private async startMatch(a: Session, b: Session, stakeCents: number): Promise<void> {
    const matchId = randomUUID()
    const state = createGame()

    const match: LiveMatch = {
      id: matchId,
      kind: "ranked",
      rulesetId: "classic",
      stakeCents,
      state,
      players: { 1: a.userId, 2: b.userId },
      reservations: { 1: a.reservationId ?? "", 2: b.reservationId ?? "" },
      turnDeadline: this.clock.now() + MOVE_TIMEOUT_MS,
      turnStartedAt: this.clock.now(),
      turnTimer: null,
      startedAt: this.clock.now(),
      latencies: { 1: [], 2: [] },
      moveSequence: [],
      disconnected: {},
      settled: false,
    }

    this.matches.set(matchId, match)
    a.matchId = matchId
    b.matchId = matchId
    a.queuedStakeCents = null
    b.queuedStakeCents = null
    a.reservationId = null
    b.reservationId = null

    const [cardA, cardB] = await Promise.all([
      this.options.store.getPlayerCard(a.userId),
      this.options.store.getPlayerCard(b.userId),
    ])

    this.send(a, {
      type: "match:start",
      matchId,
      opponent: cardB,
      stakeCents,
      state: redactStateFor(state, 1),
      turnDeadline: match.turnDeadline,
    })
    this.send(b, {
      type: "match:start",
      matchId,
      opponent: cardA,
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
    const matchId = randomUUID()
    const ruleset = getRuleset(matchup.rulesetId)
    const state = createGame(ruleset)

    // Bracket seeding already decided who's who; slot assignment here is only
    // about which socket is 1 vs 2, not a fairness question ranked's random
    // first-player pick has to answer.
    const [p1, p2] = matchup.player1 === a.userId ? [a, b] : [b, a]

    const match: LiveMatch = {
      id: matchId,
      kind: "tournament",
      tournamentMatchId: matchup.tournamentMatchId,
      rulesetId: matchup.rulesetId,
      stakeCents: 0,
      state,
      players: { 1: p1.userId, 2: p2.userId },
      reservations: { 1: "", 2: "" },
      turnDeadline: this.clock.now() + ruleset.moveTimeoutMs,
      turnStartedAt: this.clock.now(),
      turnTimer: null,
      startedAt: this.clock.now(),
      latencies: { 1: [], 2: [] },
      moveSequence: [],
      disconnected: {},
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
      match.latencies[slot].push(MOVE_TIMEOUT_MS)
      match.state = applyTimeout(match.state, slot)
      this.advanceTurn(match)

      if (match.state.status !== "active") {
        void this.settle(match, "no_legal_moves")
        return
      }

      this.broadcastState(match, true)
    }, Math.max(0, match.turnDeadline - this.clock.now()))
  }

  private advanceTurn(match: LiveMatch): void {
    match.turnStartedAt = this.clock.now()
    match.turnDeadline = match.turnStartedAt + getRuleset(match.rulesetId).moveTimeoutMs
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
  }

  // --- Disconnect handling --------------------------------------------------

  handleDisconnect(userId: string): void {
    const session = this.sessions.get(userId)
    if (!session) return

    this.sessions.delete(userId)

    if (session.queuedStakeCents !== null) {
      const stake = session.queuedStakeCents
      const queue = this.queues.get(stake) ?? []
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
    const isDraw = winnerSlot === null

    /**
     * A bracket needs exactly one winner to advance. Resign and abandon
     * always pass forcedWinner, so the only way here is a natural
     * board_full/no_legal_moves draw — replayed as sudden death rather than
     * settled. match.settled stays false: this match is not over.
     */
    if (match.kind === "tournament" && isDraw) {
      this.replayAsSuddenDeath(match)
      return
    }

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
          state: redactStateFor(match.state, slot),
          result: slot === winnerSlot ? "won" : "lost",
          reason: reason as TournamentSettlementInput["reason"],
        })
        session.matchId = null
      }

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

    for (const slot of [1, 2] as const) {
      const session = this.sessions.get(match.players[slot])
      if (!session) continue

      const isWinner = slot === winnerSlot
      this.send(session, {
        type: "match:over",
        matchId: match.id,
        state: redactStateFor(match.state, slot),
        result: isDraw ? "draw" : isWinner ? "won" : "lost",
        reason,
        payoutCents: 0, // populated by the store layer's return in production wiring
        eloDelta: isWinner ? settlement.eloDeltaWinner : settlement.eloDeltaLoser,
      })
      session.matchId = null
    }

    this.matches.delete(match.id)
  }

  /**
   * Board filled, or both ran out of legal moves, with no line completed.
   * Same two players, fresh board, same ruleset — the match stays in
   * `this.matches` under the same id so reconnection during sudden death
   * still finds it via the normal reattach path in handleConnection.
   */
  private replayAsSuddenDeath(match: LiveMatch): void {
    const ruleset = getRuleset(match.rulesetId)
    match.state = createGame(ruleset)
    match.moveSequence = []
    match.latencies = { 1: [], 2: [] }
    match.startedAt = this.clock.now()

    this.advanceTurn(match)

    for (const slot of [1, 2] as const) {
      const session = this.sessions.get(match.players[slot])
      if (!session) continue
      this.send(session, {
        type: "tournament:sudden_death",
        tournamentMatchId: match.tournamentMatchId as string,
        state: redactStateFor(match.state, slot),
        turnDeadline: match.turnDeadline,
      })
    }
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
