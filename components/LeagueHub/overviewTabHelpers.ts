import { sleeperApi } from "../../lib/sleeperApi";
import { withConcurrency } from "../../lib/concurrency";
import { OVERVIEW_REFRESH_ROSTERS_CONCURRENCY } from "../../lib/constants";
import type { SleeperLeague } from "../../lib/types";

/**
 * Force-refreshes every league's rosters/traded-picks/drafts/users from Sleeper (bypass:true, so
 * every call is a real request, never a cache hit). Each fresh answer lands in sleeperApi's own
 * browser cache under the normal (non-bypass) key, which is what loadRoster and the League
 * Overview then read — the separate 2h leagueData_* copy this used to write was retired 10/10.
 * Capped at OVERVIEW_REFRESH_ROSTERS_CONCURRENCY leagues at once — same unbounded-fan-out shape
 * as useLeagueOverview/useGamedayDashboard (Sept 22 code-review 50-league-scalability finding,
 * Tier 1 #3), just with bypass:true making the burst even less forgiving here since nothing can
 * resolve from cache.
 *
 * `onLeagueDone` fires once per league as its fetches land, so callers can drive a `{done,
 * total}` progress indicator incrementally rather than only at the very end.
 */
export async function refreshAllLeagueRosters(
  leagues: SleeperLeague[],
  onLeagueDone: () => void
): Promise<void> {
  await withConcurrency(leagues, async (league) => {
    await Promise.all([
      // A failed roster refresh leaves that league's last cached rosters in place.
      sleeperApi.getLeagueRosters(league.league_id, true).catch(() => null),
      sleeperApi.getLeagueTradedPicks(league.league_id, true),
      sleeperApi.getLeagueDrafts(league.league_id, true),
      sleeperApi.getLeagueUsers(league.league_id, true),
    ]);
    onLeagueDone();
  }, OVERVIEW_REFRESH_ROSTERS_CONCURRENCY);
}
