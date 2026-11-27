import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countInSampleReady, countsInSample, inSample, isImportedGame, sampleGameCounts, sampleGameToProspect,
  sampleGames, sampleSwitchFor, setAsideGameIds, showsSampleSwitch,
} from "@/lib/scouting/sampleGames";
import { computeRBAboveExpectedSamples, isKnownRun } from "@/lib/scouting/aboveExpected";
import { buildProspectsWithStats, buildWRModel, type ProspectGameRouteCellsRow, type ProspectRouteStatsRow } from "@/lib/scouting/aggregateMerge";
import { chartedCounts } from "@/lib/scouting/chartedCounts";
import { tagStatReps } from "@/lib/scouting/tagStats";
import type { Prospect, ProspectWithStats, RBPlay, RBRunType, ScoutingGame } from "@/lib/types";

// Minimal shapes, cast through unknown: the code under test reads a few fields.
const IMPORTED = "2026-04-30T19:00:00Z";
const IN_APP = "2026-11-01T12:00:00Z";
const game = (id: string, prospect_id: string, created_at = IN_APP, count_in_sample?: boolean): ScoutingGame =>
  ({ id, prospect_id, created_at, season_year: 2025, ...(count_in_sample === undefined ? {} : { count_in_sample }) }) as unknown as ScoutingGame;
const prospect = (id: string, position = "RB"): Prospect => ({ id, position, name: id }) as unknown as Prospect;
const run = (game_id: string, success: boolean, run_type: RBRunType = "inside_zone"): RBPlay =>
  ({ game_id, run_type, formation: "gun", success, loaded_box: false, unblocked_defender: false }) as unknown as RBPlay;
const repeat = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

describe("sampleGames: which games count", () => {
  const games = [
    game("a-old", "a", IMPORTED, false), game("a-old2", "a", IMPORTED, true), game("a-new", "a", IN_APP, true),
    game("b-new", "b", IN_APP, true),
  ];

  it("imported = created before 2026-05-01; every game counts unless switched off", () => {
    expect(isImportedGame(games[0])).toBe(true);
    expect(isImportedGame(games[2])).toBe(false);
    expect(countsInSample(games[0])).toBe(false);
    expect(countsInSample(game("x", "a"))).toBe(true); // before migration 107: no column, counts
  });

  it("maps games to players over the sample games only", () => {
    expect([...setAsideGameIds(games)]).toEqual(["a-old"]);
    expect([...sampleGameToProspect(games).keys()]).toEqual(["a-old2", "a-new", "b-new"]);
    expect(sampleGames(games).map((g) => g.id)).toEqual(["a-old2", "a-new", "b-new"]);
    expect(sampleGameCounts(games)).toEqual(new Map([["a", 2], ["b", 1]]));
  });

  it("inSample hands back the same rows when nothing is set aside", () => {
    const rows = [{ game_id: "a-old" }, { game_id: "a-new" }];
    expect(inSample(rows, new Set())).toBe(rows);
    expect(inSample(rows, new Set(["a-old"]))).toEqual([{ game_id: "a-new" }]);
  });

  it("reads migration 107 off the loaded games", () => {
    expect(countInSampleReady([])).toBeNull();
    expect(countInSampleReady([game("x", "a")])).toBe(false);
    expect(countInSampleReady(games)).toBe(true);
  });
});

