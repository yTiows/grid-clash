/**
 * Tournament scheduling and sizing.
 *
 * Two problems this solves:
 *
 *  1. Fixed field sizes break at both ends. A 128-seat event on a quiet
 *     Tuesday either cancels or runs at 30% with the platform eating the
 *     overlay. A 16-seat event on a busy Friday turns away the demand that
 *     makes the site feel alive.
 *
 *  2. A flat fee across all field sizes overcharges small contests. A 4-player
 *     knockout is two rounds; a 256-player is eight. Charging both 10% prices
 *     the same fee against four times the play.
 *
 * Sizing is driven by measured concurrency rather than a blocking access
 * queue. A queue in front of the site adds friction exactly where it is most
 * expensive, and it measures people waiting to enter rather than people
 * willing to register. Live socket counts and registration curves are the same
 * signal without the cost.
 */

import { FORMATS, type FormatId } from "./formats"

// --- Field-scaled fees ------------------------------------------------------

/**
 * Fee scales with rounds, which is what a field size actually buys.
 *
 * Monotonic and capped, so there is no field size a player should prefer for
 * fee reasons, and the rate only ever rises toward the ceiling.
 *
 *   4 players  (2 rounds)   5%
 *   8          (3 rounds)   6%
 *   16         (4 rounds)   7%
 *   32         (5 rounds)   8%
 *   64         (6 rounds)   9%
 *   128+       (7+ rounds)  10%
 *
 * This also narrows the gap against the 2% head-to-head fee at small fields,
 * which is where the comparison is most visible to players.
 */
export const MIN_FIELD_FEE_BPS = 500
export const MAX_FIELD_FEE_BPS = 1000

export function feeForFieldBps(fieldSize: number): number {
  const rounds = Math.max(1, Math.ceil(Math.log2(Math.max(2, fieldSize))))
  const bps = MIN_FIELD_FEE_BPS + (rounds - 2) * 100
  return Math.min(MAX_FIELD_FEE_BPS, Math.max(MIN_FIELD_FEE_BPS, bps))
}

/**
 * Format multiplier, applied on top of the field-scaled base.
 *
 * Swiss and Survivor guarantee more matches per entrant than a knockout of the
 * same size, so they carry a premium; Ladder is solo with no bracket to run,
 * so it carries a discount. Expressed as a ratio against the knockout baseline
 * of 1000bps so the two systems compose predictably.
 */
export function formatFeeMultiplier(formatId: FormatId): number {
  return FORMATS[formatId].rakeBps / 1000
}

/** Final fee rate for a contest. This is the number printed on the card. */
export function contestFeeBps(formatId: FormatId, fieldSize: number): number {
  const scaled = feeForFieldBps(fieldSize) * formatFeeMultiplier(formatId)
  return Math.min(MAX_FIELD_FEE_BPS * 1.2, Math.round(scaled))
}

// --- Demand measurement -----------------------------------------------------

/**
 * A snapshot of live demand. Every field is observable from data the platform
 * already holds: open sockets, recent registrations, recent stakes.
 */
export interface DemandSnapshot {
  /** Open authenticated sockets right now. */
  concurrentPlayers: number
  /** Distinct players who registered for anything in the last hour. */
  registeredLastHour: number
  /** Median head-to-head stake over the last hour, in cents. */
  medianStakeCents: number
  /** Rolling mean of (entrants / seats) across recent contests, 0..1+. */
  historicalFillRate: number
}

/**
 * Valid bracket sizes. Powers of two run clean single-elimination brackets
 * without byes; the intermediate sizes are permitted for Swiss and Arena,
 * which do not need a balanced tree.
 */
export const POWER_FIELDS = [4, 8, 16, 32, 64, 128, 256, 512] as const

export function nearestPowerField(n: number): number {
  let best = POWER_FIELDS[0] as number
  for (const f of POWER_FIELDS) {
    if (f <= n) best = f
  }
  return best
}

