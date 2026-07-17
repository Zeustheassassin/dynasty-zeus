/**
 * Personal Rankings — pure helpers.
 *
 * The user keeps their own ordered board of players (usePersonalRankings). The
 * gap between where THEY rank a player and where the market (consensus) ranks him
 * becomes a buy/sell signal that drives the Trade Finder, replacing the old manual
 * player_dispositions dropdowns.
 *
 * Everything here is a pure function (no React, no IO) so it is trivially testable
 * and shared by both the DataHub "Personal" view and the Trade Finder.
 */

export type PersonalSignal =
  | "STRONG_SELL"
  | "SELL"
  | "NEUTRAL"
  | "BUY"
  | "STRONG_BUY";

export interface PersonalSignalThresholds {
  /** gap% ≥ this ⇒ SELL/BUY. gap% = |personalRank − consensusRank| / consensusRank × 100. */
  sellPct: number;
  /** gap% ≥ this ⇒ STRONG (Super) SELL/BUY — the tier the Trade Finder hard-blocks. */
  strongPct: number;
  /** Absolute rank-gap floor: |delta| < this ⇒ always NEUTRAL, regardless of %. */
  minGap: number;
  /** Consensus ranks ≤ this get the small-delta STRONG guard below. */
  topGuardRank: number;
  /** Within `topGuardRank`, a |delta| < this caps at SELL/BUY (never STRONG). */
  topGuardStrongGap: number;
}

/**
 * Default percentage bands. The gap is measured RELATIVE to where the market
 * ranks the player, matching the user's mental model: "market has him at 200, I
 * have him at 230 → 15% off → Sell". A flat rank delta was the old model; a
 * percentage keeps a 10-spot disagreement meaningful deep on the board without
 * firing on every minor shuffle.
 *
 * The `minGap` floor (6) guards the top of the board: a percentage alone makes
 * elite players hypersensitive (at rank 10, 20% is only 2 spots). Requiring at
 * least a 6-spot disagreement before any signal protects roughly ranks 1–50,
 * since at rank 50 the 12% threshold already equals 6 spots — above that the %
 * dominates, below it the floor does.
 *
 * The top guard layers on top of that: inside the top 25, even a 6–8 spot move is
 * a large % but only a modest real disagreement, so it caps at SELL/BUY — reaching
 * Super (STRONG) up there needs a 9+ spot gap.
 */
export const DEFAULT_PERSONAL_SIGNAL_THRESHOLDS: PersonalSignalThresholds = {
  sellPct: 12,
  strongPct: 20,
  minGap: 6,
  topGuardRank: 25,
  topGuardStrongGap: 9,
};

/**
 * Map a personal-vs-consensus rank gap to a buy/sell signal.
 *
 * delta = personalRank − consensusRank (both 1-based; lower rank = better player).
 * gap% = |delta| / consensusRank × 100 — the disagreement as a fraction of the
 * MARKET rank (so "market 200, me 230" is 15%, not a raw 30):
 *   • |delta| below minGap ⇒ NEUTRAL (the top-of-board floor, applied first).
 *   • delta > 0 → you rank him WORSE than the market ⇒ SELL side (shop him, don't buy).
 *   • delta < 0 → you rank him BETTER than the market ⇒ BUY side (target him, don't sell).
 *   • gap% below sellPct ⇒ NEUTRAL.
 *   • inside the top `topGuardRank`, |delta| < `topGuardStrongGap` caps at SELL/BUY.
 *
 * The STRONG_* tier (gap% ≥ strongPct) is what the Trade Finder treats as a hard
 * block on the opposite action: never buy a STRONG_SELL, never sell a STRONG_BUY.
 * SELL/BUY are soft weightings.
 */
export function derivePersonalSignal(
  personalRank: number,
  consensusRank: number,
  thresholds: PersonalSignalThresholds = DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
): PersonalSignal {
  const delta = personalRank - consensusRank;
  const mag = Math.abs(delta);
  // Absolute floor first — protects the top of the board from tiny-but-high-%
  // disagreements (rank 10 ± 1 spot = 10%, but it's noise).
  if (mag < thresholds.minGap) return "NEUTRAL";
  // Then the percentage gap, relative to the market rank; guard consensusRank ≤ 0.
  const gapPct = consensusRank > 0 ? (mag / consensusRank) * 100 : 0;
  if (gapPct < thresholds.sellPct) return "NEUTRAL";
  // Top-of-board guard: in the top N a 6–8 spot move is a big % but a small real
  // disagreement, so it stays SELL/BUY — Super needs topGuardStrongGap+ spots.
  const strongOk =
    gapPct >= thresholds.strongPct &&
    !(consensusRank <= thresholds.topGuardRank && mag < thresholds.topGuardStrongGap);
  if (delta > 0) return strongOk ? "STRONG_SELL" : "SELL";
  return strongOk ? "STRONG_BUY" : "BUY";
}

