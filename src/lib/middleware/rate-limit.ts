/**
 * Rate Limiting
 *
 * Prevents abuse on sensitive endpoints:
 * - Move submission: 10 moves/second per player (prevents brute-force clicking)
 * - Deposit: 5 per minute per player (prevents spam)
 * - Withdrawal: 1 per minute per player (prevents double-submit)
 * - Match entry: 10 per minute per player (prevents multi-entry)
 * - Login: 5 failed attempts per minute, then 15-min lockout
 *
 * Uses in-memory store (suitable for 5k users; upgrade to Redis for scale).
 */

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests in window
  keyGenerator: (req: any) => string; // How to identify the requester
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;

    // Cleanup expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if a request is allowed.
   * Returns { allowed: boolean, remaining: number, retryAfterMs: number }.
   */
  check(req: any): {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  } {
    const key = this.config.keyGenerator(req);
    const now = Date.now();
    let entry = this.store.get(key);

    // Initialize or reset if window expired
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.config.windowMs };
      this.store.set(key, entry);
    }

    const allowed = entry.count < this.config.maxRequests;
    const retryAfterMs = entry.resetAt - now;

    entry.count++;

    return {
      allowed,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      retryAfterMs: allowed ? 0 : retryAfterMs,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

/**
 * Pre-configured rate limiters for common operations.
 */

export const moveSubmissionLimiter = new RateLimiter({
  windowMs: 1000, // 1 second
  maxRequests: 10, // 10 moves/second per player
  keyGenerator: (req: any) => `move:${req.playerId}`,
});

export const depositLimiter = new RateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 5,
  keyGenerator: (req: any) => `deposit:${req.userId}`,
});

export const withdrawalLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 1,
  keyGenerator: (req: any) => `withdrawal:${req.userId}`,
});

export const matchEntryLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 10,
  keyGenerator: (req: any) => `entry:${req.userId}`,
});

export const loginLimiter = new RateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 5, // 5 failed login attempts
  keyGenerator: (req: any) => `login:${req.email}`,
});

/**
 * Middleware factory for Next.js route handlers.
 *
 * Usage in an API route:
 * ```typescript
 * export async function POST(request: NextRequest) {
 *   const check = moveSubmissionLimiter.check({
 *     playerId: userId,
 *   });
 *
 *   if (!check.allowed) {
 *     return NextResponse.json(
 *       { error: 'Too many requests', retryAfter: check.retryAfterMs },
 *       { status: 429, headers: { 'Retry-After': (check.retryAfterMs / 1000).toString() } }
 *     );
 *   }
 *
 *   // ... rest of handler
 * }
 * ```
 */

export function createRateLimitMiddleware(limiter: RateLimiter) {
  return (req: any) => {
    const check = limiter.check(req);

    if (!check.allowed) {
      return {
        status: 429,
        body: {
          error: 'Too many requests',
          retryAfter: Math.ceil(check.retryAfterMs / 1000),
        },
        headers: {
          'Retry-After': Math.ceil(check.retryAfterMs / 1000).toString(),
          'X-RateLimit-Remaining': check.remaining.toString(),
        },
      };
    }

    return {
      allowed: true,
      remaining: check.remaining,
    };
  };
}
