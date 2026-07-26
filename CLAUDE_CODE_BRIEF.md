# Grid Clash — Handoff Brief for Claude Code

Paste this whole file as your first message, or say: "Read CLAUDE_CODE_BRIEF.md and execute it end to end." Everything below is real context from the person who owns this project, not a template.

---

## 0. Read this before touching anything

This codebase has already been damaged once by an agent (a previous chat-based Claude session) that built a second, parallel, worse version of a system that already existed, because it didn't check the filesystem first. It also inherited an earlier "layer" of dead/broken code from a prior pass that looked plausible but referenced tables and columns that don't exist. Both were found only by actually running `tsc --noEmit` and reading migrations end to end, not by reading filenames or docstrings.

**Do not repeat that.** Before writing any new file or "finishing" anything described as missing below:

1. `grep`/search the actual codebase for related functionality first. If something looks like it should exist, assume a real implementation already does and go find it before writing a new one.
2. Read the actual SQL migrations in `supabase/migrations/` in order — don't infer schema from `database.types.ts` alone, and don't infer behavior from a `.md` doc without checking the code it claims to describe.
3. After every non-trivial change: `npx tsc --noEmit` and `npx next lint`. Both must be clean before you consider a task done. This project has an untyped Supabase client in at least one historical file (already fixed) that let a broken query pass `tsc` silently — prefer the typed `createAdminClient()`/`createClient()` helpers in `src/lib/supabase/` everywhere, never a raw untyped `createClient(url, key)`.
4. If you find dead code, a naming collision, or a doc that contradicts the code — the code is the source of truth. Fix or delete the doc/dead code; don't reconcile by trusting the doc.
5. Do not fabricate a "% complete" figure anywhere (including this file's own successor) without having actually run something to verify it. The last time that happened, it produced a confident, wrong status report.

---

## 1. What this is

A real-money 1v1 and tournament skill-game platform. Players stake cash on matches of a Connect-N-style game (5×5 board, connect-4, hidden piece inventory with shield/bomb/swap specials, 5-second clock — plus 7 other board variants in `src/lib/game/rulesets.ts`). Two modes only:

- **Ranked** — join a queue at a fixed stake ($5 / $20 / $100), get paired, play, settle immediately. Currently 1% house fee (tiered down to 0.6% for top-loyalty accounts). Always the Classic ruleset.
- **Tournaments** — pay one entry fee, get seeded into a bracket (7 formats: single-elimination, swiss, bounty, survivor, ladder, satellite, arena), play out the bracket, prize pool (built from entry fees, house keeps 10% standard / 0% "Dollar" format / a *negative* 1% subsidy on "Milestone" events) pays out at the end. Any of the 8 rulesets.

No free-to-play mode. No third mode. The only free thing is a tutorial (not yet built — see §4).

Read `brand/BRAND.md` in full before writing any user-facing copy, UI, or marketing text. It's opinionated and specific (banned vocabulary list, voice rules, color tokens reserved for money-only surfaces, what this brand will never do) and it is binding, not a suggestion.

---

## 2. Architecture map

```
src/lib/game/            Pure domain logic. No I/O. This is the tested core —
                          extend it here first, call it from the impure layers below.
  engine.ts               Board rules: moves, win detection, redaction for the opponent's view.
  rulesets.ts             8 board variants as data (boardSize, connectTarget, timeouts, inventory).
  protocol.ts             The WS wire schema (zod). Client can never assert state/outcome/timing —
                          it names an action, the server decides what happened.
  fees.ts                 Rake tiers, stake brackets, Elo, prize-pool math, the 1% headline number.
  formats.ts              Tournament formats, payout curves, satellites, ladders, milestones.
  bracket.ts              Pure pairing/standings/advancement functions (knockout, swiss, survivor).
  scheduling.ts           Demand-driven field sizing, sit-and-go, milestone event planning.
  reputation.ts           Skill Index, fee tiers, bot-detection signal shape.
  use-match-socket.ts     Client-side WS hook (ranked + tournament).

src/server/               The authoritative WebSocket match server — a STANDALONE Node process,
                          not a Next.js route (`npm run ws-server`, deployed separately to Fly.io,
                          because Vercel serverless functions can't hold a long-lived socket).
  match-server.ts          Connection auth (signed single-use tickets), rate limiting (token bucket),
                          matchmaking, live game state (in-memory), settlement dispatch.
  sql-match-store.ts       The only thing that touches the database from the match server. Binds
                          match-server.ts to SQL functions. Also owns automatic tournament bracket
                          advancement (see §3).
  entrypoint.ts            The runnable process entry.

src/app/api/ws-ticket/     Issues short-lived signed tickets so the browser never puts a session JWT
                          in a WS query string.

supabase/migrations/      21 migrations, applied in filename order. Read 000006_security_hardening.sql
                          and 000010_settlement.sql / 000012_settlement_ordering.sql closely — they
                          document real bugs found by *executing* the schema against a live database,
                          not just applying it cleanly. That distinction matters: a migration that
                          applies without error proves nothing about whether the functions inside it
                          actually work. Several already have self-test functions
                          (assert_settlement_works(), assert_tournament_completion_works()) that run a
                          real settlement inside a rolled-back transaction — run these against your
                          Supabase project once it's live, and write more of them for anything you add
                          that moves money.

src/actions/              Next.js server actions: auth, deposit, withdrawal, KYC, phone, tournaments,
                          admin-tournaments.
src/components/game/      Real, wired UI: board.tsx, match-result.tsx, piece-tray.tsx,
                          enter-tournament-button.tsx.
brand/BRAND.md            Read before writing any copy. Not optional.
```

### Conventions already established — follow them, don't invent new patterns

- **One tested implementation, DB validates.** Money math (fees, Elo, payout curves) is computed once in TypeScript (`fees.ts`, `formats.ts`, `bracket.ts`) and passed into a Postgres function that re-checks conservation (`fee + payout = pot`, etc.) and raises rather than silently accepting a mismatch. Don't recompute money math inside SQL, and don't trust a TS calculation without a corresponding DB-side check when real money moves.
- **Idempotency by construction, not by convention.** Every money-moving RPC (`reserve_stake`, `refund_stake`, `settle_ranked_match`, `complete_tournament`, `record_tournament_match_result`) is safe to call twice — check the existing pattern (row-lock + terminal-state check, or "does the settlement row already exist") before adding a new money-moving path.
- **`security definer` + `revoke execute ... from anon, authenticated`** on every function a player must never call directly. Only the service-role client (`src/lib/supabase/admin.ts`) calls these. If you add a new money-touching function, follow this exactly.
- **Server-authoritative, always.** The client never sends timing, board state, or a result — it names an intent (`match:move`, `match:resign`) and the server decides. Don't add a client-supplied field that could be trusted for anything money- or fairness-relevant.
- **Two plain queries, joined in JS — not a nested Supabase select.** `database.types.ts` deliberately leaves FK relationships unasserted. Every place in this codebase that needs data across two tables does two `.from().select()` calls and joins in a `Map`, rather than relying on PostgREST's automatic relationship inference. Keep doing this.
- **Threat-model comments.** Nearly every non-obvious security decision in this codebase has an inline `/** THREAT: ... FIX: ... */` comment explaining what attack the code defends against. Keep writing these — they're what let you (and the next agent) tell a deliberate decision from an oversight.

---

## 3. What's actually done (verified as of this handoff)

- Auth, KYC (Stripe Identity), phone verification (Twilio), deposits/withdrawals (Stripe Checkout + Connect Express), age gate, self-exclusion (including identity-linked exclusion — a phone/KYC hash carries the exclusion across a new signup, not just the old account), jurisdiction gating, daily loss limits, deposit limits.
- Ranked queue matchmaking end to end: ticket auth, rate-limited WS protocol, collusion detection (linked accounts refused pairing before a stake is ever reserved), server-authoritative clock and reconnect/abandon handling, idempotent settlement, Elo.
- Tournament entry, bracket creation, and — as of this handoff — **live bracket match play**: two bracket-paired players connect through the same authoritative match server ranked uses, play out their game, and the result is recorded. Draws replay as sudden death (a bracket needs exactly one winner). Automatic round advancement and automatic final-payout are wired for `single_elimination`, `satellite`, `swiss`, and `survivor` — a completed round with no pending matches left automatically either creates the next round or pays out final placings, no admin click required. **`bounty`, `ladder`, and `arena` are NOT auto-advanced** — they have their own progression models (bounty claims, ladder runs) that don't map onto `tournament_matches`/`tournament_rounds` the same way, and nothing about them has been changed. Round 1 of any tournament is still admin-triggered by design (matches the existing demand-based scheduling in `scheduling.ts`).
- `is_admin()` was hardcoded to always return `false` since an early migration — found only by reading the codebase's own flagged residual-risk note. Fixed: a real `users.is_admin` column, first admin granted by one manual SQL `UPDATE` (there's deliberately no self-service path to grant it).
- `npx tsc --noEmit` → 0 errors. `npx next lint` → 0 warnings. Whole project, checked at handoff time.

