// ============================================================
// The user's league order in the Sleeper app. Sleeper's user-leagues list carries a
// `display_order` per league (0 = top of the user's list in the app) and comes back sorted by
// it; checked against a real 36-league account 2026-10-14 (0–35, one each, list order = sorted).
// The To-Do hub lists leagues this way so they read in the order the user works through them in
// Sleeper.
// ============================================================
import type { SleeperLeague } from "../types";

/** Each league's position in the user's Sleeper order: `display_order` first, then where it sits
 *  in the list (a league without one keeps its list position, after those that have one). */
export function getSleeperLeagueOrder(
  leagues: Pick<SleeperLeague, "league_id" | "display_order">[]
): Map<string, number> {
  const sorted = leagues
    .map((league, index) => ({ id: league.league_id, order: league.display_order ?? Number.POSITIVE_INFINITY, index }))
    .sort((a, b) => a.order - b.order || a.index - b.index);
  return new Map(sorted.map((entry, rank) => [entry.id, rank]));
}
