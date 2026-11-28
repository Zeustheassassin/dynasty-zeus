import { describe, it, expect } from "vitest";
import {
  HOME_SCORING_PINNED, VALUE_DEPTH, formatValue, homeFormat, leagueValue, leagueValues, pointsCurves,
  type Curves, type ValueFormat,
} from "../../../lib/helpers/positionalValue";
import type { LinePos, SeasonLine } from "../../../lib/helpers/nflSeasonLines";

// Positional value per league, stage 1 of the 2026-11-27 plan: lineup math on
// real NFL seasons, each position's share of starting value against the
// user's usual format.

const line = (season: number, pos: LinePos, games: number, stats: Record<string, number>): SeasonLine => ({ season, pos, games, stats });

describe("pointsCurves", () => {
  it("averages the k-th best points per game over the seasons, to the shortest season, from MIN_GAMES", () => {
    const lines = [
      line(2024, "QB", 10, { pass_td: 200 }), line(2024, "QB", 10, { pass_td: 100 }),
      line(2025, "QB", 10, { pass_td: 180 }), line(2025, "QB", 10, { pass_td: 120 }), line(2025, "QB", 10, { pass_td: 60 }),
      line(2025, "QB", 3, { pass_td: 90 }), // 30 a game, but 3 games
    ];
    const c = pointsCurves(lines, { pass_td: 1 });
    expect(c.QB).toEqual([19, 11]);
    expect(c.RB).toEqual([]);
    expect(pointsCurves(lines, { pass_td: 1 }, 1).QB).toEqual([25, 14]); // the 3-game line's 30 a game tops 2025
  });
});

const f = (teams: number, slots: Record<string, number>): ValueFormat => ({ teams, slots, scoring: {} });

describe("formatValue", () => {
  const curves: Curves = {
    QB: [30, 25, 20, 15, 10, 5],
    RB: [20, 18, 16, 14, 12, 10, 8],
    WR: [19, 17, 15, 13, 11, 9, 7],
    TE: [16, 9, 6, 4],
  };

  it("fills each position's own slots, then the flex and superflex slots with the best player left", () => {
    const v = formatValue(curves, f(2, { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, SUPER_FLEX: 1 }));
    expect([v.QB.starters, v.RB.starters, v.WR.starters, v.TE.starters]).toEqual([4, 3, 3, 2]);
    expect([v.QB.inFlex, v.RB.inFlex, v.WR.inFlex, v.TE.inFlex]).toEqual([2, 1, 1, 0]);
    // Replacement = the best one left; value = the starters' points above him.
    expect([v.QB.replacement, v.RB.replacement, v.WR.replacement, v.TE.replacement]).toEqual([10, 14, 13, 6]);
    expect([v.QB.value, v.RB.value, v.WR.value, v.TE.value]).toEqual([50, 12, 12, 13]);
    expect(v.QB.share).toBeCloseTo(50 / 87);
    expect(v.QB.share + v.RB.share + v.WR.share + v.TE.share).toBeCloseTo(1);
  });

  it("fills the narrowest flex first (W/T before FLEX)", () => {
    const c: Curves = { QB: [], RB: [17], WR: [18, 16], TE: [15] };
    const v = formatValue(c, f(1, { REC_FLEX: 1, FLEX: 1 }));
    // W/T takes the WR (18 over the TE's 15); FLEX then takes the RB (17 over WR 16). FLEX first would start two WRs.
    expect([v.RB.starters, v.WR.starters, v.TE.starters]).toEqual([1, 1, 0]);
  });

  it(`counts the top ${VALUE_DEPTH} at a position, and reads past the data as its last value`, () => {
    const deep: Curves = { QB: [], RB: [], WR: Array.from({ length: 40 }, (_, i) => 40 - i), TE: [] };
    const v = formatValue(deep, f(1, { WR: 30 }));
    expect(v.WR.replacement).toBe(10);
    expect(v.WR.value).toBe(((30 + 7) * VALUE_DEPTH) / 2); // 40..17 above 10
    const short = formatValue({ QB: [], RB: [], WR: [12, 8], TE: [] }, f(1, { WR: 5 }));
    expect([short.WR.starters, short.WR.replacement, short.WR.value]).toEqual([5, 8, 4]);
  });
});