/**
 * Chooses a field size the contest can realistically fill.
 *
 * Deliberately conservative: an undersized event that fills feels busy and
 * costs nothing, an oversized one that runs at 30% either cancels or bills the
 * platform for overlay. Filling is worth more than capacity.
 */
export function sizeFieldForDemand(
  demand: DemandSnapshot,
  formatId: FormatId,
  targetCaptureRate = 0.25
): number {
  const format = FORMATS[formatId]

  const addressable = Math.max(demand.concurrentPlayers, demand.registeredLastHour)
  const expected = addressable * targetCaptureRate * Math.min(1.2, Math.max(0.4, demand.historicalFillRate))

  const raw = Math.floor(expected)
  const bounded = Math.min(format.maxField, Math.max(format.minField, raw))

  // Bracket formats need a clean tree.
  if (formatId === "single_elimination" || formatId === "satellite") {
    return Math.max(format.minField, nearestPowerField(bounded))
  }
  return bounded
}

// --- Registration windows ---------------------------------------------------

/**
 * A contest opens for registration with a floor and a ceiling rather than a
 * fixed field. The field commits at close, based on who actually signed up.
 *
 * This is the honest version of the queue idea: it captures the same demand
 * signal, but people register for a specific contest they want rather than
 * waiting for permission to browse, and nobody is blocked from the site.
 */
export interface RegistrationWindow {
  minField: number
  maxField: number
  opensAt: number
  closesAt: number
}

export interface FieldCommit {
  fieldSize: number
  /** Registrants who get a seat. */
  seated: number
  /** Registrants refunded because the committed field could not hold them. */
  refunded: number
  /** True if the floor was not reached and the contest cannot run. */
  cancelled: boolean
  reason: string
}

/**
 * Commits the field at registration close.
 *
 * Bracket formats snap down to a clean power of two and refund the overflow in
 * full. Refunding is the correct behaviour rather than seating everyone into a
 * lopsided bracket: a bye is a free win, and handing free wins to whoever
 * happened to register last is not a skill outcome.
 */
export function commitField(
  registrations: number,
  window: RegistrationWindow,
  formatId: FormatId
): FieldCommit {
  const format = FORMATS[formatId]
  const floor = Math.max(window.minField, format.minField)
  const ceiling = Math.min(window.maxField, format.maxField)

  if (registrations < floor) {
    return {
      fieldSize: 0,
      seated: 0,
      refunded: registrations,
      cancelled: true,
      reason: `Needed ${floor} entrants, got ${registrations}. Entry fees refunded in full.`,
    }
  }

  const capped = Math.min(registrations, ceiling)

  let fieldSize = capped
  if (formatId === "single_elimination" || formatId === "satellite") {
    fieldSize = Math.max(floor, nearestPowerField(capped))
  }

  const refunded = registrations - fieldSize
  return {
    fieldSize,
    seated: fieldSize,
    refunded,
    cancelled: false,
    reason:
      refunded > 0
        ? `Field committed at ${fieldSize}. ${refunded} late registrant${refunded > 1 ? "s" : ""} refunded in full.`
        : `Field committed at ${fieldSize}.`,
  }
}

// --- Sit-and-go -------------------------------------------------------------

/**
 * No schedule. Fires the moment the seat count is reached.
 *
 * This is the answer to thin liquidity: a scheduled event on a quiet night
 * fails visibly, a sit-and-go simply fills slower and nobody watches a
 * countdown expire.
 */
export interface SitAndGoSpec {
  fieldSize: number
  entryFeeCents: number
  formatId: FormatId
  rulesetId: string
  feeBps: number
}

