// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUserTrades } from "@/hooks/useUserTrades";
import { TARGET_USER_LEAGUE_CONCURRENCY } from "@/lib/constants";
import type { SleeperLeague } from "@/lib/types";

// Sept 22 code-review 50-league-scalability finding, Tier 1 #4: loadUserTrades fanned out
// across every one of the TARGET user's leagues at once (5 Sleeper calls each) — scaling with
// the LOOKED-UP user's league count, not the viewer's own, so even a small-league viewer could
// trip a burst by looking up a whale. This test covers the fix: a bounded per-league
// concurrency cap.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

function dynastyLeague(id: string): SleeperLeague {
  return {
    league_id: id, name: id, season: "2026", season_type: "regular", status: "in_season",
    sport: "nfl", total_rosters: 12, roster_positions: [],
    settings: { taxi_slots: 2, playoff_week_start: 15, playoff_teams: 6, num_teams: 12 },
    scoring_settings: {}, avatar: null, draft_id: null, previous_league_id: null,
  };
}

beforeEach(() => { api.impl = {}; });

describe("useUserTrades — concurrency cap", () => {
  it(`fetches at most TARGET_USER_LEAGUE_CONCURRENCY (${TARGET_USER_LEAGUE_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from(
      { length: TARGET_USER_LEAGUE_CONCURRENCY + 1 },
      (_, i) => dynastyLeague(`L${i + 1}`)
    );
    api.impl.getUserLeagues = vi.fn(async () => leagues);
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const { result } = renderHook(() => useUserTrades());
    act(() => { result.current.loadUserTrades("me"); });

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY);

    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY + 1));
    releasers.forEach((release) => release());
  });
});

// Oct 7 2026: trades come from one recent-trades request per league (the server picks the legs).
// A league that fails to load is reported instead of silently showing no trades.
describe("useUserTrades — recent trades", () => {
  const recentTrade = (id: string) => ({
    transaction_id: id, type: "trade", status: "complete", created: Date.now() - 60_000,
    roster_ids: [1, 2], adds: {}, drops: {}, draft_picks: [],
  });

  it("keeps the leagues that loaded and reports the ones that failed", async () => {
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("L1"), dynastyLeague("L2")]);
    api.impl.getLeagueRosters = vi.fn(async () => [{ roster_id: 1, owner_id: "me" }, { roster_id: 2, owner_id: "them" }]);
    api.impl.getLeagueRecentTrades = vi.fn(async (leagueId: string) => {
      if (leagueId === "L2") throw new Error("cachedFetch 502");
      return [recentTrade("t1")];
    });

    const { result } = renderHook(() => useUserTrades());
    await act(async () => { await result.current.loadUserTrades("me"); });

    expect(result.current.tradeHubData?.map((t) => [t.transaction_id, t.leagueId])).toEqual([["t1", "L1"]]);
    expect(result.current.tradeHubError).toMatch(/1 of 2 leagues/);
    expect(api.impl.getLeagueRecentTrades).toHaveBeenCalledWith("L1", undefined);
  });

  it("leaves the error clear when every league loads", async () => {
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("L1")]);
    api.impl.getLeagueRosters = vi.fn(async () => [{ roster_id: 1, owner_id: "me" }, { roster_id: 2, owner_id: "them" }]);
    api.impl.getLeagueRecentTrades = vi.fn(async () => [recentTrade("t1")]);

    const { result } = renderHook(() => useUserTrades());
    await act(async () => { await result.current.loadUserTrades("me", true); });

    expect(result.current.tradeHubData).toHaveLength(1);
    expect(result.current.tradeHubError).toBeNull();
    expect(api.impl.getLeagueRecentTrades).toHaveBeenCalledWith("L1", true);
  });
});
