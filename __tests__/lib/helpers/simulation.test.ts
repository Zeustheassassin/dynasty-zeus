import { describe, it, expect } from "vitest";
import { simulateLeague, buildRostersWithTrade, type SimulateLeagueArgs, type PoolPlayer } from "@/lib/helpers/simulation";
import type { LeagueSimulation, SleeperMatchup } from "@/lib/types";

// Characterization ("golden") tests for the season simulator, written BEFORE any refactor or
// Web Worker move (audit Batch 1 step 5). The RNG is seeded from league_id + simSalt, so every
// number below is deterministic. If a snapshot changes, the sim's output changed — that is only
// acceptable when the change is deliberate (also invalidates committed sim rows; see the RNG
// NOTE in simulation.ts).

const N_TEAMS = 6;
const POS = ["QB", "QB", "RB", "RB", "RB", "WR", "WR", "WR", "WR", "TE", "TE"];
const TEAMS = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH"];

function buildFixture() {
  const players: Record<string, unknown> = {};
  const rosters: unknown[] = [];
  let idx = 0;
  for (let r = 1; r <= N_TEAMS; r++) {
    const ids: string[] = [];
    for (const position of POS) {
      const id = String(100 + idx);
      ids.push(id);
      players[id] = {
        player_id: id,
        full_name: `Player ${id}`,
        position,
        team: TEAMS[idx % TEAMS.length],
        age: 21 + ((idx * 7) % 13),
        years_exp: idx % 9 === 0 ? 0 : 1 + (idx % 6),
        // every 4th player has an explicit bye; the rest exercise the team-bye / hash fallback
        bye_week: idx % 4 === 0 ? 5 + (idx % 9) : undefined,
        injury_status: idx === 3 ? "Questionable" : idx === 12 ? "Out" : idx === 20 ? "Doubtful" : null,
        value: 500 + ((idx * 131) % 4000),
      };
      idx++;
    }
    rosters.push({
      roster_id: r, owner_id: `owner${r}`, players: ids,
      settings: { wins: 0, losses: 0, fpts: 0, ppts: 0 },
    });
  }
  const users: Record<string, string> = {};
  for (let r = 1; r <= N_TEAMS; r++) users[`owner${r}`] = `Team ${String.fromCharCode(64 + r)}`;

  const allIds = Object.keys(players);
  const fc: Record<string, number> = {};
  const redraft: Record<string, number> = {};
  const proj: { sleeperId: string; fpts: number }[] = [];
  allIds.forEach((id, i) => {
    fc[id] = 400 + ((i * 97) % 5000);
    redraft[id] = i % 5 === 0 ? 0 : 200 + ((i * 53) % 1800); // some zero -> falls through to projections/FC
    if (i % 3 !== 0) proj.push({ sleeperId: id, fpts: 3 + ((i * 37) % 17) });
  });
  return { players, rosters, users, fc, redraft, proj };
}

const league = (extra: Record<string, unknown> = {}) => ({
  league_id: "1234567890",
  roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SUPER_FLEX", "BN", "BN", "BN"],
  settings: { playoff_week_start: 10, playoff_teams: 4, ...extra },
});

function mkArgs(over: Partial<SimulateLeagueArgs> = {}): SimulateLeagueArgs {
  const f = buildFixture();
  return {
    selectedLeague: league() as never,
    rosters: f.rosters as never,
    players: f.players as never,
    nflState: null,
    projectionData: [],
    projectionWeek: 0,
    playerStats: null,
    leagueWeeklyMatchups: {},
    standings: [],
    users: f.users,
    leagueAdjustedFcValues: f.fc,
    leagueAdjustedRedraftValues: f.redraft,
    projectedRookiesByRoster: new Map<number, PoolPlayer[]>(),
    simSalt: 0,
    ...over,
  };
}

