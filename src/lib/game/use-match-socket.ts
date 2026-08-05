"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import {
  applyOptimisticMove,
  type Board,
  type PieceKind,
  type PlayerSlot,
  type RedactedGameState,
} from "@/lib/game/engine"
import type { ClientMessage, RankedRulesetId, ServerMessage } from "@/lib/game/protocol"

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "queued"
  | "tournament_waiting"
  | "wager_waiting"
  | "matched"
  | "over"
  | "disconnected"
  | "error"

export interface MatchOpponent {
  username: string
  eloRating: number
}

export interface MatchResult {
  result: "won" | "lost" | "draw"
  reason: string
  /** Ranked only — a tournament match settles nothing on its own. */
  payoutCents?: number
  eloDelta?: number
  /** The final position, so the result screen can show the board a win was
   * actually made on instead of only naming the outcome. */
  board: Board
  you: PlayerSlot
  winningLine: number[] | null
}

export interface MatchSocketState {
  phase: ConnectionPhase
  queuePosition: number | null
  matchId: string | null
  /** Set only when this match came from a tournament bracket, not the ranked queue. */
  tournamentMatchId: string | null
  /** Set only when this match came from an accepted wager (open board or a
   * friend challenge), not the ranked queue or a tournament bracket. */
  challengeId: string | null
  opponent: MatchOpponent | null
  stakeCents: number | null
  gameState: RedactedGameState | null
  turnDeadline: number | null
  result: MatchResult | null
  errorMessage: string | null
  opponentDisconnected: boolean
  graceEndsAt: number | null
  /** True for the moment right after a drawn board replays — the UI's cue
   * that the reset board isn't a bug, it's the match refusing to end in a
   * draw. Cleared by the next real move. */
  suddenDeath: boolean
}

const INITIAL_STATE: MatchSocketState = {
  phase: "idle",
  queuePosition: null,
  matchId: null,
  tournamentMatchId: null,
  challengeId: null,
  opponent: null,
  stakeCents: null,
  gameState: null,
  turnDeadline: null,
  result: null,
  errorMessage: null,
  opponentDisconnected: false,
  graceEndsAt: null,
  suddenDeath: false,
}

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5