/**
 * Reconcile a stored personal ordering against the current consensus universe.
 *
 * - First use (stored empty) ⇒ seed from the consensus order, so every player
 *   starts NEUTRAL (personalRank == consensusRank).
 * - Players the user has ordered keep that order, minus any who have left the
 *   universe (retired / filtered out).
 * - Players new to the universe (e.g. fresh rookies) are spliced in at their
 *   consensus index, so an as-yet-unranked newcomer reads ≈ NEUTRAL instead of as
 *   a huge false SELL at the bottom of the board.
 *
 * The newcomer placement is exact: because every consensus player before index
 * `i` is already in `result` by the time we reach `i` (kept from stored, or an
 * earlier newcomer already spliced), splicing at index `i` lands the newcomer at
 * personalRank `i + 1` = its consensusRank, and later splices (at higher indices)
 * never disturb it.
 *
 * @param stored          The user's persisted ordering (array of player_ids).
 * @param consensusOrder  The current market board, best-to-worst player_ids.
 * @returns               A reconciled ordering covering exactly the universe.
 */
export function reconcilePersonalOrdering(
  stored: string[],
  consensusOrder: string[],
): string[] {
  if (stored.length === 0) return [...consensusOrder];

  const universe = new Set(consensusOrder);
  // Dedupe (defensive against corrupt localStorage) and drop players who have
  // left the universe, preserving the user's order.
  const result: string[] = [];
  const present = new Set<string>();
  for (const id of stored) {
    if (universe.has(id) && !present.has(id)) {
      result.push(id);
      present.add(id);
    }
  }

  consensusOrder.forEach((id, consensusIdx) => {
    if (present.has(id)) return;
    result.splice(Math.min(consensusIdx, result.length), 0, id);
    present.add(id);
  });

  return result;
}

/**
 * Build the market-consensus order (best-to-worst player_ids) from the player
 * universe and a value accessor. Shared by the DataHub Personal view and the
 * Trade-Finder signal map so the two never drift: same filter (skill positions
 * with a positive dynasty value), same sort (value descending).
 */
export function buildConsensusOrder(
  players: Record<string, { player_id: string; position: string }>,
  valueOf: (id: string) => number,
): string[] {
  return Object.values(players)
    .filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position))
    .filter((p) => valueOf(p.player_id) > 0)
    .sort((a, b) => valueOf(b.player_id) - valueOf(a.player_id))
    .map((p) => p.player_id);
}

/**
 * Disposition shape consumed by the Trade Finder (sell/buy strings). The Finder's
 * tuned scoring + block predicates key off these exact strings; the adapter below
 * lets the Personal-rankings signal feed that engine unchanged.
 */
export interface DispositionPair {
  sell: string;
  buy: string;
}

/**
 * Adapt a single personal buy/sell signal to the legacy disposition contract the
 * Trade Finder scores against. The mapping is a clean monotonic ladder mirrored
 * across the two axes:
 *
 *   STRONG_SELL → sell "Trade at All Costs" (+4) · buy "Zero Interest" (BLOCK receive)
 *   SELL        → sell "Lower than Market"  (+2) · buy "Neutral"
 *   NEUTRAL     → sell "Neutral"            (+1) · buy "Neutral"
 *   BUY         → sell "Neutral"                 · buy "Buy at Market"  (+2)
 *   STRONG_BUY  → sell "Will Trade but Higher than Market" (-1) · buy "Buy Over Market" (+4)
 *
 * Note what this deliberately yields for the Finder's block predicates: STRONG_SELL
 * hard-blocks ACQUIRING the player ("Zero Interest"), while NOTHING here ever emits
 * "Not Willing to Trade" — so the sell-side hard block collapses to CORE-tag-only,
 * exactly the Phase-3 target. (Stage 6 then reads the signal directly and drops the
 * string round-trip.)
 */
export function personalSignalToDisposition(signal: PersonalSignal): DispositionPair {
  switch (signal) {
    case "STRONG_SELL": return { sell: "Trade at All Costs", buy: "Zero Interest" };
    case "SELL":        return { sell: "Lower than Market", buy: "Neutral" };
    case "BUY":         return { sell: "Neutral", buy: "Buy at Market" };
    case "STRONG_BUY":  return { sell: "Will Trade but Higher than Market", buy: "Buy Over Market" };
    case "NEUTRAL":
    default:            return { sell: "Neutral", buy: "Neutral" };
  }
}

/**
 * Build the raw personal buy/sell SIGNAL map the Trade Finder reads, derived
 * entirely from the user's personal ordering vs. the market consensus. Reconciles
 * first (so the map covers the live universe and untouched players read NEUTRAL),
 * then emits a signal only for NON-neutral players — the Finder treats any missing
 * entry as NEUTRAL, so a sparse map is both smaller and semantically identical.
 *
 * This is the canonical output: the Finder's block predicates read these signals
 * directly (STRONG_SELL ⇒ never acquire), and buildPersonalDispositions adapts the
 * same map to the legacy string contract the tuned scoring still keys off of.
 */
