import "server-only"

import Stripe from "stripe"

/**
 * Pinned to the version this SDK release (22.x) is built against. Without
 * this, a request uses your Stripe account's dashboard-configured default
 * API version instead, which can be changed there independently of a code
 * deploy — a field this code depends on can silently change shape with no
 * corresponding commit to blame.
 */
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? "", {
  apiVersion: "2026-06-24.dahlia",
  typescript: true,
})
