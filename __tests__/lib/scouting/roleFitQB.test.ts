import { describe, it, expect } from "vitest";
import { qbRoleFit, computeQBRoleFits, QB_MIN_THROWS, type QBRoleInputs } from "@/lib/scouting/roleFitQB";
import { matchFor } from "@/lib/scouting/roleFit";
import type { Prospect, QBPlay, ScoutingGame } from "@/lib/types";

const play = (over: Partial<QBPlay>): QBPlay => ({
  id: "", user_id: "", game_id: "g", snap_position: "shotgun", play_type: "pass", timing: "first_option",
  accuracy: "on_target", completion: "caught", int_type: null, target_pos: "wr", depth_zone: "short_center",
  route_type: "slant", coverage: "zone", platform: "on_platform", platform_side: null, pressure: "clean",
  pressure_handling: null, touch: "correct", play_notes: null, created_at: "", ...over,
});
const many = (n: number, over: Partial<QBPlay> = {}) => Array.from({ length: n }, () => play(over));
const slices = (s: Partial<Record<"all" | "shortMid" | "deep" | "offPlatform" | "pressured", [number, number]>>): QBRoleInputs["slices"] => ({
  all: { ae: s.all?.[0] ?? 0, n: s.all?.[1] ?? 100 },
  shortMid: { ae: s.shortMid?.[0] ?? 0, n: s.shortMid?.[1] ?? 80 },
  deep: { ae: s.deep?.[0] ?? 0, n: s.deep?.[1] ?? 20 },
  offPlatform: { ae: s.offPlatform?.[0] ?? 0, n: s.offPlatform?.[1] ?? 25 },
  pressured: { ae: s.pressured?.[0] ?? 0, n: s.pressured?.[1] ?? 30 },
});
const fit = (plays: QBPlay[], sl: QBRoleInputs["slices"], heightIn: number | null = 75) =>
  qbRoleFit({ plays, slices: sl, heightIn, weightLb: 215 });

describe("QB role buckets", () => {
  it("makes an accurate, on-time short and intermediate thrower a Distributor", () => {
    const plays = [...many(70), ...many(15, { timing: "checkdown" }), ...many(15, { depth_zone: "mid_left", timing: "second_option" })];
    const f = fit(plays, slices({ all: [8, 100], shortMid: [9, 100], deep: [0, 0] }))!;
    expect(f.best).toBe("distributor");
  });

  it("makes an accurate deep thrower who throws deep a lot a Vertical QB", () => {
    const plays = [...many(70), ...many(30, { depth_zone: "deep_left", route_type: "nine" })];
    const f = fit(plays, slices({ all: [2, 100], deep: [12, 30], shortMid: [-1, 70] }))!;
    expect(f.best).toBe("vertical");
  });

  it("makes a QB who's accurate off-platform and under pressure, and extends plays, a Creator", () => {
    const plays = [...many(60), ...many(25, { platform: "on_the_run", platform_side: "cross_body", pressure: "front_side", timing: "extended_play" }), ...many(10, { timing: "scramble", accuracy: null })];
    const f = fit(plays, slices({ offPlatform: [12, 25], pressured: [10, 25] }))!;
    expect(f.best).toBe("creator");
  });

  it("makes a QB who runs and scrambles a lot a Dual-threat, on how often alone", () => {
    const plays = [...many(70), ...many(25, { play_type: "run", timing: null, accuracy: null, depth_zone: null }), ...many(12, { timing: "scramble", accuracy: null })];
    const f = fit(plays, slices({}))!;
    expect(f.best).toBe("dual_threat");
    expect(matchFor(f, "dual_threat")!.drivers.join(" ")).toContain("Designed runs");
  });

  it(`needs ${QB_MIN_THROWS} graded throws`, () => {
    expect(fit(many(QB_MIN_THROWS - 1), slices({}))).toBeNull();
  });

  it("scores every QB from the league's plays", () => {
    const prospects = [{ id: "qb", position: "QB", height: "6'3\"", weight: 220 }] as unknown as Prospect[];
    const games = [{ id: "g1", prospect_id: "qb", season_year: 2025 }] as unknown as ScoutingGame[];
    const fits = computeQBRoleFits(prospects, games, many(40, { game_id: "g1" }));
    expect(fits.get("qb")!.sample).toEqual({ n: 40, unit: "graded throws" });
  });
});
