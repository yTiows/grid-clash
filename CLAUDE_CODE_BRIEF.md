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

supabase/migrations/      33 migrations, applied in filename order. Read 000006_security_hardening.sql
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

This handoff pass ran the full §4/§5 list top to bottom, applied every migration to a real, live Supabase project (`grid-clash`, `ajuxrpxpayyaxsrijuir`) one at a time, and executed the codebase's own self-test functions against real seeded accounts after each change — not just "applies cleanly." Nine such probes exist now (`assert_ledger_vocabulary`, `assert_function_dependencies`, `assert_settlement_works`, `assert_tournament_entry_works`, `assert_tournament_completion_works`, `assert_satellite_completion_works`, `assert_bounty_claim_works`, `assert_loyalty_points_mint_works`, `assert_loyalty_redemption_works`) and all nine currently pass. The project's test/seed data was wiped clean afterward — it is an empty, ready-to-use Supabase project again, not a project full of scratch rows.

**Real bugs found by executing (not reading) the schema, fixed in new migrations (022–035):**
- `hash_phone()` called `digest()` unqualified; Supabase installs `pgcrypto` into the `extensions` schema, not `public`, so every self-exclusion identifier check inside `assert_can_wager()` raised — meaning **no phone-verified account could wager at all** until this was fixed. Found only by calling the function for real.
- An orphaned trigger from migration 2 (`update_match_stats`) was never dropped when `settle_ranked_match()` was introduced later and took over the same job — every ranked match **double-counted** `matches_played`/`matches_won`/`lifetime_winnings_cents` (confirmed 2x on a live probe) and wrote nonsense `elo_ratings_history` rows. Dropped; `settle_ranked_match` now writes correct history rows itself.
- `assert_can_wager()`'s weekly loss limit check was silently dropped when migration 21 rewrote the function to add identifier-based exclusion — a player-set `weekly_loss_limit_cents` enforced nothing since then. Restored.
- `milestone_progress` (the SQL view) and `fees.ts` both carried a dead, wrong $1,000 milestone threshold that had drifted from `scheduling.ts`'s real, fully-worked-out $20,000 figure. Both fixed to the one real number.
- `enter_tournament()` broke a **fourth** distinct way during this pass (`CREATE OR REPLACE` with an added parameter creates a second overload rather than replacing in place, making every existing 2-arg call ambiguous) — caught immediately by the self-test suite, fixed same session. If you ever touch this function's signature again, `DROP FUNCTION` first, then `CREATE`, and re-run every `assert_*` that calls it.
- The landing page, root layout metadata, and signup page all still said "2% fee / 51% break-even" in hardcoded copy after `fees.ts` was fixed to the real 1% / 50.51% — found by actually rendering the pages in a browser, not by reading source. All three now derive the number from `FEE_TIERS` so they can't drift again.
- `supabase/config.toml` targeted Postgres 15 locally while the real linked project runs 17, and used the deprecated `[inbucket]` section name — found by running the Supabase CLI for real. Both fixed.
- `scripts/setup-external.sh` generated an `ADMIN_SECRET` env var nothing in the app ever reads (the real admin gate is `users.is_admin`, granted by one manual SQL `UPDATE` — now documented at SETUP.md §1.6, which migration 21 already referenced but never existed until now) — removed. Its Supabase/Stripe/Twilio "connection tests" used bare `curl -s`, which reports success on an HTTP 401 (curl only fails on transport errors without `-f`) — so a wrong API key would have printed a green checkmark. Fixed to `curl -sf` plus the missing `apikey` header Supabase's REST API requires alongside `Authorization`.
- `src/actions/tournaments.ts` (my own new code, this pass) exported a plain `const` from a `"use server"` file — a class of bug invisible to `tsc`/`eslint` that only fails Next.js's actual build transform. Caught by running a real `npm run build`, not just `tsc`. Moved the constant to `fees.ts`; every `"use server"` file in the repo was swept for the same pattern afterward.

