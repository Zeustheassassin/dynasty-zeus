// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { waitFor } from "@testing-library/react";
import { refreshAllLeagueRosters } from "@/components/LeagueHub/overviewTabHelpers";
import { OVERVIEW_REFRESH_ROSTERS_CONCURRENCY } from "@/lib/constants";
import { getLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import type { SleeperLeague } from "@/lib/types";

// Sept 22 code-review 50-league-scalability finding, Tier 1 #3: OverviewTab's manual "Refresh
// Rosters" button fanned out every league at once (4 concurrent Sleeper calls each, all
// guaranteed real requests via bypass:true) — the same unbounded-burst shape Batch 1 fixed for
// Gameday Dashboard. These tests cover the extracted fix: a bounded per-league concurrency cap,
// with per-league progress reporting and the leagueData_* cache write preserved.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

function league(id: string): SleeperLeague {
  return {
    league_id: id, name: id, season: "2026", season_type: "regular", status: "in_season",
    sport: "nfl", total_rosters: 12, roster_positions: [], settings: {
      playoff_week_start: 15, playoff_teams: 6, num_teams: 12,
    }, scoring_settings: {}, avatar: null, draft_id: null, previous_league_id: null,
  };
}

beforeEach(() => {
  api.impl = {};
  localStorage.clear();
});

describe("refreshAllLeagueRosters — concurrency cap", () => {
  it(`fetches at most OVERVIEW_REFRESH_ROSTERS_CONCURRENCY (${OVERVIEW_REFRESH_ROSTERS_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from(
      { length: OVERVIEW_REFRESH_ROSTERS_CONCURRENCY + 1 },
      (_, i) => league(`L${i + 1}`)
    );
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const done = vi.fn();
    const finished = refreshAllLeagueRosters(leagues, done);

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(OVERVIEW_REFRESH_ROSTERS_CONCURRENCY);

    // Releasing only the first chunk lets the next chunk start (and register its own releaser);
    // re-running release() afterward is a no-op on the already-settled ones and unblocks the new one.
    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(OVERVIEW_REFRESH_ROSTERS_CONCURRENCY + 1));
    releasers.forEach((release) => release());
    await finished;
  });

  it("calls onLeagueDone once per completed league, not just once at the end", async () => {
    const leagues = [league("A"), league("B")];
    const done = vi.fn();

    await refreshAllLeagueRosters(leagues, done);

    expect(done).toHaveBeenCalledTimes(2);
  });

  it("writes each league's rosters/traded-picks/drafts into its leagueData_* cache entry", async () => {
    const leagues = [league("A")];
    api.impl.getLeagueRosters = vi.fn(async () => [{ roster_id: 1 }]);
    api.impl.getLeagueTradedPicks = vi.fn(async () => [{ season: "2027" }]);
    api.impl.getLeagueDrafts = vi.fn(async () => [{ draft_id: "d1" }]);

    await refreshAllLeagueRosters(leagues, () => {});

    const cached = getLocalStorageItem<{ data: { allRosters: unknown[]; tradedPicksData: unknown[]; draftsData: unknown[] } } | null>(
      "leagueData_A", null
    );
    expect(cached?.data.allRosters).toEqual([{ roster_id: 1 }]);
    expect(cached?.data.tradedPicksData).toEqual([{ season: "2027" }]);
    expect(cached?.data.draftsData).toEqual([{ draft_id: "d1" }]);
  });

  it("falls back to an empty roster list (rather than rejecting) when getLeagueRosters fails", async () => {
    const leagues = [league("A")];
    api.impl.getLeagueRosters = vi.fn(() => Promise.reject(new Error("429")));

    await expect(refreshAllLeagueRosters(leagues, () => {})).resolves.toBeUndefined();

    const cached = getLocalStorageItem<{ data: { allRosters: unknown[] } } | null>("leagueData_A", null);
    expect(cached?.data.allRosters).toEqual([]);
  });
});