export function planSitAndGo(
  demand: DemandSnapshot,
  formatId: FormatId,
  rulesetId: string
): SitAndGoSpec {
  const format = FORMATS[formatId]

  // Small by design. A sit-and-go that never fills is worse than one that
  // fills instantly and immediately reopens.
  const fieldSize =
    demand.concurrentPlayers >= 200
      ? Math.min(32, format.maxField)
      : demand.concurrentPlayers >= 60
        ? Math.min(16, format.maxField)
        : Math.min(8, format.maxField)

  const bounded = Math.max(format.minField, fieldSize)

  return {
    fieldSize: bounded,
    entryFeeCents: Math.max(100, Math.round(demand.medianStakeCents / 100) * 100),
    formatId,
    rulesetId,
    feeBps: contestFeeBps(formatId, bounded),
  }
}

// --- Milestone events -------------------------------------------------------

/**
 * The headline subsidised event.
 *
 * Spec: every $20,000 of realised platform profit unlocks a contest with a
 * $12,000 prize pool, of which the platform contributes $2,000. Entries fund
 * the remaining $10,000, so the entry fee falls out of the field size:
 *
 *     entry = $10,000 / field
 *
 * EXPOSURE WARNING — this is the part worth reading twice.
 *
 * A fixed $12,000 pool is a guarantee, and a guarantee that does not fill is
 * paid by the house. At half fill on a 100-seat field, entries bring $5,000
 * against a $12,000 pool: the platform pays $7,000, not $2,000. That is a 3.5x
 * blowout on the advertised cost, and it lands on exactly the events most
 * likely to be undersubscribed because their entry fee is highest.
 *
 * Two modes are provided:
 *
 *   'fixed_subsidy'  — pool = entries + $2,000. Exposure is exactly $2,000 at
 *                      any turnout. Pool floats, so a full field pays $12,000
 *                      and a half field pays $7,000. Cannot blow up.
 *
 *   'guaranteed_pool' — pool = $12,000 regardless of turnout. Marketing is
 *                      stronger, exposure is unbounded below full fill.
 *                      Only defensible when the field is sized from measured
 *                      concurrency with real margin.
 *
 * Default is fixed_subsidy. The guarantee is available but should be a
 * deliberate decision with the exposure number in front of you.
 */
/**
 * Entry ceiling for milestone events.
 *
 * Without this, entry = $10,000 / field means a thin night produces a $625
 * buy-in — an event nobody can afford, on precisely the night that most needed
 * something to draw a crowd. The ceiling inverts the relationship: the field
 * shrinks, the entry stays affordable, and the pool scales down with it.
 *
 * The subsidy stays fixed at $2,000, which makes a small milestone unusually
 * generous per seat. That is the correct incentive — a quiet night is when you
 * want the strongest reason to log in.
 */
export const MILESTONE_MAX_ENTRY_CENTS = 20_000 // $200
export const MILESTONE_MIN_ENTRY_CENTS = 1_000 // $10

export const MILESTONE_PROFIT_THRESHOLD_CENTS = 2_000_000 // $20,000
export const MILESTONE_TARGET_POOL_CENTS = 1_200_000 // $12,000
export const MILESTONE_SUBSIDY_CENTS = 200_000 // $2,000
export const MILESTONE_ENTRY_FUNDED_CENTS =
  MILESTONE_TARGET_POOL_CENTS - MILESTONE_SUBSIDY_CENTS // $10,000

export type MilestoneMode = "fixed_subsidy" | "guaranteed_pool"

export interface MilestonePlan {
  mode: MilestoneMode
  fieldSize: number
  entryFeeCents: number
  /** Pool if the field fills completely. */
  fullPoolCents: number
  subsidyCents: number
  /** Platform cost if the field fills. */
  exposureAtFullFillCents: number
  /** Platform cost at the given expected fill. */
  exposureAtExpectedFillCents: number
  expectedFillRate: number
  /** Entrant EV at full fill, uniform field. */
  entrantEvAtFullFillCents: number
  /** Fill rate below which the platform loses more than the intended subsidy. */
  breakEvenFillRate: number
}

/**
 * Field is chosen from measured demand, then the entry fee falls out of it.
 * Sizing conservatively is what keeps the guarantee affordable.
 */
