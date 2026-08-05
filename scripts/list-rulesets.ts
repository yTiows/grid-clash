/**
 * Process-rule verification canary (CLAUDE_CODE_BRIEF.md) — a toy script,
 * not real project tooling. Read-only, no side effects.
 *
 * Run: npx tsx scripts/list-rulesets.ts
 */

import { RULESETS } from "../src/lib/game/rulesets"

for (const ruleset of Object.values(RULESETS)) {
  console.log(`${ruleset.id}: ${ruleset.name} — ${ruleset.boardSize}x${ruleset.boardSize}, connect ${ruleset.connectTarget}`)
}
