// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLeagueOverview } from "@/hooks/useLeagueOverview";
import { LEAGUE_OVERVIEW_CONCURRENCY } from "@/lib/constants";
import type { SleeperLeague } from "@/lib/types";

// Sept 22 code-review P1 finding #3: loadLeagueOverview fanned out every league at once (4
// concurrent Sleeper calls each), the identical unbounded-burst shape that caused Batch 5's
// cross-league-intel 429s. These tests cover the fix: a bounded per-league concurrency cap,
// with existing behavior (one bad league doesn't sink the whole overview) preserved.

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

const user = { user_id: "me" };

beforeEach(() => { api.impl = {}; });

describe("useLeagueOverview — concurrency cap", () => {
  it(`fetches at most LEAGUE_OVERVIEW_CONCURRENCY (${LEAGUE_OVERVIEW_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from({ length: LEAGUE_OVERVIEW_CONCURRENCY + 1 }, (_, i) => league(`L${i + 1}`));
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    act(() => { result.current.loadLeagueOverview(); });

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(LEAGUE_OVERVIEW_CONCURRENCY);

    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(LEAGUE_OVERVIEW_CONCURRENCY + 1));
  });

  it("loads every league once concurrency allows, keyed by league_id", async () => {
    const leagues = [league("A"), league("B")];
    const { result } = renderHook(() => useLeagueOverview(leagues, user));

    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(Object.keys(result.current.leagueOverviewData).sort()).toEqual(["A", "B"]);
    expect(result.current.leagueOverviewLoaded).toBe(true);
    expect(result.current.leagueOverviewError).toBeNull();
  });
});

describe("useLeagueOverview — per-league failure isolation", () => {
  it("drops only the league whose fetch failed, keeping the rest", async () => {
    const leagues = [league("bad"), league("good")];
    api.impl.getLeagueRosters = vi.fn((leagueId: string) =>
      leagueId === "bad" ? Promise.reject(new Error("429")) : Promise.resolve([])
    );

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(result.current.leagueOverviewData.good).toBeDefined();
    expect(result.current.leagueOverviewData.bad).toBeUndefined();
    expect(result.current.leagueOverviewError).toBeNull();
  });

  it("surfaces an error when every league fails", async () => {
    const leagues = [league("bad1"), league("bad2")];
    api.impl.getLeagueRosters = vi.fn(() => Promise.reject(new Error("429")));

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(Object.keys(result.current.leagueOverviewData)).toHaveLength(0);
    expect(result.current.leagueOverviewError).toMatch(/Couldn't load league data/);
  });
});
