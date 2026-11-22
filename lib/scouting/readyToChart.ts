// ============================================================
// Ready to chart — client-safe, pure.
// ============================================================
// A prospect is "ready" when he has no personal rank, at least one logged
// game, and none of them charted (no game with a play: the Unwatched tab's
// rule, chartedGamesByProspect). The Prospects lists' Rank sort puts the
// ready prospects right after the ranked ones, best PFF grade first, so the
// user can pick whom to chart next. No grade yet (games not linked to PFF, or
// not imported) = the end of the ready group; every other unranked prospect
// follows.
//
// The grade is his position's headline PFF grade, the one his report shows
// (PFF_GRADE), over exactly his logged games (lib/pff/totals.ts).
// ============================================================

import type { Prospect, ScoutingGame } from "../types";
import type { CompositePos } from "./aeComposite";
import { pffValues, type PffTotals } from "../pff/totals";

/** Each position's headline PFF grade (a pffValues key): his report's PFF tile and the ready sort. */
export const PFF_GRADE: Record<CompositePos, { key: string; label: string }> = {
  WR: { key: "pff_gr_route", label: "PFF route grade" },
  QB: { key: "pff_gr_pass", label: "PFF pass grade" },
  RB: { key: "pff_gr_run", label: "PFF run grade" },
  TE: { key: "pff_gr_off", label: "PFF offense grade" },
};

/**
 * Ready prospects → their PFF grade (null = none yet). Not ready = absent.
 * Null when charted games are unknown (their play counts didn't load): then
 * no one is called ready, rather than every logged prospect.
 */
export function readyToChart(
  prospects: readonly Pick<Prospect, "id" | "position" | "personal_rank">[],
  games: readonly Pick<ScoutingGame, "prospect_id">[],
  chartedGames: ReadonlyMap<string, number> | null,
  pffTotals: ReadonlyMap<string, PffTotals>,
): Map<string, number | null> | null {
  if (!chartedGames) return null;
  const logged = new Set(games.map((g) => g.prospect_id));
  const out = new Map<string, number | null>();
  for (const p of prospects) {
    if (p.personal_rank != null || !logged.has(p.id) || (chartedGames.get(p.id) ?? 0) > 0) continue;
    const grade = PFF_GRADE[p.position as CompositePos];
    out.set(p.id, grade ? (pffValues(pffTotals.get(p.id))[grade.key] ?? null) : null);
  }
  return out;
}

// Sort bands, far above any personal rank. Grades run 0–100.
const READY = 1_000_000;
const READY_NO_GRADE = READY + 1_000;
const UNRANKED = 2_000_000;

/**
 * The Rank sort's key, low first: ranked prospects by rank, then the ready
 * ones by PFF grade (best first, no grade last), then every other unranked
 * prospect.
 */
export function rankSortValue(
  p: Pick<Prospect, "id" | "personal_rank">,
  ready: ReadonlyMap<string, number | null> | null,
): number {
  if (p.personal_rank != null) return p.personal_rank;
  if (!ready?.has(p.id)) return UNRANKED;
  const grade = ready.get(p.id);
  return grade == null ? READY_NO_GRADE : READY + (100 - grade);
}
