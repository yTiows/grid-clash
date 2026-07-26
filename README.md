# Grid Clash

A skill-based 1v1 and tournament platform. 5×5 tactical board game, hidden
piece inventory, 5-second clock. 2% fee on ranked matches — break-even at
50.51%, printed on every stake before you play. See `brand/BRAND.md` for the
positioning and voice this is built around.

**Start here:** [`SETUP.md`](./SETUP.md) — every external account you need
(Supabase, Stripe, Twilio), where to get each key, and what's automated vs.
manual.

## Stack

- Next.js 14 (App Router) + TypeScript, strict mode
- Tailwind + shadcn/ui, poster-art design tokens (`src/app/globals.css`)
- Supabase (Postgres + Auth), 19 migrations, RLS on every table
- A standalone WebSocket match server (`src/server/entrypoint.ts`) — separate
  from the Next.js process because a long-lived socket server and a
  request/response web framework don't share a deployment model
- Stripe (deposits, Connect Express payouts, Identity KYC)
- Twilio Verify (phone verification)

## Architecture

```
src/lib/game/          Pure, dependency-free domain logic — the tested core.
  engine.ts             Board rules: moves, win detection, redaction.
  rulesets.ts           8 board variants as data, not code.
  fees.ts               Rake, brackets, Elo, stake ceilings.
  formats.ts            Tournament formats, payout curves, satellites, ladders.
  scheduling.ts         Demand-driven field sizing, milestone events.
  reputation.ts         Skill Index, trust, bot detection, comeback refunds.
  bracket.ts            Deterministic pairing and round advancement.

src/server/             The authoritative WebSocket match server.
  match-server.ts        Connection auth, rate limiting, settlement calls.
  sql-match-store.ts      Binds the match server to the database functions.
  entrypoint.ts           Runnable process — `npm run ws-server`.

src/actions/            Server actions: auth, deposit, withdrawal, KYC,
                        phone verification, tournament entry, admin tools.

src/app/                Next.js routes: landing, auth, dashboard, wallet,
                        tournaments, admin, the game board, API routes.

supabase/migrations/    19 migrations. Every one has been applied to a real
                        Postgres instance and replays clean from empty —
                        not just written, executed.
```

## Local development

```bash
npm install
cp .env.example .env.local   # fill in from SETUP.md
./scripts/setup.sh            # links Supabase, pushes migrations, generates types
```

Three terminals:

```bash
npm run dev                                              # Next.js — :3000
npm run ws-server                                          # match server — :3001
stripe listen --forward-to localhost:3000/api/webhooks/stripe   # if testing payments
```

## Verification discipline

Every migration in this repo has been applied to a real Postgres 16 instance
and exercised end to end — not just checked for syntax. That distinction
caught real bugs a clean `tsc`/`next build` pass could not:

- A version-skew bug in `@supabase/ssr` that silently degraded every table
  lookup to `never`
- A webhook double-credit path with no idempotency guard
- Two separate, fully-broken code paths in `enter_tournament()` — an
  ambiguous column reference and a call to a function that had been
  superseded and removed — both invisible until the function was actually
  called start to finish rather than having its dependencies tested in
  isolation

Three self-check functions live in the schema and run in CI on every PR:
`assert_function_dependencies()`, `assert_settlement_works()`, and
`assert_tournament_entry_works()`/`assert_tournament_completion_works()`.
They exist because "the migration applied without error" and "the feature
works" turned out to be different claims, repeatedly, and the gap between
them is exactly where money-affecting bugs hide.

## What's built vs. what's next

**Working end to end, verified against live Postgres:** auth, profile,
ranked match settlement, tournament creation/entry/completion with prize
distribution, deposits, Connect withdrawals, Identity KYC, phone
verification, admin tools.

**Documented as the next milestone, not yet built:** live bracket-match
pairing — the piece that connects two specific tournament opponents to a
WebSocket match rather than the open ranked queue. The completion math
(`distributePrizePool`, `complete_tournament`) and round persistence
(`create_tournament_round`, `record_tournament_match_result`) are built and
tested; wiring them to the live match server is a distinct, sizeable task
better done deliberately than rushed in alongside everything else.

See `SETUP.md` section 7 before taking real money: age verification, state
eligibility, and licensing all need a lawyer's judgment this project
deliberately does not substitute for.
