import { sleeperApi } from "../../lib/sleeperApi";
import { withConcurrency } from "../../lib/concurrency";
import { setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { OVERVIEW_REFRESH_ROSTERS_CONCURRENCY } from "../../lib/constants";
import type { SleeperLeague, SleeperRoster } from "../../lib/types";

/**
 * Force-refreshes every league's rosters/traded-picks/drafts from Sleeper (bypass:true, so
 * every call is a real request, never a cache hit) and writes each into the leagueData_*
 * localStorage entry loadRoster reads from. Capped at OVERVIEW_REFRESH_ROSTERS_CONCURRENCY
 * leagues at once — same unbounded-fan-out shape as useLeagueOverview/useGamedayDashboard
 * (Sept 22 code-review 50-league-scalability finding, Tier 1 #3), just with bypass:true making
 * the burst even less forgiving here since nothing can resolve from cache.
 *
 * `onLeagueDone` fires once per league as its write lands, so callers can drive a `{done,
 * total}` progress indicator incrementally rather than only at the very end.
 */
export async function refreshAllLeagueRosters(
  leagues: SleeperLeague[],
  onLeagueDone: () => void
): Promise<void> {
  await withConcurrency(leagues, async (league) => {
    const [allRosters, tradedPicksData, draftsData] = await Promise.all([
      sleeperApi.getLeagueRosters(league.league_id, true).catch(() => [] as SleeperRoster[]),
      sleeperApi.getLeagueTradedPicks(league.league_id, true),
      sleeperApi.getLeagueDrafts(league.league_id, true),
      sleeperApi.getLeagueUsers(league.league_id, true),
    ]);
    setLocalStorageItem(
      `leagueData_${league.league_id}`,
      { data: { allRosters, tradedPicksData, draftsData }, cachedAt: Date.now() }
    );
    onLeagueDone();
  }, OVERVIEW_REFRESH_ROSTERS_CONCURRENCY);
}
