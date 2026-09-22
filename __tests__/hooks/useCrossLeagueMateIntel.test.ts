// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCrossLeagueMateIntel } from "@/hooks/useCrossLeagueMateIntel";
import { CROSS_LEAGUE_INTEL_OWNER_BATCH, CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY } from "@/lib/constants";
import type { SleeperRoster, SleeperPlayer, SleeperLeague } from "@/lib/types";

// Sept 21 audit finding #5: this hook used to fan out owners x their-other-leagues x ~5 Sleeper
// calls with no cap at all (hundreds at once against a 60/min/route limiter), and a 429 or any
// other failure was silently swallowed into a confident-looking "0 dynasty leagues" profile that
// got cached forever. These tests cover the fix: a bounded batch per pass, and a failed owner
// (or a partially-failed one) is never cached, so it stays retryable instead of stuck wrong.

type Fn = (...args: never[]) => unknown;
const api = vi.hoisted(() => ({ impl: {} as Record<string, Fn> }));
vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: new Proxy({}, { get: (_t, k: string) => api.impl[k] ?? (async () => []) }),
}));

function roster(ownerId: string, rosterId: number): SleeperRoster {
  return {
    roster_id: rosterId, owner_id: ownerId, league_id: "L", players: [], starters: [],
    reserve: null, taxi: null, co_owners: null,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
  };
}

const players: Record<string, SleeperPlayer> = {
  p1: { player_id: "p1", full_name: "Test Player", first_name: "Test", last_name: "Player", position: "WR", team: "KC", age: 25, years_exp: 3, status: "Active", injury_status: null, injury_body_part: null, injury_notes: null, practice_description: null, practice_participation: null } as SleeperPlayer,
};

const baseArgs = { leagueId: "L", userId: "me", players, mainTab: "TRADE_HUB", tradeHubSection: "FINDER" };

beforeEach(() => { api.impl = {}; });

describe("useCrossLeagueMateIntel — concurrency cap", () => {
  it(`processes at most CROSS_LEAGUE_INTEL_OWNER_BATCH (${CROSS_LEAGUE_INTEL_OWNER_BATCH}) owners at once, deferring the rest`, async () => {
    const rosters = Array.from({ length: CROSS_LEAGUE_INTEL_OWNER_BATCH + 1 }, (_, i) => roster(`owner${i + 1}`, i + 1));
    let callCount = 0;
    const releasers: (() => void)[] = [];
    api.impl.getUserLeagues = vi.fn(() => {
      callCount++;
      return new Promise((resolve) => releasers.push(() => resolve([])));
    });

    renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await waitFor(() => expect(callCount).toBeGreaterThan(0));
    // The batch cap's calls fire synchronously together — the extra owner must not have started.
    expect(callCount).toBe(CROSS_LEAGUE_INTEL_OWNER_BATCH);

    releasers.forEach((release) => release());
    await waitFor(() => expect(callCount).toBe(CROSS_LEAGUE_INTEL_OWNER_BATCH + 1));
  });

  it("caps league fetches GLOBALLY across the whole owner batch, not per owner (live testing against a real 36-league account showed a per-owner cap alone still bursting to owners x cap concurrent calls and tripping 429s)", async () => {
    // Every owner in the batch has more dynasty leagues than the concurrency cap, so a
    // per-owner-only cap would still let (batch size x cap) leagues run at once.
    const leaguesPerOwner = CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY + 1;
    const rosters = Array.from({ length: CROSS_LEAGUE_INTEL_OWNER_BATCH }, (_, i) => roster(`owner${i + 1}`, i + 1));

    api.impl.getUserLeagues = vi.fn(async (ownerId: string) =>
      Array.from({ length: leaguesPerOwner }, (_, i) => ({
        league_id: `${ownerId}-L${i}`,
        roster_positions: Array(22).fill("BN"),
        settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 0, best_ball: 0 },
      }))
    );

    let concurrentLeagueRosterCalls = 0;
    let maxObservedConcurrency = 0;
    api.impl.getLeagueRosters = vi.fn(() => {
      concurrentLeagueRosterCalls++;
      maxObservedConcurrency = Math.max(maxObservedConcurrency, concurrentLeagueRosterCalls);
      return new Promise((resolve) => {
        setTimeout(() => { concurrentLeagueRosterCalls--; resolve([]); }, 5);
      });
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await waitFor(() => expect(Object.keys(result.current.crossLeagueMateIntel).length).toBe(rosters.length));
    expect(maxObservedConcurrency).toBeLessThanOrEqual(CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY);
    // Sanity check the cap is actually being exercised (not trivially satisfied by too few leagues).
    expect(maxObservedConcurrency).toBeGreaterThan(0);
  });
});

describe("useCrossLeagueMateIntel — failure surfacing", () => {
  it("never caches an owner whose data failed to load — it stays retryable, not a fake empty profile", async () => {
    const rosters = [roster("bad", 1), roster("good", 2)];
    let badAttempts = 0;
    api.impl.getUserLeagues = vi.fn((ownerId: string) => {
      if (ownerId === "bad") { badAttempts++; return Promise.reject(new Error("429")); }
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await waitFor(() => expect(result.current.crossLeagueMateIntel.good).toBeDefined());
    expect(result.current.crossLeagueMateIntel.bad).toBeUndefined();
    expect(badAttempts).toBeGreaterThanOrEqual(1);
    // The good owner really has 0 dynasty leagues (legitimate empty), unlike the bad one which
    // must stay absent rather than being recorded as an equally-confident "0 leagues".
    expect(result.current.crossLeagueMateIntel.good.totalDynastyLeagues).toBe(0);
  });

  it("does not cache a partial result — one failed league fails the whole owner", async () => {
    const rosters = [roster("owner1", 1)];
    const dynastyLeague: Partial<SleeperLeague> = {
      league_id: "dl1",
      roster_positions: Array(22).fill("BN"),
      settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 0, best_ball: 0 },
    };
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague]);
    api.impl.getLeagueRosters = vi.fn(async () => { throw new Error("429"); });
    api.impl.getLeagueTransactions = vi.fn(async () => []);
    api.impl.getLeagueDrafts = vi.fn(async () => []);

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await waitFor(() => expect(api.impl.getLeagueRosters).toHaveBeenCalled());
    // Give the rejected Promise.all inside buildOwnerLeaguesBounded time to unwind.
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.crossLeagueMateIntel.owner1).toBeUndefined();
  });
});
