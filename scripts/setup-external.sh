#!/bin/bash
set -e

# =============================================================================
# Grid Clash — Automated External Setup
# 
# This script automates as much as possible:
# - Prompts for account credentials (which you create manually)
# - Validates environment variables
# - Tests connections
# - Generates derived secrets
#
# Manual steps still required:
# 1. Create Supabase project (takes 1-2 min)
# 2. Create Stripe account (2 min)
# 3. Create Twilio account (2 min)
# 4. Get API keys from each (5 min)
# 
# Total time: ~15 min of copy-pasting keys + this script
# =============================================================================

echo "🚀 Grid Clash — External Setup"
echo "================================"
echo ""
echo "Prerequisites: You've created accounts at:"
echo "  • Supabase (supabase.com)"
echo "  • Stripe (stripe.com)"
echo "  • Twilio (twilio.com)"
echo ""
echo "You should have these ready to paste:"
echo "  1. Supabase Project URL, Anon Key, Service Role Key"
echo "  2. Stripe Publishable Key, Secret Key"
echo "  3. Twilio Account SID, Auth Token, Verify Service SID"
echo ""
read -p "Press Enter to continue..."

# =============================================================================
# 1. Create .env.local if it doesn't exist
# =============================================================================

if [ ! -f .env.local ]; then
  echo ""
  echo "📝 Creating .env.local..."
  cp .env.example .env.local 2>/dev/null || {
    echo "  ⚠️  .env.example not found. Creating minimal .env.local..."
    touch .env.local
  }
fi

# =============================================================================
# 2. Supabase
# =============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "1️⃣  SUPABASE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get these from: Supabase Dashboard → Project Settings → API"
echo ""

read -p "Supabase Project URL (https://xxx.supabase.co): " SUPABASE_URL
read -p "Supabase Anon Key (pk_anon_...): " SUPABASE_ANON
read -sp "Supabase Service Role Key (sk_service_role_...): " SUPABASE_SERVICE_ROLE
echo ""

