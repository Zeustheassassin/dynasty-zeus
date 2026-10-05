// Recency weighting for every Above-Expected metric: QB AAE, RB SRAE, WR SAE /
// cSAE, TE-SAER / TE-SAEB, their slices and the QB Overview breakdown (the
// user's call, 2026-10-01). A prospect's older tape counts for a little less
// than his newest: each play is weighted SEASON_DECAY^(seasons before his
// newest charted season). Three seasons of equal volume split about
// 36 / 33 / 30 instead of 33 / 33 / 33, and two split 52 / 48. Volume still
// counts: a season with twice the plays carries about twice the weight.
//
// When the seasons agree, nothing changes, since a weighted average of equal
// numbers is the same number. The weighting only moves a metric when newer
// tape differs from older tape, and then toward the newer.
//
// Only the prospect's own sample is weighted. The league difficulty models are
// fit on every play equally: how hard a rep is doesn't depend on when it was
// charted. A single game is a single season, so the per-game badges are
// unaffected.
import type { ScoutingGame } from "../types";
import { gameFlagWeight } from "./gameFlags";

export const SEASON_DECAY = 0.915;

/** Game id → the weight of its plays. Each prospect's newest charted season
 *  counts in full; a game with no season counts in full too. A game the user
 *  flagged (left early, played hurt) also carries its flag's weight
 *  (gameFlags.ts), which is 1 until its test passes. */
export function seasonWeights(
  games: readonly (Pick<ScoutingGame, "id" | "prospect_id" | "season_year"> & Partial<Pick<ScoutingGame, "played_hurt" | "left_early">>)[],
): Map<string, number> {
  const newest = new Map<string, number>();
  for (const g of games) {
    if (!Number.isFinite(g.season_year)) continue;
    const top = newest.get(g.prospect_id);
    if (top == null || g.season_year > top) newest.set(g.prospect_id, g.season_year);
  }
  const out = new Map<string, number>();
  for (const g of games) {
    const top = newest.get(g.prospect_id);
    out.set(g.id, (top == null || !Number.isFinite(g.season_year) ? 1 : SEASON_DECAY ** (top - g.season_year)) * gameFlagWeight(g));
  }
  return out;
}

/** A play's weight from its game. */
export type PlayWeight = (play: { game_id: string }) => number;

export function playWeights(games: Parameters<typeof seasonWeights>[0]): PlayWeight {
  const w = seasonWeights(games);
  return (pl) => w.get(pl.game_id) ?? 1;
}
