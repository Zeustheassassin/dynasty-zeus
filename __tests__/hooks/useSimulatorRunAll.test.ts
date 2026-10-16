// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { SimulatorCtx } from "@/app/hooks/useSimulatorState";
import type { SleeperLeague, SleeperNFLState, SleeperPlayer, SleeperRoster } from "@/lib/types";

// Run All Sims selects each league and saves the same selectedLeagueSimulation the Simulator tab
// shows. It used to save as soon as loadRoster finished, while that league's projections (scored
// for the previous league, or cleared), weekly matchups and QB-format values were still loading —
// so a batch run disagreed with opening each league and waiting.

vi.mock("@/lib/supabaseclient", () => ({ supabase: { from: vi.fn(), auth: { getSession: vi.fn() } } }));

// The engine itself is covered elsewhere; here it just echoes the projection fpts it was handed,
// so a saved row shows which league's projections were used.
vi.mock("@/lib/helpers/simulation", () => ({
  simulateLeague: (args: { selectedLeague: SleeperLeague | null; rosters: SleeperRoster[]; projectionData: { fpts: number }[] }) =>
    args.selectedLeague && args.rosters.length
      ? { rows: [{ rosterId: 1, playoffOdds: args.projectionData[0]?.fpts ?? -1, actualWins: 0, actualLosses: 0, pointsFor: 0 }] }
      : null,
  buildRostersWithTrade: (rosters: SleeperRoster[]) => rosters,
}));

const { useSimulatorState, SIM_RUN_LEAGUE_TIMEOUT_MS } = await import("@/app/hooks/useSimulatorState");
const { projectionScoringKey } = await import("@/lib/helpers/scoring");

const halfPpr = { rec: 0.5 };
const fullPpr = { rec: 1 };
const league = (id: string, scoring: Record<string, number>) =>
  ({ league_id: id, name: id, scoring_settings: scoring, roster_positions: ["QB", "SUPER_FLEX"], settings: {} }) as unknown as SleeperLeague;
const L1 = league("L1", halfPpr);
const L2 = league("L2", fullPpr);

function baseCtx(overrides: Partial<SimulatorCtx> = {}): SimulatorCtx {
  return {
    selectedLeague: null,
    rosters: [{ roster_id: 1, owner_id: "me", players: [] } as unknown as SleeperRoster],
    players: { p1: { player_id: "p1" } as SleeperPlayer },
    nflState: { season_type: "regular", week: 6 } as SleeperNFLState,
    projectionData: [],
    projectionWeek: 6,
    projectionLoadedFor: null,
    loadingProjections: false,
    loadingRedraft: false,
    redraftSettledNumQbs: 2,
    playerStats: null,
    leagueWeeklyMatchups: {},
    standings: [],
    users: {},
    leagueAdjustedFcValues: {},
    leagueAdjustedRedraftValues: {},
    projectedRookiesByRoster: new Map(),
    supabaseUser: null,
    leagues: [L1, L2],
    loadRoster: vi.fn(async () => {}),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("Run All Sims queue", () => {
  it("holds a league until its projections, values and matchups are its own, then saves and moves on", () => {
    const loadRoster = vi.fn(async () => {});
    // Projections still scored for the previous league (fpts 99) when L1's rosters land.
    const stale = baseCtx({
      loadRoster,
      selectedLeague: L1,
      projectionData: [{ fpts: 99 } as never],
      projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(fullPpr) },
      leagueWeeklyMatchups: { L1: [] },
    });
    const { result, rerender } = renderHook((ctx: SimulatorCtx) => useSimulatorState(ctx), { initialProps: stale });

    act(() => { result.current.handleRunAllSims(); });
    expect(loadRoster).toHaveBeenLastCalledWith(L1);
    act(() => { result.current.setReadyLeagueId("L1"); });

    expect(result.current.simRunWait).toBe("projections");
    expect(result.current.committedSimsByLeague.L1).toBeUndefined();

    // useProjections clears the data and reloads it under L1's scoring.
    rerender({ ...stale, projectionData: [], projectionLoadedFor: null, loadingProjections: true });
    expect(result.current.committedSimsByLeague.L1).toBeUndefined();

    // Projections land; matchups for L1 are already in. Saved with L1's own projections.
    const fresh = { ...stale, projectionData: [{ fpts: 12 } as never], projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(halfPpr) } };
    rerender(fresh);
    expect(result.current.committedSimsByLeague.L1?.[1]?.playoffOdds).toBe(12);
    expect(result.current.simQueue).toEqual(["L2"]);
    expect(result.current.simProgress).toMatchObject({ done: 1, total: 2, skipped: [] });
    expect(loadRoster).toHaveBeenLastCalledWith(L2);
  });

  it("waits for the league's weekly matchups before saving", () => {
    const ready = baseCtx({
      selectedLeague: L1,
      projectionData: [{ fpts: 12 } as never],
      projectionLoadedFor: { week: 6, scoringKey: projectionScoringKey(halfPpr) },
    });
    const { result, rerender } = renderHook((ctx: SimulatorCtx) => useSimulatorState(ctx), { initialProps: ready });
    act(() => { result.current.handleRunAllSims(); });
    act(() => { result.current.setReadyLeagueId("L1"); });

    expect(result.current.simRunWait).toBe("matchups");
    expect(result.current.committedSimsByLeague.L1).toBeUndefined();

    rerender({ ...ready, leagueWeeklyMatchups: { L1: [{ week: 1, matchups: [] }] } });
    expect(result.current.committedSimsByLeague.L1?.[1]?.playoffOdds).toBe(12);
  });

  it("skips a league that never finishes loading, keeps its old odds, and goes on to the next", () => {
    vi.useFakeTimers();
    const loadRoster = vi.fn(async () => {});
    const { result } = renderHook((ctx: SimulatorCtx) => useSimulatorState(ctx), { initialProps: baseCtx({ loadRoster }) });

    act(() => { result.current.handleRunAllSims(); });
    expect(loadRoster).toHaveBeenLastCalledWith(L1);

    act(() => { vi.advanceTimersByTime(SIM_RUN_LEAGUE_TIMEOUT_MS - 1); });
    expect(result.current.simQueue).toEqual(["L1", "L2"]);

    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.simQueue).toEqual(["L2"]);
    expect(result.current.simProgress).toMatchObject({ done: 1, total: 2, skipped: ["L1"] });
    expect(result.current.committedSimsByLeague.L1).toBeUndefined();
    expect(loadRoster).toHaveBeenLastCalledWith(L2);
  });
});
