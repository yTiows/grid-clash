#!/usr/bin/env bash
# Bootstraps local dev after you've done the manual account-creation steps in
# SETUP.md. This script does NOT create any accounts for you — Supabase,
# Stripe, and Twilio all require a human to sign up, agree to terms, and (for
# Stripe) pass business verification. What it DOES automate is everything
# after that: linking the project, pushing the schema, generating types,
# creating the webhook endpoint, and writing your local .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v npx >/dev/null || { echo "npx not found — install Node.js first"; exit 1; }

echo "== Grid Clash setup =="
echo

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example. Fill in the values from SETUP.md,"
  echo "then re-run this script."
  exit 0
fi

# shellcheck disable=SC1091
set -a; source .env.local; set +a

echo "-- Supabase --"
if ! command -v supabase >/dev/null; then
  echo "Installing Supabase CLI (npx, no global install needed)..."
fi

if [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
  echo "SUPABASE_PROJECT_REF is not set in .env.local."
  echo "Find it in your project URL: https://supabase.com/dashboard/project/<THIS PART>"
  read -rp "Enter your Supabase project ref: " SUPABASE_PROJECT_REF
  echo "SUPABASE_PROJECT_REF=$SUPABASE_PROJECT_REF" >> .env.local
fi

echo "Logging into Supabase CLI (opens a browser)..."
npx supabase login

echo "Linking to project $SUPABASE_PROJECT_REF..."
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"

echo "Pushing all migrations..."
npx supabase db push

echo "Generating TypeScript types from your live schema..."
npx supabase gen types typescript --linked > src/lib/types/database.types.ts
echo "Wrote src/lib/types/database.types.ts"

echo
echo "-- Stripe webhook --"
if command -v stripe >/dev/null; then
  echo "Stripe CLI found. For local dev, run this in a separate terminal and"
  echo "leave it running — it forwards live Stripe events to your machine:"
  echo
  echo "  stripe listen --forward-to localhost:3000/api/webhooks/stripe"
  echo
  echo "Copy the 'whsec_...' it prints into WS_TICKET_SECRET's neighbor,"
  echo "STRIPE_WEBHOOK_SECRET, in .env.local."
else
  echo "Stripe CLI not found. Install it to auto-forward webhooks locally:"
  echo "  https://docs.stripe.com/stripe-cli#install"
  echo "Without it, you'll need to test deposits/payouts against a deployed"
  echo "URL with a webhook endpoint created manually in the Dashboard (see"
  echo "SETUP.md section 2.4)."
fi

echo
echo "-- Done --"
echo "Run the app:        npm run dev"
echo "Run the WS server:  npm run ws-server   (separate terminal)"