/** Compact, stable view of a simulation: everything a consumer reads, rounded. */
function summarize(sim: LeagueSimulation) {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    meta: {
      currentWeek: sim.currentWeek, mode: sim.simulationMode, regularSeasonWeeks: sim.regularSeasonWeeks,
      playoffTeams: sim.playoffTeams, byeTeams: sim.byeTeams, weeksPlayed: sim.weeksPlayed, simCount: sim.simCount,
    },
    rows: sim.rows.map((x) => ({
      id: x.rosterId, lineup: r1(x.lineupScore), bench: r1(x.benchDepth), power: x.powerScore, sd: r1(x.weeklyStdDev),
      maxPf: x.projectedMaxPf, ew: x.expectedWins, fin: x.avgFinish, proj: x.projectedFinish, range: x.finishRange,
      po: x.playoffOdds, bye: x.byeOdds, title: x.titleOdds, first: x.oneOhOneOdds,
      luck: x.luckScore, apw: x.allPlayWins, opp: x.currentOpponent ?? null,
    })),
    weeks: sim.weeklyMatchups.map((w) => ({
      week: w.week, source: w.source,
      games: w.matchups.map((m) => `${m.aRosterId}v${m.bRosterId}@${Math.round(m.aWinProb * 1000) / 1000}`),
    })),
  };
}

const mkMatchups = (week: number, points: number[]): { week: number; matchups: SleeperMatchup[] } => ({
  week,
  matchups: points.map((p, i) => ({
    matchup_id: Math.floor(i / 2) + 1, roster_id: i + 1, points: p, custom_points: null,
    starters: [], players: [], starters_points: [], players_points: {},
  })),
});

function inSeasonArgs(over: Partial<SimulateLeagueArgs> = {}): SimulateLeagueArgs {
  const f = buildFixture();
  const history = [
    mkMatchups(1, [110, 95, 120, 100, 88, 105]),
    mkMatchups(2, [98, 115, 90, 108, 101, 97]),
    mkMatchups(3, [125, 92, 99, 111, 104, 87]),
  ];
  return mkArgs({
    nflState: { week: 4, season_type: "regular" } as never,
    projectionData: f.proj as never,
    projectionWeek: 4,
    leagueWeeklyMatchups: { "1234567890": history },
    standings: [
      { roster_id: 1, wins: 2, losses: 1, fpts: 355, max_pf: 380 },
      { roster_id: 2, wins: 1, losses: 2, fpts: 302, max_pf: 340 },
      { roster_id: 3, wins: 1, losses: 2, fpts: 309, max_pf: 350 },
      { roster_id: 4, wins: 2, losses: 1, fpts: 319, max_pf: 360 },
      { roster_id: 5, wins: 1, losses: 2, fpts: 293, max_pf: 330 },
      { roster_id: 6, wins: 1, losses: 2, fpts: 289, max_pf: 335 },
    ] as never,
    playerStats: {
      "101": { gamesPlayed: 3, avgTargets: 9, avgCarries: 0 },
      "102": { gamesPlayed: 3, avgTargets: 2, avgCarries: 16 },
    } as never,
    ...over,
  });
}

describe("simulateLeague — guards", () => {
  it("returns null with no league or no rosters", () => {
    expect(simulateLeague(mkArgs({ selectedLeague: null }))).toBeNull();
    expect(simulateLeague(mkArgs({ rosters: [] }))).toBeNull();
  });
});

describe("simulateLeague — determinism", () => {
  it("same inputs give identical output", () => {
    const a = summarize(simulateLeague(mkArgs())!);
    const b = summarize(simulateLeague(mkArgs())!);
    expect(a).toEqual(b);
  });

  it("a different simSalt changes the simulated odds but not the deterministic team strength", () => {
    const a = simulateLeague(mkArgs({ simSalt: 0 }))!;
    const b = simulateLeague(mkArgs({ simSalt: 1 }))!;
    const odds = (s: LeagueSimulation) => s.rows.map((r) => `${r.rosterId}:${r.playoffOdds}/${r.titleOdds}/${r.avgFinish}`).join(",");
    expect(odds(a)).not.toEqual(odds(b));
    const power = (s: LeagueSimulation) => [...s.rows].sort((x, y) => x.rosterId - y.rosterId).map((r) => r.powerScore);
    expect(power(a)).toEqual(power(b));
  });
});

