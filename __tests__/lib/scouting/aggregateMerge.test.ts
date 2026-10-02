import { describe, it, expect } from "vitest";
import {
  buildWRModel,
  buildWRTierSplits,
  buildProspectsWithStats,
  linedUpByProspect,
  computeSAEForPlays,
  computeCoreSAEForPlays,
  type ProspectRouteCellsRow,
  type ProspectGameRouteCellsRow,
  type ProspectRouteStatsRow,
  type ProspectGameAlignmentRow,
} from "@/lib/scouting/aggregateMerge";
import { coverageEras } from "@/lib/scouting/coverageEra";
import { SEASON_DECAY } from "@/lib/scouting/seasonWeight";
import type { Prospect, RoutePlay, RouteType, CoverageType, Alignment, ScoutingGame } from "@/lib/types";

// The functions under test only read a handful of fields off each shape, so we
// build minimal objects and cast through `unknown` to the full interface.
const routePlay = (
  game_id: string,
  route_type: RouteType,
  coverage: CoverageType,
  was_open: boolean,
  no_route_run = false,
  alignment: Alignment = "left",
  on_line = true,
): RoutePlay =>
  ({ game_id, route_type, coverage, was_open, no_route_run, alignment, on_line }) as unknown as RoutePlay;

function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

// Cell rows built from a raw play set — mirrors how the prospect_route_cells
// view (migration 057) aggregates in Postgres: per prospect, one
// "route|coverage|alignment|on_line" key → [routes, open routes].
function cellRowsFrom(playsByProspect: Record<string, RoutePlay[]>): ProspectRouteCellsRow[] {
  return Object.entries(playsByProspect).map(([prospect_id, plays]) => {
    const cells: Record<string, [number, number]> = {};
    for (const p of plays) {
      if (p.no_route_run) continue;
      const key = `${p.route_type}|${p.coverage}|${p.alignment}|${p.on_line ? "on" : "off"}`;
      const c = cells[key] ?? [0, 0];
      c[0]++;
      if (p.was_open) c[1]++;
      cells[key] = c;
    }
    return { prospect_id, cells };
  });
}
const modelFrom = (plays: RoutePlay[]) => buildWRModel(cellRowsFrom({ league: plays }));

// Per-game cell rows, as prospect_game_route_cells (migration 058) returns
// them: the same cells, one row per prospect per game.
function gameRowsFrom(playsByProspect: Record<string, RoutePlay[]>): ProspectGameRouteCellsRow[] {
  const out: ProspectGameRouteCellsRow[] = [];
  for (const [prospect_id, plays] of Object.entries(playsByProspect)) {
    const byGame = new Map<string, RoutePlay[]>();
    for (const p of plays) byGame.set(p.game_id, [...(byGame.get(p.game_id) ?? []), p]);
    for (const [game_id, gp] of byGame) out.push({ prospect_id, game_id, cells: cellRowsFrom({ [prospect_id]: gp })[0].cells });
  }
  return out;
}

// =============================================================================
// computeSAEForPlays — ungated per-game WR SAE (no 15-route minimum)
// =============================================================================

describe("computeSAEForPlays", () => {
  it("returns a number for a single rated route (no minimum-sample gate)", () => {
    const model = modelFrom(repeat(30, () => routePlay("g_bg", "curl", "man", true)));
    const out = computeSAEForPlays([routePlay("g1", "curl", "man", true)], model);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero routes (e.g. no_route_run only)", () => {
    const model = modelFrom(repeat(30, () => routePlay("g_bg", "curl", "man", true)));
    const gamePlays = repeat(5, () => routePlay("g1", "curl", "man", true, true));
    expect(computeSAEForPlays(gamePlays, model)).toBeNull();
  });

  it("returns null when there is no league model (migration 057 not applied → no cells)", () => {
    expect(computeSAEForPlays([routePlay("g1", "curl", "man", true)], buildWRModel([]))).toBeNull();
  });

  it("returns 0 when the game IS the entire league", () => {
    const plays = [
      ...repeat(6, () => routePlay("g1", "curl", "man", true)),
      ...repeat(4, () => routePlay("g1", "curl", "man", false)),
    ];
    expect(computeSAEForPlays(plays, modelFrom(plays))).toBe(0);
  });

  it("flags an above-baseline game as positive", () => {
    // League opens 50% on curl/man; this game opened 90% in the same bucket.
    const model = modelFrom([
      ...repeat(50, () => routePlay("g_bg", "curl", "man", true)),
      ...repeat(50, () => routePlay("g_bg", "curl", "man", false)),
    ]);
    const gamePlays = [
      ...repeat(9, () => routePlay("g1", "curl", "man", true)),
      ...repeat(1, () => routePlay("g1", "curl", "man", false)),
    ];
    expect(computeSAEForPlays(gamePlays, model)!).toBeGreaterThan(0);
  });
});

