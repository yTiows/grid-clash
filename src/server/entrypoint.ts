/**
 * Runnable WebSocket process. `npm run ws-server`.
 *
 * Separate from the Next.js process because a long-lived WebSocket server and
 * a request/response web framework have incompatible lifecycles — Next's
 * serverless-friendly deployment targets do not hold connections open. This
 * is designed to run as its own long-lived service (Fly.io, Railway, a plain
 * VM), reachable at NEXT_PUBLIC_GAME_API_URL.
 *
 * Thin by design: this file adapts `ws` to the Socket interface MatchServer
 * expects and does nothing else. All game and settlement logic already lives
 * in match-server.ts and sql-match-store.ts, both covered by the adversarial
 * test suite from earlier in the build.
 */

import { createServer } from "node:http"
import { WebSocketServer, type WebSocket as WSWebSocket } from "ws"

import { MatchServer, type Socket } from "@/server/match-server"
import { SqlMatchStore } from "@/server/sql-match-store"

const PORT = Number(process.env.WS_SERVER_PORT ?? 3001)
const TICKET_SECRET = process.env.WS_TICKET_SECRET
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())

if (!TICKET_SECRET) {
  console.error("WS_TICKET_SECRET is not set. Refusing to start — every connection would be forgeable.")
  process.exit(1)
}

function wrapSocket(ws: WSWebSocket, remoteAddress: string): Socket {
  return {
    send: (data: string) => ws.send(data),
    close: (code?: number, reason?: string) => ws.close(code, reason),
    remoteAddress,
  }
}

const matchServer = new MatchServer({
  store: new SqlMatchStore(),
  ticketSecret: TICKET_SECRET,
  allowedOrigins: ALLOWED_ORIGINS,
})

const httpServer = createServer((req, res) => {
  // Plain HTTP health check. Deployment platforms poll this, not the socket.
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" })
    res.end(JSON.stringify({ status: "ok" }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ noServer: true })

httpServer.on("upgrade", (req, socket, head) => {
  const origin = req.headers.origin
  if (!matchServer.isOriginAllowed(origin)) {
    socket.destroy()
    return
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req)
  })
})

wss.on("connection", (ws: WSWebSocket, req) => {
  const url = new URL(req.url ?? "", "http://localhost")
  const ticket = url.searchParams.get("ticket")
  const remoteAddress = req.socket.remoteAddress ?? "unknown"

  if (!ticket) {
    ws.close(4401, "missing ticket")
    return
  }

  const wrapped = wrapSocket(ws, remoteAddress)
  const userId = matchServer.handleConnection(wrapped, ticket)

  if (!userId) {
    // handleConnection already sent the error frame and closed the socket.
    return
  }

  ws.on("message", (data) => {
    void matchServer.handleMessage(userId, data.toString())
  })

  ws.on("close", () => {
    matchServer.handleDisconnect(userId)
  })

  ws.on("error", (err) => {
    console.error("[ws] socket error", { userId, message: err.message })
  })
})

// Heartbeat sweep: reaps sockets that stop answering ping/pong and bounds the
// ticket replay-guard set. Runs independently of any individual connection.
setInterval(() => matchServer.sweep(), MatchServer.heartbeatIntervalMs)

httpServer.listen(PORT, () => {
  console.log(`Grid Clash match server listening on :${PORT}`)
  console.log(`Allowed origins: ${ALLOWED_ORIGINS.join(", ")}`)
})

process.on("SIGTERM", () => {
  console.log("SIGTERM received, closing server")
  httpServer.close(() => process.exit(0))
})
