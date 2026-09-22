// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useUserExposure } from "@/hooks/useUserExposure";
import { TARGET_USER_LEAGUE_CONCURRENCY } from "@/lib/constants";
import type { SleeperLeague } from "@/lib/types";

// Sept 22 code-review 50-league-scalability finding, Tier 1 #4: loadUserExposure fanned out
// across every one of the TARGET user's leagues at once, uncapped, AND with no per-item
// failure isolation — one failed getLeagueRosters call rejected the whole Promise.all and
// blanked the entire panel instead of just dropping that one league. These tests cover both
// fixes: a bounded per-league concurrency cap, and a .catch so one bad league can't sink the
// rest (mirrors useUserTrades' existing pattern).

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

beforeEach(() => { api.impl = {}; });

describe("useUserExposure — concurrency cap", () => {
  it(`fetches at most TARGET_USER_LEAGUE_CONCURRENCY (${TARGET_USER_LEAGUE_CONCURRENCY}) leagues at once, deferring the rest`, async () => {
    const leagues = Array.from(
      { length: TARGET_USER_LEAGUE_CONCURRENCY + 1 },
      (_, i) => league(`L${i + 1}`)
    );
    api.impl.getUserLeagues = vi.fn(async () => leagues);
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getLeagueRosters = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    const { result } = renderHook(() => useUserExposure());
    act(() => { result.current.loadUserExposure("me"); });

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The cap's calls fire synchronously together — the extra league must not have started yet.
    expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY);

    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(TARGET_USER_LEAGUE_CONCURRENCY + 1));
    releasers.forEach((release) => release());
  });
});

describe("useUserExposure — per-league failure isolation", () => {
  it("drops only the league whose roster fetch failed, keeping the rest", async () => {
    const leagues = [league("bad"), league("good")];
    api.impl.getUserLeagues = vi.fn(async () => leagues);
    api.impl.getLeagueRosters = vi.fn((leagueId: string) =>
      leagueId === "bad"
        ? Promise.reject(new Error("429"))
        : Promise.resolve([{ roster_id: 1, owner_id: "me", players: ["p1", "p2"] }])
    );

    const { result } = renderHook(() => useUserExposure());
    await act(async () => { await result.current.loadUserExposure("me"); });

    expect(result.current.exposureError).toBeNull();
    expect(result.current.externalShares?.leagueCount).toBe(1);
    expect(result.current.externalShares?.players.map((p) => p.playerId).sort()).toEqual(["p1", "p2"]);
  });
});