// =============================================================================
// Difficulty model — a route is judged against routes like it
// =============================================================================

describe("WR SAE difficulty model", () => {
  it("a closed go route costs what the league's go rate says (not a watered-down average)", () => {
    // Gos open 40%, curls 90%, all vs zone. The old 50/50 average of route and
    // coverage rates expected a go vs zone to be open (40% + 65%) / 2 = 52.5%,
    // so a closed go cost −52.5. Judged against gos alone it costs ≈ −40.
    const model = modelFrom([
      ...repeat(200, (i) => routePlay("g_bg", "nine", "zone", i % 5 < 2)),
      ...repeat(200, (i) => routePlay("g_bg", "curl", "zone", i % 10 < 9)),
    ]);
    const closedGo = computeSAEForPlays([routePlay("g1", "nine", "zone", false)], model)!;
    expect(Math.abs(closedGo + 40)).toBeLessThan(3);
  });

  it("press is its own, harder bucket — a closed route vs press costs less than vs off man", () => {
    const model = modelFrom([
      ...repeat(100, (i) => routePlay("g_bg", "curl", "press", i % 5 < 2)),  // 40% open
      ...repeat(100, (i) => routePlay("g_bg", "curl", "man", i % 5 < 4)),    // 80% open
    ]);
    const vsPress = computeSAEForPlays([routePlay("g1", "curl", "press", false)], model)!;
    const vsMan = computeSAEForPlays([routePlay("g1", "curl", "man", false)], model)!;
    expect(vsPress - vsMan).toBeGreaterThan(25);
  });

  it("difficulty stacks: a go vs press is expected to be harder than either alone", () => {
    // Gos vs zone and curls vs press each open 50%; curls vs zone 90%. No go vs
    // press in the league — the model must infer it from the two effects. An
    // average of single-dimension rates can never go below the lowest rate.
    const model = modelFrom([
      ...repeat(100, (i) => routePlay("g_bg", "nine", "zone", i % 2 === 0)),
      ...repeat(100, (i) => routePlay("g_bg", "curl", "press", i % 2 === 0)),
      ...repeat(100, (i) => routePlay("g_bg", "curl", "zone", i % 10 < 9)),
    ]);
    const openGoVsZone = computeSAEForPlays([routePlay("g1", "nine", "zone", true)], model)!;
    const openGoVsPress = computeSAEForPlays([routePlay("g1", "nine", "press", true)], model)!;
    expect(openGoVsPress).toBeGreaterThan(openGoVsZone + 10);
  });
});

// =============================================================================
// computeCoreSAEForPlays — same as above, but drops Go (nine) & Screen routes
// =============================================================================

describe("computeCoreSAEForPlays", () => {
  it("returns null when every play is a Go or Screen route", () => {
    const model = modelFrom(repeat(30, () => routePlay("g_bg", "curl", "man", true)));
    const gamePlays = [
      ...repeat(3, () => routePlay("g1", "nine", "man", true)),
      ...repeat(2, () => routePlay("g1", "screen", "man", true)),
    ];
    expect(computeCoreSAEForPlays(gamePlays, model)).toBeNull();
  });

  it("ignores Go/Screen plays but still scores the remaining routes", () => {
    const model = modelFrom([
      ...repeat(50, () => routePlay("g_bg", "curl", "man", true)),
      ...repeat(50, () => routePlay("g_bg", "curl", "man", false)),
    ]);
    const coreOnly = [
      ...repeat(9, () => routePlay("g1", "curl", "man", true)),
      ...repeat(1, () => routePlay("g1", "curl", "man", false)),
    ];
    const withExcluded = [
      ...coreOnly,
      ...repeat(4, () => routePlay("g1", "nine", "man", true)),
      ...repeat(4, () => routePlay("g1", "screen", "man", true)),
    ];
    const coreOnlyOut = computeCoreSAEForPlays(coreOnly, model);
    expect(coreOnlyOut).not.toBeNull();
    expect(computeCoreSAEForPlays(withExcluded, model)).toBe(coreOnlyOut);
  });

  it("returns null when the game has zero core routes (e.g. no_route_run only)", () => {
    const model = modelFrom(repeat(30, () => routePlay("g_bg", "curl", "man", true)));
    const gamePlays = repeat(5, () => routePlay("g1", "curl", "man", true, true));
    expect(computeCoreSAEForPlays(gamePlays, model)).toBeNull();
  });
});

