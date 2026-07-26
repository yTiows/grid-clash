# Grid Clash — Brand Bible

Version 1.0 · Internal

---

## 1. Brand purpose

**To make skill pay.**

Every stakes game in this category takes 15–40% and calls the result a contest of skill. At those numbers a player needs a 60–70% win rate before they profit, and ranked matchmaking is engineered to hold everyone near 50%. The skill claim is decorative — the arithmetic contradicts it.

Grid Clash takes 1% on ranked. Break-even lands at **50.51%**. A genuinely strong player clears it and earns.

That is the whole purpose. Not "play games," not "win big" — close the gap between what the category claims and what its math permits.

**The test for any future decision:** does this widen or narrow the gap between the skill we advertise and the skill our numbers actually reward? Narrow it, ship it. Widen it, kill it.

---

## 2. Name

**Grid Clash** — descriptive and structural. *Grid* is the 5×5 board. *Clash* is two players, one board, no third party and no dealer.

The name's asset is what it doesn't say. No "royale," no "arena," no "coin," "cash," "jackpot," "spin," or "lucky." Nothing in it borrows casino vocabulary, which matters because the product is legally a contest of skill and the name is the first thing a regulator reads.

**Honest note:** it's safe rather than distinctive — the same construction as a hundred other titles, and unlikely to be defensible as a trademark on its own. Two practical consequences:

1. Commission a clearance search before spend. The mark and wordmark lockup are more protectable than the words.
2. The distinctiveness has to come from the identity system, not the name. That's what the rest of this document is for.

---

## 3. Positioning statement

> For competitive people who spend on entertainment and want their skill to actually count, **Grid Clash** is a stakes game where a 50.5% win rate turns a profit — because we take 1% where the category takes 15–40%.
>
> Unlike casino products dressed as skill games, our break-even number is printed on the screen.

Every clause is verifiable in the codebase. That is the point: the positioning is a fact about the product, not a claim about it.

---

## 4. Archetype

**Outlaw exterior. Sage spine.**

The visual language is Outlaw — poster art, saturated ink, heavy keylines, sticker cards, nothing that looks like it came out of a component library. Anti-corporate on sight.

The operating posture is Sage — published rake, live profit ledger, break-even printed next to the stake selector, deposit limits and self-exclusion shipped in v1 rather than bolted on after a regulator asks.

**The tension is the brand: loud room, clean math.** A boxing gym, not a casino. The room is raw, the aesthetics are unpolished, and the scoring is exact and the referee is incorruptible.

**Why not pure Outlaw:** Outlaw brands signal "we break rules," which is the wrong signal when you're asking for deposits and you need a payment processor to stay onside. The rebellion here is against the category's *dishonesty*, not against rules.

**Why not Hero:** Hero is the default for every esports brand — earnest, triumphant, interchangeable. It also implies we're on the player's side in their match, and we're not. We're the room, not a corner.

---

## 5. Emotional promise

**You'll find out if you're good. Fast.**

Not "get rich." That's false at any rake and refusing to say it is a positioning decision, not a compliance one.

The real payload is narrower and truer: within about 30 matches, Elo tells you your actual level, and at 1% rake that level has real consequences. The feeling we sell is **being right about a person under pressure with incomplete information** — you didn't know what they were holding, you read them anyway, and the read was correct.

That's a poker feeling, and it's the honest emotional core of a game built on hidden inventory and a five-second clock.

**What we never promise:** income, a living, escape, a way out. Those belong to the products this one is positioned against.

---

## 6. Voice

### Principles

**Short.** Under a 5-second clock, chatty copy costs people matches. If a string doesn't fit on one line at 320px, cut it.

**Name what the player controls.** "Spend your bomb," not "Utilize special ability." "Set a deposit limit," not "Configure responsible gaming parameters."

**Numbers speak, copy doesn't sell.** Show the break-even, the rake, the prize pool. Never adjectives them. `$1,515.00` is more persuasive than "huge prize pool."

**Errors don't apologize and are never vague.** "Not enough balance for this stake" — not "Oops! Something went wrong."

**Empty states are invitations.** "No matches yet. Queue up." — not "You haven't played any games."

### Banned vocabulary — this list is legally load-bearing

Never, in any surface, including loss states and marketing:

| Banned | Why |
|---|---|
| luck, lucky, unlucky | Directly contradicts skill-contest classification |
| chance, odds, jackpot | Casino vocabulary; regulatory tell |
| bet, wager, gamble, stake *(as verb)* | Use "entry," "entry fee," "enter" |
| win big, cash out big, life-changing | Income framing we've refused |
| free money, guaranteed, risk-free | False, and the exact phrasing regulators search for |

**"Better luck next time" is the single most expensive string we could ship.** A skill-contest operator whose own loss screen attributes outcomes to luck has undercut its classification in its own product copy. Loss states attribute to play:

- "Beaten on the read."
- "They had the bomb."
- "Out of time."

### Tone calibration

| Surface | Register |
|---|---|
| In-match | Terse. Verbs only where possible. |
| Result screens | Flat and factual. No consolation, no celebration inflation. |
| Money surfaces | Plainest register in the product. Boring on purpose. |
| Limits & self-exclusion | Neutral and frictionless. Never discourage, never editorialise. |
| Marketing | Confident, specific, unhyped. Lead with the 1%. |

---

## 7. Logo system

### Primary mark — `public/mark.svg`

A 5×5 grid with four cells connected on the descending diagonal.

**The mark is the win condition.** Not a decorative abstraction of one — the literal thing that ends a match, drawn as a glyph. It encodes the rules rather than gesturing at a theme, which is what keeps it from reading as generic tech-logo geometry.

### Compact mark — `public/mark-compact.svg`