## 4. What's missing or known-incomplete — your task list

Work top to bottom; verify each with `tsc`/`lint` (and a real settlement/advancement test where money or bracket state is involved) before moving on.

1. **Auto-advance for `bounty`, `ladder`, `arena` formats**, or a deliberate decision (documented in code, not just in your head) that they stay admin-manual and why. Read `tournament_bounties`, `ladder_runs`, `ladder_rung_results` schemas and `planLadder`/`ladderEdge` in `formats.ts` before assuming they even want the same "round → live match → next round" shape ranked/knockout/swiss use.
2. **Satellite payout curve** — verify this. Real-world satellites (and the whole point of the mechanic — see §5) pay every qualifying place the *same* ticket value, not a descending curve. `distributePrizePool()` in `formats.ts` currently applies the same field-size-based descending `PAYOUT_CURVES` to every contest kind regardless of format. Check whether `format_id === 'satellite'` needs its own flat, equal-value payout function, and if so, add it (same "one tested TS implementation, DB validates" pattern as everything else).
3. **HTTP-layer rate limiting.** The WS protocol has real token-bucket rate limiting for in-match moves. Nothing rate-limits signup, login, deposit-initiation, or withdrawal-request HTTP endpoints. Build this properly (a real store — Redis is fine at this scale, or a Postgres-backed sliding window if you want to avoid a new dependency; an in-memory `Map` in a serverless function is not durable across invocations and was already tried once and removed for exactly that reason) and wire it into the actual routes in `src/actions/` and `src/app/api/`.
4. **Admin review UI for `fraud_flags`.** The table exists (in the original schema, `src/lib/services/...` — check what's actually there now, don't assume), nothing renders it. Build a simple admin page: list unreviewed flags by severity, let an admin mark reviewed + record an action.
5. **Dispute resolution.** Real money, no path today for a player to contest a settled match result beyond contacting support out-of-band. Decide and build a minimal flow — even just a `match_disputes` table + admin review queue is enough at this scale; don't build automated arbitration.
6. **Verify, don't assume, the state of:** leaderboard UI, referral system, background jobs (XP/leaderboard refresh — check they still run correctly against the current schema, a lot has changed underneath them), age-gate UI enforcement end to end, admin fraud-flag creation (is anything actually *writing* to `fraud_flags` today, or does only the schema exist?).
7. **Deployment.** `scripts/setup.sh` and `scripts/setup-external.sh` exist and look complete but have never been run against a real Supabase/Stripe/Twilio project by anyone — the person building this hasn't gotten that far yet. Walk through them yourself against a throwaway project if you can, fix anything that doesn't actually work, and don't trust that "looks right" means "runs right" (see §0).
8. **Tutorial mode.** No stakes, no opponent (or a bot, if you want it to feel like something rather than a walkthrough), teaches the board and — given §5 below — should also be the place a brand-new player first sees what a *tournament* looks like, not just the base game. Not free-to-play in the ongoing sense; a one-time onboarding flow.