**§4 — all eight items now closed:**
1. **Bounty/ladder/arena.** Bounty is a knockout bracket with a side payment on elimination — added to `bracket.ts`/`scheduling.ts`'s bracket-shape checks alongside `single_elimination`/`satellite`, added to `AUTO_ADVANCE_FORMATS`, and — the actual missing piece — **bounty claiming itself was entirely unimplemented** (`tournament_bounties` rows were posted at entry but nothing ever set `claimed_by_user_id` or paid anyone). Fixed in `record_tournament_match_result()`. Ladder and arena are a **deliberate, final** admin-manual (really: not-yet-a-game-mode) decision — ladder is a solo climb with no opponent bracket at all, arena is continuous winner-stays-on seating with no discrete rounds; both need an actual new game loop built (start-run/play-rung/bank endpoints for ladder; seating/rotation logic for arena), which is a materially bigger scope than "wire up auto-advance" and was not attempted. See the comment on `SqlMatchStore.AUTO_ADVANCE_FORMATS`.
2. **Satellite payout curve.** Confirmed broken exactly as suspected (descending curve applied to satellites) — worse, satellites **could not even be created** through the admin UI (no way to set a target). Both fixed: `complete_satellite_tournament()` awards seats at face value plus bubble cash on the remainder, `createTournamentAction` now has a target-tournament picker, `payoutTournament()`/`completeTournamentAction()` both branch on format.
3. **HTTP rate limiting.** Postgres-backed fixed-window counter (`check_rate_limit()`), not Redis — the call is documented in `src/lib/middleware/rate-limit.ts`. Wired into signup, login, deposit, withdrawal.
4. **Admin `fraud_flags` review UI.** Built at `/admin/fraud`. The writers (three DB triggers) were already real and live — confirmed, not assumed.
5. **Dispute resolution.** `match_disputes` table + `file_match_dispute()`/`resolve_match_dispute()`/`list_open_disputes()`, a player-facing "Dispute this result" affordance on `match-result.tsx`, and an admin queue at `/admin/disputes`.
6. **Verification results:** leaderboard UI — the SQL view existed but nothing populated `player_standing`, so it would have shown every player at Skill Index 0 forever; **fee tiers (`FEE_TIERS.established`/`elite`) were therefore silently inert too**, since settlement reads `player_standing.fee_tier`. Built `/api/cron/recompute-standing` (Vercel Cron, every 30 min) to actually compute it, and `/leaderboard` to show it. Referral system — confirmed **missing entirely** (no table, no code); left unbuilt, since building one means inventing reward mechanics never specified anywhere in this brief, not completing something half-built. Background jobs — none existed; the standing-recompute cron is the one this platform actually needs. Age-gate — was collected at signup but never enforced at the money boundary; now required by `assert_can_wager`/`check_deposit_allowed`. Admin monitoring page — found genuinely broken (its TypeScript interface didn't match what the API route returns; `res.json(): any` hid it from `tsc`) and fixed.
7. **Deployment.** Walked `scripts/setup.sh`/`setup-external.sh` for real against the live project and the actual Supabase CLI (see bugs above). `SETUP.md` §1.6 (grant admin) and the Vercel Cron section were missing entirely and are now written. Did **not** attempt Stripe/Twilio account creation — those need a human with a business identity and are out of scope for an agent regardless of tooling.
8. **Tutorial mode.** Built at `/tutorial` — reuses the real `Board`/`PieceTray` components and `engine.ts` functions against a local scripted bot opponent (no WS connection, no Supabase calls), ends with a clearly-marked mock tournament preview card, links out to real play.

**§5 — all seven funnel items built:**
- §5.1 stake ceiling: `RANKED_STAKE_TIERS_CENTS` cut to `[$5, $20]` (was `[$5, $20, $100]`, which sat exactly on the tournament "gold" tier threshold rather than below it) — a pricing decision, made conservatively per this handoff's own instruction, documented inline in `fees.ts`. Note: `BRACKETS`/`elite.maxStakeCents` ($10,000), which the *original* version of this brief's §5.1 was written against, turned out to be dead code never wired into matchmaking — the real ceiling was the much lower `RANKED_STAKE_TIERS_CENTS` the whole time.
- §5.2 loyalty points: `loyalty_points`/`loyalty_points_entries` + `move_loyalty_points()`, minted at 20% of ranked rake split between both players via a trigger on `platform_ledger`, redeemable as a tournament-entry discount through an extended `enter_tournament(..., p_redeem_points)`. Balance and a redeem checkbox shown next to every `EnterTournamentButton`.
- §5.3 satellites: payout fixed (see §4.2 above), and `/dashboard/tournaments` now shows a loud "Satellite → seat in [Target Name] ($X pool)" banner on satellite cards. Did not build satellite-chaining (a satellite into a satellite) — `planSatellite()` supports it mechanically, but no UI or admin flow for constructing a chain was requested or built.
- §5.4 milestone widget: a live progress bar on the dashboard reading the (now-correct) `milestone_progress` view.
- §5.5 title-tier hint: dashboard card reading "Your Skill Index already puts you in range for [Tier]-tier tournaments" once real Skill Index data exists (see §4.6). Reuses `BRACKETS`' skill thresholds purely as a display heuristic — informational only, never a gate.
- §5.6 first-tournament bonus: 100 points, once per rolling week, granted in `enterTournamentAction` after a successful entry, idempotent on `(user_id, week_start)`.
- §5.7 countdown/urgency: admin can now set an optional `starts_at` when creating a contest; tournament cards show a live countdown (`Countdown` component) and a "N seats left" badge when a field is close to full.

`npx tsc --noEmit` → 0 errors. `npx next lint` → 0 warnings. `npm run build` fails in this specific local environment only, for a reason unrelated to this codebase — see §4.7's deployment notes / the final handoff report for detail; it is very unlikely to reproduce on Vercel's own build infrastructure.

**Follow-up pass — live local debugging with the project owner, after the above was handed off:**
- `checkRateLimit()` called `createAdminClient()` outside its try/catch — if `SUPABASE_SERVICE_ROLE_KEY` is ever missing or wrong, the exception is thrown synchronously by the `@supabase/supabase-js` constructor, before the code that was designed to fail open ever runs. This took down **login, signup, deposit, and withdrawal** with a raw 500 the first time it was hit with an incomplete `.env.local`, not just the rate-limit check. Fixed: the whole function body is wrapped now, verified live (a bad key logs a warning and the request proceeds).
- **Operational lesson, not a code bug:** Next.js dev only reads `.env.local` at process boot — editing the file does not hot-reload it. A crash that looks like a code regression after an env change is very often just a stale server process; restart before debugging further.
- The person's own real account (`paulogamet95@gmail.com`) had already signed up against the live Supabase project this pass built and tested against, before the end-of-handoff test-data wipe — the wipe took their `public.users` profile row with it (their `auth.users`/session row was untouched, so login "worked" but the app couldn't find a profile). Restored manually and granted admin. **If you ever wipe test data from a Supabase project a real person might have touched, check `auth.users` for real emails first** — a blanket `TRUNCATE` on `public` doesn't know the difference between a probe account and a real one whose only surviving trace is in `auth`.
- Manually inserting a row into `auth.users` via raw SQL (done here to create a demo login) is not sufficient on its own — GoTrue's Go driver cannot scan a `NULL` `confirmation_token`/`recovery_token`/etc. (needs `''`, not `NULL`), and login additionally requires a matching `auth.identities` row for the `email` provider, which nothing creates automatically outside the real signup flow. Both are needed for a SQL-created account to actually authenticate; a real signup doesn't have this problem.
- `src/lib/stripe.ts` constructs the Stripe client at module load with no guard — visiting `/dashboard/wallet` with no `STRIPE_SECRET_KEY` set is a hard 500, not a degraded page. Not fixed (a real deployment always has this key set, so it's not a deployment blocker), but worth knowing before you go looking for a "wallet page is broken" bug that's actually just a missing env var.

## 4. What's still genuinely open

Everything from the original §4/§5 lists is closed (see §3). What remains is what no amount of code can close:

1. **Ladder and arena are schema-only.** Building their actual gameplay loops (a solo bank-or-continue climb for ladder; continuous winner-stays-on seating for arena) is a new-game-mode-sized effort, not a bug fix. Scope it as its own project if it's wanted.
2. **Referral system.** Confirmed not to exist anywhere. Needs actual product decisions (reward shape, fraud considerations, payout rules) before it's buildable — none of that is specified in this brief.
3. **Legal review (§6).** Nothing here is a substitute for it. `jurisdiction_rules`'s seed data is explicitly a starting point for counsel, not legal advice.
4. **Real account creation** (Supabase production project already exists and is verified working; Stripe, Twilio) needs a human. See the final handoff report for exact next steps.
5. **Everything in this file should be re-verified** the first time real user traffic hits it — every self-test in §3 was run against small, synthetic probe data, which proves the logic is correct but not that it holds up at the platform's real ~5,000-user scale.

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
