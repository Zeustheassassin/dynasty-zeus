import { describe, it, expect } from "vitest";
import { rbRoleFit, computeRBRoleFits, RB_MIN_RUNS, type RBRoleInputs } from "@/lib/scouting/roleFitRB";
import { matchFor } from "@/lib/scouting/roleFit";
import type { Prospect, RBPlay, RBRunType, ScoutingGame } from "@/lib/types";

const play = (over: Partial<RBPlay>): RBPlay => ({
  id: "", user_id: "", game_id: "g", formation: "gun", run_type: "inside_zone", success: true,
  loaded_box: false, unblocked_defender: false, broken_tackle: false, explosive_play: false, run_stuff: false,
  play_notes: null, aligned_as_wr: false, targeted: false, route_type: null, was_open: null, created_at: "", ...over,
});
const runs = (n: number, run_type: RBRunType, over: Partial<RBPlay> = {}) => Array.from({ length: n }, () => play({ run_type, ...over }));
const routes = (n: number, open: number) => Array.from({ length: n }, (_, i) => play({ run_type: "route", success: null, was_open: i < open, route_type: "flats" }));
const passBlocks = (n: number, won: number) => Array.from({ length: n }, (_, i) => play({ run_type: "pass_block", success: i < won }));

// League rates: explosive 6%, broken tackles 8%, stuffed 15%, pass pro 70%,
// open on routes 60%, on longer routes 45%, catches 75%.
const LEAGUE = {
  explosive: { hits: 6, n: 100 }, btk: { hits: 8, n: 100 }, stuff: { hits: 15, n: 100 },
  passPro: { hits: 70, n: 100 }, open: { hits: 60, n: 100 }, bigOpen: { hits: 45, n: 100 }, catch: { hits: 75, n: 100 },
};
const slices = (s: Partial<Record<"all" | "loaded" | "zone" | "gap", [number, number]>>): RBRoleInputs["slices"] => ({
  all: { ae: s.all?.[0] ?? 0, n: s.all?.[1] ?? 100 },
  loaded: { ae: s.loaded?.[0] ?? 0, n: s.loaded?.[1] ?? 10 },
  zone: { ae: s.zone?.[0] ?? 0, n: s.zone?.[1] ?? 50 },
  gap: { ae: s.gap?.[0] ?? 0, n: s.gap?.[1] ?? 50 },
});
const fit = (plays: RBPlay[], sl: RBRoleInputs["slices"], heightIn: number | null = 71, weightLb: number | null = 212) =>
  rbRoleFit({ plays, slices: sl, league: LEAGUE, heightIn, weightLb });

describe("RB role buckets", () => {
  it("makes a back who wins on zone runs, and runs mostly zone, a Zone runner", () => {
    const f = fit([...runs(75, "inside_zone"), ...runs(25, "inside_man_gap"), ...routes(15, 9), ...passBlocks(10, 7)],
      slices({ all: [6, 100], zone: [14, 75], gap: [-4, 25] }))!;
    expect(f.best).toBe("zone");
    expect(f.usedAs).toBe("zone");
  });

  it("makes a heavy back who wins on gap runs and breaks tackles a Gap/Power back", () => {
    const f = fit([...runs(25, "inside_zone"), ...runs(75, "inside_man_gap", { broken_tackle: true }).map((p, i) => ({ ...p, broken_tackle: i < 20 }))],
      slices({ all: [6, 100], zone: [-4, 25], gap: [12, 75], loaded: [10, 20] }), 72, 228)!;
    expect(f.best).toBe("gap");
  });

  it("makes a back who runs routes and gets open a Receiving back", () => {
    const plays = [...runs(60, "outside_zone"), ...routes(50, 42), ...runs(0, "inside_zone")];
    plays.push(...Array.from({ length: 10 }, () => play({ run_type: "route", success: true, targeted: true, was_open: true, route_type: "big_boy_route" })));
    const f = fit(plays, slices({ all: [-3, 60], zone: [-3, 60], gap: [0, 0] }))!;
    expect(f.best).toBe("receiving");
  });

  it("makes a back with explosive runs and stuffs a Big-play back", () => {
    const plays = runs(80, "outside_zone").map((p, i) => ({ ...p, explosive_play: i < 16, run_stuff: i >= 60 }));
    const f = fit(plays, slices({ all: [0, 80], zone: [0, 80], gap: [0, 0] }))!;
    expect(matchFor(f, "big_play")!.pct).toBe(Math.max(...f.matches.map((m) => m.pct)));
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
});
