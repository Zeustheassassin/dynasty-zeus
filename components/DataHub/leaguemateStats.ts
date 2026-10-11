import { sleeperApi } from "../../lib/sleeperApi";
import { withConcurrency } from "../../lib/concurrency";
import { CURRENT_YEAR } from "../../lib/helpers";
import { LEAGUEMATES_LEAGUE_CONCURRENCY, LEAGUEMATES_OWNER_CONCURRENCY } from "../../lib/constants";
import type { SleeperLeague, SleeperRoster, LeagueMateStatEntry } from "../../lib/types";
import type { FetchedRoster, FetchedUser } from "./dataHubTypes";

export interface LeagueMateStatsProgress {
  done: number;
  total: number;
}

/**
 * The Leaguemates tab's table: every other owner across `leagues`, with how many leagues they're in
 * this season (regular vs best ball) and how many of them they share with `myUserId`.
 *
 * Two capped passes — LEAGUEMATES_LEAGUE_CONCURRENCY leagues' rosters + users (mostly cache hits
 * once the League Overview has loaded), then LEAGUEMATES_OWNER_CONCURRENCY owners' league lists
 * (one call each, ~450 owners at 50 leagues). Both were a plain Promise.all until 10/10, which fired
 * every owner lookup at once; most of them 429'd and silently came back as 0 leagues. `onProgress`
 * counts finished owner lookups.
 *
 * A league or owner whose call fails still counts — as no rosters, or 0 leagues — as before.
 */
export async function loadLeagueMateStats(
  leagues: SleeperLeague[],
  myUserId: string,
  onProgress?: (progress: LeagueMateStatsProgress) => void
): Promise<LeagueMateStatEntry[]> {
  const myLeagueData = await withConcurrency(leagues, async (league) => {
    const [rosters, leagueUsers] = await Promise.all([
      sleeperApi.getLeagueRosters(league.league_id).catch(() => [] as SleeperRoster[]),
      sleeperApi.getLeagueUsers(league.league_id),
    ]);
    return { rosters: rosters as FetchedRoster[], leagueUsers: leagueUsers as FetchedUser[] };
  }, LEAGUEMATES_LEAGUE_CONCURRENCY);

  const displayNameMap: Record<string, string> = {};
  const sharedLeaguesCount: Record<string, number> = {};
  const allOwnerIds = new Set<string>();

  myLeagueData.forEach(({ rosters, leagueUsers }) => {
    leagueUsers.forEach((u) => {
      if (u?.user_id && u?.display_name) displayNameMap[u.user_id] = u.display_name;
    });
    rosters.forEach((r) => {
      if (!r.owner_id || r.owner_id === myUserId) return;
      allOwnerIds.add(r.owner_id);
      sharedLeaguesCount[r.owner_id] = (sharedLeaguesCount[r.owner_id] || 0) + 1;
    });
  });

  const ownerIds = [...allOwnerIds];
  let done = 0;
  onProgress?.({ done, total: ownerIds.length });

  return withConcurrency(ownerIds, async (ownerId): Promise<LeagueMateStatEntry> => {
    const theirLeagues = await sleeperApi
      .getUserLeagues(ownerId, CURRENT_YEAR)
      .catch(() => [] as SleeperLeague[]);
    done++;
    onProgress?.({ done, total: ownerIds.length });
    return {
      userId: ownerId,
      displayName: displayNameMap[ownerId] || ownerId,
      totalLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) === 0).length,
      bestBallLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) !== 0).length,
      sharedLeagues: sharedLeaguesCount[ownerId] || 0,
    };
  }, LEAGUEMATES_OWNER_CONCURRENCY);
}
