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

describe("useLeagueOverview — in-flight dedupe", () => {
  // Sept 22 code-review Tier 2 finding #7: multiple useAppState.ts effects (the OVERVIEW-tab
  // effect and the player-profile-open effect) can each call loadLeagueOverview() in the same
  // render pass, before leagueOverviewLoaded flips true — every one of them used to kick off
  // its own full per-league fan-out. A call made while one is already running should now join
  // that same in-flight promise instead of starting a duplicate fetch.
  it("ignores a second call while the first is still in flight, joining the same load", async () => {
    const leagues = [league("A"), league("B")];
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => {
      p1 = result.current.loadLeagueOverview();
      p2 = result.current.loadLeagueOverview();
    });

    expect(p1).toBe(p2); // the second call joined the first's in-flight promise, not a new one
    await waitFor(() => expect(callCount).toBe(2)); // both leagues' rosters requested exactly once each

    releasers.forEach((release) => release());
    await act(async () => { await p1; });

    expect(callCount).toBe(2); // still 2 — no duplicate fan-out fired for the second call
    expect(Object.keys(result.current.leagueOverviewData).sort()).toEqual(["A", "B"]);
  });

  it("starts a genuinely new fetch on the next call once the previous one has resolved", async () => {
    const leagues = [league("A")];
    let callCount = 0;
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    await act(async () => { await result.current.loadLeagueOverview(); });
    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(callCount).toBe(2); // two sequential (non-overlapping) calls each did their own fetch
  });
});

describe("useLeagueOverview — freshRosters (Roster Overview Refresh)", () => {
  it("bypasses the roster cache for every league", async () => {
    const leagues = [league("A"), league("B")];
    api.impl.getLeagueRosters = vi.fn(async () => []);

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    await act(async () => { await result.current.loadLeagueOverview({ freshRosters: true }); });

    expect(api.impl.getLeagueRosters).toHaveBeenCalledWith("A", true);
    expect(api.impl.getLeagueRosters).toHaveBeenCalledWith("B", true);
  });

  it("does not join a cached load already in flight — it starts its own pass, which wins", async () => {
    const leagues = [league("A")];
    const pending: { bypass: boolean | undefined; release: (v: unknown) => void }[] = [];
    api.impl.getLeagueRosters = vi.fn((_id: string, bypass?: boolean) =>
      new Promise((resolve) => pending.push({ bypass, release: resolve }))
    );

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    let cached!: Promise<void>;
    let fresh!: Promise<void>;
    act(() => { cached = result.current.loadLeagueOverview(); });
    await waitFor(() => expect(pending.length).toBe(1));
    act(() => { fresh = result.current.loadLeagueOverview({ freshRosters: true }); });

    expect(fresh).not.toBe(cached);
    await waitFor(() => expect(pending.length).toBe(2));
    expect(pending.map((p) => !!p.bypass)).toEqual([false, true]);

    // The fresh answer lands first; the older cached answer arriving afterwards must not replace it.
    const mine = (players: string[]) => [{ roster_id: 1, owner_id: "me", players }];
    pending[1].release(mine(["fresh"]));
    await act(async () => { await fresh; });
    pending[0].release(mine(["stale"]));
    await act(async () => { await cached; });

    expect(result.current.leagueOverviewData.A.rosters[0].players).toEqual(["fresh"]);
    // And a plain call afterwards gets a new pass rather than a dangling in-flight slot.
    let next!: Promise<void>;
    act(() => { next = result.current.loadLeagueOverview(); });
    await waitFor(() => expect(pending.length).toBe(3));
    pending[2].release(mine(["next"]));
    await act(async () => { await next; });
    expect(result.current.leagueOverviewData.A.rosters[0].players).toEqual(["next"]);
  });
});

describe("useLeagueOverview — per-league failure isolation", () => {
  it("keeps a league's last good entry when a later pass fails for it", async () => {
    // allLeagueData (injury report, Shares, Dashboard) is derived from this map and re-polled every
    // couple of minutes — one 429 must not make a league vanish from all of them.
    const leagues = [league("A"), league("B")];
    let failA = false;
    api.impl.getLeagueRosters = vi.fn((leagueId: string) =>
      leagueId === "A" && failA
        ? Promise.reject(new Error("429"))
        : Promise.resolve([{ roster_id: 1, owner_id: "me", players: [leagueId] }])
    );

    const { result } = renderHook(() => useLeagueOverview(leagues, user));
    await act(async () => { await result.current.loadLeagueOverview(); });
    const firstA = result.current.leagueOverviewData.A;
    expect(firstA).toBeDefined();

    failA = true;
    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(result.current.leagueOverviewData.A).toBe(firstA);
    expect(result.current.leagueOverviewData.B).toBeDefined();
    expect(result.current.leagueOverviewError).toBeNull();
  });

  it("prunes leagues the user is no longer in", async () => {
    api.impl.getLeagueRosters = vi.fn(async () => []);
    const { result, rerender } = renderHook(({ ls }) => useLeagueOverview(ls, user), {
      initialProps: { ls: [league("A"), league("B")] },
    });
    await act(async () => { await result.current.loadLeagueOverview(); });
    rerender({ ls: [league("B")] });
    await act(async () => { await result.current.loadLeagueOverview(); });

    expect(Object.keys(result.current.leagueOverviewData)).toEqual(["B"]);
  });

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