describe("simulateLeague — invariants", () => {
  for (const [label, args] of [["offseason", () => mkArgs()], ["in-season", () => inSeasonArgs()]] as const) {
    it(`${label}: probabilities are internally consistent`, () => {
      const sim = simulateLeague(args())!;
      expect(sim.rows).toHaveLength(N_TEAMS);
      const sum = (f: (r: LeagueSimulation["rows"][number]) => number) => sim.rows.reduce((t, r) => t + f(r), 0);
      // odds are rounded to 0.1% per team, so allow a small rounding envelope
      expect(sum((r) => r.playoffOdds)).toBeCloseTo(sim.playoffTeams * 100, -1);
      expect(Math.abs(sum((r) => r.playoffOdds) - sim.playoffTeams * 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(sum((r) => r.titleOdds) - 100)).toBeLessThanOrEqual(1);
      expect(Math.abs(sum((r) => r.oneOhOneOdds) - 100)).toBeLessThanOrEqual(1);
      sim.rows.forEach((r) => {
        expect(r.finishProbabilities.reduce((t, p) => t + p, 0)).toBeCloseTo(1, 6);
        expect(r.slotProbabilities.reduce((t, p) => t + p, 0)).toBeCloseTo(1, 6);
        expect(r.titleOdds).toBeLessThanOrEqual(r.playoffOdds);
        expect(r.byeOdds).toBeLessThanOrEqual(r.playoffOdds);
        expect(sim.rowByRosterId.get(r.rosterId)).toBe(r);
      });
      // ranked by playoff odds desc
      for (let i = 1; i < sim.rows.length; i++) expect(sim.rows[i - 1].playoffOdds).toBeGreaterThanOrEqual(sim.rows[i].playoffOdds);
    });
  }

  it("offseason uses 350 sims, in-season 250", () => {
    expect(simulateLeague(mkArgs())!.simCount).toBe(350);
    expect(simulateLeague(inSeasonArgs())!.simCount).toBe(250);
  });
});

describe("simulateLeague — golden output", () => {
  it("offseason (no projections, redraft-value fallback)", () => {
    expect(summarize(simulateLeague(mkArgs())!)).toMatchInlineSnapshot(`
      {
        "meta": {
          "byeTeams": 0,
          "currentWeek": 0,
          "mode": "offseason",
          "playoffTeams": 4,
          "regularSeasonWeeks": 9,
          "simCount": 350,
          "weeksPlayed": 0,
        },
        "rows": [
          {
            "apw": 0,
            "bench": 0.6,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.1,
            "first": 9.7,
            "id": 3,
            "lineup": 5.9,
            "luck": 0,
            "maxPf": 53,
            "opp": null,
            "po": 74.6,
            "power": 6.1,
            "proj": 1,
            "range": "1-5",
            "sd": 8,
            "title": 19.4,
          },
          {
            "apw": 0,
            "bench": 0,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.3,
            "first": 13.7,
            "id": 6,
            "lineup": 5.6,
            "luck": 0,
            "maxPf": 50.6,
            "opp": null,
            "po": 72.3,
            "power": 5.6,
            "proj": 2,
            "range": "2-5",
            "sd": 8,
            "title": 18.3,
          },
          {
            "apw": 0,
            "bench": 0.7,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.4,
            "first": 16.9,
            "id": 5,
            "lineup": 4.6,
            "luck": 0,
            "maxPf": 41.5,
            "opp": null,
            "po": 68.6,
            "power": 4.9,
            "proj": 3,
            "range": "2-5",
            "sd": 8,
            "title": 17.7,
          },
          {
            "apw": 0,
            "bench": 0.3,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.6,
            "first": 16,
            "id": 2,
            "lineup": 3.8,
            "luck": 0,
            "maxPf": 34,
            "opp": null,
            "po": 66.3,
            "power": 3.9,
            "proj": 4,
            "range": "2-5",
            "sd": 8,
            "title": 14.6,
          },
          {
            "apw": 0,
            "bench": 0.1,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.8,
            "first": 17.4,
            "id": 4,
            "lineup": 2.4,
            "luck": 0,
            "maxPf": 21.5,
            "opp": null,
            "po": 60,
            "power": 2.4,
            "proj": 5,
            "range": "2-5",
            "sd": 8,
            "title": 13.1,
          },
          {
            "apw": 0,
            "bench": 0.1,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.8,
            "first": 26.3,
            "id": 1,
            "lineup": 1.7,
            "luck": 0,
            "maxPf": 14.9,
            "opp": null,
            "po": 58.3,
            "power": 1.7,
            "proj": 6,
            "range": "2-6",
            "sd": 8,
            "title": 16.9,
          },
        ],
        "weeks": [
          {
            "games": [
              "1v6@0.431",
              "2v5@0.482",
              "3v4@0.566",
            ],
            "source": "generated",
            "week": 1,
          },
          {
            "games": [
              "1v5@0.443",
              "6v4@0.557",
              "2v3@0.461",
            ],
            "source": "generated",
            "week": 2,
          },
          {
            "games": [
              "1v4@0.488",
              "5v3@0.479",
              "6v2@0.53",
            ],
            "source": "generated",
            "week": 3,
          },
          {
            "games": [
              "1v3@0.422",
              "4v2@0.473",
              "5v6@0.488",
            ],
            "source": "generated",
            "week": 4,
          },
        ],
      }
    `);
  });

  it("offseason with projected rookies added to rosters", () => {
    const rookies = new Map<number, PoolPlayer[]>([
      [1, [{ id: "r1", position: "WR", nflTeam: "AAA", score: 14 }]],
      [3, [{ id: "r2", position: "QB", nflTeam: "BBB", score: 18 }, { id: "r3", position: "RB", nflTeam: "CCC", score: 12 }]],
    ]);
    expect(summarize(simulateLeague(mkArgs({ projectedRookiesByRoster: rookies }))!)).toMatchInlineSnapshot(`
      {
        "meta": {
          "byeTeams": 0,
          "currentWeek": 0,
          "mode": "offseason",
          "playoffTeams": 4,
          "regularSeasonWeeks": 9,
          "simCount": 350,
          "weeksPlayed": 0,
        },
        "rows": [
          {
            "apw": 0,
            "bench": 1.9,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.1,
            "first": 10.6,
            "id": 3,
            "lineup": 7.9,
            "luck": 0,
            "maxPf": 71.5,
            "opp": null,
            "po": 78.3,
            "power": 8.6,
            "proj": 1,
            "range": "1-5",
            "sd": 8,
            "title": 22.9,
          },
          {
            "apw": 0,
            "bench": 0,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.2,
            "first": 14,
            "id": 6,
            "lineup": 5.6,
            "luck": 0,
            "maxPf": 50.6,
            "opp": null,
            "po": 74.6,
            "power": 5.6,
            "proj": 1,
            "range": "1-5",
            "sd": 8,
            "title": 15.1,
          },
          {
            "apw": 0,
            "bench": 0.7,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.4,
            "first": 13.7,
            "id": 5,
            "lineup": 4.6,
            "luck": 0,
            "maxPf": 41.5,
            "opp": null,
            "po": 69.7,
            "power": 4.9,
            "proj": 2,
            "range": "2-5",
            "sd": 8,
            "title": 17.1,
          },
          {
            "apw": 0,
            "bench": 0.3,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.6,
            "first": 13.7,
            "id": 2,
            "lineup": 3.8,
            "luck": 0,
            "maxPf": 34,
            "opp": null,
            "po": 63.1,
            "power": 3.9,
            "proj": 5,
            "range": "2-5",
            "sd": 8,
            "title": 14.6,
          },
          {
            "apw": 0,
            "bench": 0.2,
            "bye": 0,
            "ew": 4.5,
            "fin": 3.7,
            "first": 20.3,
            "id": 1,
            "lineup": 3.1,
            "luck": 0,
            "maxPf": 27.7,
            "opp": null,
            "po": 59.4,
            "power": 3.2,
            "proj": 5,
            "range": "2-6",
            "sd": 8,
            "title": 14.9,
          },
          {
            "apw": 0,
            "bench": 0.1,
            "bye": 0,
            "ew": 4.5,
            "fin": 4,
            "first": 27.7,
            "id": 4,
            "lineup": 2.4,
            "luck": 0,
            "maxPf": 21.5,
            "opp": null,
            "po": 54.9,
            "power": 2.4,
            "proj": 6,
            "range": "2-6",
            "sd": 8,
            "title": 15.4,
          },
        ],
        "weeks": [
          {
            "games": [
              "1v6@0.457",
              "2v5@0.482",
              "3v4@0.609",
            ],
            "source": "generated",
            "week": 1,
          },
          {
            "games": [
              "1v5@0.47",
              "6v4@0.557",
              "2v3@0.417",
            ],
            "source": "generated",
            "week": 2,
          },
          {
            "games": [
              "1v4@0.514",
              "5v3@0.434",
              "6v2@0.53",
            ],
            "source": "generated",
            "week": 3,
          },
          {
            "games": [
              "1v3@0.405",
              "4v2@0.473",
              "5v6@0.488",
            ],
            "source": "generated",
            "week": 4,
          },
        ],
      }
    `);
  });

  it("in-season week 4 with history, standings, usage stats", () => {
    expect(summarize(simulateLeague(inSeasonArgs())!)).toMatchInlineSnapshot(`
      {
        "meta": {
          "byeTeams": 0,
          "currentWeek": 4,
          "mode": "in_season",
          "playoffTeams": 4,
          "regularSeasonWeeks": 9,
          "simCount": 250,
          "weeksPlayed": 3,
        },
        "rows": [
          {
            "apw": 4,
            "bench": 12.6,
            "bye": 0,
            "ew": 5.4,
            "fin": 2.2,
            "first": 2.8,
            "id": 6,
            "lineup": 104,
            "luck": 0.2,
            "maxPf": 624,
            "opp": "Team E",
            "po": 92.8,
            "power": 108.4,
            "proj": 1,
            "range": "1-3",
            "sd": 13.7,
            "title": 55.6,
          },
          {
            "apw": 7,
            "bench": 9,
            "bye": 0,
            "ew": 5,
            "fin": 2.5,
            "first": 2.4,
            "id": 3,
            "lineup": 97.4,
            "luck": -0.4,
            "maxPf": 584.5,
            "opp": "Team A",
            "po": 90.8,
            "power": 100.6,
            "proj": 1,
            "range": "1-4",
            "sd": 15.5,
            "title": 31.6,
          },
          {
            "apw": 11,
            "bench": 4.4,
            "bye": 0,
            "ew": 4.1,
            "fin": 3.4,
            "first": 10.8,
            "id": 1,
            "lineup": 83.7,
            "luck": -0.2,
            "maxPf": 502.2,
            "opp": "Team C",
            "po": 74.4,
            "power": 85.3,
            "proj": 3,
            "range": "2-5",
            "sd": 13.2,
            "title": 4.4,
          },
          {
            "apw": 10,
            "bench": 5.6,
            "bye": 0,
            "ew": 4.4,
            "fin": 3.6,
            "first": 8.4,
            "id": 4,
            "lineup": 67.8,
            "luck": 0,
            "maxPf": 406.8,
            "opp": "Team B",
            "po": 68.4,
            "power": 69.8,
            "proj": 5,
            "range": "2-5",
            "sd": 10.5,
            "title": 3.2,
          },
          {
            "apw": 7,
            "bench": 6.3,
            "bye": 0,
            "ew": 3.7,
            "fin": 4.5,
            "first": 30.4,
            "id": 2,
            "lineup": 85.9,
            "luck": -0.4,
            "maxPf": 515.2,
            "opp": "Team D",
            "po": 46.4,
            "power": 88.1,
            "proj": 6,
            "range": "3-6",
            "sd": 13.6,
            "title": 3.2,
          },
          {
            "apw": 6,
            "bench": 13.2,
            "bye": 0,
            "ew": 3.4,
            "fin": 4.9,
            "first": 45.2,
            "id": 5,
            "lineup": 86.2,
            "luck": -0.2,
            "maxPf": 517.3,
            "opp": "Team F",
            "po": 27.2,
            "power": 90.8,
            "proj": 6,
            "range": "4-6",
            "sd": 13.1,
            "title": 2,
          },
        ],
        "weeks": [
          {
            "games": [
              "1v3@0.251",
              "4v2@0.213",
              "5v6@0.221",
            ],
            "source": "generated",
            "week": 4,
          },
          {
            "games": [
              "1v2@0.45",
              "3v6@0.364",
              "4v5@0.182",
            ],
            "source": "generated",
            "week": 5,
          },
          {
            "games": [
              "1v6@0.161",
              "2v5@0.452",
              "3v4@0.9",
            ],
            "source": "generated",
            "week": 6,
          },
          {
            "games": [
              "1v5@0.403",
              "6v4@0.94",
              "2v3@0.291",
            ],
            "source": "generated",
            "week": 7,
          },
        ],
      }
    `);
  });

  it("in-season with Sleeper league-median scoring on", () => {
    const withMedian = inSeasonArgs({ selectedLeague: league({ league_average_match: 1 }) as never });
    const noMedian = simulateLeague(inSeasonArgs())!;
    const sim = simulateLeague(withMedian)!;
    // median bonus adds up to one extra win per projected week -> strictly more expected wins overall
    const total = (s: LeagueSimulation) => s.rows.reduce((t, r) => t + r.expectedWins, 0);
    expect(total(sim)).toBeGreaterThan(total(noMedian));
    expect(summarize(sim)).toMatchInlineSnapshot(`
      {
        "meta": {
          "byeTeams": 0,
          "currentWeek": 4,
          "mode": "in_season",
          "playoffTeams": 4,
          "regularSeasonWeeks": 9,
          "simCount": 250,
          "weeksPlayed": 3,
        },
        "rows": [
          {
            "apw": 4,
            "bench": 12.6,
            "bye": 0,
            "ew": 9.1,
            "fin": 1.6,
            "first": 0.4,
            "id": 6,
            "lineup": 104,
            "luck": 0.2,
            "maxPf": 624,
            "opp": "Team E",
            "po": 98,
            "power": 108.4,
            "proj": 1,
            "range": "1-2",
            "sd": 13.7,
            "title": 58,
          },
          {
            "apw": 7,
            "bench": 9,
            "bye": 0,
            "ew": 7.9,
            "fin": 2,
            "first": 0.8,
            "id": 3,
            "lineup": 97.4,
            "luck": -0.4,
            "maxPf": 584.5,
            "opp": "Team A",
            "po": 97.2,
            "power": 100.6,
            "proj": 2,
            "range": "1-3",
            "sd": 15.5,
            "title": 30,
          },
          {
            "apw": 11,
            "bench": 4.4,
            "bye": 0,
            "ew": 4.7,
            "fin": 3.9,
            "first": 12,
            "id": 1,
            "lineup": 83.7,
            "luck": -0.2,
            "maxPf": 502.2,
            "opp": "Team C",
            "po": 65.6,
            "power": 85.3,
            "proj": 3,
            "range": "3-5",
            "sd": 13.2,
            "title": 4,
          },
          {
            "apw": 10,
            "bench": 5.6,
            "bye": 0,
            "ew": 4.4,
            "fin": 4.5,
            "first": 21.2,
            "id": 4,
            "lineup": 67.8,
            "luck": 0,
            "maxPf": 406.8,
            "opp": "Team B",
            "po": 47.2,
            "power": 69.8,
            "proj": 5,
            "range": "3-6",
            "sd": 10.5,
            "title": 1.2,
          },
          {
            "apw": 7,
            "bench": 6.3,
            "bye": 0,
            "ew": 4.3,
            "fin": 4.6,
            "first": 33.6,
            "id": 2,
            "lineup": 85.9,
            "luck": -0.4,
            "maxPf": 515.2,
            "opp": "Team D",
            "po": 46.8,
            "power": 88.1,
            "proj": 6,
            "range": "3-6",
            "sd": 13.6,
            "title": 3.2,
          },
          {
            "apw": 6,
            "bench": 13.2,
            "bye": 0,
            "ew": 4.6,
            "fin": 4.5,
            "first": 32,
            "id": 5,
            "lineup": 86.2,
            "luck": -0.2,
            "maxPf": 517.3,
            "opp": "Team F",
            "po": 45.2,
            "power": 90.8,
            "proj": 6,
            "range": "3-6",
            "sd": 13.1,
            "title": 3.6,
          },
        ],
        "weeks": [
          {
            "games": [
              "1v3@0.251",
              "4v2@0.213",
              "5v6@0.221",
            ],
            "source": "generated",
            "week": 4,
          },
          {
            "games": [
              "1v2@0.45",
              "3v6@0.364",
              "4v5@0.182",
            ],
            "source": "generated",
            "week": 5,
          },
          {
            "games": [
              "1v6@0.161",
              "2v5@0.452",
              "3v4@0.9",
            ],
            "source": "generated",
            "week": 6,
          },
          {
            "games": [
              "1v5@0.403",
              "6v4@0.94",
              "2v3@0.291",
            ],
            "source": "generated",
            "week": 7,
          },
        ],
      }
    `);
  });

  it("projection week mismatch ignores projectionData (falls back to values)", () => {
    const sim = simulateLeague(inSeasonArgs({ projectionWeek: 9 }))!;
    const withProj = simulateLeague(inSeasonArgs())!;
    const power = (s: LeagueSimulation) => s.rows.map((r) => `${r.rosterId}:${r.powerScore}`).sort().join(",");
    expect(power(sim)).not.toEqual(power(withProj));
  });
});

describe("buildRostersWithTrade", () => {
  const rosters = [
    { roster_id: 1, players: ["a", "b", "c"] },
    { roster_id: 2, players: ["x", "y"] },
    { roster_id: 3, players: ["z"] },
  ] as never;

  it("swaps assets between the two rosters and leaves others untouched", () => {
    const out = buildRostersWithTrade(rosters, 1, 2, ["a"], ["x", "y"]) as unknown as { roster_id: number; players: string[] }[];
    expect(out.find((r) => r.roster_id === 1)!.players.sort()).toEqual(["b", "c", "x", "y"]);
    expect(out.find((r) => r.roster_id === 2)!.players.sort()).toEqual(["a"]);
    expect(out.find((r) => r.roster_id === 3)!.players).toEqual(["z"]);
  });

  it("returns the same array for an empty trade and does not mutate the input", () => {
    expect(buildRostersWithTrade(rosters, 1, 2, [], [])).toBe(rosters);
    buildRostersWithTrade(rosters, 1, 2, ["a"], ["x"]);
    expect((rosters as unknown as { players: string[] }[])[0].players).toEqual(["a", "b", "c"]);
  });
});
