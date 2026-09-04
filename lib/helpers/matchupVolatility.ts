// ============================================================
// Matchup-relative variance guidance for Suggested Starters.
// User's framing: if you're favored, minimize variance (protect the
// projected win); if you're an underdog, a "safe" lineup that's still
// projected to lose doesn't help — lean into a higher-ceiling lineup.
// ============================================================

import type { ProjectionRow, SleeperMatchup } from "../types";
import { getProjectionKickoffAt, getKickoffState } from "./gameday";
import { getProjectionVolatility } from "./projectionVolatility";

/** Sums an opponent's projected final score for the week: already-scored
 *  points for starters whose game is live/final, plus each remaining
 *  (not-yet-kicked-off) starter's own projection — the same "actual +
 *  remaining" methodology Gameday Hub uses for live matchup totals. */
export const getOpponentProjectedScore = (
  oppMatchup: SleeperMatchup | null | undefined,
  projectionBySleeperId: Map<string, ProjectionRow>
): number => {
  if (!oppMatchup) return 0;
  const starterIds = (oppMatchup.starters || []).map(String).filter((id) => id && id !== "0");
  const playerPoints = oppMatchup.players_points || {};
  return starterIds.reduce((sum, id) => {
    const proj = projectionBySleeperId.get(id) ?? null;
    const actual = Number(playerPoints[id] ?? 0);
    const kickoffAt = getProjectionKickoffAt(proj);
    const state = getKickoffState(kickoffAt);
    const remaining =
      state === "Upcoming" ? Number(proj?.fpts ?? 0) :
      state === "Live" ? Math.max(Number(proj?.fpts ?? 0) - actual, 0) :
      0; // Final — the game is over, actual is the whole story.
    return sum + actual + remaining;
  }, 0);
};

export interface LineupRange {
  consensus: number;
  floor: number;
  ceiling: number;
}

/** Sums the consensus/floor/ceiling across a set of starter projection rows.
 *  A player with fewer than 3 matched sources (see getProjectionVolatility)
 *  contributes their plain consensus fpts to floor and ceiling both — no
 *  spread data means no reason to assume they'd swing the range. */
export const getLineupRange = (
  rows: Array<Pick<ProjectionRow, "fpts" | "sourceFpts"> | null>
): LineupRange =>
  rows.reduce<LineupRange>(
    (acc, row) => {
      if (!row) return acc;
      const v = getProjectionVolatility(row);
      return {
        consensus: acc.consensus + row.fpts,
        floor: acc.floor + (v?.floor ?? row.fpts),
        ceiling: acc.ceiling + (v?.ceiling ?? row.fpts),
      };
    },
    { consensus: 0, floor: 0, ceiling: 0 }
  );

/** Below this margin (in points), the matchup reads as too close to call —
 *  neither "protect the lead" nor "you need upside" is a clear signal. */
export const NEUTRAL_MATCHUP_MARGIN = 3;

export type MatchupLean = "favored" | "underdog" | "neutral";

export interface MatchupLeanResult {
  margin: number;
  lean: MatchupLean;
}

/** myTotal/oppTotal are both consensus (median) projected totals. */
export const getMatchupLean = (myTotal: number, oppTotal: number): MatchupLeanResult => {
  const margin = myTotal - oppTotal;
  if (Math.abs(margin) < NEUTRAL_MATCHUP_MARGIN) return { margin, lean: "neutral" };
  return { margin, lean: margin > 0 ? "favored" : "underdog" };
};
