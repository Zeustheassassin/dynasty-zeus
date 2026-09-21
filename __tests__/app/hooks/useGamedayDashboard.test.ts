// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGamedayDashboard } from "@/app/hooks/useGamedayDashboard";
import type { SleeperLeague, SleeperRoster, SleeperUser, SleeperMatchup, SleeperPlayer, TeamGameState } from "@/lib/types";

const getLeagueRosters = vi.fn();
const getLeagueUsers = vi.fn();
const getLeagueMatchups = vi.fn();

vi.mock("@/lib/sleeperApi", () => ({
  sleeperApi: {
    getLeagueRosters: (...args: unknown[]) => getLeagueRosters(...args),
    getLeagueUsers: (...args: unknown[]) => getLeagueUsers(...args),
    getLeagueMatchups: (...args: unknown[]) => getLeagueMatchups(...args),
  },
}));

const mkLeague = (id: string): SleeperLeague => ({
  league_id: id,
  name: `League ${id}`,
  season: "2026",
  season_type: "regular",
  status: "in_season",
  sport: "nfl",
  total_rosters: 2,
  roster_positions: ["QB", "BN"],
  settings: { playoff_week_start: 15, playoff_teams: 4, num_teams: 2 },
  scoring_settings: {},
  avatar: null,
  draft_id: null,
  previous_league_id: null,
});

const mkRoster = (rosterId: number, ownerId: string): SleeperRoster => ({
  roster_id: rosterId,
  owner_id: ownerId,
  league_id: "league",
  players: [],
  starters: [],
  reserve: null,
  taxi: null,
  co_owners: null,
  settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
});

const mkUser = (id: string, name: string): SleeperUser => ({
  user_id: id, username: name, display_name: name, avatar: null,
});

const mkMatchup = (matchupId: number, rosterId: number, points: number): SleeperMatchup => ({
  matchup_id: matchupId, roster_id: rosterId, points, custom_points: null,
  starters: [], players: [], starters_points: [], players_points: {},
});

const me: SleeperUser = mkUser("me", "Me");

const noInputs = { user: me, players: {}, projectionData: [], scheduleByTeam: {} };

beforeEach(() => {
  getLeagueRosters.mockReset();
  getLeagueUsers.mockReset();
  getLeagueMatchups.mockReset();
});

