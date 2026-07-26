"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { PieceKind, RedactedGameState } from "@/lib/game/engine"
import type { ClientMessage, ServerMessage } from "@/lib/game/protocol"

export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "queued"
  | "tournament_waiting"
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
}

export interface MatchSocketState {
  phase: ConnectionPhase
  queuePosition: number | null
  matchId: string | null
  /** Set only when this match came from a tournament bracket, not the ranked queue. */
  tournamentMatchId: string | null
  opponent: MatchOpponent | null
  stakeCents: number | null
  gameState: RedactedGameState | null
  turnDeadline: number | null
  result: MatchResult | null
  errorMessage: string | null
  opponentDisconnected: boolean
  graceEndsAt: number | null
}

const INITIAL_STATE: MatchSocketState = {
  phase: "idle",
  queuePosition: null,
  matchId: null,
  tournamentMatchId: null,
  opponent: null,
  stakeCents: null,
  gameState: null,
  turnDeadline: null,
  result: null,
  errorMessage: null,
  opponentDisconnected: false,
  graceEndsAt: null,
}

const RECONNECT_DELAY_MS = 2000
const MAX_RECONNECT_ATTEMPTS = 5

export function useMatchSocket() {
  const [state, setState] = useState<MatchSocketState>(INITIAL_STATE)
  const socketRef = useRef<WebSocket | null>(null)
  const seqRef = useRef(0)
  const reconnectAttemptsRef = useRef(0)
  const desiredStakeRef = useRef<number | null>(null)
  const desiredTournamentMatchIdRef = useRef<string | null>(null)
  const intentionalCloseRef = useRef(false)

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
        }))
        return

      case "tournament:sudden_death":
        seqRef.current = message.state.moveNumber
        setState((s) => ({
          ...s,
          phase: "matched",
          gameState: message.state,
          turnDeadline: message.turnDeadline,
          result: null,
        }))
        return

      case "match:state":
        seqRef.current = message.state.moveNumber
        setState((s) => ({
          ...s,
          gameState: message.state,
          turnDeadline: message.turnDeadline,
        }))
        return

      case "match:over":
        setState((s) => ({
          ...s,
          phase: "over",
          gameState: message.state,
          result: {
            result: message.result,
            reason: message.reason,
            payoutCents: message.payoutCents,
            eloDelta: message.eloDelta,
          },
        }))
        return

      case "tournament:over":
        setState((s) => ({
          ...s,
          phase: "over",
          gameState: message.state,
          result: { result: message.result, reason: message.reason },
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

      case "error":
        setState((s) => ({ ...s, errorMessage: message.message }))
        return
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

        if ((canRetryRanked || canRetryTournament) && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1
          setTimeout(() => {
            if (desiredStakeRef.current !== null) {
              void connect(desiredStakeRef.current)
            } else if (desiredTournamentMatchIdRef.current !== null) {
              void connectTournament(desiredTournamentMatchIdRef.current)
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
    async (stakeCents: number) => {
      intentionalCloseRef.current = false
      desiredStakeRef.current = stakeCents
      desiredTournamentMatchIdRef.current = null
      setState((s) => ({ ...s, phase: "connecting", errorMessage: null }))
      await openSocket({ type: "queue:join", stakeCents })
    },
    [openSocket]
  )

  /** Connects to a specific bracket match rather than the open ranked queue. */
  const connectTournament = useCallback(
    async (tournamentMatchId: string) => {
      intentionalCloseRef.current = false
      desiredTournamentMatchIdRef.current = tournamentMatchId
      desiredStakeRef.current = null
      setState((s) => ({ ...s, phase: "connecting", errorMessage: null }))
      await openSocket({ type: "tournament:join", tournamentMatchId })
    },
    [openSocket]
  )

  const leaveQueue = useCallback(() => {
    send({ type: "queue:leave" })
    desiredStakeRef.current = null
  }, [send])

  const submitMove = useCallback(
    (matchId: string, kind: PieceKind, index: number, targetIndex?: number) => {
      send({
        type: "match:move",
        matchId,
        seq: seqRef.current,
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

  return { state, connect, connectTournament, leaveQueue, submitMove, resign, disconnect }
}