describe("sampleSwitchFor: the in-app half-sample floor", () => {
  const games = [game("old1", "a", IMPORTED, true), game("old2", "a", IMPORTED, false), game("new", "a", IN_APP, true)];
  const plays = [
    ...repeat(30, () => run("old1", true)), ...repeat(20, () => run("old2", true)),
    ...repeat(49, () => run("new", true)),
    run("new", true, "pass_block" as RBRunType), // not a sample play
  ];

  it("counts imported and in-app sample plays; the switch opens at half a sample (RB 50 runs)", () => {
    const sw = sampleSwitchFor("RB", games, plays, isKnownRun);
    expect(sw).toMatchObject({ importedGames: 2, importedPlays: 50, inAppPlays: 49, half: 50, open: false, setAsideGames: 1, setAsidePlays: 20 });
    expect(sw.playsByGame.get("new")).toBe(49);
    const open = sampleSwitchFor("RB", games, [...plays, run("new", false)], isKnownRun);
    expect(open.open).toBe(true);
  });

  it("shows on imported games once open; a set-aside game keeps its switch below the floor", () => {
    expect(showsSampleSwitch(games[0], { open: false })).toBe(false);
    expect(showsSampleSwitch(games[1], { open: false })).toBe(true);
    expect(showsSampleSwitch(games[0], { open: true })).toBe(true);
    expect(showsSampleSwitch(games[2], { open: true })).toBe(false); // in-app: never
  });
});

describe("set-aside games leave the player's numbers, not the league model", () => {
  // RB a: an imported game of failed runs and an in-app game of successes;
  // RB b: in-app only. Setting a's imported game aside lifts a's SRAE and
  // shrinks his sample, while b (judged by the same league model) is unchanged.
  const plays = [
    ...repeat(20, () => run("a-old", false)), ...repeat(20, (i) => run("a-new", i % 4 !== 0)),
    ...repeat(30, (i) => run("b-new", i % 2 === 0)),
  ];
  const prospects = [prospect("a"), prospect("b")];
  const withFlag = (aside: boolean) => [game("a-old", "a", IMPORTED, !aside), game("a-new", "a"), game("b-new", "b")];

  it("RB SRAE: his sample drops the game; another back's value doesn't move", () => {
    const all = computeRBAboveExpectedSamples(prospects, withFlag(false), plays);
    const aside = computeRBAboveExpectedSamples(prospects, withFlag(true), plays);
    expect(all.get("a")!.n).toBe(40);
    expect(aside.get("a")!.n).toBe(20);
    expect(aside.get("a")!.ae).toBeGreaterThan(all.get("a")!.ae);
    expect(aside.get("b")!.ae).toBeCloseTo(all.get("b")!.ae, 10);
  });

  it("Big Board charted counts: games, snaps and runs are his sample's", () => {
    const ps = prospects.map((p) => ({ ...p, total_snaps: 0, total_routes: 0 }) as unknown as ProspectWithStats);
    const c = chartedCounts(ps, withFlag(true), { qb: [], rb: plays, te: [] }, true);
    expect(c.get("a")).toEqual({ games: 1, snaps: 20, plays: 20 });
    expect(c.get("b")).toEqual({ games: 1, snaps: 30, plays: 30 });
  });

  it("tag stats read his sample games only", () => {
    const tagged = plays.map((pl) => ({ ...pl, garbage_time: false, missed_read: false }));
    const reads = (aside: boolean) =>
      tagStatReps({ games: withFlag(aside), qbPlays: [], rbPlays: tagged, tePlays: [], wrTagRows: [] }).get("tag_rb_missed_read")!.get("a")!;
    expect(reads(false).reduce((s, r) => s + r.n, 0)).toBe(40);
    expect(reads(true).reduce((s, r) => s + r.n, 0)).toBe(20);
    expect(reads(true).every((r) => r.gameId !== "a-old")).toBe(true);
  });

  it("WR: SAE and the sample come from his sample games; the model and other receivers keep every game", () => {
    const cells = (open: number, n: number): Record<string, [number, number]> => ({ "curl|zone|left|on": [n, open] });
    const rows: ProspectGameRouteCellsRow[] = [
      { prospect_id: "w", game_id: "w-old", cells: cells(10, 40) },
      { prospect_id: "w", game_id: "w-new", cells: cells(36, 40) },
      { prospect_id: "v", game_id: "v-new", cells: cells(60, 80) },
    ];
    const statsRow = (prospect_id: string, routes: number): ProspectRouteStatsRow =>
      ({ prospect_id, total_routes: routes, total_games: 2, has_charted_open_data: true, route_stats_raw: {}, coverage_stats_raw: {} }) as unknown as ProspectRouteStatsRow;
    const wr = [prospect("w", "WR"), prospect("v", "WR")];
    const gamesWith = (aside: boolean) => [game("w-old", "w", IMPORTED, !aside), game("w-new", "w"), game("v-new", "v")];
    const build = (aside: boolean) => {
      const games = gamesWith(aside);
      return buildProspectsWithStats(wr, [statsRow("w", aside ? 40 : 80), statsRow("v", 80)], rows, games, {}, buildWRModel(rows, games));
    };
    const all = build(false), aside = build(true);
    const by = (out: ProspectWithStats[], id: string) => out.find((p) => p.id === id)!;
    expect(by(all, "w").sae_sample!.n).toBe(80);
    expect(by(aside, "w").sae_sample!.n).toBe(40);
    expect(by(aside, "w").adj_success_above_exp!).toBeGreaterThan(by(all, "w").adj_success_above_exp!);
    expect(by(aside, "v").adj_success_above_exp!).toBeCloseTo(by(all, "v").adj_success_above_exp!, 10);
    expect(by(aside, "w").sample_games).toBe(1);
    expect(by(aside, "w").total_games).toBe(2);
  });
});