---

## 5. Ranked-vs-Tournament funnel strategy — build this, don't just note it

**The problem stated by the person who owns this:** ranked is cheap (1%) and always available. Left alone, that's a reason for a good player to *never* look at tournaments, which are both more profitable for the house (10% vs 1%) and the more marketable, exciting, "event" surface of the product. Ranked should exist and stay cheap — it's the low-friction front door and the skill-signal engine (Elo) — but the product needs real, structural pulls toward tournaments, not just hoping people click the other tab.

This is not a new problem — it's the exact shape of "cash games vs. tournaments" that the entire online poker industry has spent 20 years solving, plus what mobile real-money tournament platforms (Skillz being the largest, ~$300M+ paid out historically, entirely tournament-framed even for 1v1 matches) do differently. Below is what's actually proven to work, adapted to this codebase, not generic advice. Build these — most of them are additive (new tables/functions alongside what exists), not rewrites.

### 5.1 Rank-gated stake ceilings that plateau below tournament entry (the person's own instinct, confirmed correct)

This is exactly how poker cash games and tournaments already relate: cash game rake is capped in absolute terms even at high stakes (a $5/$10 game might cap rake at $10 regardless of pot size), while tournament buy-ins have no such ceiling — a serious player who wants to put more than the cash cap in play *structurally has to* go to a tournament to do it.

