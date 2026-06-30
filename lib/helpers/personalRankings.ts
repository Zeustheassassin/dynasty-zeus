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
  /** |personalRank − consensusRank| ≤ this ⇒ NEUTRAL (also absorbs market drift). */
  neutralBand: number;
  /** |delta| > this ⇒ STRONG_* — the tier the Trade Finder treats as a hard block. */
  strongBand: number;
}

/**
 * Default rank-gap bands. Deliberately a flat rank delta (matches the user's
 * mental model: "I have him at 19, the market has him at 33"). Tunable — a
 * value-aware or percentile band is a possible later refinement.
 */
export const DEFAULT_PERSONAL_SIGNAL_THRESHOLDS: PersonalSignalThresholds = {
  neutralBand: 5,
  strongBand: 15,
};

/**
 * Map a personal-vs-consensus rank gap to a buy/sell signal.
 *
 * delta = personalRank − consensusRank (both 1-based; lower rank = better player):
 *   • delta > 0 → you rank him WORSE than the market ⇒ SELL side (shop him, don't buy).
 *   • delta < 0 → you rank him BETTER than the market ⇒ BUY side (target him, don't sell).
 *   • |delta| within the neutral band ⇒ NEUTRAL.
 *
 * The STRONG_* tier (|delta| beyond strongBand) is what the Trade Finder treats as
 * a hard block on the opposite action: never buy a STRONG_SELL, never sell a
 * STRONG_BUY. SELL/BUY are soft weightings.
 */
export function derivePersonalSignal(
  personalRank: number,
  consensusRank: number,
  thresholds: PersonalSignalThresholds = DEFAULT_PERSONAL_SIGNAL_THRESHOLDS,
): PersonalSignal {
  const delta = personalRank - consensusRank;
  const mag = Math.abs(delta);
  if (mag <= thresholds.neutralBand) return "NEUTRAL";
  if (delta > 0) return mag > thresholds.strongBand ? "STRONG_SELL" : "SELL";
  return mag > thresholds.strongBand ? "STRONG_BUY" : "BUY";
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
