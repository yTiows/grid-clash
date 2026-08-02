import { loadStripe, type Stripe } from "@stripe/stripe-js"

/**
 * loadStripe() must be called exactly once per publishable key and reused —
 * calling it inside a component body re-fetches Stripe.js on every render.
 * Module scope makes it a stable singleton promise shared by every mount.
 */
let stripePromise: Promise<Stripe | null> | null = null

export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "")
  }
  return stripePromise
}
