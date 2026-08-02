"use client"

import { useEffect, useRef, useState } from "react"

import type { PlayerSlot, SpectatorGameState } from "@/lib/game/engine"
import type { ServerMessage } from "@/lib/game/protocol"

export type SpectatorPhase = "connecting" | "watching" | "over" | "error"

export interface SpectatorState {
  phase: SpectatorPhase
  gameState: SpectatorGameState | null
  turnDeadline: number | null
  winnerSlot: PlayerSlot | null
  errorMessage: string | null
}

const INITIAL_STATE: SpectatorState = {
  phase: "connecting",
  gameState: null,
  turnDeadline: null,
  winnerSlot: null,
  errorMessage: null,
}

/**
 * Read-only counterpart to use-match-socket.ts, deliberately not folded into
 * it — a spectator never queues, never reserves a stake, never submits a
 * move, and needs none of that hook's reconnect-with-desired-stake state.
 * Same ticket exchange (a connection ticket carries no intent of its own;
 * spectate:join is what declares it), same one-frame parse-or-drop handling.
 */
export function useSpectatorSocket(matchId: string) {
  const [state, setState] = useState<SpectatorState>(INITIAL_STATE)
  const socketRef = useRef<WebSocket | null>(null)
  const intentionalCloseRef = useRef(false)

  useEffect(() => {
    intentionalCloseRef.current = false
    setState(INITIAL_STATE)

    let cancelled = false

    async function connect() {
      let ticket: string
      try {
        const res = await fetch("/api/ws-ticket")
        if (!res.ok) throw new Error("no ticket")
        const data = (await res.json()) as { ticket: string }
        ticket = data.ticket
      } catch {
        if (!cancelled) {
          setState((s) => ({ ...s, phase: "error", errorMessage: "Could not connect. Try again." }))
        }
        return
      }
      if (cancelled) return

      const base = process.env.NEXT_PUBLIC_GAME_API_URL ?? "ws://localhost:3001"
      const socket = new WebSocket(`${base}?ticket=${encodeURIComponent(ticket)}`)
      socketRef.current = socket

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: "spectate:join", matchId }))
      }

      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data as string) as ServerMessage
          if (message.type === "spectate:state") {
            setState((s) => ({
              ...s,
              phase: "watching",
              gameState: message.state,
              turnDeadline: message.turnDeadline,
            }))
          } else if (message.type === "spectate:over") {
            setState((s) => ({
              ...s,
              phase: "over",
              gameState: message.state,
              winnerSlot: message.winnerSlot,
            }))
          } else if (message.type === "error") {
            setState((s) => ({ ...s, phase: "error", errorMessage: message.message }))
          } else if (message.type === "ping") {
            socket.send(JSON.stringify({ type: "pong" }))
          }
        } catch {
          // Malformed frame — a server bug, not something to act on here.
        }
      }

      socket.onclose = () => {
        if (intentionalCloseRef.current || cancelled) return
        setState((s) =>
          s.phase === "over" ? s : { ...s, phase: "error", errorMessage: "Connection lost." }
        )
      }
    }

    void connect()

    return () => {
      cancelled = true
      intentionalCloseRef.current = true
      socketRef.current?.close(1000, "unmount")
      socketRef.current = null
    }
  }, [matchId])

  return state
}