describe("useGamedayDashboard", () => {
  it("does nothing when user, leagues, or week are missing", async () => {
    const { result } = renderHook(() => useGamedayDashboard(noInputs));
    await act(async () => {
      await result.current.loadGamedayDashboard([], null, 1);
    });
    expect(getLeagueRosters).not.toHaveBeenCalled();
    expect(result.current.gamedayDashboardEntries).toEqual([]);
  });

  it("builds one entry per league, splitting myTeam and oppTeam by roster ownership", async () => {
    const leagueA = mkLeague("A");
    const leagueB = mkLeague("B");
    getLeagueRosters.mockResolvedValue([mkRoster(1, "me"), mkRoster(2, "them")]);
    getLeagueUsers.mockResolvedValue([mkUser("me", "Me"), mkUser("them", "Them")]);
    getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 10), mkMatchup(1, 2, 20)]);

    const { result } = renderHook(() => useGamedayDashboard(noInputs));
    await act(async () => {
      await result.current.loadGamedayDashboard([leagueA, leagueB], me, 1);
    });

    await waitFor(() => expect(result.current.gamedayDashboardEntries).toHaveLength(2));
    for (const entry of result.current.gamedayDashboardEntries) {
      expect(entry.error).toBe(false);
      expect(entry.myTeam?.rosterId).toBe(1);
      expect(entry.oppTeam?.rosterId).toBe(2);
    }
    expect(result.current.gamedayDashboardWeek).toBe(1);
  });

  it("isolates one league's failure — the rest still load", async () => {
    const leagueA = mkLeague("A");
    const leagueB = mkLeague("B");

    getLeagueRosters.mockImplementation((leagueId: string) => {
      if (leagueId === "A") return Promise.reject(new Error("boom"));
      return Promise.resolve([mkRoster(1, "me"), mkRoster(2, "them")]);
    });
    getLeagueUsers.mockResolvedValue([mkUser("me", "Me"), mkUser("them", "Them")]);
    getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 10), mkMatchup(1, 2, 20)]);

    const { result } = renderHook(() => useGamedayDashboard(noInputs));
    await act(async () => {
      await result.current.loadGamedayDashboard([leagueA, leagueB], me, 1);
    });

    await waitFor(() => expect(result.current.gamedayDashboardEntries).toHaveLength(2));
    const entryA = result.current.gamedayDashboardEntries.find((e) => e.league.league_id === "A")!;
    const entryB = result.current.gamedayDashboardEntries.find((e) => e.league.league_id === "B")!;
    expect(entryA.error).toBe(true);
    expect(entryA.myTeam).toBeNull();
    expect(entryB.error).toBe(false);
    expect(entryB.myTeam?.rosterId).toBe(1);
  });

  it("marks a league with no matchup this week as a non-error empty entry", async () => {
    const league = mkLeague("A");
    getLeagueRosters.mockResolvedValue([mkRoster(1, "me")]);
    getLeagueUsers.mockResolvedValue([mkUser("me", "Me")]);
    getLeagueMatchups.mockResolvedValue([]); // no matchup row for my roster this week

    const { result } = renderHook(() => useGamedayDashboard(noInputs));
    await act(async () => {
      await result.current.loadGamedayDashboard([league], me, 1);
    });

    await waitFor(() => expect(result.current.gamedayDashboardEntries).toHaveLength(1));
    const [entry] = result.current.gamedayDashboardEntries;
    expect(entry.error).toBe(false);
    expect(entry.myTeam).toBeNull();
    expect(entry.oppTeam).toBeNull();
  });

  it("passes bypass through to the matchup fetch only", async () => {
    getLeagueRosters.mockResolvedValue([mkRoster(1, "me"), mkRoster(2, "them")]);
    getLeagueUsers.mockResolvedValue([mkUser("me", "Me")]);
    getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 10), mkMatchup(1, 2, 20)]);

    const { result } = renderHook(() => useGamedayDashboard(noInputs));
    await act(async () => {
      await result.current.loadGamedayDashboard([mkLeague("A")], me, 1, { bypass: true });
    });
    expect(getLeagueMatchups).toHaveBeenCalledWith("A", 1, true);
    expect(getLeagueRosters).toHaveBeenCalledWith("A");
  });

  it("re-scores cards from the current scoreboard without refetching anything", async () => {
    const league = mkLeague("A");
    const rosterMe = { ...mkRoster(1, "me"), starters: ["qb1"], players: ["qb1"] };
    getLeagueRosters.mockResolvedValue([rosterMe, mkRoster(2, "them")]);
    getLeagueUsers.mockResolvedValue([mkUser("me", "Me"), mkUser("them", "Them")]);
    getLeagueMatchups.mockResolvedValue([
      { ...mkMatchup(1, 1, 8), starters: ["qb1"], players_points: { qb1: 8 } },
      mkMatchup(1, 2, 0),
    ]);
    const players = { qb1: { player_id: "qb1", position: "QB", team: "SF", full_name: "QB One" } as SleeperPlayer };
    const projectionData = [{
      sleeperId: "qb1", full_name: "QB One", position: "QB", team: "SF", fpts: 20,
      sources: ["sleeper"], kickoffAt: null, stats: null, sourceFpts: null,
    }];

    let schedule: Record<string, TeamGameState> = { SF: { kickoffAt: 1, state: "Upcoming" } };
    const { result, rerender } = renderHook(() => useGamedayDashboard({ user: me, players, projectionData, scheduleByTeam: schedule }));
    await act(async () => { await result.current.loadGamedayDashboard([league], me, 1); });
    await waitFor(() => expect(result.current.gamedayDashboardEntries).toHaveLength(1));
    expect(result.current.gamedayDashboardEntries[0].myTeam?.starterRows[0].gameState).toBe("Upcoming");
    const fetchesAfterLoad = getLeagueMatchups.mock.calls.length;

    schedule = { SF: { kickoffAt: 1, state: "Final" } };
    rerender();
    expect(result.current.gamedayDashboardEntries[0].myTeam?.starterRows[0].gameState).toBe("Final");
    expect(getLeagueMatchups.mock.calls.length).toBe(fetchesAfterLoad);
  });

  describe("refreshGamedayDashboardMatchups", () => {
    const setup = async () => {
      getLeagueRosters.mockResolvedValue([mkRoster(1, "me"), mkRoster(2, "them")]);
      getLeagueUsers.mockResolvedValue([mkUser("me", "Me"), mkUser("them", "Them")]);
      getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 10), mkMatchup(1, 2, 20)]);
      const hook = renderHook(() => useGamedayDashboard(noInputs));
      await act(async () => {
        await hook.result.current.loadGamedayDashboard([mkLeague("A"), mkLeague("B")], me, 1);
      });
      await waitFor(() => expect(hook.result.current.gamedayDashboardEntries).toHaveLength(2));
      getLeagueRosters.mockClear();
      getLeagueMatchups.mockReset();
      return hook;
    };
    const pointsFor = (result: { current: ReturnType<typeof useGamedayDashboard> }, id: string) =>
      result.current.gamedayDashboardEntries.find((e) => e.league.league_id === id)?.myTeam?.actualPoints;

    it("re-pulls only the requested leagues, with the cache bypassed, and leaves rosters alone", async () => {
      const { result } = await setup();
      getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 33), mkMatchup(1, 2, 20)]);

      await act(async () => { await result.current.refreshGamedayDashboardMatchups(["A"], 1); });

      expect(getLeagueMatchups).toHaveBeenCalledTimes(1);
      expect(getLeagueMatchups).toHaveBeenCalledWith("A", 1, true);
      expect(getLeagueRosters).not.toHaveBeenCalled();
      expect(pointsFor(result, "A")).toBe(33);
      expect(pointsFor(result, "B")).toBe(10);
      expect(result.current.gamedayDashboardUpdatedAt).not.toBeNull();
    });

    it("keeps a league's previous data when its refresh fails", async () => {
      const { result } = await setup();
      getLeagueMatchups.mockRejectedValue(new Error("429"));

      await act(async () => { await result.current.refreshGamedayDashboardMatchups(["A"], 1); });

      expect(pointsFor(result, "A")).toBe(10);
      expect(result.current.gamedayDashboardEntries[0].error).toBe(false);
    });

    it("ignores a refresh for a different week", async () => {
      const { result } = await setup();
      getLeagueMatchups.mockResolvedValue([mkMatchup(1, 1, 99), mkMatchup(1, 2, 20)]);

      await act(async () => { await result.current.refreshGamedayDashboardMatchups(["A"], 2); });

      expect(pointsFor(result, "A")).toBe(10);
    });
  });
});