// =============================================================================
// buildProspectsWithStats — season/career SAE + cSAE from the cells view
// =============================================================================

describe("buildProspectsWithStats — WR SAE", () => {
  const prospect = (id: string): Prospect => ({ id, position: "WR", name: id }) as unknown as Prospect;
  const statsRow = (prospect_id: string, plays: RoutePlay[]): ProspectRouteStatsRow => {
    const routes = plays.filter((p) => !p.no_route_run);
    return {
      prospect_id,
      total_routes: routes.length,
      open_routes: routes.filter((p) => p.was_open).length,
      has_charted_open_data: routes.some((p) => p.was_open),
      route_stats_raw: {},
      coverage_stats_raw: {},
    } as unknown as ProspectRouteStatsRow;
  };
  // A deep threat (half gos) and a possession receiver (all curls), same
  // league, each open at exactly the league rate for what he ran.
  const deep = [
    ...repeat(100, (i) => routePlay("g_d", "nine", "zone", i % 5 < 2)),   // 40%
    ...repeat(100, (i) => routePlay("g_d", "curl", "zone", i % 10 < 8)),  // 80%
  ];
  const poss = repeat(200, (i) => routePlay("g_p", "curl", "zone", i % 10 < 8));  // 80%
  const byProspect = { deep, poss };
  const build = (rows: ProspectGameRouteCellsRow[]) =>
    buildProspectsWithStats(
      [prospect("deep"), prospect("poss")],
      [statsRow("deep", deep), statsRow("poss", poss)],
      rows,
      [],
    );

  it("judges each receiver against what he ran, so league-rate receivers both land near 0", () => {
    const out = build(gameRowsFrom(byProspect));
    const d = out.find((p) => p.id === "deep")!.adj_success_above_exp!;
    const p = out.find((p) => p.id === "poss")!.adj_success_above_exp!;
    // Old averaging would have put the deep threat well below 0 for running gos.
    expect(Math.abs(d)).toBeLessThan(2);
    expect(Math.abs(p)).toBeLessThan(2);
    // And the league nets to 0, route-weighted (both ran 200 routes).
    expect(Math.abs(d + p)).toBeLessThan(0.02);
  });

  it("cSAE drops gos exactly — the deep threat's cSAE comes from his curls alone", () => {
    const out = build(gameRowsFrom(byProspect));
    const d = out.find((p) => p.id === "deep")!;
    // 100 core routes (≥ 15) — curls vs zone at the league curl rate.
    expect(d.core_sae).not.toBeNull();
    expect(Math.abs(d.core_sae!)).toBeLessThan(2);
  });

  it("keeps SAE's route count and sampling variance for the AE Score", () => {
    const out = build(gameRowsFrom(byProspect));
    const p = out.find((x) => x.id === "poss")!;
    expect(p.sae_sample!.ae).toBe(p.adj_success_above_exp);
    expect(p.sae_sample!.n).toBe(200);
    // One cell, 160 of 200 open: the residuals vary exactly as the outcomes do,
    // (160·0.2² + 40·0.8²) / 199 per route, over 200 routes, in pts².
    expect(p.sae_sample!.variance).toBeCloseTo((32 / 199 / 200) * 1e4, 6);
  });

  it("keeps cSAE's sample over core routes only", () => {
    const out = build(gameRowsFrom(byProspect));
    const d = out.find((x) => x.id === "deep")!;
    expect(d.core_sae_sample!.ae).toBe(d.core_sae);
    expect(d.core_sae_sample!.n).toBe(100); // the curls; the 100 gos are dropped
    expect(d.sae_sample!.n).toBe(200);
    // 80 of 100 curls open, one cell: (80·0.2² + 20·0.8²) / 99 per route, over 100.
    expect(d.core_sae_sample!.variance).toBeCloseTo((16 / 99 / 100) * 1e4, 6);
  });

  it("applies the 15-route gate", () => {
    const few = repeat(14, () => routePlay("g_f", "curl", "zone", true));
    const out = buildProspectsWithStats(
      [prospect("few")],
      [statsRow("few", few)],
      gameRowsFrom({ ...byProspect, few }),
      [],
    );
    expect(out[0].adj_success_above_exp).toBeNull();
    expect(out[0].core_sae).toBeNull();
    expect(out[0].sae_sample).toBeNull();
    expect(out[0].core_sae_sample).toBeNull();
  });

  it("matches the per-prospect cells view (057) when every route counts in full", () => {
    const fromGames = build(gameRowsFrom(byProspect));
    const fromProspects = buildWRModel(cellRowsFrom(byProspect));
    expect(fromProspects.model).not.toBeNull();
    // The league model fit from either view is the same model.
    const fromGameRows = buildWRModel(gameRowsFrom(byProspect)).model!;
    fromGameRows.forEach((x, i) => expect(x).toBeCloseTo(fromProspects.model![i], 6));
    expect(fromGames.find((p) => p.id === "poss")!.sae_sample!.w).toBe(200);
  });

  it("weights each route by its season, leaning toward the newer tape", () => {
    // 100 curls a season: 60% open in 2024, 90% open in 2025.
    const older = repeat(100, (i) => routePlay("w24", "curl", "zone", i % 10 < 6));
    const newer = repeat(100, (i) => routePlay("w25", "curl", "zone", i % 10 < 9));
    const rows = gameRowsFrom({ ...byProspect, w: [...older, ...newer] });
    const games = [
      { id: "w24", prospect_id: "w", season_year: 2024 },
      { id: "w25", prospect_id: "w", season_year: 2025 },
    ] as unknown as ScoutingGame[];
    const stats = [statsRow("w", [...older, ...newer])];
    const flat = buildProspectsWithStats([prospect("w")], stats, rows, [])[0];
    const weighted = buildProspectsWithStats([prospect("w")], stats, rows, games)[0];
    const lean = ((0.6 * SEASON_DECAY + 0.9) / (SEASON_DECAY + 1) - 0.75) * 100;
    expect(weighted.adj_success_above_exp! - flat.adj_success_above_exp!).toBeCloseTo(lean, 1);
    expect(weighted.core_sae! - flat.core_sae!).toBeCloseTo(lean, 1);
    expect(weighted.sae_sample!.n).toBe(200);
    expect(weighted.sae_sample!.w).toBeCloseTo(100 + 100 * SEASON_DECAY, 9);
  });

  it("shows no SAE / cSAE (null) when the cells view isn't available yet", () => {
    const out = build([]);
    for (const p of out) {
      expect(p.adj_success_above_exp).toBeNull();
      expect(p.core_sae).toBeNull();
      expect(p.sae_sample).toBeNull();
      expect(p.core_sae_sample).toBeNull();
    }
  });
});

