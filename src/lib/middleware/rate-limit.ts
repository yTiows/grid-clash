/**
 * HTTP-layer rate limiting.
 *
 * Backed by check_rate_limit() (20260726000035_http_rate_limiting.sql), a
 * Postgres fixed-window counter — not Redis, and not the in-memory Map this
 * file used to contain. That in-memory version was never durable across
 * serverless invocations or multiple instances, and nothing in src/ ever
 * imported it. See the migration for the full reasoning; short version: this
 * platform targets ~5,000 users on infrastructure that is already just
 * Supabase, and a new Redis dependency buys nothing at that scale for
 * request classes (signup, login, deposit, withdrawal) far below what a
 * single row-locked counter table can absorb.
 *
 * Not for in-match moves — the WS match server has its own in-process token
 * bucket (src/server/match-server.ts) with no HTTP round trip, which matters
 * at 5-second-clock speed. This is for the request classes a hostile script
 * could hit at will: signup, login, deposit, withdrawal.
 */

import { createAdminClient } from "@/lib/supabase/admin"

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterMs: number
}

export interface RateLimitBucketConfig {
  windowMs: number
  maxRequests: number
}

/**
 * Pre-configured buckets for the endpoints CLAUDE_CODE_BRIEF.md §4.3 names.
 * Numbers match the ones the old in-memory limiter documented, since those
 * figures were never the problem — durability was.
 */
export const RATE_LIMIT_BUCKETS = {
  signup: { windowMs: 60 * 60 * 1000, maxRequests: 5 }, // 5 signups/hour per IP
  login: { windowMs: 60 * 1000, maxRequests: 5 }, // 5 attempts/minute per email, checked before auth so it counts every attempt, not just failures
  deposit: { windowMs: 60 * 1000, maxRequests: 5 }, // 5/minute per user
  withdrawal: { windowMs: 60 * 1000, maxRequests: 1 }, // 1/minute per user — prevents double-submit
} as const satisfies Record<string, RateLimitBucketConfig>

export type RateLimitBucket = keyof typeof RATE_LIMIT_BUCKETS

/**
 * Checks and increments in one atomic call. `rateKey` is caller-chosen —
 * typically a user id for authenticated actions, or the client IP / email
 * for pre-auth ones (signup, login) where no user id exists yet.
 *
 * Uses the service-role client: check_rate_limit() is granted to anon and
 * authenticated directly (see the migration), but every caller of this
 * helper today is a "use server" action already running with service-role
 * access, so there's no reason to route through the RLS-scoped client here.
 */
export async function checkRateLimit(
  bucket: RateLimitBucket,
  rateKey: string
): Promise<RateLimitResult> {
  const config = RATE_LIMIT_BUCKETS[bucket]

  // FOUND BY: a real 500 on POST /login in local dev with SUPABASE_SERVICE_
  // ROLE_KEY unset. createAdminClient() throws SYNCHRONOUSLY (the underlying
  // @supabase/supabase-js constructor validates its args immediately) when
  // the URL or key is missing/malformed — that throw happens before the
  // .rpc() call this function already fails open around, so it was never
  // caught by the try/catch below and took the whole login/signup/deposit/
  // withdrawal action down with it. A rate limiter must never be a single
  // point of failure for the thing it's guarding; the whole body is wrapped
  // now, not just the network call.
  try {
    const admin = createAdminClient()

    const { data, error } = await admin
      .rpc("check_rate_limit", {
        p_bucket: bucket,
        p_rate_key: rateKey,
        p_window_ms: config.windowMs,
        p_max_requests: config.maxRequests,
      })
      .single()

    if (error || !data) {
      // Fail open rather than lock every user out on a transient DB error —
      // consistent with this codebase's existing "log loudly, degrade
      // gracefully" pattern for non-money-safety paths (see refundStake in
      // sql-match-store.ts). A rate limiter that itself takes the site down
      // on a blip is worse than the abuse it prevents.
      console.error("[checkRateLimit] check failed, allowing request", { bucket, message: error?.message })
      return { allowed: true, remaining: config.maxRequests, retryAfterMs: 0 }
    }

    return {
      allowed: data.allowed,
      remaining: data.remaining,
      retryAfterMs: data.retry_after_ms,
    }
  } catch (err) {
    console.error("[checkRateLimit] threw, allowing request", {
      bucket,
      message: err instanceof Error ? err.message : String(err),
    })
    return { allowed: true, remaining: config.maxRequests, retryAfterMs: 0 }
  }
}

/** Human-readable "try again in..." for a refused request. */
export function formatRetryAfter(retryAfterMs: number): string {
  const seconds = Math.ceil(retryAfterMs / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? "" : "s"}`
}
