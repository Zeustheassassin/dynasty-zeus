// The Big Board's "Realign ranks" buttons (the user's ask, 2026-11-12): put a
// class's ranks in Dynasty Score order, or Dynasty+ order, in one go.
//
// Ranks live per draft class: OVR (overall_rank) across positions, POS
// (personal_rank) within a position. On the All tab a realign rewrites the
// class's OVR and every position's POS, so the two agree; on a position tab it
// rewrites only that position's POS and leaves OVR alone.
//
// Within each ladder: every prospect with the score goes first, best first
// (ranked or not before); those ranked without one follow in their current
// order; the rest stay unranked. Ties keep the current order, then name.

import type { Prospect } from "../types";

export type RankField = "overall_rank" | "personal_rank";

/** New (or, for Undo, old) ranks for one prospect; only the fields that change. */
export type RankUpdate = Partial<Record<RankField, number | null>>;

type RankedProspect = Pick<Prospect, "id" | "name" | "position" | "draft_class_year" | "overall_rank" | "personal_rank">;

export interface RealignScope {
  /** The draft classes to realign, each on its own. */
  classes: readonly number[];
  /** A position tab's position (POS only), or null on the All tab (OVR and every POS). */
  position: string | null;
}

export interface RealignResult {
  /** Only the prospects whose ranks change, with only the fields that change. */
  updates: Map<string, RankUpdate>;
  /** The same prospects and fields as they stand now, for Undo. */
  before: Map<string, RankUpdate>;
  /** Prospects in scope with the score: they go first. */
  scored: number;
  /** Prospects in scope ranked without the score: they follow. */
  unscoredRanked: number;
}

const byCurrent = (field: RankField) => (a: RankedProspect, b: RankedProspect) =>
  (a[field] ?? Infinity) - (b[field] ?? Infinity) || a.name.localeCompare(b.name);

/** One ladder's new ranks: scored best-first, then ranked-without-a-score in their current order; null for the rest. */
function ladder(
  group: readonly RankedProspect[],
  field: RankField,
  scoreOf: (id: string) => number | null | undefined,
): Map<string, number | null> {
  const score = (p: RankedProspect) => {
    const s = scoreOf(p.id);
    return s != null && Number.isFinite(s) ? s : null;
  };
  const current = byCurrent(field);
  const scored = group.filter((p) => score(p) != null)
    .sort((a, b) => score(b)! - score(a)! || current(a, b));
  const following = group.filter((p) => score(p) == null && p[field] != null).sort(current);
  const out = new Map<string, number | null>(group.map((p) => [p.id, null]));
  [...scored, ...following].forEach((p, i) => out.set(p.id, i + 1));
  return out;
}

export function realignRanks(
  prospects: readonly RankedProspect[],
  scoreOf: (id: string) => number | null | undefined,
  scope: RealignScope,
): RealignResult {
  const classes = new Set(scope.classes);
  const inScope = prospects.filter((p) =>
    classes.has(p.draft_class_year) && (scope.position == null || p.position === scope.position));
  const next = new Map<string, RankUpdate>();
  const set = (ranks: Map<string, number | null>, field: RankField) => {
    for (const [id, r] of ranks) next.set(id, { ...next.get(id), [field]: r });
  };
  for (const year of classes) {
    const cls = inScope.filter((p) => p.draft_class_year === year);
    if (scope.position == null) set(ladder(cls, "overall_rank", scoreOf), "overall_rank");
    for (const pos of new Set(cls.map((p) => p.position))) {
      set(ladder(cls.filter((p) => p.position === pos), "personal_rank", scoreOf), "personal_rank");
    }
  }

  const updates = new Map<string, RankUpdate>();
  const before = new Map<string, RankUpdate>();
  let scored = 0;
  let unscoredRanked = 0;
  for (const p of inScope) {
    const s = scoreOf(p.id);
    const fields = Object.keys(next.get(p.id) ?? {}) as RankField[];
    if (s != null && Number.isFinite(s)) scored++;
    else if (fields.some((f) => p[f] != null)) unscoredRanked++;
    const changed = fields.filter((f) => (next.get(p.id)![f] ?? null) !== (p[f] ?? null));
    if (!changed.length) continue;
    updates.set(p.id, Object.fromEntries(changed.map((f) => [f, next.get(p.id)![f] ?? null])));
    before.set(p.id, Object.fromEntries(changed.map((f) => [f, p[f] ?? null])));
  }
  return { updates, before, scored, unscoredRanked };
}