describe("buildWRTierSplits", () => {
  it("splits each WR's residuals by the game's opponent tier, core routes on their own", () => {
    const g1 = [...repeat(20, (i) => routePlay("g1", "curl", "zone", i % 2 === 0)), ...repeat(10, () => routePlay("g1", "screen", "zone", true))];
    const g2 = repeat(20, (i) => routePlay("g2", "curl", "zone", i % 4 !== 0));
    const rows = [
      { prospect_id: "a", game_id: "g1", cells: cellRowsFrom({ a: g1 })[0].cells },
      { prospect_id: "a", game_id: "g2", cells: cellRowsFrom({ a: g2 })[0].cells },
    ];
    const tiers: Record<string, "P4" | "G5"> = { g1: "P4", g2: "G5" };
    const s = buildWRTierSplits(rows, (id) => tiers[id]).all.get("a")!;
    expect(s.P4!.n).toBe(30);
    expect(s.G5!.n).toBe(20);
    // One league model: residuals over every route sum to 0.
    expect(s.P4!.resid + s.G5!.resid).toBeCloseTo(0, 3);
    // The G5 game went better (75% vs 50% on curls).
    expect(s.G5!.resid / s.G5!.n).toBeGreaterThan(s.P4!.resid / s.P4!.n);
    // Core routes drop the screens.
    expect(buildWRTierSplits(rows, (id) => tiers[id]).core.get("a")!.P4!.n).toBe(20);
  });

  it("season-weights each tier's share of a WR's routes, leaving n and the residuals as counted", () => {
    const g1 = repeat(20, (i) => routePlay("g1", "curl", "zone", i % 2 === 0));
    const g2 = repeat(20, (i) => routePlay("g2", "curl", "zone", i % 4 !== 0));
    const rows = [
      { prospect_id: "a", game_id: "g1", cells: cellRowsFrom({ a: g1 })[0].cells },
      { prospect_id: "a", game_id: "g2", cells: cellRowsFrom({ a: g2 })[0].cells },
    ];
    const tiers: Record<string, "P4" | "G5"> = { g1: "P4", g2: "G5" };
    const games = [
      { id: "g1", prospect_id: "a", season_year: 2025 },
      { id: "g2", prospect_id: "a", season_year: 2024 },
    ] as unknown as ScoutingGame[];
    const flat = buildWRTierSplits(rows, (id) => tiers[id]).all.get("a")!;
    const s = buildWRTierSplits(rows, (id) => tiers[id], games).all.get("a")!;
    expect(s.G5!.n).toBe(20);
    expect(s.G5!.w).toBeCloseTo(20 * SEASON_DECAY, 9);
    expect(s.P4!.w).toBe(20);
    expect(s.G5!.resid).toBe(flat.G5!.resid);
    expect(flat.G5!.w).toBe(20);
  });

  it("skips games whose opponent isn't recognized", () => {
    const rows = [{ prospect_id: "a", game_id: "g1", cells: cellRowsFrom({ a: repeat(20, () => routePlay("g1", "curl", "zone", true)) })[0].cells }];
    expect(buildWRTierSplits(rows, () => null).all.get("a")).toBeUndefined();
  });
});

