import { describe, it, expect } from "vitest";
import {
  gameTraits, isTraitGame, traitAverages, traitComponents, uncoveredTraits, validTraitGrade, withTrait,
  TRAITS, TRAIT_WEIGHT, TRAIT_GRADES_FROM,
} from "@/lib/scouting/traits";
import { countStat, type CountStatDef, type GameCount } from "@/lib/scouting/countComponents";
import { addGameResidual } from "@/lib/scouting/contextEffects";
import { COV } from "@/lib/scouting/gameContext";
import type { ScoutingGame } from "@/lib/types";

const g = (id: string, prospect: string, created: string, grades: Record<string, number> | null, season = 2026) =>
  ({ id, prospect_id: prospect, season_year: season, created_at: created, trait_grades: grades }) as ScoutingGame;

describe("traits", () => {
  it("six per position; the uncovered ones are the user's list", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) expect(TRAITS[pos]).toHaveLength(6);
    expect(uncoveredTraits("QB").map((t) => t.key)).toEqual(["arm", "creation"]);
    expect(uncoveredTraits("RB").map((t) => t.key)).toEqual(["burst"]);
    expect(uncoveredTraits("WR")).toEqual([]);
    expect(uncoveredTraits("TE").map((t) => t.key)).toEqual(["hands", "yac"]);
    expect(TRAIT_WEIGHT).toBe(0.2);
  });

  it("only new games carry grades; 1–10 whole numbers only", () => {
    expect(isTraitGame(g("a", "p", "2026-10-02T00:00:00Z", null))).toBe(false);
    expect(isTraitGame(g("a", "p", TRAIT_GRADES_FROM, null))).toBe(true);
    expect([0, 1, 10, 11, 5.5].map(validTraitGrade)).toEqual([false, true, true, false, false]);
    expect(gameTraits("QB", { arm: 7, burst: 9, accuracy: 0, creation: 10 })).toEqual({ arm: 7, creation: 10 });
  });

  it("sets and clears one trait", () => {
    expect(withTrait(null, "arm", 7)).toEqual({ arm: 7 });
    expect(withTrait({ arm: 7, creation: 4 }, "arm", null)).toEqual({ creation: 4 });
    expect(withTrait({ arm: 7 }, "arm", null)).toBeNull();
  });

  it("averages graded new games, older seasons a little less; old games never count", () => {
    const games = [
      g("old", "q", "2026-09-01T00:00:00Z", { arm: 1 }),
      g("a", "q", "2026-10-06T00:00:00Z", { arm: 8, creation: 6 }),
      g("b", "q", "2026-10-07T00:00:00Z", { arm: 6 }),
    ];
    const avg = traitAverages([{ id: "q", position: "QB" }], games).get("q")!;
    expect(avg.arm).toEqual({ avg: 7, games: 2 });
    expect(avg.creation).toEqual({ avg: 6, games: 1 });
  });

  it("builds per-player components for the uncovered traits only", () => {
    const games: ScoutingGame[] = [];
    for (let p = 0; p < 3; p++) for (let i = 0; i < 2; i++) games.push(g(`q${p}${i}`, `q${p}`, "2026-10-06T00:00:00Z", { arm: 5 + p + i, accuracy: 9 }));
    const comps = traitComponents(["q0", "q1", "q2"].map((id) => ({ id, position: "QB" })), games);
    expect(comps.QB.map((c) => c.key)).toEqual(["trait_arm", "trait_creation"]);
    const arm = comps.QB[0];
    expect(arm).toMatchObject({ weight: 0.2, perPlayer: true });
    expect(arm.samples.get("q1")).toMatchObject({ ae: 6.5, n: 2 });
    expect(arm.samples.get("q1")!.variance).toBeCloseTo(0.25);
    expect(comps.WR).toEqual([]);
  });
});

describe("count components with game context", () => {
  // 12 WRs × 4 games; YPRR-like: higher against worse defenses.
  const def: CountStatDef = {
    key: "pff_wr_yprr", label: "YPRR", source: "pff", pos: "WR", dir: 1, scale: 1, unit: "routes",
    floor: 20, suffix: " yds/route", description: "",
  };
  const counts: GameCount[] = [], games: { id: string; prospect_id: string; season_year: number }[] = [];
  const cov = new Map<string, Record<string, number>>();
  for (let p = 0; p < 12; p++) {
    for (let k = 0; k < 4; k++) {
      const id = `p${p}g${k}`, sp = 12 + ((p * 4 + k) * 7) % 20;
      games.push({ id, prospect_id: `p${p}`, season_year: 2025 });
      counts.push({ prospectId: `p${p}`, gameId: id, num: 30 * (1.5 + 0.05 * (sp - 21) + (p % 4) * 0.2), den: 30 });
      cov.set(id, { [COV.oppDefSp]: sp, [COV.oppFcs]: 0 });
    }
  }

  it("without context: today's numbers exactly", () => {
    const a = countStat(def, counts, games);
    const b = countStat(def, counts, games, undefined, { context: undefined });
    expect(b.samples).toEqual(a.samples);
    expect(b.context).toBeUndefined();
  });

  it("an SP+ stat takes its opponent-defense lift out (the raw value kept)", () => {
    const r = countStat(def, counts, games, undefined, { context: { cov, spRef: 21, fcsSp: 30 } });
    expect(r.context).toMatchObject({ opponent: "sp" });
    expect(r.context!.fit!.beta[COV.oppDefSp]).toBeGreaterThan(0.03);
    const s = r.samples.get("p0")!;
    expect(s.rawAe).toBeDefined();
    expect(s.byGame).toBeDefined();
  });

  it("per-game residuals add up to the sample's", () => {
    const r = countStat(def, counts, games, undefined, { byGame: true });
    const s = r.samples.get("p3")!;
    const total = Object.values(s.byGame!).reduce((t, x) => t + x.resid, 0);
    const bg = {};
    for (const c of counts.filter((c) => c.prospectId === "p3")) addGameResidual(bg, c.gameId, c.den, c.num - c.den * (r.poolRate! / def.scale));
    expect(total).toBeCloseTo(Object.values(bg).reduce((t: number, x) => t + (x as { resid: number }).resid, 0));
  });
});
