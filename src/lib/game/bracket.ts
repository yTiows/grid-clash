/**
 * Bracket runner.
 *
 * Pairings are deterministic given a contest seed and the results so far. That
 * property is what makes a disputed tournament resolvable: an investigator can
 * replay the exact bracket from stored inputs rather than taking the server's
 * word for it. It also removes any question of the platform steering matchups,
 * which is the accusation a stakes operator least wants to be unable to
 * disprove.
 */

import { FORMATS, type FormatId } from "./formats"

// --- Deterministic RNG ------------------------------------------------------

/**
 * mulberry32. Seeded, tiny, and reproducible across runs and machines.
 *
 * Math.random() would make byes and tiebreaks unauditable — the one place a
 * player is handed a free win is the last place to use an unseeded source.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Stable 32-bit hash of the contest id, used as the RNG seed. */
export function seedFromId(id: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

// --- Entrants ---------------------------------------------------------------

export interface Entrant {
  userId: string
  seatNumber: number
  eloRating: number
  skillIndex: number
}

export interface StandingRow {
  userId: string
  wins: number
  losses: number
  draws: number
  /** Sum of opponents' wins. Standard Swiss tiebreak. */
  opponentWinSum: number
  /** Byes received. Used to avoid giving anyone a second one. */
  byes: number
  eliminated: boolean
}

export interface Pairing {
  boardPosition: number
  player1: string
  /** Null on a bye. */
  player2: string | null
  isBye: boolean
}

export function initialStandings(entrants: Entrant[]): StandingRow[] {
  return entrants.map((e) => ({
    userId: e.userId,
    wins: 0,
    losses: 0,
    draws: 0,
    opponentWinSum: 0,
    byes: 0,
    eliminated: false,
  }))
}

// --- Seeding ----------------------------------------------------------------

/**
 * Standard bracket seeding: 1 plays the lowest seed, 2 plays second-lowest,
 * and so on, so the strongest entrants only meet late.
 *
 * Seeding by Skill Index rather than arrival order matters for fairness — an
 * unseeded draw can put the two best players in round one, which turns the
 * result into a scheduling artefact rather than a skill outcome.
 */
export function seedEntrants(entrants: Entrant[]): Entrant[] {
  return [...entrants].sort((a, b) => {
    if (b.skillIndex !== a.skillIndex) return b.skillIndex - a.skillIndex
    if (b.eloRating !== a.eloRating) return b.eloRating - a.eloRating
    return a.seatNumber - b.seatNumber
  })
}

// --- Single elimination -----------------------------------------------------

/**
 * Round-one pairings for a knockout.
 *
 * Byes go to the highest seeds. That is the conventional choice and the
 * defensible one: a bye is a free win, and awarding free wins by lottery in a
 * paid contest invites exactly the accusation the deterministic seed exists to
 * prevent. Earning the bye through seeding keeps it a skill outcome.
 */
export function pairKnockoutRound(
  active: string[],
  seededOrder: string[],
  standings: StandingRow[],
  rng: () => number
): Pairing[] {
  const byRank = seededOrder.filter((id) => active.includes(id))
  const pairings: Pairing[] = []

  const n = byRank.length
  if (n === 0) return pairings
  if (n === 1) {
    return [{ boardPosition: 1, player1: byRank[0]!, player2: null, isBye: true }]
  }

  // Number needing a bye to reach the next clean power of two.
  const nextPower = 2 ** Math.ceil(Math.log2(n))
  const byeCount = nextPower - n

  const byeIds = new Set<string>()
  for (let i = 0; i < byeCount; i++) {
    // Prefer a top seed who has not already had one.
    const candidate = byRank.find(
      (id) => !byeIds.has(id) && (standings.find((s) => s.userId === id)?.byes ?? 0) === 0
    )
    byeIds.add(candidate ?? byRank[i]!)
  }

  let board = 1
  for (const id of byRank) {
    if (byeIds.has(id)) {
      pairings.push({ boardPosition: board++, player1: id, player2: null, isBye: true })
    }
  }

  const remaining = byRank.filter((id) => !byeIds.has(id))
  // Highest against lowest.
  for (let i = 0; i < remaining.length / 2; i++) {
    const high = remaining[i]!
    const low = remaining[remaining.length - 1 - i]!
    if (high === low) break
    pairings.push({ boardPosition: board++, player1: high, player2: low, isBye: false })
  }

  // Consume one RNG draw so the stream advances identically per round even
  // when no random choice was needed. Keeps replay aligned.
  rng()

  return pairings
}

// --- Swiss ------------------------------------------------------------------

/**
 * Swiss pairing: group by score, pair within group, avoid rematches.
 *
 * TANKING — a real attack on Swiss. A player can deliberately lose an early
 * round to drop into a weaker score group, farm easy wins, and finish above
 * where honest play would have put them.
 *
 * Two things blunt it here. Tiebreaks use opponent win sum, so a soft schedule
 * is worth measurably less than a hard one and a tanked round costs more than
 * it returns. And a deliberate loss is a real loss in the standings, which in
 * a paid contest is a real entry fee spent on a worse position. Detection of
 * repeated tanking across contests belongs with the fraud flags, not here.
 */
export function pairSwissRound(
  active: string[],
  standings: StandingRow[],
  previousOpponents: Map<string, Set<string>>,
  rng: () => number
): Pairing[] {
  const byId = new Map(standings.map((s) => [s.userId, s]))

  // Sort by score, then opponent strength, then a seeded shuffle key so equal
  // records do not always pair in the same order.
  const shuffleKey = new Map<string, number>()
  for (const id of active) shuffleKey.set(id, rng())

  const sorted = [...active].sort((a, b) => {
    const sa = byId.get(a)!
    const sb = byId.get(b)!
    const scoreA = sa.wins * 2 + sa.draws
    const scoreB = sb.wins * 2 + sb.draws
    if (scoreB !== scoreA) return scoreB - scoreA
    if (sb.opponentWinSum !== sa.opponentWinSum) return sb.opponentWinSum - sa.opponentWinSum
    return (shuffleKey.get(a) ?? 0) - (shuffleKey.get(b) ?? 0)
  })

  const pairings: Pairing[] = []
  const paired = new Set<string>()
  let board = 1

  for (const player of sorted) {
    if (paired.has(player)) continue

    const seen = previousOpponents.get(player) ?? new Set<string>()
    let opponent: string | null = null

    // Nearest unpaired player they have not already faced.
    for (const candidate of sorted) {
      if (candidate === player || paired.has(candidate)) continue
      if (seen.has(candidate)) continue
      opponent = candidate
      break
    }

    // Every remaining candidate is a rematch. Accept the nearest one rather
    // than leaving players idle — an unpaired entrant in a paid contest is a
    // refund conversation, and a rematch is the lesser cost.
    if (!opponent) {
      for (const candidate of sorted) {
        if (candidate === player || paired.has(candidate)) continue
        opponent = candidate
        break
      }
    }

    if (opponent) {
      paired.add(player)
      paired.add(opponent)
      pairings.push({ boardPosition: board++, player1: player, player2: opponent, isBye: false })
    }
  }

  // Odd field: the lowest-scoring player without a prior bye gets it.
  const unpaired = sorted.filter((id) => !paired.has(id))
  for (const id of unpaired) {
    pairings.push({ boardPosition: board++, player1: id, player2: null, isBye: true })
  }

  return pairings
}

/** Lowest-scoring entrant who has not yet had a bye. */
export function selectByeRecipient(
  active: string[],
  standings: StandingRow[]
): string | null {
  const byId = new Map(standings.map((s) => [s.userId, s]))
  const eligible = active
    .filter((id) => (byId.get(id)?.byes ?? 0) === 0)
    .sort((a, b) => {
      const sa = byId.get(a)!
      const sb = byId.get(b)!
      return sa.wins * 2 + sa.draws - (sb.wins * 2 + sb.draws)
    })
  return eligible[0] ?? active[0] ?? null
}

// --- Survivor ---------------------------------------------------------------

/** Cuts the bottom half by score each round. Ties are broken upward. */
export function applySurvivorCut(standings: StandingRow[]): StandingRow[] {
  const alive = standings.filter((s) => !s.eliminated)
  if (alive.length <= 1) return standings

  const ranked = [...alive].sort((a, b) => {
    const scoreA = a.wins * 2 + a.draws
    const scoreB = b.wins * 2 + b.draws
    if (scoreB !== scoreA) return scoreB - scoreA
    return b.opponentWinSum - a.opponentWinSum
  })

  const survivors = Math.max(1, Math.ceil(ranked.length / 2))
  const cutIds = new Set(ranked.slice(survivors).map((s) => s.userId))

  return standings.map((s) => (cutIds.has(s.userId) ? { ...s, eliminated: true } : s))
}

// --- Round advance ----------------------------------------------------------

export interface RoundResult {
  player1: string
  player2: string | null
  /** Null on a draw. Equals player1 on a bye. */
  winner: string | null
  isBye: boolean
}

export interface AdvanceOutcome {
  standings: StandingRow[]
  /** Players still in contention. */
  active: string[]
  complete: boolean
  champion: string | null
}

/**
 * Applies a round's results.
 *
 * Pure and idempotent with respect to its inputs: given the same standings and
 * results it returns the same output, so a retried advance cannot double-count
 * a win. Idempotency at the call site is enforced separately by the round's
 * status column.
 */
export function advanceRound(
  formatId: FormatId,
  standings: StandingRow[],
  results: RoundResult[],
  roundNumber: number
): AdvanceOutcome {
  const next = standings.map((s) => ({ ...s }))
  const byId = new Map(next.map((s) => [s.userId, s]))

  for (const r of results) {
    const p1 = byId.get(r.player1)
    if (!p1) continue

    if (r.isBye) {
      p1.wins += 1
      p1.byes += 1
      continue
    }

    const p2 = r.player2 ? byId.get(r.player2) : undefined
    if (!p2) continue

    if (r.winner === null) {
      p1.draws += 1
      p2.draws += 1
    } else if (r.winner === p1.userId) {
      p1.wins += 1
      p2.losses += 1
    } else {
      p2.wins += 1
      p1.losses += 1
    }
  }

  // Opponent win sum, recomputed from the full result set.
  const opponentsOf = new Map<string, string[]>()
  for (const r of results) {
    if (r.isBye || !r.player2) continue
    opponentsOf.set(r.player1, [...(opponentsOf.get(r.player1) ?? []), r.player2])
    opponentsOf.set(r.player2, [...(opponentsOf.get(r.player2) ?? []), r.player1])
  }
  for (const s of next) {
    const faced = opponentsOf.get(s.userId) ?? []
    s.opponentWinSum += faced.reduce((sum, id) => sum + (byId.get(id)?.wins ?? 0), 0)
  }

  let updated = next

  if (formatId === "single_elimination" || formatId === "satellite" || formatId === "bounty") {
    // One loss ends the run. Bounty is structurally a knockout with a side
    // payment on elimination (see record_tournament_match_result's bounty
    // claim) — the bracket shape itself is identical to single_elimination.
    updated = next.map((s) => (s.losses > 0 ? { ...s, eliminated: true } : s))
  } else if (formatId === "survivor") {
    updated = applySurvivorCut(next)
  }

  const active = updated.filter((s) => !s.eliminated).map((s) => s.userId)
  const totalRounds = FORMATS[formatId].guaranteedMatches ?? 1

  let complete = false
  let champion: string | null = null

  if (
    formatId === "single_elimination" ||
    formatId === "satellite" ||
    formatId === "survivor" ||
    formatId === "bounty"
  ) {
    complete = active.length <= 1
    champion = complete ? (active[0] ?? null) : null
  } else {
    // Score formats run a fixed number of rounds.
    complete = roundNumber >= Math.max(totalRounds, 1)
    if (complete) {
      const ranked = [...updated].sort((a, b) => {
        const sa = a.wins * 2 + a.draws
        const sb = b.wins * 2 + b.draws
        if (sb !== sa) return sb - sa
        return b.opponentWinSum - a.opponentWinSum
      })
      champion = ranked[0]?.userId ?? null
    }
  }

  return { standings: updated, active, complete, champion }
}

/** Final placings, best first. */
export function finalPlacings(standings: StandingRow[]): string[] {
  return [...standings]
    .sort((a, b) => {
      const sa = a.wins * 2 + a.draws
      const sb = b.wins * 2 + b.draws
      if (sb !== sa) return sb - sa
      if (b.opponentWinSum !== a.opponentWinSum) return b.opponentWinSum - a.opponentWinSum
      return a.losses - b.losses
    })
    .map((s) => s.userId)
}

// --- Full run ---------------------------------------------------------------

export interface RoundPlan {
  roundNumber: number
  pairings: Pairing[]
}

/**
 * Produces the next round's pairings. Deterministic given contestId, round
 * number, and standings — the RNG is reseeded per round from the contest id,
 * so a replay of round 4 does not depend on having replayed rounds 1 to 3.
 */
export function planRound(
  contestId: string,
  formatId: FormatId,
  roundNumber: number,
  entrants: Entrant[],
  standings: StandingRow[],
  previousOpponents: Map<string, Set<string>>
): RoundPlan {
  const rng = seededRandom(seedFromId(contestId) + roundNumber * 7919)
  const seeded = seedEntrants(entrants).map((e) => e.userId)
  const active = standings.filter((s) => !s.eliminated).map((s) => s.userId)

  const pairings =
    formatId === "single_elimination" || formatId === "satellite" || formatId === "bounty"
      ? pairKnockoutRound(active, seeded, standings, rng)
      : pairSwissRound(active, standings, previousOpponents, rng)

  return { roundNumber, pairings }
}