// =============================================================================
// Coverage eras — press was redefined after the 2026-04-30 import (coverageEra.ts)
// =============================================================================

describe("WR coverage eras", () => {
  const prospect = (id: string): Prospect => ({ id, position: "WR", name: id }) as unknown as Prospect;
  const statsRow = (prospect_id: string, plays: RoutePlay[]): ProspectRouteStatsRow =>
    ({ prospect_id, total_routes: plays.length, has_charted_open_data: true, route_stats_raw: {}, coverage_stats_raw: {} }) as unknown as ProspectRouteStatsRow;
  // Old charting folded press into man: "o" is 60% open on (old) man. New
  // charting splits it: "n" is 80% open on man and 40% on press. Both run 100
  // zone curls at 80%. Every route is a curl from the same spot, so without
  // coverage the league expects 71% everywhere: o is open 70%, n 72%.
  const oPlays = [
    ...repeat(100, (i) => routePlay("go", "curl", "zone", i % 10 < 8)),
    ...repeat(100, (i) => routePlay("go", "curl", "man", i % 10 < 6)),
  ];
  const nPlays = [
    ...repeat(100, (i) => routePlay("gn", "curl", "zone", i % 10 < 8)),
    ...repeat(60, (i) => routePlay("gn", "curl", "man", i % 10 < 8)),
    ...repeat(40, (i) => routePlay("gn", "curl", "press", i % 10 < 4)),
  ];
  const rows = gameRowsFrom({ o: oPlays, n: nPlays });
  const oldGame = { id: "go", prospect_id: "o", season_year: 2025, created_at: "2026-04-30T19:00:00Z" } as unknown as ScoutingGame;
  const newGame = { id: "gn", prospect_id: "n", season_year: 2025, created_at: "2026-05-02T12:00:00Z" } as unknown as ScoutingGame;
  const games = [oldGame, newGame];
  const build = (gs: ScoutingGame[]) =>
    new Map(buildProspectsWithStats([prospect("o"), prospect("n")], [statsRow("o", oPlays), statsRow("n", nPlays)], rows, gs)
      .map((p) => [p.id, p.adj_success_above_exp!]));

  it("judges a rep against reps charted under the same press definition", () => {
    const model = buildWRModel(rows, games);
    const manAt80 = nPlays.filter((p) => p.coverage === "man");
    const asNew = computeSAEForPlays(manAt80, model, newGame)!;
    const asOld = computeSAEForPlays(manAt80, model, oldGame)!;
    // Under the old definition, man was the 60% look, so 80% open reads far better.
    expect(asOld - asNew).toBeGreaterThan(10);
  });

  it("keeps each era's overall level, so the tags only move credit within an era", () => {
    const sae = build(games);
    expect(sae.get("n")!).toBeCloseTo(1, 1);
    expect(sae.get("o")!).toBeCloseTo(-1, 1);
  });

  it("without eras, the new receiver collects credit for the definition change", () => {
    const undated = games.map((g) => ({ ...g, created_at: undefined }) as unknown as ScoutingGame);
    const sae = build(undated);
    expect(sae.get("n")!).toBeGreaterThan(3);
    expect(sae.get("o")!).toBeLessThan(-3);
  });

  it("still nets the league to 0", () => {
    const sae = build(games);
    expect(sae.get("n")! + sae.get("o")!).toBeCloseTo(0, 1);
  });
});

