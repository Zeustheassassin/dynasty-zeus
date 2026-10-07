import { describe, it, expect } from "vitest";
import { rbRoleFit, computeRBRoleFits, RB_MIN_RUNS, type RBRoleInputs } from "@/lib/scouting/roleFitRB";
import { matchFor } from "@/lib/scouting/roleFit";
import type { Prospect, RBPlay, RBRunType, ScoutingGame } from "@/lib/types";
import type { PffTotals } from "@/lib/pff/totals";

const play = (over: Partial<RBPlay>): RBPlay => ({
  id: "", user_id: "", game_id: "g", formation: "gun", run_type: "inside_zone", success: true,
  loaded_box: false, unblocked_defender: false, broken_tackle: false, explosive_play: false, run_stuff: false,
  play_notes: null, aligned_as_wr: false, targeted: false, route_type: null, was_open: null, created_at: "", ...over,
});
const runs = (n: number, run_type: RBRunType, over: Partial<RBPlay> = {}) => Array.from({ length: n }, () => play({ run_type, ...over }));
const routes = (n: number, open: number) => Array.from({ length: n }, (_, i) => play({ run_type: "route", success: null, was_open: i < open, route_type: "flats" }));
const passBlocks = (n: number, won: number) => Array.from({ length: n }, (_, i) => play({ run_type: "pass_block", success: i < won }));

// League rates: stuffed 15%, pass pro 70%, open on routes 60%, on longer
// routes 45%, drops 9% of targets. PFF pool: 10+ yard runs 16% of carries,
// missed tackles 0.26 per carry.
const LEAGUE = {
  stuff: { hits: 15, n: 100 },
  passPro: { hits: 70, n: 100 }, open: { hits: 60, n: 100 }, bigOpen: { hits: 45, n: 100 }, drops: { hits: 9, n: 100 },
};
const PFF_POOL = { leaguePffExplosive: { hits: 16, n: 100 }, leaguePffMissedTackles: { hits: 26, n: 100 } };
const slices = (s: Partial<Record<"all" | "loaded" | "zone" | "gap", [number, number]>>): RBRoleInputs["slices"] => ({
  all: { ae: s.all?.[0] ?? 0, n: s.all?.[1] ?? 100 },
  loaded: { ae: s.loaded?.[0] ?? 0, n: s.loaded?.[1] ?? 10 },
  zone: { ae: s.zone?.[0] ?? 0, n: s.zone?.[1] ?? 50 },
  gap: { ae: s.gap?.[0] ?? 0, n: s.gap?.[1] ?? 50 },
});
const fit = (plays: RBPlay[], sl: RBRoleInputs["slices"], heightIn: number | null = 71, weightLb: number | null = 212, pff: Partial<RBRoleInputs> = {}) =>
  rbRoleFit({ plays, slices: sl, league: LEAGUE, heightIn, weightLb, ...PFF_POOL, ...pff });

