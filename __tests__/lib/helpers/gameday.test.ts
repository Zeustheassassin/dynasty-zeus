import { describe, it, expect } from "vitest";
import { resolveGameState, buildGamedayMatchups, getKickoffState } from "@/lib/helpers/gameday";
import type {
  SleeperLeague, SleeperRoster, SleeperMatchup, SleeperPlayer, ProjectionRow, TeamGameState,
} from "@/lib/types";

const HOUR = 60 * 60 * 1000;

const mkLeague = (over: Partial<SleeperLeague> = {}): SleeperLeague => ({
  league_id: "league1",
  name: "Test League",
  season: "2026",
  season_type: "regular",
  status: "in_season",
  sport: "nfl",
  total_rosters: 2,
  roster_positions: ["QB", "RB", "WR", "BN", "BN"],
  settings: { playoff_week_start: 15, playoff_teams: 4, num_teams: 2 },
  scoring_settings: {},
  avatar: null,
  draft_id: null,
  previous_league_id: null,
  ...over,
});

const mkRoster = (over: Partial<SleeperRoster>): SleeperRoster => ({
  roster_id: 1,
  owner_id: "owner1",
  league_id: "league1",
  players: [],
  starters: [],
  reserve: null,
  taxi: null,
  co_owners: null,
  settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0, fpts_against_decimal: 0 },
  ...over,
});

const mkMatchup = (over: Partial<SleeperMatchup>): SleeperMatchup => ({
  matchup_id: 1,
  roster_id: 1,
  points: 0,
  custom_points: null,
  starters: [],
  players: [],
  starters_points: [],
  players_points: {},
  ...over,
});

const mkPlayer = (over: Partial<SleeperPlayer>): SleeperPlayer => ({
  player_id: "p1",
  full_name: "Test Player",
  first_name: "Test",
  last_name: "Player",
  position: "QB",
  team: "SF",
  age: 25,
  years_exp: 3,
  status: "Active",
  injury_status: null,
  injury_body_part: null,
  injury_notes: null,
  practice_description: null,
  practice_participation: null,
  active: true,
  bye_week: null,
  number: 1,
  depth_chart_position: 1,
  search_rank: 1,
  fantasy_positions: ["QB"],
  college: null,
  height: null,
  weight: null,
  ...over,
});

const mkProjection = (sleeperId: string, fpts: number): ProjectionRow => ({
  sleeperId,
  full_name: "Test Player",
  position: "QB",
  team: "SF",
  fpts,
  sources: ["sleeper"],
  kickoffAt: null,
  stats: null,
  sourceFpts: null,
});

// ── resolveGameState ─────────────────────────────────────────────────────

describe("resolveGameState", () => {
  it("uses the scheduled game's state and kickoff when the team is found", () => {
    const schedule: Record<string, TeamGameState> = {
      SF: { kickoffAt: 12345, state: "Final" },
    };
    expect(resolveGameState("SF", schedule, 999)).toEqual({ state: "Final", kickoffAt: 12345 });
  });

  it("falls back to the kickoff heuristic when the team isn't in the schedule", () => {
    const pastKickoff = Date.now() - 1 * HOUR;
    expect(resolveGameState("SEA", {}, pastKickoff)).toEqual({
      state: getKickoffState(pastKickoff),
      kickoffAt: pastKickoff,
    });
  });

  it("falls back to the heuristic when team is null/undefined", () => {
    expect(resolveGameState(null, { SF: { kickoffAt: 1, state: "Live" } }, null)).toEqual({
      state: "Upcoming",
      kickoffAt: null,
    });
  });
});

// ── buildGamedayMatchups ─────────────────────────────────────────────────

