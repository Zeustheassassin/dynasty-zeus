import { describe, it, expect } from "vitest";
import {
  resolveGameState, buildGamedayMatchups, getKickoffState, getGamedayResultStatus, getMatchupWinProbability,
} from "@/lib/helpers/gameday";
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

/** A scoreboard big enough to be trusted (12 other teams playing). */
const fullSchedule = (extra: Record<string, TeamGameState> = {}): Record<string, TeamGameState> => {
  const out: Record<string, TeamGameState> = {};
  for (let i = 0; i < 12; i++) out[`T${i}`] = { kickoffAt: 1, state: "Upcoming" };
  return { ...out, ...extra };
};

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

  it("reports No game for a team missing from a complete scoreboard (bye week)", () => {
    expect(resolveGameState("SEA", fullSchedule(), 999)).toEqual({ state: "No game", kickoffAt: null });
  });

  it("does NOT call it a bye when the scoreboard is empty or partial (failed fetch)", () => {
    const partial: Record<string, TeamGameState> = { SF: { kickoffAt: 1, state: "Live" }, DAL: { kickoffAt: 1, state: "Live" } };
    expect(resolveGameState("SEA", {}, null).state).toBe("Upcoming");
    expect(resolveGameState("SEA", partial, null).state).toBe("Upcoming");
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

  it("with no clock data on a Live game, falls back to projection minus points so far (never negative)", () => {
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

// ── live accuracy ────────────────────────────────────────────────────────

describe("buildGamedayMatchups — live accuracy", () => {
  const league = mkLeague({ roster_positions: ["QB", "BN"] });
  const rosters = [
    mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1"] }),
    mkRoster({ roster_id: 2, owner_id: "opp", starters: ["qb2"], players: ["qb2"] }),
  ];
  const players = {
    qb1: mkPlayer({ player_id: "qb1", team: "SF", position: "QB", full_name: "Mine" }),
    qb2: mkPlayer({ player_id: "qb2", team: "SEA", position: "QB", full_name: "Theirs" }),
  };
  const build = (
    schedule: Record<string, TeamGameState>,
    opts: { myActual?: number; myProj?: number; oppProj?: number; oppActual?: number; playerOverrides?: Record<string, SleeperPlayer> } = {}
  ) => {
    const matchups = [
      mkMatchup({ matchup_id: 1, roster_id: 1, points: opts.myActual ?? 0, starters: ["qb1"], players_points: { qb1: opts.myActual ?? 0 } }),
      mkMatchup({ matchup_id: 1, roster_id: 2, points: opts.oppActual ?? 0, starters: ["qb2"], players_points: { qb2: opts.oppActual ?? 0 } }),
    ];
    const projectionData = [
      mkProjection("qb1", opts.myProj ?? 20),
      { ...mkProjection("qb2", opts.oppProj ?? 20), team: "SEA" },
    ];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, opts.playerOverrides ?? players, projectionData, {}, schedule);
    const mine = built.teams.find((t) => t.rosterId === 1)!;
    const theirs = built.teams.find((t) => t.rosterId === 2)!;
    return { mine, theirs, myRow: mine.starterRows[0], theirRow: theirs.starterRows[0] };
  };

  it("keeps projecting a Live player who already passed their pre-game number, using the game clock (the reported 'no points left at halftime' bug)", () => {
    const schedule = fullSchedule({ SF: { kickoffAt: 1, state: "Live", status: "halftime", period: 2, clockSeconds: 0, score: 14, oppScore: 14 } });
    const { myRow } = build(schedule, { myActual: 25, myProj: 10 });
    expect(myRow.remainingProjection).toBeGreaterThan(0);
    expect(myRow.projectedFinal).toBeCloseTo(25 + myRow.remainingProjection, 10);
  });

  it("scales remaining projection by the time left: halfway through at exact pace, half is left", () => {
    const schedule = fullSchedule({ SF: { kickoffAt: 1, state: "Live", status: "halftime", period: 2, clockSeconds: 0 } });
    const { myRow } = build(schedule, { myActual: 10, myProj: 20 });
    expect(myRow.remainingProjection).toBeCloseTo(10, 6);
  });

  it("projects less the later it is, for the same points scored", () => {
    const q2 = fullSchedule({ SF: { kickoffAt: 1, state: "Live", period: 2, clockSeconds: 450 } });
    const q4 = fullSchedule({ SF: { kickoffAt: 1, state: "Live", period: 4, clockSeconds: 450 } });
    expect(build(q4, { myActual: 12, myProj: 20 }).myRow.remainingProjection)
      .toBeLessThan(build(q2, { myActual: 12, myProj: 20 }).myRow.remainingProjection);
  });

  it("shows the live game detail on the row and leaves Upcoming rows plain", () => {
    const schedule = fullSchedule({
      SF: { kickoffAt: 1, state: "Live", period: 3, clockSeconds: 252, clockDisplay: "4:12", score: 17, oppScore: 10, hasPossession: true },
      SEA: { kickoffAt: 5, state: "Upcoming" },
    });
    const { myRow, theirRow } = build(schedule);
    expect(myRow.gameDetail).toBe("Q3 4:12 · SF 17-10 · SF ball");
    expect(theirRow.gameDetail).toBe("");
  });

  it("marks a starter whose team has no game as 'No game' with nothing left to score, and counts them separately", () => {
    // SF is missing from an otherwise complete scoreboard.
    const { mine, myRow } = build(fullSchedule({ SEA: { kickoffAt: 5, state: "Upcoming" } }), { myProj: 20 });
    expect(myRow.gameState).toBe("No game");
    expect(myRow.remainingProjection).toBe(0);
    expect(mine.noGameStarters).toBe(1);
    expect(mine.upcomingStarters).toBe(0);
    expect(mine.projectedFinal).toBe(0);
  });

  it("still counts an Upcoming projection when the scoreboard simply failed to load", () => {
    const { myRow } = build({}, { myProj: 20 });
    expect(myRow.gameState).toBe("Upcoming");
    expect(myRow.remainingProjection).toBeCloseTo(20, 10);
  });

  it("zeroes a starter ruled Out even though their game hasn't started", () => {
    const out = { ...players, qb1: mkPlayer({ player_id: "qb1", team: "SF", position: "QB", injury_status: "Out" }) };
    const schedule = fullSchedule({ SF: { kickoffAt: 5, state: "Upcoming" }, SEA: { kickoffAt: 5, state: "Upcoming" } });
    const { mine, myRow } = build(schedule, { myProj: 20, playerOverrides: out });
    expect(myRow.remainingProjection).toBe(0);
    expect(mine.remainingProjection).toBe(0);
    expect(myRow.remainingStdDev).toBe(0);
  });

  it("discounts a Doubtful starter rather than zeroing them", () => {
    const doubtful = { ...players, qb1: mkPlayer({ player_id: "qb1", team: "SF", position: "QB", injury_status: "Doubtful" }) };
    const schedule = fullSchedule({ SF: { kickoffAt: 5, state: "Upcoming" }, SEA: { kickoffAt: 5, state: "Upcoming" } });
    const { myRow } = build(schedule, { myProj: 20, playerOverrides: doubtful });
    expect(myRow.remainingProjection).toBeCloseTo(4, 10);
  });

  it("gives a team a remaining spread that shrinks as its games finish", () => {
    const pre = fullSchedule({ SF: { kickoffAt: 5, state: "Upcoming" }, SEA: { kickoffAt: 5, state: "Upcoming" } });
    const late = fullSchedule({ SF: { kickoffAt: 1, state: "Live", period: 4, clockSeconds: 120 }, SEA: { kickoffAt: 5, state: "Upcoming" } });
    const done = fullSchedule({ SF: { kickoffAt: 1, state: "Final" }, SEA: { kickoffAt: 5, state: "Upcoming" } });
    const sd = (sched: Record<string, TeamGameState>) => build(sched, { myActual: 15 }).mine.remainingStdDev;
    expect(sd(pre)).toBeGreaterThan(sd(late));
    expect(sd(late)).toBeGreaterThan(sd(done));
    expect(sd(done)).toBe(0);
  });

  it("reports bench regret so far, counting only non-IR non-taxi bench players", () => {
    const l = mkLeague({ roster_positions: ["QB", "BN", "BN"] });
    const r = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1", "qb-bench", "qb-ir"], reserve: ["qb-ir"] })];
    const m = [mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["qb1"], players_points: { qb1: 6, "qb-bench": 15, "qb-ir": 40 } })];
    const pl = {
      qb1: mkPlayer({ player_id: "qb1", full_name: "Starter" }),
      "qb-bench": mkPlayer({ player_id: "qb-bench", full_name: "Bench QB" }),
      "qb-ir": mkPlayer({ player_id: "qb-ir", full_name: "IR QB" }),
    };
    const [built] = buildGamedayMatchups(l, r, m, 1, pl, [], {}, {});
    const regret = built.teams[0].benchRegret;
    expect(regret.points).toBe(9); // Bench QB 15 vs starter 6 — the 40-pt IR player can't be started
    expect(regret.swaps).toHaveLength(1);
    expect(regret.swaps[0]).toMatchObject({ benchName: "Bench QB", starterName: "Starter", gain: 9 });
  });
});

describe("win probability", () => {
  const league = mkLeague({ roster_positions: ["QB", "BN"] });
  const rosters = [
    mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb1"], players: ["qb1"] }),
    mkRoster({ roster_id: 2, owner_id: "opp", starters: ["qb2"], players: ["qb2"] }),
  ];
  const players = {
    qb1: mkPlayer({ player_id: "qb1", team: "SF" }),
    qb2: mkPlayer({ player_id: "qb2", team: "SEA" }),
  };
  const teams = (schedule: Record<string, TeamGameState>, my: { pts: number; proj: number }, opp: { pts: number; proj: number }) => {
    const matchups = [
      mkMatchup({ matchup_id: 1, roster_id: 1, points: my.pts, starters: ["qb1"], players_points: { qb1: my.pts } }),
      mkMatchup({ matchup_id: 1, roster_id: 2, points: opp.pts, starters: ["qb2"], players_points: { qb2: opp.pts } }),
    ];
    const projectionData = [mkProjection("qb1", my.proj), { ...mkProjection("qb2", opp.proj), team: "SEA" }];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projectionData, {}, schedule);
    return { me: built.teams.find((t) => t.rosterId === 1)!, opp: built.teams.find((t) => t.rosterId === 2)! };
  };
  const upcoming = fullSchedule({ SF: { kickoffAt: 5, state: "Upcoming" }, SEA: { kickoffAt: 5, state: "Upcoming" } });
  const bothFinal = fullSchedule({ SF: { kickoffAt: 1, state: "Final" }, SEA: { kickoffAt: 1, state: "Final" } });

  it("favors the team with the higher projected final, and the two sides sum to 1", () => {
    const { me, opp } = teams(upcoming, { pts: 0, proj: 25 }, { pts: 0, proj: 15 });
    const p = getMatchupWinProbability(me, opp);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
    expect(getMatchupWinProbability(opp, me)).toBeCloseTo(1 - p!, 10);
  });

  it("is a coin flip between identical teams", () => {
    const { me, opp } = teams(upcoming, { pts: 0, proj: 20 }, { pts: 0, proj: 20 });
    expect(getMatchupWinProbability(me, opp)).toBeCloseTo(0.5, 6);
  });

  it("is exactly 1 / 0 / 0.5 once every starter is done", () => {
    let t = teams(bothFinal, { pts: 30, proj: 10 }, { pts: 12, proj: 30 });
    expect(getMatchupWinProbability(t.me, t.opp)).toBe(1);
    expect(getMatchupWinProbability(t.opp, t.me)).toBe(0);
    t = teams(bothFinal, { pts: 20, proj: 10 }, { pts: 20, proj: 10 });
    expect(getMatchupWinProbability(t.me, t.opp)).toBe(0.5);
  });

  it("moves with the game: a team up big with little time left is a near-lock", () => {
    const late = fullSchedule({
      SF: { kickoffAt: 1, state: "Live", period: 4, clockSeconds: 60 },
      SEA: { kickoffAt: 1, state: "Live", period: 4, clockSeconds: 60 },
    });
    const early = fullSchedule({
      SF: { kickoffAt: 1, state: "Live", period: 1, clockSeconds: 600 },
      SEA: { kickoffAt: 1, state: "Live", period: 1, clockSeconds: 600 },
    });
    const lateT = teams(late, { pts: 30, proj: 20 }, { pts: 10, proj: 20 });
    const earlyT = teams(early, { pts: 30, proj: 20 }, { pts: 10, proj: 20 });
    expect(getMatchupWinProbability(lateT.me, lateT.opp)).toBeGreaterThan(0.97);
    expect(getMatchupWinProbability(lateT.me, lateT.opp)).toBeGreaterThan(getMatchupWinProbability(earlyT.me, earlyT.opp)!);
  });

  it("getGamedayResultStatus carries the win probability and the points needed", () => {
    const { me, opp } = teams(upcoming, { pts: 5, proj: 20 }, { pts: 0, proj: 30 });
    const result = getGamedayResultStatus(me, opp)!;
    expect(result.final).toBe(false);
    expect(result.status).toBe("loss");
    expect(result.winProbability).toBeLessThan(0.5);
    // Opponent projects to 30; I have 5, so I need 25 from my remaining starters.
    expect(result.pointsNeeded).toBeCloseTo(25, 6);
  });

  it("getGamedayResultStatus goes to actual points, certainty and no points needed once final", () => {
    const { me, opp } = teams(bothFinal, { pts: 30, proj: 10 }, { pts: 12, proj: 30 });
    expect(getGamedayResultStatus(me, opp)).toMatchObject({ status: "win", final: true, winProbability: 1, pointsNeeded: 0 });
  });

  it("reports NO win probability while games remain but no projections are loaded (never a made-up 100%)", () => {
    // No projection rows: nothing left to score on either side, though games are still upcoming.
    const matchups = [
      mkMatchup({ matchup_id: 1, roster_id: 1, points: 27.7, starters: ["qb1"], players_points: { qb1: 27.7 } }),
      mkMatchup({ matchup_id: 1, roster_id: 2, points: 17.5, starters: ["qb2"], players_points: { qb2: 17.5 } }),
    ];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, [], {}, upcoming);
    const [a, b] = built.teams;
    expect(getMatchupWinProbability(a, b)).toBeNull();
    expect(getGamedayResultStatus(a, b)?.winProbability).toBeNull();
  });

  it("still reports 1/0 for a decided matchup even with no projections", () => {
    const matchups = [
      mkMatchup({ matchup_id: 1, roster_id: 1, points: 27.7, starters: ["qb1"], players_points: { qb1: 27.7 } }),
      mkMatchup({ matchup_id: 1, roster_id: 2, points: 17.5, starters: ["qb2"], players_points: { qb2: 17.5 } }),
    ];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, [], {}, bothFinal);
    const me = built.teams.find((t) => t.actualPoints === 27.7)!;
    const opp = built.teams.find((t) => t.actualPoints === 17.5)!;
    expect(getMatchupWinProbability(me, opp)).toBe(1);
  });

  it("returns null when either team is missing", () => {
    const { me } = teams(upcoming, { pts: 0, proj: 10 }, { pts: 0, proj: 10 });
    expect(getGamedayResultStatus(me, null)).toBeNull();
  });
});