describe("homeFormat", () => {
  const SF = { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPER_FLEX: 1 };
  const TWO_WR = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, SUPER_FLEX: 1 };

  it("the user's named scoring, and the most common lineup, team count and other rules", () => {
    const home = homeFormat([
      { teams: 12, slots: SF, scoring: { rec: 1, bonus_rec_te: 1, pass_td: 6, pass_int: -2, rush_att: 0.25 } },
      { teams: 12, slots: SF, scoring: { rec: 1, bonus_rec_te: 1, pass_td: 6, pass_int: -2 } },
      { teams: 10, slots: TWO_WR, scoring: { rec: 0.5, pass_td: 4, pass_int: -1 } },
    ])!;
    expect(home.teams).toBe(12);
    expect(home.slots).toEqual(SF);
    expect(home.scoring).toEqual({ ...HOME_SCORING_PINNED, pass_int: -2 }); // rush_att is 0 in 2 of 3
    expect(homeFormat([])).toBeNull();
  });

  it("a tie goes to the league listed first", () => {
    const home = homeFormat([
      { teams: 10, slots: TWO_WR, scoring: {} },
      { teams: 12, slots: SF, scoring: {} },
    ])!;
    expect([home.teams, home.slots]).toEqual([10, TWO_WR]);
  });
});

// Two synthetic seasons with a spread at every position, 16 games each.
const LINES: SeasonLine[] = [2024, 2025].flatMap((season) => [
  ...Array.from({ length: 30 }, (_, i) => line(season, "QB", 16, { pass_td: 40 - i, pass_yd: 4500 - 60 * i, rush_yd: 300 })),
  ...Array.from({ length: 50 }, (_, i) => line(season, "RB", 16, { rush_yd: 1600 - 25 * i, rush_att: 300 - 4 * i, rec: 60 - i, rec_yd: 450 - 5 * i })),
  ...Array.from({ length: 70 }, (_, i) => line(season, "WR", 16, { rec: 115 - i, rec_yd: 1500 - 17 * i, rec_td: 10 - i / 10 })),
  ...Array.from({ length: 35 }, (_, i) => line(season, "TE", 16, { rec: 95 - 2 * i, rec_yd: 1100 - 25 * i, rec_td: 8 - i / 5 })),
]);
const BASE = { pass_yd: 0.04, pass_td: 4, rush_yd: 0.1, rec: 1, rec_yd: 0.1, rec_td: 6, bonus_rec_te: 0.5 };
const HOME: ValueFormat = { teams: 12, slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 2, SUPER_FLEX: 1 }, scoring: BASE };
const like = (patch: Partial<ValueFormat> & { rules?: Record<string, number> }): ValueFormat =>
  ({ teams: patch.teams ?? HOME.teams, slots: patch.slots ?? HOME.slots, scoring: { ...BASE, ...patch.rules } });

describe("leagueValue", () => {
  it("a league in the usual format reads ×1.00 at every position", () => {
    const v = leagueValue(LINES, like({}), HOME);
    for (const pos of ["QB", "RB", "WR", "TE"] as const) expect(v.mult[pos]).toBeCloseTo(1);
  });

  it("a fuller TE premium lifts TEs against the rest; 6-point passing TDs lift QBs", () => {
    const tep = leagueValue(LINES, like({ rules: { bonus_rec_te: 1 } }), HOME).mult;
    expect(tep.TE!).toBeGreaterThan(1.05);
    expect(tep.WR!).toBeLessThan(1);
    const sixPt = leagueValue(LINES, like({ rules: { pass_td: 6 } }), HOME).mult;
    expect(sixPt.QB!).toBeGreaterThan(1.05);
    expect(sixPt.WR!).toBeLessThan(1);
  });

  it("points per carry lifts RBs", () => {
    const ppc = leagueValue(LINES, like({ rules: { rush_att: 0.25 } }), HOME).mult;
    expect(ppc.RB!).toBeGreaterThan(1.05);
    expect(ppc.WR!).toBeLessThan(1);
  });

  it("a position the usual format gives no value reads null", () => {
    const noTe: ValueFormat = { ...HOME, slots: { QB: 2, RB: 2, WR: 3, WRRB_FLEX: 1 } }; // no slot a TE can fill
    expect(leagueValue(LINES, HOME, noTe).mult.TE).toBeNull();
  });
});

describe("leagueValues", () => {
  it("values every league against the usual format, the same as one at a time", () => {
    const leagues = [
      { leagueId: "a", ...like({ rules: { bonus_rec_te: 1 } }) },
      { leagueId: "b", ...like({ teams: 14 }) },
      { leagueId: "c", ...like({ rules: { bonus_rec_te: 1 } }), teams: 10 },
    ];
    const { home, byLeague } = leagueValues(LINES, leagues, HOME);
    expect(home).toEqual(formatValue(pointsCurves(LINES, BASE), HOME));
    for (const l of leagues) expect(byLeague.get(l.leagueId)).toEqual(leagueValue(LINES, l, HOME));
  });
});
