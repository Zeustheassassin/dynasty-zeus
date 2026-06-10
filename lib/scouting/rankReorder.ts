/**
 * Personal-rank re-sequencing for the scouting prospect boards.
 *
 * The Prospect Data sheet lets the user type a new rank into any prospect. A
 * raw write would allow two prospects to share a rank (and leave gaps). Instead
 * we treat the ranked prospects as an *ordered list* and "move" the edited
 * prospect to the requested position, then renumber everyone to a contiguous
 * `1..N`. This is the same mental model as drag-to-reorder, driven by a number
 * input.
 *
 * Scope note: `personal_rank` is a ladder per (position, draft class) — the same
 * model the Big Board editor enforces (ScoutingHub.handleUpdateRank) and the one
 * documented in migration 011 ("within-position rank"). The scouting hubs hand
 * the sheet a single POSITION's prospects (all classes); the class scoping is
 * applied by `reorderRanksWithinClass` below so one class's edit never disturbs
 * another class's ladder. `reorderRanks` itself is class-agnostic and simply
 * renumbers whatever single sequence it is given.
 *
 * Null ranks mean "unranked"; unranked prospects are kept out of the sequence
 * and stay null. Setting a rank to null pulls a prospect out of the sequence
 * and compacts the rest.
 */

export interface RankItem {
  id: string;
  /** Current personal rank, or null when unranked. */
  rank: number | null;
}

/**
 * Re-sequence personal ranks after the user moves `movedId` to `target`.
 *
 * @param items   Every prospect in the (single) position, with current ranks.
 * @param movedId The prospect whose rank the user just edited.
 * @param target  The requested 1-based rank, or null to unrank the prospect.
 *                Out-of-range values are clamped into `[1, sequenceLength]`.
 * @returns A map of `id -> new rank` containing ONLY the prospects whose rank
 *          actually changed, so the caller can persist a minimal diff. An empty
 *          map means nothing changed (no write needed).
 */
export function reorderRanks(
  items: RankItem[],
  movedId: string,
  target: number | null,
): Map<string, number | null> {
  const changes = new Map<string, number | null>();

  const moved = items.find((it) => it.id === movedId);
  if (!moved) return changes; // unknown id — no-op

  // Normalize the requested target: only a finite number counts as "ranked".
  const wantRank =
    target != null && Number.isFinite(target) ? Math.round(target) : null;

  // Current ranked prospects, sorted by (rank asc, original order) for a stable
  // tie-break. This also collapses any pre-existing duplicate ranks: equal
  // ranks fall back to original-array order, so the result is always unique.
  const ranked = items
    .map((it, idx) => ({ it, idx }))
    .filter(({ it }) => it.rank != null)
    .sort((a, b) => (a.it.rank! - b.it.rank!) || (a.idx - b.idx))
    .map(({ it }) => it);

  // The sequence to renumber, with the moved prospect taken out first.
  const rest = ranked.filter((it) => it.id !== movedId);

  let ordered: RankItem[];
  if (wantRank == null) {
    // Unranking: the moved prospect leaves the sequence entirely.
    ordered = rest;
  } else {
    // Clamp the insert position into the valid range. After removing the moved
    // prospect there are `rest.length` items, so a new item can land anywhere
    // from index 0 (rank 1) to index rest.length (last).
    const insertIndex = Math.min(Math.max(wantRank - 1, 0), rest.length);
    ordered = [...rest.slice(0, insertIndex), moved, ...rest.slice(insertIndex)];
  }

  // Assign contiguous 1..N ranks and diff against current values.
  const newRankById = new Map<string, number | null>();
  ordered.forEach((it, i) => newRankById.set(it.id, i + 1));
  // The moved prospect is unranked when target was null; record it explicitly.
  if (wantRank == null) newRankById.set(movedId, null);

  for (const it of items) {
    const next = newRankById.has(it.id) ? newRankById.get(it.id)! : it.rank;
    if (next !== it.rank) changes.set(it.id, next);
  }

  return changes;
}

export interface ClassRankItem extends RankItem {
  /** The prospect's draft class — the partition key for the rank ladder. */
  draftClass: number;
}

/**
 * Class-scoped reorder. `personal_rank` is a separate 1..N ladder per draft
 * class (within an already position-filtered list), so a rank edit must only
 * renumber prospects sharing the moved prospect's `draftClass`; every other
 * class is left exactly as it was.
 *
 * @returns A map of `id -> new rank` for ONLY the changed prospects, all of whom
 *          are in the moved prospect's draft class.
 */
export function reorderRanksWithinClass(
  items: ClassRankItem[],
  movedId: string,
  target: number | null,
): Map<string, number | null> {
  const mover = items.find((it) => it.id === movedId);
  if (!mover) return new Map();
  const sameClass = items.filter((it) => it.draftClass === mover.draftClass);
  return reorderRanks(sameClass, movedId, target);
}