- `fees.ts` already has `BRACKETS` (bronze/silver/gold/elite, gating stake *ranges* by skill index + verification) topping out at `elite.maxStakeCents = 1,000,000` ($10,000) and `RANKED_STAKE_TIERS_CENTS = [500, 2000, 10000]` as the actual selectable amounts.
- Audit this against the tournament side: `complete_tournament`'s title-tier thresholds start "obsidian" at `entry_fee_cents >= 25000` ($250). Right now a ranked player can stake $10,000 in ranked — an order of magnitude above where a tournament entry starts feeling exclusive. That's backwards for the funnel goal.
- **Fix:** lower ranked's real ceiling (not necessarily `elite.maxStakeCents` — pick the actual number with the person, but structurally it should sit *below* where tournament entries start feeling like "the real stakes"), and make sure tournament entry fees have meaningfully higher ceilings than anything ranked offers. The gap between "the most you can ever stake in ranked" and "the least a serious tournament costs" should be small or negative — i.e., a player who outgrows ranked's ceiling has nowhere to go *but* a tournament.

### 5.2 A loyalty-points economy funded by ranked's own rake, spendable only on tournament entries

This is the single most proven retention mechanic in the entire real-money gaming industry (poker "rakeback"/VIP points — every major operator runs some version of it) and it maps almost exactly onto what's needed here: convert ranked activity into a currency that's worthless anywhere except the thing you want people to try.

- New table, e.g. `loyalty_points` (`user_id`, `balance`, ledger table for audit — same pattern as `balance_entries`).
- Every `ranked_rake` entry written to `platform_ledger` (already happens, at settlement) also mints points — e.g. 1 point per $1 of rake paid (tune the number; the mechanism matters more than the exact rate). This is *additive* to `settle_ranked_match` — a trigger on `platform_ledger` insert, or an explicit call alongside it, following the same idempotent, security-definer pattern as everything else here.
- Points are redeemable **only** as a discount or full comp on a tournament entry fee, never convertible to cash, never usable in ranked. Build the redemption function the same way `move_balance` works (idempotency key, atomic, audited).
- Surface the balance right next to every tournament's "Enter" button: "You have 340 points — $3.40 off this entry" (per `BRAND.md`'s own voice rule: numbers speak, don't editorialize).
- This does not touch the ranked/tournament rake differential — ranked stays 1%, tournaments stay 10% — it just gives the house a controlled, self-funded way to make tournament entry cheaper *for people who already generate ranked revenue*, which is a straight transfer of the thing they're already paying for into the direction the business wants them to go.

### 5.3 Satellites — already built, not yet surfaced. This is the highest-leverage item on this whole list.

The `format_id = 'satellite'` / `satellite_target_tournament_id` mechanic already in this schema *is* the single most famous and effective funnel mechanic in the entire industry — it's literally how poker turns cash-game grinders into main-event players (the Chris Moneymaker story: a $39 satellite entry turned into a World Series Main Event seat and a $2.5M win, and single-handedly created the 2000s poker boom). The mechanism is simple and already representable in this schema: a cheap entry fee, winner(s) get a *ticket* into a bigger, more expensive tournament instead of cash.

- Confirm (per §4.2) satellite payouts are flat/equal-value tickets, not a descending curve — this is structurally what makes a satellite a satellite rather than just a cheap tournament.
- Build the UI to make this loud: a satellite's card should say what it's a satellite *into*, by name, with the target tournament's prize pool front and center ("$5 entry → win a seat in the $25,000 Obsidian Invitational"). This is a much stronger hook than a generic "enter this tournament" card.
- Consider a multi-step satellite ladder (cheap satellite → seat in a bigger satellite → seat in the target event) for the highest-value tournaments — `planSatellite()` already exists in `formats.ts`; check whether it supports chaining and extend it if not.