export function planMilestoneEvent(
  demand: DemandSnapshot,
  mode: MilestoneMode = "fixed_subsidy"
): MilestonePlan {
  const addressable = Math.max(demand.concurrentPlayers, demand.registeredLastHour)

  // Milestone events draw better than routine contests, but they are also the
  // most expensive entry on the site. 15% capture is deliberately pessimistic.
  const expectedEntrants = Math.max(10, Math.floor(addressable * 0.15))

  const candidate = nearestPowerField(Math.max(16, expectedEntrants))
  const fieldSize = Math.min(256, candidate)

  // Entry falls out of field size, then is bounded and snapped to a clean
  // figure. Players read round numbers faster, which matters on a card they
  // scan before committing money.
  const rawEntry = MILESTONE_ENTRY_FUNDED_CENTS / fieldSize
  const bounded = Math.min(MILESTONE_MAX_ENTRY_CENTS, Math.max(MILESTONE_MIN_ENTRY_CENTS, rawEntry))
  const entryFeeCents = snapEntryFee(bounded)

  const expectedFillRate = Math.min(1, expectedEntrants / fieldSize)

  if (mode === "fixed_subsidy") {
    // Pool floats with turnout; the platform's contribution never moves.
    const fullPoolCents = entryFeeCents * fieldSize + MILESTONE_SUBSIDY_CENTS
    return {
      mode,
      fieldSize,
      entryFeeCents,
      fullPoolCents,
      subsidyCents: MILESTONE_SUBSIDY_CENTS,
      exposureAtFullFillCents: MILESTONE_SUBSIDY_CENTS,
      exposureAtExpectedFillCents: MILESTONE_SUBSIDY_CENTS,
      expectedFillRate,
      entrantEvAtFullFillCents: Math.round(fullPoolCents / fieldSize) - entryFeeCents,
      breakEvenFillRate: 0,
    }
  }

  // Guaranteed pool: every unsold seat is paid by the platform.
  const guaranteedPool = MILESTONE_TARGET_POOL_CENTS
  const entriesAtExpected = Math.floor(fieldSize * expectedFillRate) * entryFeeCents
  const exposureAtExpected = Math.max(0, guaranteedPool - entriesAtExpected)

  return {
    mode,
    fieldSize,
    entryFeeCents,
    fullPoolCents: guaranteedPool,
    subsidyCents: MILESTONE_SUBSIDY_CENTS,
    exposureAtFullFillCents: MILESTONE_SUBSIDY_CENTS,
    exposureAtExpectedFillCents: exposureAtExpected,
    expectedFillRate,
    entrantEvAtFullFillCents: Math.round(guaranteedPool / fieldSize) - entryFeeCents,
    breakEvenFillRate: MILESTONE_ENTRY_FUNDED_CENTS / (fieldSize * entryFeeCents),
  }
}

/**
 * Snaps an entry fee to a figure players recognise. Always rounds down, so
 * snapping never raises the price of entry.
 */
export function snapEntryFee(cents: number): number {
  const steps = [
    100, 200, 500, 1_000, 2_000, 2_500, 5_000, 7_500,
    10_000, 15_000, 20_000, 25_000, 50_000, 100_000,
  ]
  let best = steps[0] as number
  for (const s of steps) {
    if (s <= cents) best = s
  }
  return best
}

export function milestonesEarned(realisedProfitCents: number): number {
  return Math.floor(realisedProfitCents / MILESTONE_PROFIT_THRESHOLD_CENTS)
}

export function progressToNextMilestone(realisedProfitCents: number): {
  currentCents: number
  targetCents: number
  fraction: number
} {
  const currentCents = realisedProfitCents % MILESTONE_PROFIT_THRESHOLD_CENTS
  return {
    currentCents,
    targetCents: MILESTONE_PROFIT_THRESHOLD_CENTS,
    fraction: currentCents / MILESTONE_PROFIT_THRESHOLD_CENTS,
  }
}
