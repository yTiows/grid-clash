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

import { FORMATS, swissRounds, type FormatId } from "./formats"

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

  // Odd field: the lowest-scoring player without a prior bye gets it. The
  // pairing loop above always leaves the single lowest-scored player
  // unpaired, with no regard for whether they already had a bye —
  // selectByeRecipient below implements the real "no second bye" rule but
  // was never actually wired into this path, so a repeat bottom-of-the-
  // standings player could draw two or more free-win byes across an event.
  // If the natural odd-one-out already had a bye, swap them into the
  // lowest-scored zero-bye player's pairing instead (a rematch, same
  // tradeoff already accepted above rather than leaving someone idle) and
  // give the actual bye to the zero-bye player.
  let unpaired = sorted.filter((id) => !paired.has(id))
  if (unpaired.length === 1 && (byId.get(unpaired[0]!)?.byes ?? 0) > 0) {
    const oddOut = unpaired[0]!
    const swapCandidate = sorted.find(
      (id) => paired.has(id) && id !== oddOut && (byId.get(id)?.byes ?? 0) === 0
    )
    const swapPairing = swapCandidate
      ? pairings.find((p) => !p.isBye && (p.player1 === swapCandidate || p.player2 === swapCandidate))
      : undefined
    if (swapCandidate && swapPairing) {
      if (swapPairing.player1 === swapCandidate) swapPairing.player1 = oddOut
      else swapPairing.player2 = oddOut
      unpaired = [swapCandidate]
    }
  }
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

  if (formatId === "single_elimination" || formatId === "satellite" || formatId === "bounty" || formatId === "arena") {
    // One loss ends the run. Bounty is structurally a knockout with a side
    // payment on elimination (see record_tournament_match_result's bounty
    // claim) — the bracket shape itself is identical to single_elimination.
    // Arena is routed here too — see the note on planRound's pairing
    // dispatcher below for why "winner stays on" isn't actually implemented.
    updated = next.map((s) => (s.losses > 0 ? { ...s, eliminated: true } : s))
  } else if (formatId === "survivor" && roundNumber >= 3) {
    // formats.ts's own rakeRationale for Survivor is "guarantees at least
    // three rounds before any cut" — that's the entire justification for
    // its rake sitting above Knockout's. This used to cut the bottom half
    // after every round unconditionally, including round 1, contradicting
    // the guarantee the higher rate is priced on.
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
    formatId === "bounty" ||
    formatId === "arena"
  ) {
    complete = active.length <= 1
    champion = complete ? (active[0] ?? null) : null
  } else {
    // Score formats run a number of rounds. Swiss's is field-size-
    // dependent (swissRounds — 3 rounds at an 8-player field, up to 9 at
    // 512) because that's what planTournament (formats.ts) already
    // computed and priced the contest card's higher rake on ("every
    // entrant plays all rounds regardless of record"). The static
    // FORMATS[formatId].guaranteedMatches=5 default below used to be the
    // only number read here, so anything outside roughly a 17-32 player
    // field ran a different tournament than the one it was sold as: a
    // small field played extra unplanned rounds, a large field got cut
    // off early with dozens of players tied at a perfect record, deciding
    // the "champion" by tiebreak instead of the rounds that were supposed
    // to separate them. Standings never shrink for Swiss (nobody's
    // eliminated), so standings.length is the field size at any round.
    const roundsForFormat = formatId === "swiss" ? swissRounds(standings.length) : totalRounds
    complete = roundNumber >= Math.max(roundsForFormat, 1)
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

/**
 * Recomputes opponentWinSum from each opponent's FINAL win total, not the
 * incremental snapshot advanceRound accumulates round by round above (which
 * credits an opponent's win count as of the moment they were played, e.g. 1
 * if faced right after their round-1 win, 2 if faced right after round 2 —
 * even for the exact same opponent finishing the event with an identical
 * final record). A standard Buchholz tiebreak sums opponents' FINAL scores
 * specifically so two players who faced equivalent opposition get
 * equivalent credit regardless of which round they happened to play them
 * in; the incremental version instead rewards facing an opponent before
 * they get hot.
 *
 * Call this once, after the last round, before finalPlacings() — it decides
 * real-money payout order, so it needs the correct number. advanceRound's
 * running total is left as-is for mid-event display, where there's no
 * "final" opponent score to sum yet anyway.
 */
export function finalOpponentWinSums(
  standings: StandingRow[],
  previousOpponents: Map<string, Set<string>>
): StandingRow[] {
  const winsById = new Map(standings.map((s) => [s.userId, s.wins]))
  return standings.map((s) => {
    const faced = previousOpponents.get(s.userId)
    if (!faced) return s
    let sum = 0
    for (const opponentId of faced) sum += winsById.get(opponentId) ?? 0
    return { ...s, opponentWinSum: sum }
  })
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
 * number, and the final entrant list — still fully replayable (an
 * investigator has all three from storage), but no longer precomputable
 * before registration closes. Seeding from contestId alone let anyone with
 * influence over contestId (a private event's host-chosen slug, say) brute-
 * force the ~4 billion 32-bit hash space offline for one that hands
 * themselves a favorable bye or pairing, then create the event under that
 * id — the same determinism that makes a bracket auditable after the fact
 * also made it riggable in advance. Folding in the entrant list closes that
 * specific hole: nobody knows the full field, and so can't compute this
 * seed, until registration is closed and pairings are actually about to be
 * drawn.
 */
export function planRound(
  contestId: string,
  formatId: FormatId,
  roundNumber: number,
  entrants: Entrant[],
  standings: StandingRow[],
  previousOpponents: Map<string, Set<string>>
): RoundPlan {
  const fieldFingerprint = seedFromId([...entrants].map((e) => e.userId).sort().join(","))
  const rng = seededRandom((seedFromId(contestId) ^ fieldFingerprint) + roundNumber * 7919)
  const seeded = seedEntrants(entrants).map((e) => e.userId)
  const active = standings.filter((s) => !s.eliminated).map((s) => s.userId)

  /**
   * Arena is routed through the knockout pairer/eliminator, not a real
   * "winner stays on" ladder. A literal king-of-the-hill format — one
   * champion seat, challengers queued one at a time, N-1 total sequential
   * matches (formats.ts's planTournament already computes fieldSize-1 for
   * this reason) — is a genuinely different scheduling shape than every
   * other format here: this whole file is built around simultaneous
   * per-round pairings (RoundPlan) resolved as a batch, and a single
   * ongoing seat doesn't fit that shape without a different runner. Before
   * this fix, "arena" matched neither the knockout list above nor the
   * active.length<=1 completion check below, so it fell into the shared
   * "score formats run guaranteedMatches rounds" branch with
   * guaranteedMatches hardcoded to 1 — a real-money contest that priced
   * itself as a 1v1 streak-based format but actually paired the whole
   * field once and crowned whichever tied player happened to sort first.
   * Knockout is a real, already-correct multi-round bracket that at least
   * decides a genuine champion through actual play; it doesn't preserve
   * the literal "break the streak" fantasy (see the arena blurb in
   * formats.ts, which should be revisited alongside a real sequential
   * runner if that fantasy still matters more than shipping a working fix
   * now).
   */
  const pairings =
    formatId === "single_elimination" || formatId === "satellite" || formatId === "bounty" || formatId === "arena"
      ? pairKnockoutRound(active, seeded, standings, rng)
      : pairSwissRound(active, standings, previousOpponents, rng)

  return { roundNumber, pairings }
}
