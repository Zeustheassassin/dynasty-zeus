// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCrossLeagueMateIntel } from "@/hooks/useCrossLeagueMateIntel";
import { CROSS_LEAGUE_INTEL_OWNER_BATCH, CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY, CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS } from "@/lib/constants";
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

  it("does not cache anything for an owner whose only league never succeeds (Batch 4 still excludes zero-progress owners)", async () => {
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

describe("useCrossLeagueMateIntel — retry after an all-failed pass", () => {
  // A pass where every owner in the batch fails never changes crossLeagueMateIntel, which is
  // otherwise the only dependency that advances the effect to a new attempt — without an
  // explicit retry, a persistently-failing owner (e.g. Sleeper down for a few minutes) would be
  // silently dropped for the rest of the session instead of picked back up once it recovers.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  // A single fake-timer tick doesn't settle a chained promise -> setState -> re-render ->
  // effect-re-fire round trip; advance a few no-op ticks to let it fully propagate.
  const flush = async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  };

  it("retries a lone failing owner on a cooldown instead of dropping them for the session", async () => {
    const rosters = [roster("bad", 1)];
    let attempts = 0;
    api.impl.getUserLeagues = vi.fn(() => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error("429"));
      return Promise.resolve([]);
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await flush();
    expect(attempts).toBe(1);
    expect(result.current.crossLeagueMateIntel.bad).toBeUndefined();

    await vi.advanceTimersByTimeAsync(CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
    await flush();
    expect(attempts).toBe(2);
    expect(result.current.crossLeagueMateIntel.bad).toBeUndefined();

    await vi.advanceTimersByTimeAsync(CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
    await flush();
    expect(attempts).toBe(3);
    expect(result.current.crossLeagueMateIntel.bad).toBeDefined();
  });

  it("does not keep polling once every owner has successfully loaded", async () => {
    const rosters = [roster("good", 1)];
    api.impl.getUserLeagues = vi.fn(() => Promise.resolve([]));

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));

    await flush();
    expect(result.current.crossLeagueMateIntel.good).toBeDefined();
    const callsBefore = (api.impl.getUserLeagues as ReturnType<typeof vi.fn>).mock.calls.length;

    // Nothing is missing any more, so the effect returns before even scheduling a retry timer —
    // this asserts the retry mechanism doesn't leave a stray poll running after success.
    await vi.advanceTimersByTimeAsync(CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
    await flush();
    expect((api.impl.getUserLeagues as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });
});

describe("useCrossLeagueMateIntel — partial profiles + targeted retry", () => {
  // Sept 22 code-review 50-league-scalability finding, Tier 1 #5 (Batch 4): an owner used to be
  // dropped ENTIRELY if even one of their (possibly many) dynasty leagues failed, which got
  // specifically worse as an owner's own league count grew toward 50. These tests cover the
  // redesign: a partial profile is cached as soon as any league succeeds (flagged isPartial),
  // and only the still-outstanding leagues are re-fetched on a later pass — a league that
  // already succeeded is never refetched.
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const flush = async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  };

  function dynastyLeague(id: string): Partial<SleeperLeague> {
    return {
      league_id: id,
      roster_positions: Array(22).fill("BN"),
      settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 0, best_ball: 0 },
    };
  }

  it("caches a partial profile (isPartial: true) as soon as one league succeeds, without waiting for the rest", async () => {
    const rosters = [roster("owner1", 1)];
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("A"), dynastyLeague("B")]);
    api.impl.getLeagueRosters = vi.fn((leagueId: string) =>
      leagueId === "A" ? Promise.resolve([]) : Promise.reject(new Error("429"))
    );

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await flush();

    expect(result.current.crossLeagueMateIntel.owner1).toBeDefined();
    expect(result.current.crossLeagueMateIntel.owner1.isPartial).toBe(true);
    expect(result.current.crossLeagueMateIntel.owner1.totalDynastyLeagues).toBe(2);
    expect(result.current.crossLeagueMateIntel.owner1.crossLeagueSummary).toMatch(/partial/i);
  });

  it("only re-fetches the still-failing league on retry — the already-succeeded one is never refetched", async () => {
    const rosters = [roster("owner1", 1)];
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("A"), dynastyLeague("B")]);
    let bFails = true;
    const rosterCalls: string[] = [];
    api.impl.getLeagueRosters = vi.fn((leagueId: string) => {
      rosterCalls.push(leagueId);
      if (leagueId === "A") return Promise.resolve([]);
      return bFails ? Promise.reject(new Error("429")) : Promise.resolve([]);
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await flush();

    expect(result.current.crossLeagueMateIntel.owner1.isPartial).toBe(true);
    expect(rosterCalls.filter((id) => id === "A")).toHaveLength(1);
    expect(rosterCalls.filter((id) => id === "B")).toHaveLength(1);

    bFails = false;
    await vi.advanceTimersByTimeAsync(CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
    await flush();

    expect(result.current.crossLeagueMateIntel.owner1.isPartial).toBe(false);
    expect(rosterCalls.filter((id) => id === "A")).toHaveLength(1); // never refetched — served from cache
    expect(rosterCalls.filter((id) => id === "B")).toHaveLength(2);
  });
});

describe("useCrossLeagueMateIntel — shared-league dedup", () => {
  // Sept 22 deferred follow-up #1: leaguemates sharing OTHER leagues is this hook's whole use
  // case, but the fetch queue used to be keyed by (owner, league) pair — so a league shared by
  // N owners cost its 5 Sleeper calls N times. The queue is now keyed by league_id and each
  // owner's view is derived from the one fetch.
  function dynastyLeague(id: string): Partial<SleeperLeague> {
    return {
      league_id: id,
      roster_positions: Array(22).fill("BN"),
      settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 0, best_ball: 0 },
    };
  }

  it("fetches a league shared by two owners exactly once, and still derives each owner's own roster from it", async () => {
    const rosters = [roster("owner1", 1), roster("owner2", 2)];
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("shared")]);
    const rosterCalls: string[] = [];
    api.impl.getLeagueRosters = vi.fn(async (leagueId: string) => {
      rosterCalls.push(leagueId);
      return [
        { ...roster("owner1", 7), players: ["p1"] },
        { ...roster("owner2", 8), players: [] },
      ];
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await waitFor(() => expect(Object.keys(result.current.crossLeagueMateIntel)).toHaveLength(2));

    // One unique league, one fetch — not one per owner in it.
    expect(rosterCalls).toEqual(["shared"]);
    // Only the roster lookup is owner-specific, and each owner got theirs out of the one fetch.
    expect(result.current.crossLeagueMateIntel.owner1.ownedPlayerCounts).toEqual({ p1: 1 });
    expect(result.current.crossLeagueMateIntel.owner2.ownedPlayerCounts).toEqual({});
    expect(result.current.crossLeagueMateIntel.owner1.isPartial).toBe(false);
    expect(result.current.crossLeagueMateIntel.owner2.isPartial).toBe(false);
  });

  it("attempts a failing shared league once per pass, leaving every owner in it partial rather than dropping one owner's copy of the same failure", async () => {
    const rosters = [roster("owner1", 1), roster("owner2", 2)];
    api.impl.getUserLeagues = vi.fn(async (ownerId: string) => [
      dynastyLeague("shared"),
      dynastyLeague(`${ownerId}-own`),
    ]);
    const rosterCalls: string[] = [];
    api.impl.getLeagueRosters = vi.fn((leagueId: string) => {
      rosterCalls.push(leagueId);
      if (leagueId === "shared") return Promise.reject(new Error("429"));
      return Promise.resolve([roster("owner1", 7), roster("owner2", 8)]);
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await waitFor(() => expect(Object.keys(result.current.crossLeagueMateIntel)).toHaveLength(2));

    // withConcurrency is fail-fast within a batch, so this also pins that the per-league catch
    // lives inside fn — without it the shared league's rejection would take the others down.
    expect(result.current.crossLeagueMateIntel.owner1.isPartial).toBe(true);
    expect(result.current.crossLeagueMateIntel.owner2.isPartial).toBe(true);
    expect(rosterCalls.filter((id) => id === "shared")).toHaveLength(1);
    expect(rosterCalls).toContain("owner1-own");
    expect(rosterCalls).toContain("owner2-own");
  });

  it("excludes the league currently being traded in — this is CROSS-league intel", async () => {
    const rosters = [roster("owner1", 1)];
    // Sleeper's user-leagues endpoint returns every league the owner is in, including this one.
    api.impl.getUserLeagues = vi.fn(async () => [dynastyLeague("L"), dynastyLeague("other")]);
    const rosterCalls: string[] = [];
    api.impl.getLeagueRosters = vi.fn(async (leagueId: string) => {
      rosterCalls.push(leagueId);
      return [{ ...roster("owner1", 7), players: ["p1"] }];
    });

    // baseArgs.leagueId is "L".
    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await waitFor(() => expect(result.current.crossLeagueMateIntel.owner1).toBeDefined());

    expect(rosterCalls).toEqual(["other"]);
    expect(result.current.crossLeagueMateIntel.owner1.totalDynastyLeagues).toBe(1);
    // Counted once (the other league), not twice — the current-league copy is not double-counted
    // into the hoarding/affinity signals the Finder reads off ownedPlayerCounts.
    expect(result.current.crossLeagueMateIntel.owner1.ownedPlayerCounts).toEqual({ p1: 1 });
  });
});

describe("useCrossLeagueMateIntel — league cache is shared across passes", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const flush = async () => {
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };

  function dynastyLeague(id: string): Partial<SleeperLeague> {
    return {
      league_id: id,
      roster_positions: Array(22).fill("BN"),
      settings: { playoff_week_start: 15, playoff_teams: 6, num_teams: 12, taxi_slots: 0, best_ball: 0 },
    };
  }

  it("does not re-fetch a league on a later pass just because a different owner needs it", async () => {
    const rosters = [roster("owner1", 1), roster("owner2", 2)];
    let owner2Fails = true;
    api.impl.getUserLeagues = vi.fn((ownerId: string) => {
      if (ownerId === "owner2" && owner2Fails) return Promise.reject(new Error("429"));
      return Promise.resolve([dynastyLeague("shared")]);
    });
    const rosterCalls: string[] = [];
    api.impl.getLeagueRosters = vi.fn(async (leagueId: string) => {
      rosterCalls.push(leagueId);
      return [roster("owner1", 7), roster("owner2", 8)];
    });

    const { result } = renderHook(() => useCrossLeagueMateIntel({ ...baseArgs, rosters }));
    await flush();

    // Pass 1: owner2 never got as far as a league list, so only owner1 pulled "shared".
    expect(result.current.crossLeagueMateIntel.owner1).toBeDefined();
    expect(result.current.crossLeagueMateIntel.owner2).toBeUndefined();
    expect(rosterCalls).toEqual(["shared"]);

    owner2Fails = false;
    await vi.advanceTimersByTimeAsync(CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS);
    await flush();

    // Pass 2: owner2 resolves to the same league, which is already in the league-keyed cache —
    // a per-owner cache would have refetched it here.
    expect(result.current.crossLeagueMateIntel.owner2).toBeDefined();
    expect(result.current.crossLeagueMateIntel.owner2.isPartial).toBe(false);
    expect(rosterCalls).toEqual(["shared"]);
  });
});
