# Grid Clash — Game Design Document

Written against the actual shipped implementation (`src/lib/game/engine.ts`,
`match-server.ts`, `fees.ts`, `rulesets.ts`, `anti-cheat.ts`, `BRAND.md`), not
a hypothetical redesign. Where the honest answer is "rebuild this," it says
so. Where the existing chassis is sound, it says that too, and explains why
tearing it up would be a regression, not progress.

---

## 0. Verdict, up front

**Keep the chassis. It's the right bones.** 5×5, connect-4, hidden inventory,
a hard clock, symmetric tools. That combination already has the property
that makes Poker durable: **the same simple action space produces different
correct answers depending on what you can't see and how much time you have
to decide.** That's not a coincidence to preserve carefully — it's the one
idea in this document everything else should be judged against.

What's actually wrong isn't the core loop. It's three things: **match length
is untuned for a 2–3 minute target, ranked has no format/skill segmentation
beyond stake, and the "hidden information" is currently a pure secrecy
mechanic with no bluffing dimension** — the opponent can't be given a false
signal, only denied a true one. Poker's depth comes from betting *sending
information*, not just withholding it. Grid Clash withholds well; it doesn't
yet let a player lie with an action. Section 17 proposes the smallest change
that fixes this without adding a new rule to learn.

---

## 1. Core gameplay

Two players, one 5×5 board, alternating turns, 5 seconds each. Every match
is a race to read your opponent faster than they read you, spend a
disappearing toolkit at the right moment, and not blink first when the clock
runs out. There is no bot in the loop that matters, no third-party house
edge distorting outcomes, and nothing that happens is explainable by luck —
every result traces to a decision either player made or failed to make in
time.

## 2. Rules (as shipped)

- 5×5 grid (Classic/Blitz/Demolition/Fortress/Shuffle/Gambit), connect 4 in
  a row — any of 4 directions (`engine.ts` `DIRECTIONS`).
- Each side holds the same four piece kinds: **Normal** (occupy an empty
  cell), **Shield** (occupy + immune to Bomb/Swap), **Bomb** (clear an
  unshielded enemy cell), **Swap** (trade positions with an unshielded enemy
  cell — the *contents* move, not just ownership; see `applyMove`'s swap
  case).
- Inventory is hidden: an opponent sees your remaining piece **count**, never
  the breakdown (`redactStateFor`). This is the one piece of imperfect
  information in the system today.
- 5s per move (format-dependent: Blitz 3s, Siege 7s, Sprawl 8s). A timeout
  forfeits one piece from inventory and passes the turn — never an instant
  loss, so a single lag spike can't end a match (`applyTimeout`).
- First move is decided by a coin flip seeded from the match id — auditable
  after the fact, unpredictable before it exists (`coinFlipGivesFirstSlotTo`,
  added this session; previously always favored whoever queued first).
- A drawn board (full, or neither side has a legal move) replays as sudden
  death on a fresh board instead of settling as a split pot — capped at 5
  rounds for ranked so a real-money stake can't sit in escrow indefinitely
  (`MAX_RANKED_SUDDEN_DEATH_ROUNDS`, added this session).

## 3. Win conditions