// ── per-stat pace, correlation, ESPN injury overlay through the builder ──

describe("buildGamedayMatchups — per-stat pace and correlation", () => {
  const scoring = { rec: 1, rec_yd: 0.1, rec_td: 6, pass_yd: 0.04, pass_td: 4 };
  const league = mkLeague({ roster_positions: ["WR", "BN"], scoring_settings: scoring });
  const rosters = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["wr1"], players: ["wr1"] })];
  const players = { wr1: mkPlayer({ player_id: "wr1", team: "SF", position: "WR" }) };
  const halftime = fullSchedule({ SF: { kickoffAt: 1, state: "Live", status: "halftime", period: 2, clockSeconds: 0 } });
  const wrProjection: ProjectionRow = {
    ...mkProjection("wr1", 17.6), position: "WR", stats: { rec: 6, rec_yd: 80, rec_td: 0.6 },
  };
  const build = (actual: number, liveStats: Record<string, Record<string, number>>, sched = halftime) => {
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, points: actual, starters: ["wr1"], players_points: { wr1: actual } })];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, [wrProjection], {}, sched, liveStats);
    return built.teams[0].starterRows[0];
  };

  it("uses per-stat pace when a live stat line agrees with Sleeper's official points", () => {
    const row = build(7, { wr1: { rec: 3, rec_yd: 40 } }); // scores 3 + 4 = 7
    expect(row.paceSource).toBe("stats");
    expect(row.remainingProjection).toBeCloseTo(8.8, 6);
  });

  it("ignores a stat feed that disagrees with the official points (lagging feed) and falls back to points pace", () => {
    const row = build(20, { wr1: { rec: 3, rec_yd: 40 } }); // stats say 7, Sleeper says 20
    expect(row.paceSource).toBe("points");
  });

  it("falls back to points pace when there is no live stat line for the player", () => {
    expect(build(7, {}).paceSource).toBe("points");
  });

  it("falls back to points pace when the projection has no stat line to pace against", () => {
    const noStats = { ...wrProjection, stats: null };
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, points: 7, starters: ["wr1"], players_points: { wr1: 7 } })];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, [noStats], {}, halftime, { wr1: { rec: 3, rec_yd: 40 } });
    expect(built.teams[0].starterRows[0].paceSource).toBe("points");
  });

  it("marks pre-game and finished players as 'projection', and never reads stats for them", () => {
    const pre = fullSchedule({ SF: { kickoffAt: 5, state: "Upcoming" } });
    const done = fullSchedule({ SF: { kickoffAt: 1, state: "Final" } });
    expect(build(0, { wr1: { rec: 3, rec_yd: 40 } }, pre).paceSource).toBe("projection");
    expect(build(7, { wr1: { rec: 3, rec_yd: 40 } }, done).paceSource).toBe("projection");
  });

  it("does not extrapolate a fluke touchdown — a 2-TD half doesn't project 2 more", () => {
    const row = build(3 + 4 + 12, { wr1: { rec: 3, rec_yd: 40, rec_td: 2 } }); // official 19 = 3+4+12 → stats agree
    expect(row.paceSource).toBe("stats");
    // On-pace yardage (factor 1) and TD regressed to the projection: 8.8 remaining, not ~20.
    expect(row.remainingProjection).toBeCloseTo(8.8, 6);
  });
});

