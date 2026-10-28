import { sleeperApi } from "../../lib/sleeperApi";
import { withConcurrency } from "../../lib/concurrency";
import { OVERVIEW_REFRESH_ROSTERS_CONCURRENCY } from "../../lib/constants";
import type { SleeperLeague, SleeperRoster, AugmentedPick, SimRow, CachedSimRow } from "../../lib/types";

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

/**
 * The Overview's 1.01% column: the chance you hold the first pick of the draft this season's sim
 * decides (league season + 1). Each 1st you hold in that draft carries its original roster's
 * last-place odds, so a traded-in 1st counts and a traded-away own 1st doesn't.
 *
 * `odds` is null when there's no sim yet, or when the saved sim predates 1.01 odds being kept
 * (migration 082) — the Overview shows "—" for those until the next Run All Sims.
 */
export function getMyOneOhOneOdds(args: {
  leagueSeason: string;
  myRosterId: number;
  picks: AugmentedPick[];
  rosters: SleeperRoster[];
  userMap: Record<string, string>;
  committedRows: Record<number, SimRow> | undefined;
  cachedRows: Record<number, CachedSimRow> | undefined;
  hasSim: boolean;
}): { odds: number | null; title: string | undefined } {
  const { leagueSeason, myRosterId, picks, rosters, userMap, committedRows, cachedRows, hasSim } = args;
  const draftSeason = String(Number(leagueSeason) + 1);
  const sources = picks
    .filter((p) => Number(p.owner_id) === myRosterId && Number(p.round) === 1 && String(p.season) === draftSeason)
    .map((p) => {
      const rid = Number(p.roster_id);
      const ownerId = rosters.find((r) => Number(r.roster_id) === rid)?.owner_id;
      return {
        odds: committedRows?.[rid]?.oneOhOneOdds ?? cachedRows?.[rid]?.one_oh_one_odds ?? null,
        label: rid === myRosterId ? "your own 1st" : `${(ownerId && userMap[ownerId]) || `Team ${rid}`}'s 1st`,
      };
    });
  if (!hasSim) return { odds: null, title: undefined };
  if (sources.some((s) => s.odds === null)) return { odds: null, title: "Run All Sims to get 1.01 odds" };
  if (sources.length === 0) return { odds: 0, title: `You don't hold a ${draftSeason} 1st` };
  return {
    odds: Math.round(sources.reduce((sum, s) => sum + (s.odds ?? 0), 0) * 10) / 10,
    title: `Chance you hold the ${draftSeason} 1.01: ${sources.map((s) => `${s.odds}% via ${s.label}`).join(" + ")}\nThe sim gives the 1.01 to the non-playoff team with the lowest max PF.`,
  };
}
