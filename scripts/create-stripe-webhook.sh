#!/usr/bin/env bash
# Creates the production Stripe webhook endpoint via the Stripe CLI, listening
# to exactly the events src/app/api/webhooks/stripe/route.ts handles. Run
# this once per environment (once for your production URL). For local dev,
# use `stripe listen` instead (see scripts/setup.sh) — that command creates a
# temporary endpoint for the duration it runs rather than a permanent one.
set -euo pipefail

if ! command -v stripe >/dev/null; then
  echo "Stripe CLI not found. Install: https://docs.stripe.com/stripe-cli#install"
  exit 1
fi

read -rp "Production URL for your Next.js app (e.g. https://gridclash.com): " APP_URL

echo "Creating webhook endpoint at ${APP_URL}/api/webhooks/stripe ..."

RESULT=$(stripe webhook_endpoints create \
  --url "${APP_URL}/api/webhooks/stripe" \
  --enabled-events "payment_intent.succeeded" \
  --enabled-events "account.updated" \
  --enabled-events "identity.verification_session.verified" \
  --enabled-events "identity.verification_session.requires_input" \
  --enabled-events "identity.verification_session.canceled" \
  --enabled-events "transfer.reversed")

echo "$RESULT"
echo
echo "Copy the 'secret' field above into STRIPE_WEBHOOK_SECRET in your"
echo "production environment variables (Vercel: Settings > Environment"
echo "Variables). It is shown ONLY at creation time — if you lose it, delete"
echo "this endpoint in the Dashboard and re-run this script."
