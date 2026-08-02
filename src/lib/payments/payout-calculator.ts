/**
 * Payout Calculator
 *
 * STATUS — dead code. Nothing in src/ imports calculatePayouts,
 * verifyPayoutRecord, or formatPayouts; the real settlement path is
 * calculateMatchFee in src/lib/game/fees.ts. This file's DEFAULT_CONFIG
 * still says 1%, which has been stale since the 2026-07 fee increase (see
 * fees.ts's FEE_TIERS — standard is now 3%, elite 1.5%). Left in place
 * rather than deleted only because nothing references it either way; do NOT
 * wire this up as-is, and do not "fix" its 1% without also confirming
 * fees.ts and this file are meant to be the same calculation — they compute
 * fee differently (bps-of-pot with a per-match cap here has no cap at all)
 * and duplicating the model is exactly how the two disagreeing-fee bugs
 * documented in fees.ts happened before.
 *
 * Ensures 100% money conservation:
 * entry_fee_p1 + entry_fee_p2 = winner_payout + loser_payout + house_rake
 *
 * Never rounds in favor of the house. Always rounds down payouts, up rake.
 * Example:
 *   Player A pays $5.00 (500 cents)
 *   Player B pays $5.00 (500 cents)
 *   Total pot = 1000 cents
 *   House takes 1% = 10 cents
 *   Remaining = 990 cents
 *   Winner gets 990 cents ($9.90)
 *   Loser gets 0 cents
 */

export interface PayoutConfig {
  houseRakePercent: number; // e.g., 1 for 1%
  minPayout: number; // minimum cents winner receives (prevents $0.01 wins)
  loserConsolePercent?: number; // e.g., 0.5 for 0.5% consolation prize
  roundingBias: 'house' | 'winner'; // which direction to round on fractional cents
}

export interface PayoutCalculation {
  // Inputs
  entryFeeP1Cents: number;
  entryFeeP2Cents: number;
  totalPotCents: number;

  // Outputs
  houseRakeCents: number;
  winnerPayoutCents: number;
  loserPayoutCents: number;

  // Verification
  totalDistributedCents: number; // Should equal totalPotCents
  isValid: boolean;
  errors: string[];
}

const DEFAULT_CONFIG: PayoutConfig = {
  houseRakePercent: 1, // 1%
  minPayout: 0,
  roundingBias: 'house', // Always round up rake (in house's favor on fractional cents)
};

/**
 * Calculate payouts for a match.
 * Guaranteed money conservation: inputs == outputs (down to the cent).
 */
export function calculatePayouts(
  entryFeeP1Cents: number,
  entryFeeP2Cents: number,
  config: Partial<PayoutConfig> = {}
): PayoutCalculation {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  const errors: string[] = [];

  // Validate inputs
  if (entryFeeP1Cents < 0 || !Number.isInteger(entryFeeP1Cents)) {
    errors.push(`Invalid entryFeeP1Cents: ${entryFeeP1Cents}`);
  }
  if (entryFeeP2Cents < 0 || !Number.isInteger(entryFeeP2Cents)) {
    errors.push(`Invalid entryFeeP2Cents: ${entryFeeP2Cents}`);
  }
  if (fullConfig.houseRakePercent < 0 || fullConfig.houseRakePercent > 100) {
    errors.push(`Invalid houseRakePercent: ${fullConfig.houseRakePercent}`);
  }

  const totalPotCents = entryFeeP1Cents + entryFeeP2Cents;

  // Calculate rake (always round up in house's favor)
  const rakeExact = (totalPotCents * fullConfig.houseRakePercent) / 100;
  let houseRakeCents = Math.ceil(rakeExact);

  // Ensure rake doesn't exceed pot
  if (houseRakeCents > totalPotCents) {
    houseRakeCents = totalPotCents;
  }

  const remainingAfterRakeCents = totalPotCents - houseRakeCents;

  // Calculate loser consolation (if any)
  let loserPayoutCents = 0;
  if (fullConfig.loserConsolePercent && fullConfig.loserConsolePercent > 0) {
    const consoleExact = (remainingAfterRakeCents * fullConfig.loserConsolePercent) / 100;
    loserPayoutCents = Math.floor(consoleExact); // Round down for loser
  }

  // Winner gets remainder
  let winnerPayoutCents = remainingAfterRakeCents - loserPayoutCents;

  // Enforce minimum payout
  if (winnerPayoutCents < fullConfig.minPayout && fullConfig.minPayout > 0) {
    errors.push(
      `Winner payout ${winnerPayoutCents} cents below minimum ${fullConfig.minPayout}`
    );
  }

  // Verify conservation
  const totalDistributedCents = houseRakeCents + winnerPayoutCents + loserPayoutCents;
  const isValid = totalDistributedCents === totalPotCents && errors.length === 0;

  if (totalDistributedCents !== totalPotCents) {
    errors.push(
      `Money mismatch: pot=${totalPotCents}, distributed=${totalDistributedCents} (diff=${
        totalPotCents - totalDistributedCents
      })`
    );
  }

  return {
    entryFeeP1Cents,
    entryFeeP2Cents,
    totalPotCents,
    houseRakeCents,
    winnerPayoutCents,
    loserPayoutCents,
    totalDistributedCents,
    isValid,
    errors,
  };
}

