// How much tape each prospect has charted: the Big Board's Charted columns
// (games, snaps, and his position's own play count). Counted the same way the
// Analysis tables count G / Snaps / Throws-Runs-Routes
// (components/scouting/stats/*StatsTable.tsx), which use the predicates below,
// so the two always agree.
//
// WR counts come pre-aggregated on the prospect (prospect_route_stats). QB / RB
// / TE counts need that position's raw plays, which the hub loads lazily: until
// they land, snaps and plays are null (unknown), never 0.

import type { ProspectWithStats, ScoutingGame, QBPlay, RBPlay, RBRunType, TEPlay } from "../types";

export type ChartedPos = "QB" | "RB" | "WR" | "TE";

/** A ball thrown: a pass / RPO snap that wasn't a scramble, sack or throw-away
 *  (tipped and not-yet-graded throws count; AAE reads only the graded ones). */
export function isQBThrow(pl: Pick<QBPlay, "play_type" | "timing">): boolean {
  return pl.play_type !== "run" && pl.timing !== "scramble" && pl.timing !== "sack" && pl.timing !== "throw_away";
}

/** The four run schemes; an RB's other plays (blocks, routes, decoys) aren't runs. */
export const RB_RUN_TYPES: readonly RBRunType[] = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];
export function isRBRun(pl: Pick<RBPlay, "run_type">): boolean {
  return RB_RUN_TYPES.includes(pl.run_type);
}

export function isTERoute(pl: Pick<TEPlay, "play_type">): boolean {
  return pl.play_type === "route_run";
}

/** Each position's own play count: its header and what one of them is called. */
export const CHARTED_PLAYS: Record<ChartedPos, { label: string; unit: string; tooltip: string }> = {
  QB: { label: "Throws", unit: "throws", tooltip: "Balls thrown: pass / RPO snaps minus scrambles, sacks and throw-aways. Includes tipped and not-yet-graded throws (AAE and the Smp dot read the graded ones)." },
  RB: { label: "Runs",   unit: "runs",   tooltip: "Runs: outside zone, inside zone, outside man gap and inside man gap. Blocks, routes and decoys are snaps, not runs." },
  WR: { label: "Routes", unit: "routes", tooltip: "Routes run (snaps where he didn't run a route are left out)." },
  TE: { label: "Routes", unit: "routes", tooltip: "Routes run. Blocks and decoys are snaps, not routes." },
};

export interface ChartedCounts {
  games: number;
  /** Every charted play; null while the position's plays are still loading. */
  snaps: number | null;
  /** Throws / runs / routes (CHARTED_PLAYS); null while still loading. */
  plays: number | null;
}

export function isChartedPos(pos: string): pos is ChartedPos {
  return pos === "QB" || pos === "RB" || pos === "WR" || pos === "TE";
}

/**
 * Every QB / RB / WR / TE prospect's charted games, snaps and plays.
 * `playsLoaded` says the QB / RB / TE plays have landed; until then those
 * positions' snaps and plays are null.
 */
export function chartedCounts(
  prospects: readonly ProspectWithStats[],
  games: readonly ScoutingGame[],
  plays: { qb: readonly QBPlay[]; rb: readonly RBPlay[]; te: readonly TEPlay[] },
  playsLoaded: boolean,
): Map<string, ChartedCounts> {
  const gameToProspect = new Map<string, string>();
  const gamesBy = new Map<string, number>();
  for (const g of games) {
    gameToProspect.set(g.id, g.prospect_id);
    gamesBy.set(g.prospect_id, (gamesBy.get(g.prospect_id) ?? 0) + 1);
  }

  // Snaps and plays per prospect, from one pass over each position's plays.
  const tally = new Map<string, { snaps: number; plays: number }>();
  const count = <P extends { game_id: string }>(list: readonly P[], isPlay: (pl: P) => boolean) => {
    for (const pl of list) {
      const pid = gameToProspect.get(pl.game_id);
      if (!pid) continue;
      const t = tally.get(pid) ?? { snaps: 0, plays: 0 };
      t.snaps++;
      if (isPlay(pl)) t.plays++;
      tally.set(pid, t);
    }
  };
  if (playsLoaded) {
    count(plays.qb, isQBThrow);
    count(plays.rb, isRBRun);
    count(plays.te, isTERoute);
  }

  const out = new Map<string, ChartedCounts>();
  for (const p of prospects) {
    if (!isChartedPos(p.position)) continue;
    const g = gamesBy.get(p.id) ?? 0;
    if (p.position === "WR") {
      out.set(p.id, { games: g, snaps: p.total_snaps ?? 0, plays: p.total_routes ?? 0 });
      continue;
    }
    const t = tally.get(p.id);
    out.set(p.id, playsLoaded
      ? { games: g, snaps: t?.snaps ?? 0, plays: t?.plays ?? 0 }
      : { games: g, snaps: null, plays: null });
  }
  return out;
}