The winning line alone, grid dropped. Favicon, app icon, avatar. Legible at 16px.

### Wordmark

Heavy condensed uppercase, 2px black stroke via `paint-order: stroke fill`, 4px hard offset shadow, no blur. Implemented as `.display` in `globals.css`.

### Lockups

| Lockup | Use |
|---|---|
| Mark + wordmark, horizontal | Site header, docs, email |
| Mark over wordmark, stacked | Social avatars, square placements |
| Mark only | Favicon, app icon, loading, watermark |
| Wordmark only | Where the mark is under ~24px and would muddy |

### Rules

- Clear space on all sides = one grid cell (20 units at native scale).
- Keylines never thin below 3px at render size. If the mark is too small to hold a 3px keyline, use the compact mark.
- Never recolour the four filled cells to anything but `--primary` acid lime, except the all-black and all-white single-colour variants.
- Never rotate, never gradient the mark, never add an outer glow.
- Never place on a mid-tone background — the mark needs either deep ink or near-white behind it.

---

## 8. Mascot — the Striker

A praying mantis, drawn in the poster register: angular, oversaturated, heavy keyline, slightly too large for its frame.

**Why a mantis.** The mantis strike is one of the fastest movements in the animal kingdom — roughly 50 milliseconds — and it comes after long stillness. That is exactly the rhythm of a Grid Clash turn: five seconds, four of them reading, one committed action. The mascot *is* the game's tempo, not a random animal in a hat.

**Deliberately unnamed in-product.** It appears in loading states, empty states, the 404, and tournament plates. It is never labelled. Communities name their own mascots, and an adopted nickname is worth more than an assigned one. Internally: the Striker.

**Where it never appears:** deposit, withdrawal, KYC, limits, or self-exclusion screens. Money and safety surfaces stay plain. A cartoon on a deposit form reads as a casino, and reads worse to a regulator.

---

## 9. Community identity

**Players are identified by what they've won, not by an invented demonym.**

The title ladder already exists in the schema (`player_titles`) and is earned deterministically — win a contest at a tier, receive that tier's title. No random rolls anywhere in the path, which is what keeps it an achievement rather than a loot box. (Loot boxes are regulated as gambling in Belgium and the Netherlands; we're not going near it.)

Tiers: **Dollar · Bronze · Silver · Gold · Obsidian · Milestone**

Someone who has taken an Obsidian tournament *is* an Obsidian. That's the demonym, and it's earned rather than assigned.

**Typography and colour per tier are never explained anywhere in the product.** No legend, no tooltip, no key. Players work out what a treatment signifies by seeing it worn by someone who earned it. The meaning spreads socially or not at all.

**The line this respects:** money terms are always explicit. Entry fee, field size, prize pool, and rake are stated up front on every contest, every time. Only the *cosmetic* meaning is left to discovery. Nothing discoverable affects odds, payouts, or cost. That distinction is what makes this mystery rather than obfuscation, and it is not negotiable — the moment a hidden treatment carries a money consequence, it becomes an undisclosed term.

**Milestone is the rarest and is never sold.** It exists only when the published profit ledger crosses another $1,000. It cannot be bought, gifted, or granted.

---

## 10. Brand bible — operating rules

### Colour

| Token | Hex | Reserved for |
|---|---|---|
| `--primary` | `#b8ff2e` | Player one, primary action, win state |
| `--rival` | `#ff2e8b` | Player two, opposition |
| `--accent` | `#00e5ff` | Shields, focus rings, system state |
| `--gold` | `#ffc21f` | **Money only** — prize pools, payouts, milestone counter |
| `--ink` | `#08060f` | Every keyline and every hard shadow |

**`--gold` never appears on a non-monetary surface.** When gold means money everywhere without exception, players read prize amounts before they read the label. Spending it on decoration destroys that.

### Structure

- **Keylines are the identity.** 3px minimum, `--ink`, on every card, cell, badge, and button. This single token carries more recognition than the palette.
- **Shadows are hard offsets, never blurs.** `6px 6px 0 0 var(--ink)`. Sticker, not Material.
- **Halftone is texture, never content.** Max 16% opacity, always beneath.

### The quiet board

The play surface is the one place the brand goes quiet. Cells are muted until occupied, then hit full saturation. No halftone, no ambient motion, no decoration on or near the grid.

Under a five-second clock, ornament on the play surface costs people matches — and in a stakes game, costing someone a match costs them money. **Restraint here is a fairness property, not a taste preference.**

### Motion

- Piece placement: 90ms.
- Winning line: single 420ms pop, once, then still.
- Clock: linear drain, no easing — easing misrepresents remaining time.
- `prefers-reduced-motion` is honoured globally in `globals.css`. Non-negotiable under a timer.

---

## 11. What this brand will not do

Recorded so the list survives staff turnover:

- **Never advertise as income.** Not "extra income," not "side hustle," not "make money playing games." The product is entertainment with a genuine skill payoff, and the copy says exactly that.
- **Never target financial desperation.** No campaign aimed at debt, unemployment, or hardship. The audience is discretionary spend.
- **Never hide a money term.** Entry fee, field size, prize pool, rake, and break-even are stated before entry, every time.
- **Never introduce a randomised paid reward.** No loot boxes, no mystery entries, no randomised prize tiers.
- **Never make a limit easier to lift than to set.** Tightening is immediate; loosening waits out a cooling-off period. Already enforced in schema.
- **Never raise ranked rake above 1% without republishing break-even in the same release.** The number on the screen and the number in the code ship together or neither ships.

---

*Assets: `public/mark.svg`, `public/mark-compact.svg`. Tokens: `src/app/globals.css`. Economics of record: `src/lib/game/fees.ts`.*
