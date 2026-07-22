import { describe, it, expect } from "vitest";
import { indexBaselines, computeSAEForPlays, type LeagueRouteBaselineRow } from "@/lib/scouting/aggregateMerge";
import type { RoutePlay, RouteType, CoverageType } from "@/lib/types";

// The functions under test only read a handful of fields off each shape, so we
// build minimal objects and cast through `unknown` to the full interface.
const routePlay = (
  game_id: string,
  route_type: RouteType,
  coverage: CoverageType,
  was_open: boolean,
  no_route_run = false,
): RoutePlay =>
  ({ game_id, route_type, coverage, was_open, no_route_run }) as unknown as RoutePlay;

function repeat<T>(n: number, make: (i: number) => T): T[] {
  return Array.from({ length: n }, (_, i) => make(i));
}

// League baselines built from a raw play set — mirrors how league_route_baselines
// aggregates in Postgres (one row per route_type/coverage with n + open_n).
function baselineRowsFrom(plays: RoutePlay[]): LeagueRouteBaselineRow[] {
  const rated = plays.filter((p) => !p.no_route_run);
  const byRoute = new Map<string, { n: number; open_n: number }>();
  const byCvg = new Map<string, { n: number; open_n: number }>();
  for (const p of rated) {
    const r = byRoute.get(p.route_type) ?? { n: 0, open_n: 0 };
    r.n++; if (p.was_open) r.open_n++;
    byRoute.set(p.route_type, r);
    if (p.coverage) {
      const c = byCvg.get(p.coverage) ?? { n: 0, open_n: 0 };
      c.n++; if (p.was_open) c.open_n++;
      byCvg.set(p.coverage, c);
    }
  }
  const rows: LeagueRouteBaselineRow[] = [];
  for (const [key, v] of byRoute) rows.push({ kind: "route", key, n: v.n, open_n: v.open_n });
  for (const [key, v] of byCvg) rows.push({ kind: "coverage", key, n: v.n, open_n: v.open_n });
  return rows;
}

// =============================================================================
// computeSAEForPlays — ungated per-game WR SAE (no 15-route minimum)
// =============================================================================

describe("computeSAEForPlays", () => {
  it("returns a number for a single rated route (no minimum-sample gate)", () => {
    const bgPlays = repeat(30, () => routePlay("g_bg", "curl", "man", true));
    const baselines = indexBaselines(baselineRowsFrom(bgPlays));
    const gamePlays = [routePlay("g1", "curl", "man", true)];
    const out = computeSAEForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });

  it("returns null when the game has zero routes (e.g. no_route_run only)", () => {
    const bgPlays = repeat(30, () => routePlay("g_bg", "curl", "man", true));
    const baselines = indexBaselines(baselineRowsFrom(bgPlays));
    const gamePlays = repeat(5, () => routePlay("g1", "curl", "man", true, true));
    expect(computeSAEForPlays(gamePlays, baselines)).toBeNull();
  });

  it("returns 0 when the game IS the entire league baseline", () => {
    const plays = [
      ...repeat(6, () => routePlay("g1", "curl", "man", true)),
      ...repeat(4, () => routePlay("g1", "curl", "man", false)),
    ];
    const baselines = indexBaselines(baselineRowsFrom(plays));
    expect(computeSAEForPlays(plays, baselines)).toBe(0);
  });

  it("flags an above-baseline game as positive", () => {
    // League opens 50% on curl/man; this game opened 90% in the same bucket.
    const bgPlays = [
      ...repeat(50, () => routePlay("g_bg", "curl", "man", true)),
      ...repeat(50, () => routePlay("g_bg", "curl", "man", false)),
    ];
    const baselines = indexBaselines(baselineRowsFrom(bgPlays));
    const gamePlays = [
      ...repeat(9, () => routePlay("g1", "curl", "man", true)),
      ...repeat(1, () => routePlay("g1", "curl", "man", false)),
    ];
    const out = computeSAEForPlays(gamePlays, baselines)!;
    expect(out).toBeGreaterThan(0);
  });

  it("folds press coverage into the man bucket", () => {
    const bgPlays = repeat(40, () => routePlay("g_bg", "curl", "man", true));
    const baselines = indexBaselines(baselineRowsFrom(bgPlays));
    const gamePlays = [
      ...repeat(3, () => routePlay("g1", "curl", "press", true)),
      ...repeat(3, () => routePlay("g1", "curl", "man", false)),
    ];
    const out = computeSAEForPlays(gamePlays, baselines);
    expect(out).not.toBeNull();
    expect(Number.isFinite(out)).toBe(true);
  });
});