export function buildPersonalSignals(
  personalOrdering: string[],
  consensusOrder: string[],
  thresholds: PersonalSignalThresholds = DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
): Record<string, PersonalSignal> {
  const order = reconcilePersonalOrdering(personalOrdering, consensusOrder);
  const consensusRank = new Map<string, number>();
  consensusOrder.forEach((id, i) => consensusRank.set(id, i + 1));

  const out: Record<string, PersonalSignal> = {};
  order.forEach((id, i) => {
    const cr = consensusRank.get(id);
    if (cr == null) return; // outside the consensus universe — no signal
    const signal = derivePersonalSignal(i + 1, cr, thresholds);
    if (signal === "NEUTRAL") return; // default; keep the map sparse
    out[id] = signal;
  });
  return out;
}

/**
 * Build the raw personal-vs-consensus rank gap for every player in the
 * reconciled universe (vsMkt = consensusRank − personalRank; positive means
 * you rank the player HIGHER than the market — a buy signal). Same shape and
 * reconciliation as buildPersonalSignals, but the numeric delta instead of
 * the derived signal — for UI that shows the raw "+4 / -3" gap (RankingsTab's
 * "vs Mkt" column, and the Trade Finder cards). Zero-gap entries are omitted
 * to keep the map sparse; missing entries read as 0.
 */
export function buildPersonalRankGaps(
  personalOrdering: string[],
  consensusOrder: string[],
): Record<string, number> {
  const order = reconcilePersonalOrdering(personalOrdering, consensusOrder);
  const consensusRank = new Map<string, number>();
  consensusOrder.forEach((id, i) => consensusRank.set(id, i + 1));

  const out: Record<string, number> = {};
  order.forEach((id, i) => {
    const cr = consensusRank.get(id);
    if (cr == null) return;
    const gap = cr - (i + 1);
    if (gap !== 0) out[id] = gap;
  });
  return out;
}

/**
 * Build the disposition map the Trade Finder's tuned SCORING consumes, derived
 * entirely from the user's personal ordering vs. the market consensus. A thin
 * adapter over buildPersonalSignals so the two representations can never drift:
 * same sparse universe (NEUTRAL omitted — the Finder defaults missing entries to
 * "Neutral"), just translated to the legacy sell/buy string contract.
 *
 * This is the Phase-2 swap: it replaces the manual player_dispositions dropdowns as
 * the Finder's buy/sell opinion input while reusing every bit of the tuned scoring.
 */
export function buildPersonalDispositions(
  personalOrdering: string[],
  consensusOrder: string[],
  thresholds: PersonalSignalThresholds = DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
): Record<string, DispositionPair> {
  const signals = buildPersonalSignals(personalOrdering, consensusOrder, thresholds);
  const out: Record<string, DispositionPair> = {};
  for (const [id, signal] of Object.entries(signals)) {
    out[id] = personalSignalToDisposition(signal);
  }
  return out;
}

/**
 * Move `playerId` to 1-based `targetRank` within an ordering, returning a new
 * contiguous 1..N array. Drives both drag-to-reorder (target = drop position) and
 * the type-a-number-to-jump input. Out-of-range targets clamp into [1, length];
 * an unknown id is a no-op (returns the input array unchanged).
 */
export function moveInOrdering(
  ordering: string[],
  playerId: string,
  targetRank: number,
): string[] {
  if (ordering.indexOf(playerId) === -1) return ordering;
  const rest = ordering.filter((id) => id !== playerId);
  const insertIndex = Math.min(Math.max(Math.round(targetRank) - 1, 0), rest.length);
  return [...rest.slice(0, insertIndex), playerId, ...rest.slice(insertIndex)];
}

/**
 * Re-sort a 1-based personal-rank RANGE (e.g. 280–350) into market-consensus
 * order, leaving every rank outside the range untouched. This does not move
 * players to their exact consensus rank number (that's `moveInOrdering` /
 * per-row reset) — it just relatively re-orders the players already occupying
 * that slice of the personal board so they read best-to-worst by market
 * value, in the same slots.
 *
 * @param ordering       The current personal ordering (array of player_ids).
 * @param consensusRank  player_id → 1-based market rank (lower = better).
 * @param startRank      1-based inclusive start of the range (either bound order is fine).
 * @param endRank        1-based inclusive end of the range.
 */
export function sortRangeByMarket(
  ordering: string[],
  consensusRank: Map<string, number>,
  startRank: number,
  endRank: number,
): string[] {
  const lo = Math.max(1, Math.min(startRank, endRank));
  const hi = Math.min(ordering.length, Math.max(startRank, endRank));
  if (lo > hi) return ordering;

  const startIdx = lo - 1;
  const endIdx = hi; // exclusive slice bound
  const slice = ordering.slice(startIdx, endIdx);
  const sorted = [...slice].sort((a, b) => {
    const ra = consensusRank.get(a) ?? Number.MAX_SAFE_INTEGER;
    const rb = consensusRank.get(b) ?? Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });

  return [...ordering.slice(0, startIdx), ...sorted, ...ordering.slice(endIdx)];
}