export function useMatchSocket() {
  const [state, setState] = useState<MatchSocketState>(INITIAL_STATE)
  const socketRef = useRef<WebSocket | null>(null)
  const seqRef = useRef(0)
  const reconnectAttemptsRef = useRef(0)
  const desiredStakeRef = useRef<number | null>(null)
  const desiredRulesetIdRef = useRef<RankedRulesetId>("classic")
  const desiredTournamentMatchIdRef = useRef<string | null>(null)
  const desiredChallengeIdRef = useRef<string | null>(null)
  const intentionalCloseRef = useRef(false)
  /**
   * Snapshot taken the instant an optimistic move is applied, so a rejection
   * can be undone. Wiped the moment any authoritative state arrives, since
   * there's nothing left to roll back to once the server has spoken.
   *
   * The error handler below rolls back whenever this is non-null, rather
   * than checking the error's code against an allowlist of "move rejection"
   * codes — a code-based allowlist is exactly how this broke once already:
   * rate_limited (a real, reachable rejection of a match:move under a burst
   * of sends) wasn't on the list, so the optimistic board stayed applied
   * with no correction until an eventual forced-timeout burned the player's
   * piece. Whether a snapshot is currently held is a more reliable signal
   * than guessing which server error codes can arrive in response to a move.
   */
  const lastAuthoritativeRef = useRef<{
    gameState: RedactedGameState
    turnDeadline: number | null
  } | null>(null)

  /**
   * True from the moment a move is optimistically applied until an
   * authoritative message (success or rejection) resolves it. Prevents a
   * second rapid submitMove call — a fast double-click, or a tap landing in
   * the ~1-frame window before React commits the optimistic turn flip that
   * disables the board — from reading an already-optimistic (unconfirmed)
   * gameState as if it were the last known-good one and clobbering
   * lastAuthoritativeRef with it.
   */
  const pendingMoveRef = useRef(false)

  const send = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message))
    }
  }, [])

  const handleServerMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case "queue:waiting":
        setState((s) => ({
          ...s,
          phase: "queued",
          queuePosition: message.position,
          stakeCents: message.stakeCents,
        }))
        return

      case "queue:left":
        setState(() => ({ ...INITIAL_STATE, phase: "idle" }))
        return

      case "match:start":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "matched",
          matchId: message.matchId,
          tournamentMatchId: null,
          opponent: message.opponent,
          stakeCents: message.stakeCents,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          opponentDisconnected: false,
          graceEndsAt: null,
          suddenDeath: false,
        }))
        return

      case "tournament:waiting":
        setState((s) => ({
          ...s,
          phase: "tournament_waiting",
          tournamentMatchId: message.tournamentMatchId,
        }))
        return

      case "tournament:start":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "matched",
          matchId: message.matchId,
          tournamentMatchId: message.tournamentMatchId,
          opponent: message.opponent,
          stakeCents: null,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          opponentDisconnected: false,
          graceEndsAt: null,
          suddenDeath: false,
        }))
        return

      case "tournament:sudden_death":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "matched",
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          result: null,
          suddenDeath: true,
        }))
        return

      case "wager:waiting":
        setState((s) => ({
          ...s,
          phase: "wager_waiting",
          challengeId: message.challengeId,
        }))
        return

      case "wager:start":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "matched",
          matchId: message.matchId,
          challengeId: message.challengeId,
          opponent: message.opponent,
          stakeCents: message.stakeCents,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          opponentDisconnected: false,
          graceEndsAt: null,
          suddenDeath: false,
        }))
        return

      case "wager:sudden_death":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "matched",
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          result: null,
          suddenDeath: true,
        }))
        return

      case "wager:over":
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "over",
          gameState: message.state,
          result: {
            result: message.result,
            reason: message.reason,
            // No eloDelta for a wager — settle_wager_match deliberately
            // never touches it. MatchResult.eloDelta is optional for
            // exactly this case; the result card treats an absent value as
            // "not applicable", not "zero change".
            payoutCents: message.payoutCents,
            board: message.state.board,
            you: message.state.you,
            winningLine: message.state.winningLine,
          },
        }))
        return

      case "match:state":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          suddenDeath: false,
        }))
        return

      case "match:sudden_death":
        seqRef.current = message.state.moveNumber
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          result: null,
          suddenDeath: true,
        }))
        return

      case "match:over":
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "over",
          gameState: message.state,
          result: {
            result: message.result,
            reason: message.reason,
            payoutCents: message.payoutCents,
            eloDelta: message.eloDelta,
            board: message.state.board,
            you: message.state.you,
            winningLine: message.state.winningLine,
          },
        }))
        return

      case "tournament:over":
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => ({
          ...s,
          phase: "over",
          gameState: message.state,
          result: {
            result: message.result,
            reason: message.reason,
            board: message.state.board,
            you: message.state.you,
            winningLine: message.state.winningLine,
          },
        }))
        return

      case "match:opponent_disconnected":
        setState((s) => ({ ...s, opponentDisconnected: true, graceEndsAt: message.graceEndsAt }))
        return

      case "match:opponent_reconnected":
        setState((s) => ({ ...s, opponentDisconnected: false, graceEndsAt: null }))
        return

      case "ping":
        send({ type: "pong" })
        return

      case "error": {
        const rollback = lastAuthoritativeRef.current
        lastAuthoritativeRef.current = null
        pendingMoveRef.current = false
        setState((s) => {
          // A pre-match rejection (ineligible stake, malformed join, a rate
          // limit before any match exists) has no board to fall back to —
          // leaving phase alone strands the player on "Connecting…"/"Finding
          // an opponent" forever with no way out. Once matched, an error is a
          // rejected move, not a reason to leave the game, so phase stays put
          // and the rollback above is what corrects the board.
          const isPreMatch =
            s.phase === "connecting" ||
            s.phase === "queued" ||
            s.phase === "tournament_waiting" ||
            s.phase === "wager_waiting"
          return {
            ...s,
            phase: isPreMatch ? "error" : s.phase,
            errorMessage: message.message,
            ...(rollback && { gameState: rollback.gameState, turnDeadline: rollback.turnDeadline }),
          }
        })
        return
      }
    }
  }, [send])

  /**
   * Shared by connect() and connectTournament() — everything except which
   * message fires on open (queue:join with a stake vs tournament:join with a
   * bracket match id) and which ref drives reconnection.
   */
  const openSocket = useCallback(
    async (onOpenMessage: ClientMessage) => {
      let ticket: string
      try {
        const res = await fetch("/api/ws-ticket")
        if (!res.ok) throw new Error("Could not get a connection ticket")
        const data = (await res.json()) as { ticket: string }
        ticket = data.ticket
      } catch {
        setState((s) => ({ ...s, phase: "error", errorMessage: "Could not connect. Try again." }))
        return
      }

      const base = process.env.NEXT_PUBLIC_GAME_API_URL ?? "ws://localhost:3001"
      const socket = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`)
      socketRef.current = socket

      socket.onopen = () => {
        reconnectAttemptsRef.current = 0
        send(onOpenMessage)
      }

      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as ServerMessage
          handleServerMessage(parsed)
        } catch {
          // Malformed frame from the server side would be a server bug, not
          // something the client can act on. Drop it.
        }
      }

      socket.onclose = () => {
        if (intentionalCloseRef.current) return

        setState((s) => (s.phase === "matched" ? { ...s, phase: "disconnected" } : s))

        const canRetryRanked = desiredStakeRef.current !== null
        const canRetryTournament = desiredTournamentMatchIdRef.current !== null
        const canRetryWager = desiredChallengeIdRef.current !== null

        if (
          (canRetryRanked || canRetryTournament || canRetryWager) &&
          reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS
        ) {
          reconnectAttemptsRef.current += 1
          setTimeout(() => {
            if (desiredStakeRef.current !== null) {
              void connect(desiredStakeRef.current, desiredRulesetIdRef.current)
            } else if (desiredTournamentMatchIdRef.current !== null) {
              void connectTournament(desiredTournamentMatchIdRef.current)
            } else if (desiredChallengeIdRef.current !== null) {
              void connectWager(desiredChallengeIdRef.current)
            }
          }, RECONNECT_DELAY_MS * reconnectAttemptsRef.current)
        } else {
          setState((s) => ({
            ...s,
            phase: "error",
            errorMessage: "Connection lost. Refresh to try again.",
          }))
        }
      }

      socket.onerror = () => {
        // onclose fires immediately after; no separate handling needed.
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [handleServerMessage, send]
  )

  const connect = useCallback(
    async (stakeCents: number, rulesetId: RankedRulesetId = "classic") => {
      intentionalCloseRef.current = false
      desiredStakeRef.current = stakeCents
      desiredRulesetIdRef.current = rulesetId
      desiredTournamentMatchIdRef.current = null
      desiredChallengeIdRef.current = null
      setState((s) => ({ ...s, phase: "connecting", errorMessage: null }))
      await openSocket({ type: "queue:join", stakeCents, rulesetId })
    },
    [openSocket]
  )

  /** Connects to a specific bracket match rather than the open ranked queue. */
  const connectTournament = useCallback(
    async (tournamentMatchId: string) => {
      intentionalCloseRef.current = false
      desiredTournamentMatchIdRef.current = tournamentMatchId
      desiredStakeRef.current = null
      desiredChallengeIdRef.current = null
      setState((s) => ({ ...s, phase: "connecting", errorMessage: null }))
      await openSocket({ type: "tournament:join", tournamentMatchId })
    },
    [openSocket]
  )

  /** Connects to a specific accepted wager rather than the open ranked queue
   * — same rendezvous shape as connectTournament. */
  const connectWager = useCallback(
    async (challengeId: string) => {
      intentionalCloseRef.current = false
      desiredChallengeIdRef.current = challengeId
      desiredStakeRef.current = null
      desiredTournamentMatchIdRef.current = null
      setState((s) => ({ ...s, phase: "connecting", errorMessage: null }))
      await openSocket({ type: "wager:join", challengeId })
    },
    [openSocket]
  )

  const leaveQueue = useCallback(() => {
    send({ type: "queue:leave" })
    desiredStakeRef.current = null
  }, [send])

  const submitMove = useCallback(
    (matchId: string, kind: PieceKind, index: number, targetIndex?: number) => {
      // Dropped, not queued: the board is already showing the result of the
      // in-flight move (isMyTurn goes false the instant it's applied), so a
      // second call this soon is a double-click/double-tap, not a real
      // second decision. Without this guard, the second call would read the
      // first call's already-optimistic state as if it were server-
      // confirmed and clobber the rollback snapshot with it.
      if (pendingMoveRef.current) return
      pendingMoveRef.current = true

      // seq always comes from the last server-confirmed moveNumber, never
      // from the optimistic one below — the board can render ahead of the
      // server, but what gets sent over the wire never does.
      const seq = seqRef.current

      setState((s) => {
        if (!s.gameState) {
          pendingMoveRef.current = false
          return s
        }
        lastAuthoritativeRef.current = { gameState: s.gameState, turnDeadline: s.turnDeadline }
        return {
          ...s,
          gameState: applyOptimisticMove(s.gameState, s.gameState.you, {
            kind,
            index,
            targetIndex,
          }),
        }
      })

      send({
        type: "match:move",
        matchId,
        seq,
        kind,
        index,
        ...(targetIndex !== undefined ? { targetIndex } : {}),
      })
    },
    [send]
  )

  const resign = useCallback(
    (matchId: string) => {
      send({ type: "match:resign", matchId })
    },
    [send]
  )

  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true
    desiredStakeRef.current = null
    desiredTournamentMatchIdRef.current = null
    desiredChallengeIdRef.current = null
    lastAuthoritativeRef.current = null
    pendingMoveRef.current = false
    socketRef.current?.close(1000, "client left")
    socketRef.current = null
    setState(INITIAL_STATE)
  }, [])

  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true
      socketRef.current?.close(1000, "unmount")
    }
  }, [])

  return { state, connect, connectTournament, connectWager, leaveQueue, submitMove, resign, disconnect }
}