// Migration 107: the per-player views skip a set-aside game's plays, the
// sample-count filters stay the Big Board dot's, and it stays additive.
describe("migration 107 (count_in_sample)", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/107_scouting_game_count_in_sample.sql"), "utf8");
  const body = sql.replace(/--[^\n]*/g, "");
  const view = (name: string) => {
    const m = body.match(new RegExp(`CREATE OR REPLACE VIEW public\\.${name}\\s+WITH \\(security_invoker = on\\) AS([\\s\\S]*?);`));
    expect(m, name).not.toBeNull();
    return m![1];
  };

  it("adds the column (every game counts by default) and keeps it on imported games", () => {
    expect(body).toMatch(/ADD COLUMN IF NOT EXISTS count_in_sample boolean NOT NULL DEFAULT true/);
    expect(body).toMatch(/CHECK \(count_in_sample OR created_at < '2026-05-01T00:00:00Z'\)/);
  });

  it("every per-player view skips set-aside games", () => {
    for (const v of ["prospect_route_stats", "prospect_route_cells", "prospect_rb_stats", "prospect_qb_stats", "prospect_te_stats", "prospect_sample_counts"]) {
      expect(view(v), v).toMatch(/count_in_sample/);
    }
    // Plays join only for counted games, so the logged-games counts keep every game.
    expect(view("prospect_rb_stats")).toMatch(/LEFT JOIN public\.rb_plays rp\s+ON rp\.game_id = sg\.id AND sg\.count_in_sample/);
    expect(view("prospect_route_stats")).toMatch(/LEFT JOIN public\.route_plays rp ON rp\.game_id = sg\.id AND sg\.count_in_sample/);
  });

  it("keeps the sample-count filters of migration 102 (aboveExpected.ts)", () => {
    const sc = view("prospect_sample_counts");
    expect(sc).toMatch(/qp\.play_type <> 'run'\s+AND qp\.accuracy IS NOT NULL\s+AND qp\.accuracy <> 'tipped_ball'/);
    expect(sc).toMatch(/rp\.run_type IN \('outside_zone', 'inside_zone', 'outside_man_gap', 'inside_man_gap'\)\s+AND rp\.success IS NOT NULL/);
    expect(sc).toMatch(/tp\.play_type = 'route_run'\s+AND tp\.was_open IS NOT NULL/);
  });

  it("is additive", () => {
    expect(body).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/i);
    expect(body).toMatch(/'107_scouting_game_count_in_sample'/);
  });
});