describe("buildGamedayMatchups", () => {
  it("returns [] when league, rosters, or week are missing", () => {
    expect(buildGamedayMatchups(null, [], [], 1, {}, [], {}, {})).toEqual([]);
    expect(buildGamedayMatchups(mkLeague(), [], [], 1, {}, [], {}, {})).toEqual([]);
    expect(buildGamedayMatchups(mkLeague(), [mkRoster({})], [], 0, {}, [], {}, {})).toEqual([]);
  });

  it("reports zero remaining points for a starter whose game is Final, even with a nonzero projection (the reported bug)", () => {
    const league = mkLeague({ roster_positions: ["QB", "BN"] });
    const rosters = [
      mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1"] }),
      mkRoster({ roster_id: 2, owner_id: "opp", starters: ["qb2"], players: ["qb2"] }),
    ];
    const matchups = [
      mkMatchup({ matchup_id: 1, roster_id: 1, points: 22.1, starters: ["qb1"], players_points: { qb1: 22.1 } }),
      mkMatchup({ matchup_id: 1, roster_id: 2, points: 0, starters: ["qb2"], players_points: {} }),
    ];
    const players = { qb1: mkPlayer({ player_id: "qb1", team: "SF" }), qb2: mkPlayer({ player_id: "qb2", team: "SEA" }) };
    const projectionData = [mkProjection("qb1", 40.6)]; // matches the Brock Purdy repro: 22.1 actual, big fpts projection
    const scheduleByTeam: Record<string, TeamGameState> = { SF: { kickoffAt: 1, state: "Final" } };

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projectionData, {}, scheduleByTeam);
    const myTeam = built.teams.find((t) => t.rosterId === 1)!;

    expect(myTeam.starterRows[0].gameState).toBe("Final");
    expect(myTeam.starterRows[0].remainingProjection).toBe(0);
    expect(myTeam.remainingProjection).toBe(0);
    expect(myTeam.projectedFinal).toBeCloseTo(22.1, 5);
  });

  it("still projects full fpts for an Upcoming starter with no schedule entry", () => {
    const league = mkLeague({ roster_positions: ["QB", "BN"] });
    const rosters = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1"] })];
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["qb1"], players_points: {} })];
    const players = { qb1: mkPlayer({ player_id: "qb1", team: "DAL" }) };
    const projectionData = [mkProjection("qb1", 18.2)];

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projectionData, {}, {});
    const row = built.teams[0].starterRows[0];
    expect(row.gameState).toBe("Upcoming");
    expect(row.remainingProjection).toBe(18.2);
  });

  it("caps remaining at 0 for a Live starter who already exceeded their projection", () => {
    const league = mkLeague({ roster_positions: ["QB", "BN"] });
    const rosters = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1"] })];
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["qb1"], players_points: { qb1: 25 } })];
    const players = { qb1: mkPlayer({ player_id: "qb1", team: "SF" }) };
    const projectionData = [mkProjection("qb1", 10)];
    const scheduleByTeam: Record<string, TeamGameState> = { SF: { kickoffAt: 1, state: "Live" } };

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projectionData, {}, scheduleByTeam);
    expect(built.teams[0].starterRows[0].remainingProjection).toBe(0);
  });

  // Regression: the cross-league Gameday Dashboard passes ONE projectionData
  // set (baked with whatever league happens to be globally selected) across
  // every league it renders. A starter's points must be re-derived under
  // THIS league's own scoring_settings rather than trusting projection.fpts
  // as-is, or switching the globally selected league would silently change
  // every other league's projected scores too.
  it("recomputes a starter's points from this league's own scoring_settings instead of trusting projection.fpts", () => {
    const league = mkLeague({
      roster_positions: ["WR", "BN"],
      scoring_settings: { rec: 0.5, rec_yd: 0.1, rec_td: 6 }, // half-PPR
    });
    const rosters = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["wr1"], players: ["wr1"] })];
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["wr1"], players_points: {} })];
    const players = { wr1: mkPlayer({ player_id: "wr1", position: "WR", team: "SF" }) };
    const projectionData: ProjectionRow[] = [{
      sleeperId: "wr1",
      full_name: "Test WR",
      position: "WR",
      team: "SF",
      fpts: 20, // baked under a DIFFERENT (full-PPR) league's scoring
      sources: ["sleeper"],
      kickoffAt: null,
      stats: { rec: 10, rec_yd: 100 },
      sourceFpts: { sleeper: 20 },
      sourceWeights: { sleeper: 1 },
    }];

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projectionData, {}, {});
    const row = built.teams[0].starterRows[0];
    // Half-PPR: 10 rec * 0.5 + 100 yd * 0.1 = 15 — NOT the baked-in 20.
    expect(row.remainingProjection).toBe(15);
  });

  it("falls back to Team {rosterId} when no owner name is provided", () => {
    const league = mkLeague({ roster_positions: ["QB"] });
    const rosters = [mkRoster({ roster_id: 7, owner_id: "unknown-owner" })];
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 7 })];

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, {}, [], {}, {});
    expect(built.teams[0].ownerName).toBe("Team 7");
  });

  it("sorts bench and taxi rows by remaining + actual points, descending", () => {
    const league = mkLeague({ roster_positions: ["QB", "BN", "BN"] });
    const rosters = [mkRoster({
      roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1", "bench-lo", "bench-hi"],
    })];
    const matchups = [mkMatchup({
      matchup_id: 1, roster_id: 1, starters: ["qb1"],
      players_points: { "bench-lo": 2, "bench-hi": 9 },
    })];
    const players = {
      qb1: mkPlayer({ player_id: "qb1", team: "SF" }),
      "bench-lo": mkPlayer({ player_id: "bench-lo", position: "RB", team: "DAL" }),
      "bench-hi": mkPlayer({ player_id: "bench-hi", position: "RB", team: "DAL" }),
    };

    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, [], {}, {});
    expect(built.teams[0].benchRows.map((r) => r.playerId)).toEqual(["bench-hi", "bench-lo"]);
  });

  it("groups by matchup_id and orders matchups by soonest kickoff, then matchup id", () => {
    const league = mkLeague({ roster_positions: ["QB"], total_rosters: 4 });
    const rosters = [
      mkRoster({ roster_id: 1, owner_id: "a" }),
      mkRoster({ roster_id: 2, owner_id: "b" }),
      mkRoster({ roster_id: 3, owner_id: "c" }),
      mkRoster({ roster_id: 4, owner_id: "d" }),
    ];
    const matchups = [
      mkMatchup({ matchup_id: 2, roster_id: 3, starters: ["p3"] }),
      mkMatchup({ matchup_id: 2, roster_id: 4, starters: ["p4"] }),
      mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["p1"] }),
      mkMatchup({ matchup_id: 1, roster_id: 2, starters: ["p2"] }),
    ];
    const players = {
      p1: mkPlayer({ player_id: "p1", team: "SF" }),
      p2: mkPlayer({ player_id: "p2", team: "SEA" }),
      p3: mkPlayer({ player_id: "p3", team: "DAL" }),
      p4: mkPlayer({ player_id: "p4", team: "NYG" }),
    };
    // matchup 1's team plays sooner than matchup 2's
    const scheduleByTeam: Record<string, TeamGameState> = {
      SF: { kickoffAt: 100, state: "Upcoming" },
      DAL: { kickoffAt: 200, state: "Upcoming" },
    };

    const built = buildGamedayMatchups(league, rosters, matchups, 1, players, [], {}, scheduleByTeam);
    expect(built.map((m) => m.matchupId)).toEqual([1, 2]);
  });
});