# Validate URLs
if [[ ! "$SUPABASE_URL" =~ ^https://.*\.supabase\.co$ ]]; then
  echo "  ❌ Invalid Supabase URL format"
  exit 1
fi

# Extract project ref
PROJECT_REF=$(echo "$SUPABASE_URL" | sed 's|https://\(.*\)\.supabase\.co|\1|')

# Update .env.local
sed -i.bak "s|^NEXT_PUBLIC_SUPABASE_URL=.*|NEXT_PUBLIC_SUPABASE_URL=$SUPABASE_URL|" .env.local
sed -i.bak "s|^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*|NEXT_PUBLIC_SUPABASE_ANON_KEY=$SUPABASE_ANON|" .env.local
sed -i.bak "s|^SUPABASE_SERVICE_ROLE_KEY=.*|SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE|" .env.local

echo "  ✅ Supabase keys saved"

# =============================================================================
# 3. Stripe
# =============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  STRIPE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get these from: Stripe Dashboard → Developers → API Keys"
echo "Use TEST keys for development, LIVE keys for production"
echo ""

read -p "Stripe Publishable Key (pk_test_...): " STRIPE_PUB
read -sp "Stripe Secret Key (sk_test_...): " STRIPE_SECRET
echo ""

sed -i.bak "s|^NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=.*|NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$STRIPE_PUB|" .env.local
sed -i.bak "s|^STRIPE_SECRET_KEY=.*|STRIPE_SECRET_KEY=$STRIPE_SECRET|" .env.local

echo "  ✅ Stripe keys saved"

# =============================================================================
# 4. Twilio
# =============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  TWILIO"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Get Account SID & Auth Token from: Twilio Console (dashboard)"
echo "Get Verify Service SID from: Twilio Console → Explore Products → Verify → Services"
echo ""

read -p "Twilio Account SID (ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx): " TWILIO_SID
read -sp "Twilio Auth Token: " TWILIO_TOKEN
echo ""
read -p "Twilio Verify Service SID (VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx): " TWILIO_VERIFY

sed -i.bak "s|^TWILIO_ACCOUNT_SID=.*|TWILIO_ACCOUNT_SID=$TWILIO_SID|" .env.local
sed -i.bak "s|^TWILIO_AUTH_TOKEN=.*|TWILIO_AUTH_TOKEN=$TWILIO_TOKEN|" .env.local
sed -i.bak "s|^TWILIO_VERIFY_SERVICE_SID=.*|TWILIO_VERIFY_SERVICE_SID=$TWILIO_VERIFY|" .env.local

echo "  ✅ Twilio keys saved"

# =============================================================================
# 5. Generate derived secrets
# =============================================================================

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔐 GENERATED SECRETS (save these for production)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Generate WS ticket secret
WS_SECRET=$(openssl rand -hex 32)
sed -i.bak "s|^WS_TICKET_SECRET=.*|WS_TICKET_SECRET=$WS_SECRET|" .env.local
echo "WS_TICKET_SECRET=$WS_SECRET"

# NOTE: an ADMIN_SECRET used to be generated here. Removed — grep confirms
# nothing in src/ ever reads it. This platform's real admin gate is the
# users.is_admin column (checked via the is_admin() RPC against the caller's
# own session), granted by one manual SQL UPDATE and deliberately having no
# self-service or secret-based path — see migration
# 20260726000021_admin_and_exclusion_wiring.sql. A generated-but-unused
# secret here was misleading: it implied a secret-based admin backdoor that
# does not exist.

# Generate cron secret
CRON_SECRET=$(openssl rand -hex 24)
sed -i.bak "s|^CRON_SECRET=.*|CRON_SECRET=$CRON_SECRET|" .env.local
echo "CRON_SECRET=$CRON_SECRET"

echo ""
echo "⚠️  Save these three secrets in Vercel/Fly.io environment variables!"
echo "    They're also in .env.local (but never commit .env.local)"
echo ""

# Clean up backup files
rm -f .env.local.bak

# =============================================================================
# 6. Test connections
# =============================================================================

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔗 TESTING CONNECTIONS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Test Supabase
#
# FOUND BY: reading this against how curl actually behaves. `curl -s` alone
# exits 0 on an HTTP 401/403/404 — only a transport-level failure (DNS,
# refused connection) makes it non-zero. A typo'd anon key would have
# returned an auth error from PostgREST and still printed a green check.
# `-f`/`--fail` makes curl itself fail on a non-2xx response, which is what
# "testing the key" actually requires.
#
# users has RLS with anon SELECT revoked (migration
# 20260724000006_security_hardening.sql, Finding 1) but public_players is
# anon-readable — hitting that view is a real, meaningful reachability +
# auth check, not a table this key is expected to fail against by design.
echo -n "Testing Supabase... "
if curl -sf -H "Authorization: Bearer $SUPABASE_ANON" -H "apikey: $SUPABASE_ANON" \
  "$SUPABASE_URL/rest/v1/public_players?limit=1" >/dev/null 2>&1; then
  echo "✅"
else
  echo "❌ (request failed — check the URL and anon key, or that migrations have been pushed)"
fi

# Test Stripe
echo -n "Testing Stripe... "
if curl -sf -u "$STRIPE_SECRET:" https://api.stripe.com/v1/charges?limit=1 >/dev/null 2>&1; then
  echo "✅"
else
  echo "❌ (request failed — check the secret key)"
fi

# Test Twilio
echo -n "Testing Twilio... "
if curl -sf -u "$TWILIO_SID:$TWILIO_TOKEN" "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID.json" >/dev/null 2>&1; then
  echo "✅"
else
  echo "❌ (request failed — check the account SID and auth token)"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1️⃣  Push database schema:"
echo "    npx supabase login"
echo "    npx supabase link --project-ref $PROJECT_REF"
echo "    npx supabase db push"
echo ""
echo "2️⃣  Regenerate TypeScript types:"
echo "    npx supabase gen types typescript --linked > src/lib/types/database.types.ts"
echo ""
echo "3️⃣  Set up Stripe webhook locally:"
echo "    stripe listen --forward-to localhost:3000/api/webhooks/stripe"
echo "    (Copy the STRIPE_WEBHOOK_SECRET it prints to .env.local)"
echo ""
echo "4️⃣  Configure Supabase Auth URLs:"
echo "    Dashboard → Authentication → URL Configuration"
echo "    Site URL: http://localhost:3000 (dev) / https://yourdomain.com (prod)"
echo "    Redirect URLs: http://localhost:3000/auth/callback, https://yourdomain.com/auth/callback"
echo ""
echo "5️⃣  Start local dev:"
echo "    npm install"
echo "    npm run dev"
echo ""
echo "✅ Setup complete!"