### 5.4 Milestone tournaments as visible, house-funded hype events

`CONTEST_FEE_BPS.tournament_milestone = -100` means the house *adds* money to these — the direct equivalent of a poker "guarantee" or DFS "overlay," both proven to drive a disproportionate amount of attention and signups relative to their actual frequency, because "the house is subsidizing this one" is a genuinely compelling, honest hook (and it's the one place inflated marketing language is actually justified by real math, consistent with the brand's own "numbers speak" rule).

- `progressToNextMilestone()` already computes how close the platform is to unlocking the next one. Put this on the dashboard as a visible, live-updating progress indicator — "Next Milestone event unlocks at $[X] platform profit, currently at $[Y]" — turning an abstract backend number into something a ranked-only player has a reason to go check on.

### 5.5 Titles are already tournament-exclusive — lean into it, make it visible

`BRAND.md` §9 already establishes that titles (Dollar/Bronze/Silver/Gold/Obsidian) are earned *only* by winning a tournament at that tier — ranked play, however much of it, cannot earn one. This is already the right shape (status-seeking pull toward tournaments) but needs a visible trigger: when a ranked player's Skill Index/Elo crosses into a range that would make them competitive at a given tournament tier, show them that, specifically — "Your Skill Index already qualifies for Obsidian-tier tournaments" is a concrete, personalized invitation, not a generic ad.

### 5.6 A small "first tournament of the period" bonus (the "missions" pattern)

Modern loyalty programs (poker VIP "missions" systems) increasingly reward *trying something different*, not just volume — e.g., a one-time bonus (loyalty points, never cash) the first time a player enters a tournament in a given week or a format they haven't played before. Cheap to build (a `first_tournament_entry_at` style check against `tournament_entries`), directly targets a ranked-only player's very first tournament entry, which is the highest-leverage single conversion in this whole funnel.

### 5.7 Scheduled tournaments create urgency ranked structurally cannot

Ranked's whole value proposition is "play anytime, no waiting" — which means it can never create appointment-viewing urgency. Tournaments can: `scheduling.ts` already has `RegistrationWindow`/`commitField`. Make sure the UI surfaces a live countdown ("Starts in 8 minutes — 14 seats left") prominently wherever tournaments are listed. This is standard, well-documented DFS/poker MTT scheduling practice and it's a lever ranked cannot use by its own design, so it should be leaned on hard.

### What not to do here

Don't raise the tournament rake further to "make ranked look cheap by comparison" — 10% is already at the higher end of normal for the category (researched: poker tournament rake typically runs 5–15%, cash games 2.5–10%; above ~15–20% players correctly perceive it as predatory and avoid it). Don't lower ranked's 1% either — `BRAND.md`'s entire positioning is built on that specific, printed number, and it's already the platform's competitive edge. The lever here is *pulling toward tournaments*, not making ranked worse.

---

## 6. Constraints

- Built for **~5,000 users**, not 5 million. Don't introduce infrastructure (Redis clusters, message queues, multi-region anything) unless a task above genuinely can't be done without it — and even then, prefer the smallest real solution (e.g., a single Redis instance for rate limiting, not a cluster).
- This is a real-money product in an area (skill-gaming/sweepstakes law) the person has already been told needs a lawyer before launch. Don't touch `jurisdiction_rules` data, self-exclusion mechanics, or age-verification logic as if you're making a legal determination — implement what's asked precisely, and if a task implies a legal judgment call, say so instead of guessing.
- Preserve every existing security/idempotency pattern exactly. If you're not sure whether a new function needs `security definer` + `revoke execute`, or an idempotency key, the answer is yes if it touches money, a bracket, or an account-status flag.
- Keep `brand/BRAND.md`'s voice rules on anything user-facing. The banned-vocabulary list ("luck," "chance," "jackpot," "bet"/"wager"/"gamble" as verbs, "win big," "guaranteed," "risk-free") is described in that doc as "legally load-bearing" — treat it that way.

## 7. Definition of done

For every item you complete: `npx tsc --noEmit` clean, `npx next lint` clean, and — for anything that moves money or advances a bracket — an actual executed test (a self-test function in the migration, following the existing `assert_settlement_works()` pattern, or a manual run against a real Supabase project) proving it works, not just that it compiles. Update this file's §3/§4 as you go so the next person (human or agent) inherits an accurate picture instead of a stale one.
