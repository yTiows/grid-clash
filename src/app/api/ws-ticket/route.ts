import { NextResponse } from "next/server"

import { issueTicket } from "@/server/match-server"
import { createClient } from "@/lib/supabase/server"

/**
 * Issues a single-use, 30-second WebSocket connection ticket.
 *
 * Session JWTs cannot go in a WebSocket handshake's query string safely — URLs
 * land in proxy logs, referrer headers, and browser history. This route
 * verifies the authenticated session over normal HTTPS and hands back a
 * short-lived signed ticket instead. Fetched immediately before opening the
 * socket, never cached: the ticket is consumed on first use.
 */
export async function GET() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const secret = process.env.WS_TICKET_SECRET
  if (!secret) {
    console.error("[ws-ticket] WS_TICKET_SECRET is not configured")
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 })
  }

  const ticket = issueTicket(user.id, secret)
  return NextResponse.json({ ticket })
}
