import { describe, it, expect } from "vitest";
import {
  buildWRModel,
  buildProspectsWithStats,
  computeSAEForPlays,
  computeCoreSAEForPlays,
  type ProspectRouteCellsRow,
  type ProspectRouteStatsRow,
} from "@/lib/scouting/aggregateMerge";
import type { Prospect, RoutePlay, RouteType, CoverageType, Alignment } from "@/lib/types";

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
  const build = (cells: ProspectRouteCellsRow[]) =>
    buildProspectsWithStats(
      [prospect("deep"), prospect("poss")],
      [statsRow("deep", deep), statsRow("poss", poss)],
      cells,
    );

  it("judges each receiver against what he ran, so league-rate receivers both land near 0", () => {
    const out = build(cellRowsFrom(byProspect));
    const d = out.find((p) => p.id === "deep")!.adj_success_above_exp!;
    const p = out.find((p) => p.id === "poss")!.adj_success_above_exp!;
    // Old averaging would have put the deep threat well below 0 for running gos.
    expect(Math.abs(d)).toBeLessThan(2);
    expect(Math.abs(p)).toBeLessThan(2);
    // And the league nets to 0, route-weighted (both ran 200 routes).
    expect(Math.abs(d + p)).toBeLessThan(0.02);
  });

  it("cSAE drops gos exactly — the deep threat's cSAE comes from his curls alone", () => {
    const out = build(cellRowsFrom(byProspect));
    const d = out.find((p) => p.id === "deep")!;
    // 100 core routes (≥ 15) — curls vs zone at the league curl rate.
    expect(d.core_sae).not.toBeNull();
    expect(Math.abs(d.core_sae!)).toBeLessThan(2);
  });

  it("keeps SAE's route count and sampling variance for the AE Score", () => {
    const out = build(cellRowsFrom(byProspect));
    const p = out.find((x) => x.id === "poss")!;
    expect(p.sae_sample!.ae).toBe(p.adj_success_above_exp);
    expect(p.sae_sample!.n).toBe(200);
    // One cell, 160 of 200 open: the residuals vary exactly as the outcomes do,
    // (160·0.2² + 40·0.8²) / 199 per route, over 200 routes, in pts².
    expect(p.sae_sample!.variance).toBeCloseTo((32 / 199 / 200) * 1e4, 6);
  });

  it("applies the 15-route gate", () => {
    const few = repeat(14, () => routePlay("g_f", "curl", "zone", true));
    const out = buildProspectsWithStats(
      [prospect("few")],
      [statsRow("few", few)],
      cellRowsFrom({ ...byProspect, few }),
    );
    expect(out[0].adj_success_above_exp).toBeNull();
    expect(out[0].core_sae).toBeNull();
    expect(out[0].sae_sample).toBeNull();
  });

  it("shows no SAE / cSAE (null) when the cells view isn't available yet", () => {
    const out = build([]);
    for (const p of out) {
      expect(p.adj_success_above_exp).toBeNull();
      expect(p.core_sae).toBeNull();
      expect(p.sae_sample).toBeNull();
    }
  });
});
