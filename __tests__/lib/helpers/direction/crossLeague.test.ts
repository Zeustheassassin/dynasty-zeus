import { describe, it, expect } from "vitest";
import { getCrossLeagueDirections } from "@/lib/helpers/direction/crossLeague";
import type { LeagueOverviewEntry, SleeperPlayer } from "@/lib/types";

// Two-roster league: roster 1 has a clearly stronger dynasty+redraft core
// (dynRank=1, redRank=1 out of 2 -> both land in the top-20%, so the raw
// bucket is "Elite" — see bucket.ts's 3x3 grid). Both players are age 26,
// non-QB/RB, which zeroes out computeWindowScore's age term (neutral —
// coreAge===26 means both the "young" bonus and "old" penalty are 0), so
// the ONLY thing that can move the bucket away from "Elite" is the
// playoff-odds adjustment this test is targeting.
function makeLeagueOverviewData(): Record<string, LeagueOverviewEntry> {
  const league = {} as LeagueOverviewEntry["league"];
  return {
    L1: {
      league,
      rosters: [
        { roster_id: 1, owner_id: "u1", players: ["p1"], settings: { wins: 5, losses: 5, fpts: 1200, fpts_max: 1300 } },
        { roster_id: 2, owner_id: "u2", players: ["p2"], settings: { wins: 5, losses: 5, fpts: 900, fpts_max: 1000 } },
      ],
      picks: [],
      userMap: {},
    } as unknown as LeagueOverviewEntry,
  };
}

const players: Record<string, SleeperPlayer> = {
  p1: { player_id: "p1", full_name: "Star Player", position: "WR", team: "AAA", age: 26, value: 8000 } as SleeperPlayer,
  p2: { player_id: "p2", full_name: "Bench Player", position: "WR", team: "BBB", age: 26, value: 500 } as SleeperPlayer,
};

const redraftValues = { p1: 8000, p2: 500 };

describe("getCrossLeagueDirections", () => {
  it("returns the raw (pre-adjustment) bucket when no playoff-odds data is supplied", () => {
    const result = getCrossLeagueDirections({
      leagueOverviewData: makeLeagueOverviewData(),
      myRosterIdByLeague: { L1: 1 },
      players,
      pickFcValues: {},
      redraftValues,
    });
    expect(result.L1.bucket).toBe("Elite");
  });

  it("applies the SAME getAdjustedDirectionBucket step every other consumer (OverviewTab, LeagueMatesTab, UserScoutHub) already runs, once playoff-odds data is supplied", () => {
    // playoffOdds=0 with sim data present is a hard floor in getAdjustedDirectionBucket:
    // Elite/True Contender/Almost There all get pulled down to "Rebuilder" — this was the
    // exact bug (Dashboard tally showed the un-adjusted "Elite" while every other screen
    // showing this same team, with the same 0% playoff odds, showed "Rebuilder").
    const result = getCrossLeagueDirections({
      leagueOverviewData: makeLeagueOverviewData(),
      myRosterIdByLeague: { L1: 1 },
      players,
      pickFcValues: {},
      redraftValues,
      playoffOddsByLeague: { L1: 0 },
    });
    expect(result.L1.bucket).toBe("Rebuilder");
  });

  it("skips leagues where the user's roster can't be found", () => {
    const result = getCrossLeagueDirections({
      leagueOverviewData: makeLeagueOverviewData(),
      myRosterIdByLeague: {},
      players,
      pickFcValues: {},
      redraftValues,
    });
    expect(result.L1).toBeUndefined();
  });
});