1. Connect 4 (or the format's target) in a row, any direction.
2. Opponent resigns.
3. Opponent disconnects and doesn't return inside the 30s grace window.
4. Opponent runs out of legal moves (rare — usually a symptom of #1 already
   having happened via a Swap/Bomb touching the winning line).
5. Draw is no longer a terminal outcome for automated play (see §2) — it's
   architecturally close to zero now, not just discouraged.

## 4. Mathematical analysis

**First-move advantage.** Free-placement connect-in-a-row games on small
open boards are well-documented first-player wins with perfect play (this is
the Gomoku result, and a 5×5/connect-4 board is smaller and more solvable
than 15×15 Gomoku). The correct fix for a *ranked ladder* is not to weaken
the win condition — that's solving the wrong problem, the same mistake
symmetric hidden-info games avoid by not nerfing the stronger side's tools.
The correct fix is **procedural fairness**: randomize who gets the edge, so
it washes out across a season instead of compounding for whoever queues
first. That's what the coin flip does. It does not make any single match
50/50 — no finite deterministic game can promise that without becoming
trivial — it makes the *population* of matches fair, which is what "ranked"
actually needs to mean.

**Draws.** With ~22–24 total pieces on a 25-cell board and two disruption
tools (Bomb, Swap) that can break up a forming line, draws are a real,
non-degenerate outcome between two cautious players — this is the same
shape as human-vs-human tic-tac-toe-adjacent games converging to draws at
skill. Sudden-death replay (§2) removes it as a terminal state entirely
rather than accepting it or bolting on an arbitrary tiebreak (first to
control the center, most pieces remaining, etc.) — exactly what was asked
for: eliminate, don't paper over.

**Solved-opening risk.** A 5×5/connect-4 board with single-use specials
degenerates, once both sides' specials are spent, into plain connect-4 on a
tiny board — a game small enough that dedicated players will approach
solved lines within a season. This is real and not fully addressed yet.
Gambit (doubling specials, §10) buys more turns of live decision-making
before the game flattens into the solved endgame, but it's a mitigation, not
a fix. §17 has the actual fix.

**Expected value.** `fees.ts` already publishes the honest number: at
standard tier (3%), break-even is 51.55%; at elite (1.5%), 50.76%. Compare
to the category's 60–70% at 15–40% rake (`BRAND.md` §1) — the arithmetic
gap between "the skill claim" and "the skill the payout structure actually
rewards" is real and already the smallest in the category. This is the one
section where the existing design is already best-in-class; don't touch it
casually.

## 5. Psychological analysis

What Poker actually runs on, and which of it applies here:

| Element | Keep? | Why |
|---|---|---|
| Hidden information | **Yes, already core** | The entire game is built on it. |
| Bluffing (acting to misrepresent your hand) | **Missing — add it** | Grid Clash can currently only withhold true information, never send false information. This is the single biggest gap vs. Poker's depth. See §17. |
| Tension / time pressure | **Yes, already core** | 5s clock. Already excellent — don't loosen it. |
| Comeback potential | **Partially** | A losing position can still flip via a well-timed Bomb/Swap, but there's no explicit "you're behind, here's your lever" moment the way Poker's stack pressure creates. Acceptable as-is; not urgent. |
| Near-misses ("I almost had him") | **Yes, emergent** | A blocked connect-4 one cell short is already the natural drama of this board. No changes needed. |
| Status / identity | **Partial** | `player_titles`/badge system exists in schema, not yet a UI. See §9. |
| Mastery / visible skill growth | **Yes** | Skill Index (`reputation.ts`) is published, multi-factor, and already explains itself to the player — this is good design, keep it. |
| Social proof / spectatorship | **Not yet built** | See §12. |
| Loss aversion, reward anticipation | **Present via real money** | Already the core hook; no artificial scarcity/dark-pattern needed on top of it. |
| Collection | **Reject** | Cosmetic collection is fine (§ monetization) but "collect pieces/power-ups" would turn a skill game into a gacha. Not recommended. |
| Revenge motivation | **Cheap to add** | A "Rematch" button already exists implicitly (Queue again); a direct rematch-request-to-a-specific-opponent doesn't exist yet. Low-cost addition, see §17. |

## 6. Economy

Current model (`fees.ts`, this session's repricing):

- Ranked: $1 minimum stake at a flat $0.25 fee (a percentage of a $2 pot is
  too small to mean anything — a floor, not a rate), $5/$20 at tiered
  percentage (3% standard → 1.5% elite).
- Tournament: field-scaled 5–10% (`scheduling.ts` `feeForFieldBps`), format
  multiplier on top, milestone events subsidized by the house from realized
  profit (`planMilestoneEvent`) with a bounded, floating-pool exposure model
  — capped house risk, not a blank check.
- Anti-abuse: `assert_can_wager` gates every paid entry on account status,
  self-exclusion, jurisdiction, and daily/weekly loss limits, in that order,
  *before* money moves. Bounty/satellite/ladder formats exist with their own
  fee shape (`formats.ts`), not force-fit into the head-to-head model.

**This is already a healthy design.** The two things worth tightening:

1. **`newAccountStakeCeilingCents`** caps a new account's stake, not a new
   account's number of *concurrent* opponents faced — a farm of fresh
   accounts could still each individually stay under the cap while
   collectively targeting one victim. `arePlayersLinked` catches direct
   collusion between two accounts; it doesn't catch a ring. Not urgent at
   current scale, worth a note for when volume grows.
2. **Tournament economics don't yet flex with live demand** — `scheduling.ts`
   has a fully-designed, unwired system for this (`sizeFieldForDemand`,
   `commitField`'s floor/refund). Wiring it is real, scoped work (flagged
   previously in this session), not a redesign.

## 7. Matchmaking

Today: stake+format partitioned FIFO queues (`match-server.ts` `queueKey`,
this session's change), collusion-checked pairing, no skill-based matching
at all — first two compatible sessions in the queue pair, full stop.

**This is the actual retention risk**, more than anything mechanical: a
brand-new player can currently be queued against a 500-match veteran at the
same stake with zero skill gate. `player_standing.skill_index` already
exists and is computed (`recompute-standing` cron) — it's simply not read by
the matchmaker. **Recommended fix, concretely scoped**: sort each stake+
format queue by Elo distance before pairing (closest available opponent,
not first-in-line), widening the acceptable band the longer someone waits —
the exact `bracketsOpenAfterWait` pattern already written in `fees.ts` and
never wired into anything. This is the highest-value matchmaking change
available and it requires no new subsystem, only reading data that already
exists.

## 8. Anti-cheat architecture

Implemented this session (`anti-cheat.ts`, `/api/cron/detect-automation`,
`/admin/automation`), on top of what already existed:

- **Server-authoritative everything.** The client proposes, `applyMove` on
  the server decides. No client input is ever trusted for legality, timing,
  or outcome (`match-server.ts` header comment).
- **Rate limiting** (token bucket, `protocol.ts` `RATE_LIMIT`) — bounds the
  cost of a scripted flood before it reaches game logic.
- **Collusion detection** (`arePlayersLinked`) at pairing time, before money
  moves — not post-hoc.
- **Automation detection** (new): reaction-time consistency, session length,
  active-hours spread — computed hourly, escalating none → monitor → review
  → freeze, with human review required before any account is confirmed and
  humans it beat are refunded (`resolveAutomationReviewAction`). The one
  documented gap: **move-quality scoring** (`optimal_move_rate`) isn't
  implemented — that needs a real move-evaluator, which is a genuinely
  separate, larger build (a search oracle under the same hidden-information
  constraint a human faces), not a corner to cut carelessly.
- **Device fingerprinting** (`device_fingerprints` table) exists in schema,
  unused in `src/` — the same "designed, never wired" pattern as the
  automation tables were before this session. Worth doing next if
  multi-accounting becomes observed, not before.

**What's still missing, in priority order:**
1. Move-quality oracle (closes the biggest remaining gap — the honest
   answer, not a shortcut).
2. Client build/version attestation (nothing today distinguishes the real
   web client from a scripted WebSocket client speaking the same protocol —
   the protocol is intentionally simple, which is good for legitimate
   clients and equally easy for a bot; server-side behavioral detection is
   correctly the primary defense here, not client hardening, which is easy
   to bypass and easy to over-invest in).
3. IP/ASN reputation on top of `ip_blocks` (exists, unused).

## 9. Retention systems

Exists: Skill Index (multi-factor, transparent), Elo, win streaks, loyalty
points for first weekly tournament entry, milestone events (house-subsidized
periodic prize pools). Missing: any UI for `player_titles`/badges (schema
exists, never surfaced — see leaderboard's `TITLE_TIER_MARK`, which already
renders tiers if `equipped_title_tier` is set, but nothing ever sets one), a
friends/rivalry surface (`rivalries` table exists, unused), and a rematch/
challenge flow. All three are additive, none require touching game logic.

**Explicitly rejected**: streak-based loss-forgiveness beyond the existing
comeback-claim mechanic (`comeback_claims`, already bounded and cooldown-
gated), loot-box or randomized cosmetic drops (BRAND.md already forbids
this, correctly), any mechanic that makes losing feel like a technical
failure rather than a read failure — every existing loss-state copy already
attributes to play, never luck (`match-result.tsx` `REASON_COPY`'s own
comment: "a skill-contest operator undercuts its own classification").

## 10. Ranked mode

Format now includes Classic, Blitz, and Gambit (this session) at the same
$1/$5/$20 stakes, queue-partitioned so a format choice never crosses into
another. Siege/Sprawl/Fortress/Shuffle/Purist remain tournament-only —
correctly: a 7×7 board or a specials-only format changes match length
enough that pairing it with a fixed ranked stake ladder would need its own
stake tiers, which is real scope, not a quick add.

**Match-length reality check against the stated 2–3 minute target**: Classic
at 5s/move, worst case ~22 moves before the board is exhausted → roughly
110s of pure clock time, plus think-time slack most players won't use in
full. Realistically most Classic matches likely land in the 60–150s range
already — closer to the target than it might look on paper. Blitz (3s) is
the format that actually guarantees the 2–3 minute ceiling; **recommend
making Blitz, not Classic, the default-highlighted ranked format** if
match-length is the metric being optimized for. This is a positioning
change, not a code change.

## 11. Tournament mode

Bracket/Swiss/Satellite/Bounty/Ladder formats exist (`formats.ts`),
seeded pairing is deterministic and auditable (`bracket.ts`), prize
distribution is money-conservation-tested (`distributePrizePool`). Demand-
adaptive field sizing is designed but unwired (§6). Recommend wiring that
before adding anything new to this mode — it's the single highest-leverage
unshipped piece already sitting in the codebase.

## 12. Spectator mode

**Does not exist.** This is a real gap for "spectator value" and for the
long-term health of any competitive product — without it, there's no path
to content creators, no highlight clips, no way a non-playing audience ever
sees a high-level match. Scoped recommendation: a read-only WebSocket
subscription to `match:state` broadcasts for a given `matchId` (the
authoritative state already redacts correctly per-viewer; a spectator view
would need a *third* redaction mode — see both players' inventories are
still hidden from a spectator by the same rule that hides them from the
opponent, unless the product wants "spectator sees everything," which is a
policy decision, not an engineering one). Not built this session — it's a
new, real feature, not a fix.

## 13. New-player onboarding

`/tutorial` already exists and is well-built: three staged lessons (pieces,
board, tournaments), a real interactive board reusing the actual `GameBoard`
component (not a mockup), skip-to-dashboard always available. This is
already good practice — the same component that plays a real match teaches
the rules, so nothing taught can drift from what's actually shipped.

## 14. Risk analysis

- **Regulatory**: age gate, self-exclusion, deposit/loss limits, and
  jurisdiction rules are enforced server-side at the single money gate
  (`assert_can_wager`), not scattered across call sites — this is the
  correct architecture for this risk category and already shipped.
- **Reputational**: `BRAND.md`'s own governing rule (never raise rake
  without republishing break-even in the same release) is a real process
  control against the most likely reputational failure mode (quietly
  changing the odds). It was followed this session for the 1%→3%/1.5%
  repricing specifically because it's the codified standard.
- **Concentration risk**: milestone events cap house exposure at a fixed
  subsidy by default (`fixed_subsidy` mode); the `guaranteed_pool` mode
  exists but is explicitly documented as requiring a deliberate exposure
  decision, not a default. Correct posture — don't flip that default without
  the same rigor the code already demands of it.

## 15. Exploit analysis

- **Timing exploit**: closed. `stale_sequence` + server-held turn deadline
  means a client can't fake a faster or slower clock than reality.
- **Reentrancy exploit** (client double-submitting a move before the first
  resolves): closed this session (`pendingMoveRef` guard,
  `use-match-socket.ts`).
- **Rollback desync** (a rejected optimistic move leaving a wrong-looking
  board with no correction): closed this session (rollback now triggers on
  any pending-move error, not a hardcoded code allowlist that had already
  missed `rate_limited`).
- **Sudden-death stake lockup**: closed this session (round cap +
  fallback to real draw settlement for ranked).
- **Audit-trail loss across sudden-death rounds**: closed this session
  (moveSequence/latencies now accumulate instead of resetting per round).
- **Remaining, not yet closed**: no move-quality oracle (§8) means a subtle,
  consistently-optimal-but-not-obviously-fast bot is not yet detectable by
  this system — the honest gap, not a hidden one.

## 16. Weaknesses

In order of how much they cost the product if left alone:

1. **No skill-based matchmaking** (§7) — the single biggest retention risk;
   a new player facing a 500-match veteran on stake #1 will not become a
   returning player.
2. **No bluffing mechanic** (§5, §17) — caps the skill ceiling below what
   "better than Poker" requires; withholding information is not the same
   game as being able to misrepresent it.
3. **No spectator mode** (§12) — caps growth to word-of-mouth among people
   who already play.
4. **Solved-opening risk at small board size** (§4) — a genuine long-term
   competitive-health question once a serious player base exists.

## 17. Recommended improvements (concrete, scoped, in priority order)

1. **Elo-proximity matchmaking within each stake+format queue.** Reads data
   that already exists (`player_standing.elo_rating`), reuses a pattern
   already written and unwired (`bracketsOpenAfterWait`). Highest value per
   line of code in this entire document.
2. **A genuine bluffing mechanic**: let a player declare a move as one of
   two "shapes" before the opponent sees which it resolved as — concretely,
   make **Normal and Shield indistinguishable at the moment they're played**
   (both currently show identically until `cell.shielded` styling reveals
   it — check whether that's already true or whether Shield is visually
   flagged immediately; if it resolves face-down for one full opponent turn
   before revealing, that single change turns "hidden inventory" into "you
   don't know if that's a real wall or a bluff," which is the actual Poker-
   shaped mechanic this design has been missing). Needs real playtesting
   before shipping — flagged, not implemented blind, consistent with how
   every other rebalance this session was handled.
3. **Wire demand-adaptive tournament sizing** (`scheduling.ts` already
   built, §6/§11).
4. **Ship the move-quality oracle** for anti-cheat (§8) — the honestly-
   documented remaining gap.
5. **Direct rematch / challenge-a-friend flow** — cheap, retention-positive,
   no schema changes (`rivalries` table already exists).
6. **Spectator read-only view** (§12) — real feature, real payoff, real
   scope; sequence after the above, not before.

## 18. Alternative concepts considered, and why they weren't recommended

- **Real-time simultaneous moves instead of alternating turns** (more
  Rocket-League-like): rejected. It would remove the clean server-
  authoritative turn model that makes anti-cheat and dispute resolution
  possible today, in exchange for a genre change the brand isn't asking for.
- **Larger default board** (7×7/connect-5 as the ranked default): rejected
  for ranked (works against the 2–3 minute target directly), already
  correctly scoped to Sprawl/tournament-only.
- **House-vs-player matches to fill empty queues**: explicitly rejected.
  The platform should never have financial exposure to a single match's
  outcome the way a casino does — every existing mechanic (`assert_can_wager`,
  fixed-subsidy milestones, money-conservation-tested settlement) is built
  around the platform taking a fee on a match it has no stake in the outcome
  of. A house-bot introduces exactly the exposure the rest of this
  architecture was built to avoid, and "a bot that intentionally loses" is
  both a regulatory problem (undisclosed rigged odds) and a bad-faith
  answer to a liquidity problem that has honest fixes: estimated wait times,
  a free (no real-money) practice queue against a fixed-strength AI clearly
  labeled as such, and scheduled sit-and-go windows at low-liquidity hours.
  No bankroll is needed for any of these — the one place a bankroll is
  already used correctly is milestone subsidy, which is bounded, disclosed,
  and funded from realized profit, not speculative capital.
