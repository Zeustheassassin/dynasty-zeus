// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useGamedayDashboard } from "@/app/hooks/useGamedayDashboard";
import type { SleeperLeague, SleeperRoster, SleeperUser, SleeperMatchup } from "@/lib/types";

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

beforeEach(() => {
  getLeagueRosters.mockReset();
  getLeagueUsers.mockReset();
  getLeagueMatchups.mockReset();
});

describe("useGamedayDashboard", () => {
  it("does nothing when user, leagues, or week are missing", async () => {
    const { result } = renderHook(() => useGamedayDashboard());
    await act(async () => {
      await result.current.loadGamedayDashboard([], null, 1, {}, [], {});
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

    const { result } = renderHook(() => useGamedayDashboard());
    await act(async () => {
      await result.current.loadGamedayDashboard([leagueA, leagueB], me, 1, {}, [], {});
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

    const { result } = renderHook(() => useGamedayDashboard());
    await act(async () => {
      await result.current.loadGamedayDashboard([leagueA, leagueB], me, 1, {}, [], {});
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

    const { result } = renderHook(() => useGamedayDashboard());
    await act(async () => {
      await result.current.loadGamedayDashboard([league], me, 1, {}, [], {});
    });

    await waitFor(() => expect(result.current.gamedayDashboardEntries).toHaveLength(1));
    const [entry] = result.current.gamedayDashboardEntries;
    expect(entry.error).toBe(false);
    expect(entry.myTeam).toBeNull();
    expect(entry.oppTeam).toBeNull();
  });
});