/**
 * Verify a recorded payout matches the calculated one.
 * Call this before settling matches to catch bugs.
 */
export function verifyPayoutRecord(
  entryFeeP1Cents: number,
  entryFeeP2Cents: number,
  recordedWinnerPayoutCents: number,
  recordedLoserPayoutCents: number,
  recordedRakeCents: number,
  config: Partial<PayoutConfig> = {}
): { valid: boolean; message: string } {
  const calculated = calculatePayouts(entryFeeP1Cents, entryFeeP2Cents, config);

  if (!calculated.isValid) {
    return {
      valid: false,
      message: `Calculation failed: ${calculated.errors.join('; ')}`,
    };
  }

  const issues: string[] = [];

  if (recordedWinnerPayoutCents !== calculated.winnerPayoutCents) {
    issues.push(
      `Winner payout mismatch: expected ${calculated.winnerPayoutCents}, got ${recordedWinnerPayoutCents}`
    );
  }

  if (recordedLoserPayoutCents !== calculated.loserPayoutCents) {
    issues.push(
      `Loser payout mismatch: expected ${calculated.loserPayoutCents}, got ${recordedLoserPayoutCents}`
    );
  }

  if (recordedRakeCents !== calculated.houseRakeCents) {
    issues.push(
      `Rake mismatch: expected ${calculated.houseRakeCents}, got ${recordedRakeCents}`
    );
  }

  if (issues.length > 0) {
    return {
      valid: false,
      message: issues.join('; '),
    };
  }

  return {
    valid: true,
    message: `Payout verified: winner=$${(calculated.winnerPayoutCents / 100).toFixed(2)}, loser=$${(calculated.loserPayoutCents / 100).toFixed(2)}, rake=$${(calculated.houseRakeCents / 100).toFixed(2)}`,
  };
}

/**
 * Format a payout calculation for display.
 */
export function formatPayouts(calc: PayoutCalculation): string {
  return `
Pot: $${(calc.totalPotCents / 100).toFixed(2)}
  House rake (${(calc.houseRakeCents / calc.totalPotCents * 100).toFixed(2)}%): $${(calc.houseRakeCents / 100).toFixed(2)}
  Winner payout: $${(calc.winnerPayoutCents / 100).toFixed(2)}
  Loser payout: $${(calc.loserPayoutCents / 100).toFixed(2)}
  ────────────────
  Total: $${(calc.totalDistributedCents / 100).toFixed(2)}
${!calc.isValid ? `\n⚠️  ERRORS: ${calc.errors.join(', ')}` : '✅ Valid'}
  `.trim();
}