describe("RB role buckets", () => {
  it("makes a back who wins on zone runs, and runs mostly zone, a Zone runner", () => {
    const f = fit([...runs(75, "inside_zone"), ...runs(25, "inside_man_gap"), ...routes(15, 9), ...passBlocks(10, 7)],
      slices({ all: [6, 100], zone: [14, 75], gap: [-4, 25] }))!;
    expect(f.best).toBe("zone");
    expect(f.usedAs).toBe("zone");
  });

  it("makes a heavy back who wins on gap runs and breaks tackles (PFF missed tackles) a Gap/Power back", () => {
    const f = fit([...runs(25, "inside_zone"), ...runs(75, "inside_man_gap")],
      slices({ all: [6, 100], zone: [-4, 25], gap: [12, 75], loaded: [10, 20] }), 72, 228, { pffMissedTackles: { hits: 38, n: 100 } })!;
    expect(f.best).toBe("gap");
    expect(f.features.btk!.display).toBe("0.38 vs 0.26 league per carry on 100 carries");
  });

  it("makes a back who runs routes and gets open a Receiving back", () => {
    const plays = [...runs(60, "outside_zone"), ...routes(50, 42), ...runs(0, "inside_zone")];
    plays.push(...Array.from({ length: 10 }, () => play({ run_type: "route", success: true, targeted: true, was_open: true, route_type: "big_boy_route" })));
    const f = fit(plays, slices({ all: [-3, 60], zone: [-3, 60], gap: [0, 0] }))!;
    expect(f.best).toBe("receiving");
  });

  it("makes a back with explosive runs (PFF 10+ yards) and stuffs a Big-play back", () => {
    const plays = runs(80, "outside_zone").map((p, i) => ({ ...p, run_stuff: i >= 60 }));
    const f = fit(plays, slices({ all: [0, 80], zone: [0, 80], gap: [0, 0] }), 71, 212, { pffExplosive: { hits: 24, n: 80 } })!;
    expect(matchFor(f, "big_play")!.pct).toBe(Math.max(...f.matches.map((m) => m.pct)));
  });

  it("reads explosive runs and broken tackles as neutral without PFF rows, never off the old charted buttons", () => {
    const plays = runs(80, "outside_zone", { explosive_play: true, broken_tackle: true });
    const f = fit(plays, slices({ all: [0, 80], zone: [0, 80], gap: [0, 0] }))!;
    expect(f.features.explosive!.fit).toBe(0.5);
    expect(f.features.btk!.fit).toBe(0.5);
  });

  // A Jadan Baugh-like back: wins on zone and gap runs, 0 drops on 13 targets
  // (3 of them uncatchable, not drops), wins 22 of 24 pass blocks, 231 lb,
  // and his college barely used him on passing downs.
  const targets = (n: number, caught: number, drops: number) => Array.from({ length: n }, (_, i) =>
    play({ run_type: "route", targeted: true, was_open: true, route_type: "flats", success: i < caught ? true : i < caught + drops ? false : null }));
  const workhorse = (hands = targets(13, 10, 0), blocks = passBlocks(24, 22)) =>
    [...runs(55, "inside_zone"), ...runs(48, "inside_man_gap"), ...hands, ...blocks];
  const WORKHORSE_SLICES = slices({ all: [12, 103], zone: [12, 55], gap: [10, 48] });

  it("makes a big back who runs well in both schemes, has no drops and blocks decently a Three-down back, whatever his college usage", () => {
    const f = fit(workhorse(), WORKHORSE_SLICES, 73, 231)!;
    expect(f.best).toBe("three_down");
    expect(matchFor(f, "three_down")!.pct).toBeGreaterThanOrEqual(75);
    expect(f.features.passGame!.fit).toBe(0); // 26% passing-down snaps: no credit, and none needed
  });

  it("cuts Three-down for drops and for poor pass protection, but not for uncatchable balls", () => {
    const pct = (plays: RBPlay[]) => matchFor(fit(plays, WORKHORSE_SLICES, 73, 231)!, "three_down")!.pct;
    const clean = pct(workhorse());
    expect(pct(workhorse(targets(13, 13, 0)))).toBe(clean);          // 3 more catches instead of uncatchables: same
    expect(pct(workhorse(targets(13, 7, 3)))).toBeLessThan(clean - 10); // 3 drops
    expect(pct(workhorse(undefined, passBlocks(24, 14)))).toBeLessThan(clean - 10); // 58% pass pro
  });

  it("doesn't make an average runner a workhorse just for clearing the bars", () => {
    const f = fit(workhorse(), slices({ all: [0, 103], zone: [0, 55], gap: [0, 48] }), 72, 215)!;
    expect(matchFor(f, "three_down")!.pct).toBeLessThan(55);
  });

  it("doesn't cut a back with no targets charted for unknown hands", () => {
    const f = fit([...runs(55, "inside_zone"), ...runs(48, "inside_man_gap"), ...passBlocks(24, 22)], WORKHORSE_SLICES, 73, 231)!;
    expect(f.features.handsOk).toBeUndefined();
    expect(matchFor(f, "three_down")!.drivers.join(" ")).not.toContain("Hands");
  });

  it("holds a 5'7\" 185 back out of Three-down", () => {
    const plays = [...runs(60, "inside_zone"), ...routes(30, 20), ...passBlocks(20, 16)];
    const m = matchFor(fit(plays, slices({ all: [2, 60] }), 67, 185)!, "three_down")!;
    expect(m.sizeDrop).toBeCloseTo(2 * 0.06 + 20 * 0.006);
  });

  it(`needs ${RB_MIN_RUNS} known runs`, () => {
    expect(fit(runs(RB_MIN_RUNS - 1, "inside_zone"), slices({}))).toBeNull();
  });

  it("scores every RB from the league's plays, and only RBs", () => {
    const prospects = [
      { id: "rb", position: "RB", height: "5'11\"", weight: 210 },
      { id: "wr", position: "WR", height: "", weight: null },
    ] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "rb", season_year: 2025 }, { id: "g2", prospect_id: "lg", season_year: 2025 }] as unknown as ScoutingGame[];
    const league = [
      ...runs(40, "inside_zone", { game_id: "g1" }).map((p, i) => ({ ...p, success: i % 3 !== 0 })),
      ...runs(60, "inside_zone", { game_id: "g2" }).map((p, i) => ({ ...p, success: i % 2 === 0 })),
    ];
    const fits = computeRBRoleFits(prospects, games, league);
    expect([...fits.keys()]).toEqual(["rb"]);
    const f = fits.get("rb")!;
    expect(f.sample).toEqual({ n: 40, unit: "runs" });
    expect(f.features.srae!.display).toMatch(/^\+\d/); // 67% vs the league's 58%
  });

  it("takes each back's PFF 10+ runs and missed tackles over his charted games, against every back's", () => {
    const prospects = [
      { id: "a", position: "RB", height: "5'11\"", weight: 210 },
      { id: "b", position: "RB", height: "5'11\"", weight: 210 },
    ] as unknown as Prospect[];
    const games = [{ id: "ga", prospect_id: "a", season_year: 2025 }, { id: "gb", prospect_id: "b", season_year: 2025 }] as unknown as ScoutingGame[];
    const league = [...runs(40, "inside_zone", { game_id: "ga" }), ...runs(40, "inside_zone", { game_id: "gb" })];
    const sum = (rush_att: number, rush_10plus: number, rush_mtf: number) => ({ sum: { rush_att, rush_10plus, rush_mtf, pressures_allowed: null, pass_block_snaps: null } }) as unknown as PffTotals;
    const fits = computeRBRoleFits(prospects, games, league, new Map([["a", sum(60, 12, 18)], ["b", sum(40, 4, 8)]]));
    expect(fits.get("a")!.features.explosive!.display).toBe("20% vs 16% league on 60 carries");
    expect(fits.get("b")!.features.btk!.display).toBe("0.20 vs 0.26 league per carry on 40 carries");
  });
});

describe("RB Three-down pass-pro gate adds PFF pass blocking (Stage 4)", () => {
  const plays = [...runs(80, "inside_zone"), ...runs(40, "outside_zone"), ...passBlocks(20, 14)];
  const three = (extra: Partial<RBRoleInputs>) =>
    matchFor(rbRoleFit({ plays, slices: slices({ all: [6, 120] }), league: LEAGUE, heightIn: 72, weightLb: 222, ...extra })!, "three_down")!.pct;

  it("is unchanged without PFF pass-block snaps", () => {
    expect(three({})).toBe(three({ pffPassPro: null, leaguePffPassPro: { hits: 7, n: 100 } }));
  });

  it("cuts a back PFF says gives up pressure, and keeps one who gives up none", () => {
    const leaky = three({ pffPassPro: { hits: 12, n: 60 }, leaguePffPassPro: { hits: 7, n: 100 } });
    const clean = three({ pffPassPro: { hits: 0, n: 60 }, leaguePffPassPro: { hits: 7, n: 100 } });
    expect(leaky).toBeLessThan(three({}));
    expect(clean).toBeGreaterThanOrEqual(three({}));
  });
});
