// The Scouting Hub header: per draft class and position,
//   Prospects · Full · Partial · Logged · Games · Snaps
// under one colour key (the user, 2026-11-24).
//
// Full = Fully Charted. Partial Chart is split by whether he has a hand-charted
// snap: Partial = at least one charted play, Logged = only logged games (a
// logged game auto-promotes him to Partial Chart, deriveChartingDecision).
// Games and Snaps count charted tape only: a game with at least one play
// (chartedGamesByProspect, the Prospects lists' "6/8G" numerator), and his
// charted snaps. Client-safe, no I/O.

import type { ChartingDecision } from "../types";

export interface HubHeaderProspect {
  id: string;
  position: string;
  draft_class_year: number;
  charting_decision: ChartingDecision;
}

export interface HubHeaderCounts {
  pos: string;
  prospects: number;
  full: number;
  /** Partial Chart with at least one hand-charted snap. */
  partial: number;
  /** Partial Chart with logged games but no charted snap. */
  logged: number;
  /** Games with at least one charted play; null when the per-game counts didn't load. */
  games: number | null;
  /** Charted snaps. */
  snaps: number;
}

export interface HubHeaderYear {
  year: number;
  positions: HubHeaderCounts[];
}

/**
 * One row per draft class (oldest first), one entry per position in
 * `positions` order, all zeros where the class has none at that position (so
 * every row lines up, the user 2026-11-24). `chartedGames` is
 * chartedGamesByProspect's map (null when its load failed: Games reads null and
 * Partial / Logged go by snaps alone); `snaps` is each prospect's charted snaps.
 */
export function hubHeaderBreakdown(
  prospects: readonly HubHeaderProspect[],
  chartedGames: ReadonlyMap<string, number> | null,
  snaps: ReadonlyMap<string, number>,
  positions: readonly string[],
): HubHeaderYear[] {
  const years = [...new Set(prospects.map((p) => p.draft_class_year))].sort((a, b) => a - b);
  const hasCharted = (id: string) => (chartedGames?.get(id) ?? 0) > 0 || (snaps.get(id) ?? 0) > 0;

  return years.map((year) => ({
    year,
    positions: positions.map((pos) => {
      const group = prospects.filter((p) => p.draft_class_year === year && p.position === pos);
      const partialChart = group.filter((p) => p.charting_decision === "partial_chart");
      const partial = partialChart.filter((p) => hasCharted(p.id)).length;
      return {
        pos,
        prospects: group.length,
        full: group.filter((p) => p.charting_decision === "fully_charted").length,
        partial,
        logged: partialChart.length - partial,
        games: chartedGames ? group.reduce((s, p) => s + (chartedGames.get(p.id) ?? 0), 0) : null,
        snaps: group.reduce((s, p) => s + (snaps.get(p.id) ?? 0), 0),
      };
    }),
  }));
}