describe("lined up (in-app alignment, every play)", () => {
  const imported = { id: "gi", prospect_id: "w", season_year: 2025, created_at: "2026-04-30T19:00:00Z" } as unknown as ScoutingGame;
  const inApp1 = { id: "ga", prospect_id: "w", season_year: 2025, created_at: "2026-05-02T12:00:00Z" } as unknown as ScoutingGame;
  const inApp2 = { id: "gb", prospect_id: "w", season_year: 2026, created_at: "2026-09-10T12:00:00Z" } as unknown as ScoutingGame;
  const row = (game_id: string, counts: Partial<Omit<ProspectGameAlignmentRow, "prospect_id" | "game_id">>, prospect_id = "w"): ProspectGameAlignmentRow => {
    const base = { slot_on: 0, slot_off: 0, left_on: 0, left_off: 0, right_on: 0, right_off: 0, backfield: 0, ...counts };
    const snaps = base.slot_on + base.slot_off + base.left_on + base.left_off + base.right_on + base.right_off + base.backfield;
    return { prospect_id, game_id, snaps, ...base };
  };

  it("sums every in-app game and leaves the imported ones out", () => {
    const lu = linedUpByProspect([
      row("gi", { slot_on: 40, left_on: 30 }), // imported: whole-game entry, not per play
      row("ga", { left_on: 20, left_off: 5, slot_off: 10, backfield: 1 }),
      row("gb", { right_on: 12, right_off: 3, slot_off: 9 }),
    ], coverageEras([imported, inApp1, inApp2]));
    expect(lu.get("w")).toEqual({ snaps: 60, slot_on: 0, slot_off: 19, left_on: 20, left_off: 5, right_on: 12, right_off: 3, backfield: 1 });
  });

  it("has nothing for a player charted only in the import", () => {
    expect(linedUpByProspect([row("gi", { left_on: 30 })], coverageEras([imported])).has("w")).toBe(false);
  });

  it("lands on ProspectWithStats as lined_up", () => {
    const prospect = { id: "w", name: "W", position: "WR" } as unknown as Prospect;
    const [p] = buildProspectsWithStats([prospect], [], [], [imported, inApp1], {}, undefined, [
      row("gi", { slot_on: 40 }),
      row("ga", { left_on: 6, right_off: 4 }),
    ]);
    expect(p.lined_up).toEqual({ snaps: 10, slot_on: 0, slot_off: 0, left_on: 6, left_off: 0, right_on: 0, right_off: 4, backfield: 0 });
    expect(buildProspectsWithStats([prospect], [], [], [imported], {}, undefined, [row("gi", { slot_on: 40 })])[0].lined_up).toBeNull();
  });
});