describe("buildGamedayMatchups — correlation", () => {
  const league = mkLeague({ roster_positions: ["QB", "WR", "BN"] });
  const sched = fullSchedule({
    SF: { kickoffAt: 5, state: "Upcoming", opponent: "SEA" },
    SEA: { kickoffAt: 5, state: "Upcoming", opponent: "SF" },
    DAL: { kickoffAt: 5, state: "Upcoming", opponent: "NYG" },
  });
  const rosters = [mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb", "wr"], players: ["qb", "wr"] })];
  const stdFor = (wrTeam: string) => {
    const players = {
      qb: mkPlayer({ player_id: "qb", team: "SF", position: "QB" }),
      wr: mkPlayer({ player_id: "wr", team: wrTeam, position: "WR" }),
    };
    const projections = [
      { ...mkProjection("qb", 20), position: "QB" },
      { ...mkProjection("wr", 15), position: "WR", team: wrTeam },
    ];
    const matchups = [mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["qb", "wr"], players_points: {} })];
    const [built] = buildGamedayMatchups(league, rosters, matchups, 1, players, projections, {}, sched);
    const t = built.teams[0];
    const independent = Math.sqrt(t.starterRows.reduce((s, r) => s + r.remainingStdDev ** 2, 0));
    return { team: t.remainingStdDev, independent };
  };

  it("widens a team's spread when its QB and WR share an NFL team", () => {
    const stacked = stdFor("SF");
    expect(stacked.team).toBeGreaterThan(stacked.independent);
  });

  it("leaves it unchanged when the QB and WR are in different games", () => {
    const apart = stdFor("DAL");
    expect(apart.team).toBeCloseTo(apart.independent, 10);
  });

  it("tightens the score difference when the OPPONENT starts a player from my QB's team", () => {
    const players = {
      qb: mkPlayer({ player_id: "qb", team: "SF", position: "QB" }),
      wrSame: mkPlayer({ player_id: "wrSame", team: "SF", position: "WR" }),
      wrOther: mkPlayer({ player_id: "wrOther", team: "DAL", position: "WR" }),
    };
    const projections = [
      { ...mkProjection("qb", 20), position: "QB" },
      { ...mkProjection("wrSame", 16), position: "WR", team: "SF" },
      { ...mkProjection("wrOther", 16), position: "WR", team: "DAL" },
    ];
    const l = mkLeague({ roster_positions: ["QB"] });
    const winProb = (oppWr: string) => {
      const rs = [
        mkRoster({ roster_id: 1, owner_id: "me", starters: ["qb"], players: ["qb"] }),
        mkRoster({ roster_id: 2, owner_id: "opp", starters: [oppWr], players: [oppWr] }),
      ];
      const ms = [
        mkMatchup({ matchup_id: 1, roster_id: 1, starters: ["qb"] }),
        mkMatchup({ matchup_id: 1, roster_id: 2, starters: [oppWr] }),
      ];
      const [built] = buildGamedayMatchups(l, rs, ms, 1, players, projections, {}, sched);
      const me = built.teams.find((t) => t.rosterId === 1)!;
      const opp = built.teams.find((t) => t.rosterId === 2)!;
      return getMatchupWinProbability(me, opp)!;
    };
    // Same means either way (QB 20 vs WR 16); the shared-team opponent moves with my QB.
    expect(winProb("wrSame")).toBeGreaterThan(winProb("wrOther"));
  });
});
