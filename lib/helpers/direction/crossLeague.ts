import type { LeagueOverviewEntry, SleeperPlayer, StrategicBucket } from "../../types";
import { getRosterDirectionProfile } from "./roster";

export interface CrossLeagueDirectionEntry {
  leagueId: string;
  bucket: StrategicBucket;
  bucketColor: string;
  dynRank: number;
  redRank: number;
  n: number;
}

/**
 * Cross-league sibling of getRosterDirectionProfile — computes the user's
 * own strategic bucket (Elite/True Contender/.../Hopeless) in every
 * connected league at once, for the Dashboard's "Your Teams" summary.
 *
 * Uses global (not per-league-scoring-adjusted) dynasty/redraft values
 * rather than deriving each league's scoring multipliers. A scoring
 * adjustment (e.g. TE premium) reweights every roster in the *same*
 * league by roughly the same factor, so it barely moves relative RANK
 * within a league — which is all the bucket actually depends on — and
 * doing this properly for every league would mean re-deriving scoring
 * multipliers per league just for a landing-screen summary. Not a fetch
 * cost issue like the roster data itself (leagueOverviewData is already
 * loaded); this is a deliberate scope cut on precision, not on data.
 */
export function getCrossLeagueDirections({
  leagueOverviewData,
  myRosterIdByLeague,
  players,
  pickFcValues,
  redraftValues,
}: {
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  myRosterIdByLeague: Record<string, number>;
  players: Record<string, SleeperPlayer>;
  pickFcValues: Record<string, number>;
  redraftValues: Record<string, number>;
}): Record<string, CrossLeagueDirectionEntry> {
  const result: Record<string, CrossLeagueDirectionEntry> = {};
  for (const [leagueId, entry] of Object.entries(leagueOverviewData)) {
    const rosterId = myRosterIdByLeague[leagueId];
    if (rosterId == null || !entry.rosters.length) continue;
    const profile = getRosterDirectionProfile({
      rosterId,
      rosters: entry.rosters,
      ownedPicks: entry.picks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer: (id) => players[id]?.value ?? 0,
    });
    if (!profile) continue;
    result[leagueId] = {
      leagueId,
      bucket: profile.bucket,
      bucketColor: profile.bucketColor,
      dynRank: profile.dynRank,
      redRank: profile.redRank,
      n: profile.n,
    };
  }
  return result;
}

/** Fixed best-to-worst display order for the Dashboard's bucket tally —
 *  matches the 3×3 grid layout documented in ./bucket.ts. */
export const DIRECTION_BUCKET_ORDER: StrategicBucket[] = [
  "Elite",
  "True Contender",
  "Almost There",
  "Window Closing",
  "Fading Contender",
  "Purgatory",
  "Rebuilder",
  "Stranded",
  "Fading Out",
  "Hopeless",
];
