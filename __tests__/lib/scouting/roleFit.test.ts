import { describe, it, expect } from "vitest";
import {
  buildRoleFit, scoreBucket, skillFeature, usageFeature, inverseUsageFeature, contrastFeature, shrinkAE,
  roleLabel, roleFitTooltip, matchTooltip, aeOf, mergeAESums,
  ELITE_SIZE_SHARE, NEAR_TIE, VERSATILE_PCT, FALLBACK_LINE, versatileRuleText, hasVersatile, ROLES,
  type BucketRecipe, type FeatureSet, type Feature, type RolePos,
} from "@/lib/scouting/roleFit";

// A feature with a set fit, for driving the recipes directly.
const skill = (fit: number, label = "s"): Feature => ({ label, kind: "skill", fit, display: "" });
const usage = (fit: number, label = "u"): Feature => ({ label, kind: "usage", fit, display: "" });

describe("role features", () => {
  it("reads average (0.5) with no reps, and pulls a small sample toward it", () => {
    expect(skillFeature("x", null, 0, 40, 4, "routes").fit).toBe(0.5);
    expect(skillFeature("x", 12, 0, 40, 4, "routes").fit).toBe(0.5);
    const thin = skillFeature("x", 12, 10, 40, 4, "routes").fit;
    const thick = skillFeature("x", 12, 300, 40, 4, "routes").fit;
    expect(thin).toBeGreaterThan(0.5);
    expect(thick).toBeGreaterThan(thin);
    expect(shrinkAE(12, 40, 40)).toBe(6);
  });

  it("ramps usage between its bounds, and inverts where less is better", () => {
    expect(usageFeature("u", 0.1, 0.2, 0.6).fit).toBe(0);
    expect(usageFeature("u", 0.4, 0.2, 0.6).fit).toBeCloseTo(0.5);
    expect(usageFeature("u", 0.9, 0.2, 0.6).fit).toBe(1);
    expect(inverseUsageFeature("u", 0.01, 0.01, 0.07).fit).toBe(1);
    expect(inverseUsageFeature("u", 0.07, 0.01, 0.07).fit).toBe(0);
  });

  it("contrasts two slices after the sample discount", () => {
    expect(contrastFeature("c", { ae: 8, n: 100 }, { ae: 8, n: 100 }, 40, 4).fit).toBeCloseTo(0.5);
    expect(contrastFeature("c", { ae: 8, n: 100 }, { ae: -4, n: 100 }, 40, 4).fit).toBeGreaterThan(0.8);
  });

  it("turns weighted sums into points, merging slices", () => {
    expect(aeOf({ n: 10, w: 10, actual: 6, expected: 5 })).toBeCloseTo(10);
    expect(aeOf(undefined)).toBeNull();
    expect(mergeAESums([{ n: 2, w: 2, actual: 1, expected: 1 }, undefined, { n: 3, w: 1.5, actual: 1, expected: 0.5 }]))
      .toEqual({ n: 5, w: 3.5, actual: 2, expected: 1.5 });
  });
});

describe("scoreBucket", () => {
  const recipe: BucketRecipe = {
    role: "x",
    ingredients: [{ feature: "a", weight: 0.6, core: true }, { feature: "b", weight: 0.4 }],
    size: { minHeightIn: 72, minWeightLb: 195 },
  };

  it("is the weighted feature average, in %", () => {
    expect(scoreBucket(recipe, { a: skill(0.8), b: usage(0.5) }, 74, 210).pct).toBe(68);
  });

  it("leaves a missing usage feature out and renormalizes", () => {
    expect(scoreBucket(recipe, { a: skill(0.8) }, 74, 210).pct).toBe(80);
  });

  it("drops a small player under the floor, and an elite one keeps most", () => {
    // 5'7" 170: 5 inches and 25 lb short = 0.45.
    const plain = scoreBucket(recipe, { a: skill(0.7), b: usage(1) }, 67, 170);
    expect(plain.sizeDrop).toBeCloseTo(0.45);
    expect(plain.pct).toBe(Math.round(82 * 0.55));
    expect(plain.sizeNote).toContain(`5'7" 170 under 6'0" 195`);
    const elite = scoreBucket(recipe, { a: skill(0.9), b: usage(1) }, 67, 170);
    expect(elite.sizeDrop).toBeCloseTo(0.45 * ELITE_SIZE_SHARE);
    expect(elite.sizeNote).toContain("elite");
  });

  it("cuts a gated bucket in proportion to how far short of each gate he falls", () => {
    const gated: BucketRecipe = { role: "x", ingredients: [{ feature: "a", weight: 1 }], gates: [{ feature: "g1", maxCut: 0.5 }, { feature: "g2", maxCut: 0.5 }] };
    expect(scoreBucket(gated, { a: skill(0.8), g1: skill(1), g2: skill(1) }, null, null).pct).toBe(80);
    expect(scoreBucket(gated, { a: skill(0.8), g1: skill(0.5), g2: skill(1) }, null, null).pct).toBe(60);  // −25%
    expect(scoreBucket(gated, { a: skill(0.8), g1: skill(0), g2: skill(0) }, null, null).pct).toBe(20);    // −50% twice
    expect(scoreBucket(gated, { a: skill(0.8) }, null, null).pct).toBe(80);                                // missing gate: no cut
    expect(scoreBucket(gated, { a: skill(0.8), g1: { ...skill(0.5), label: "Hands", display: "2 drops" } }, null, null).drivers)
      .toContain("− Hands: 2 drops (−25%)");
  });

  it("never drops a player with no height or weight on file", () => {
    expect(scoreBucket(recipe, { a: skill(0.7) }, null, null).sizeDrop).toBe(0);
  });

  it("names the features that moved it most, signed", () => {
    const m = scoreBucket(recipe, { a: { ...skill(0.9), label: "Press", display: "+8 pts" }, b: { ...usage(0.1), label: "On the line", display: "12%" } }, 74, 210);
    expect(m.drivers[0]).toBe("+ Press: +8 pts");
    expect(m.drivers[1]).toBe("− On the line: 12%");
  });
});

describe("buildRoleFit", () => {
  // Four WR buckets on one feature each, plus one usage feature for X.
  const recipes: BucketRecipe[] = [
    { role: "x", ingredients: [{ feature: "x", weight: 1 }, { feature: "ux", weight: 0.5 }] },
    { role: "y", ingredients: [{ feature: "y", weight: 1 }] },
    { role: "slot", ingredients: [{ feature: "slot", weight: 1 }, { feature: "us", weight: 0.5 }] },
    { role: "gadget", ingredients: [{ feature: "g", weight: 1 }] },
  ];
  const fit = (f: FeatureSet, n = 150) => buildRoleFit({
    pos: "WR", recipes, features: f, heightIn: null, weightLb: null,
    sample: { n, unit: "routes" }, confidenceAt: { medium: 100, high: 200 },
  });

  it("leads with the best fit, every role scored on its own", () => {
    const r = fit({ x: skill(0.4), y: skill(0.6), slot: skill(0.9), g: skill(0.3) });
    expect(r.best).toBe("slot");
    expect(r.hybrid).toBeNull();
    expect(r.matches.map((m) => m.role)).toEqual(["x", "y", "slot", "gadget"]);
    expect(r.matches.map((m) => m.pct)).toEqual([40, 60, 90, 30]);
  });

  it("on a near tie leads with the higher-ceiling role and shows the other as the hybrid", () => {
    const r = fit({ x: skill(0.78), y: skill(0.6), slot: skill(0.8), g: skill(0.3) });
    expect(80 - 78).toBeLessThanOrEqual(NEAR_TIE);
    expect(r.best).toBe("x");
    expect(r.hybrid).toBe("slot");
    expect(roleLabel(r)).toBe("X / Slot");
  });

  it("calls a WR Versatile above 60% at both X and Y, and only with a proven X", () => {
    expect(fit({ x: skill(0.61), y: skill(0.62), slot: skill(0.4), g: skill(0.3) }).versatile).toBe(true);
    expect(fit({ x: skill(0.61), y: skill(0.6), slot: skill(0.4), g: skill(0.3) }).versatile).toBe(false);
    // Strong elsewhere doesn't count: it's X and Y.
    expect(fit({ x: skill(0.9), y: skill(0.5), slot: skill(0.9), g: skill(0.9) }).versatile).toBe(false);
    const unproven = buildRoleFit({
      pos: "WR",
      recipes: recipes.map((r) => (r.role === "x" ? { ...r, requires: { feature: "x", minN: 10, why: "needs 10 reps" } } : r)),
      features: { x: { ...skill(0.7), n: 3 }, y: skill(0.7), slot: skill(0.4), g: skill(0.3) },
      heightIn: null, weightLb: null, sample: { n: 150, unit: "routes" }, confidenceAt: { medium: 100, high: 200 },
    });
    expect(unproven.versatile).toBe(false);
    expect(versatileRuleText("WR")).toBe("above 60% at both X and Y");
    expect(roleFitTooltip(fit({ x: skill(0.65), y: skill(0.66), slot: skill(0.4), g: skill(0.3) }))).toContain("Versatile: above 60% at both X and Y");
  });

  // One recipe per role, one feature each, for any position.
  const fitAt = (pos: RolePos, fits: number[]) => buildRoleFit({
    pos,
    recipes: ROLES[pos].map((r, i) => ({ role: r.key, ingredients: [{ feature: `f${i}`, weight: 1 }] })),
    features: Object.fromEntries(fits.map((v, i) => [`f${i}`, skill(v)])),
    heightIn: null, weightLb: null, sample: { n: 80, unit: "plays" }, confidenceAt: { medium: 60, high: 120 },
  });

  it("calls a TE Versatile at 70%+ in two roles", () => {
    expect(fitAt("TE", [0.72, 0.71, 0.4, 0.4]).versatile).toBe(true);
    expect(fitAt("TE", [0.72, 0.69, 0.4, 0.4]).versatile).toBe(false);
    expect(VERSATILE_PCT).toBe(70);
    expect(versatileRuleText("TE")).toBe("70%+ in two or more roles");
  });

  it("never calls an RB or QB Versatile: Three-down, Creator and Dual-threat already mean all-round", () => {
    expect(fitAt("RB", [0.9, 0.9, 0.9, 0.9, 0.9]).versatile).toBe(false);
    expect(fitAt("QB", [0.9, 0.9, 0.9, 0.9]).versatile).toBe(false);
    expect([hasVersatile("RB"), hasVersatile("QB"), hasVersatile("WR"), hasVersatile("TE")]).toEqual([false, false, true, true]);
  });

  it("says what his usage alone points to, which can differ from where he projects", () => {
    const r = fit({ x: skill(0.9), ux: usage(0.1), y: skill(0.5), slot: skill(0.5), us: usage(0.9), g: skill(0.5) });
    expect(r.best).toBe("x");
    expect(r.usedAs).toBe("slot");
    expect(roleFitTooltip(r)).toContain("Used as: Slot");
  });

  it("flags skill only when there's no usage data at all", () => {
    const r = fit({ x: skill(0.6), y: skill(0.5), slot: skill(0.5), g: skill(0.5) });
    expect(r.skillOnly).toBe(true);
    expect(r.usedAs).toBeNull();
    expect(roleFitTooltip(r)).toContain("skill only");
  });

  it("grades confidence by the tape behind it", () => {
    const f = { x: skill(0.6), y: skill(0.5), slot: skill(0.5), g: skill(0.5) };
    expect([fit(f, 60).confidence, fit(f, 150).confidence, fit(f, 250).confidence]).toEqual(["low", "medium", "high"]);
  });

  it("shows an unproven role with a ?, leading only as the outright top match", () => {
    const gated: BucketRecipe[] = recipes.map((r) => (r.role === "x" ? { ...r, requires: { feature: "x", minN: 10, why: "needs 10 reps" } } : r));
    const run = (xFit: number, n: number) => buildRoleFit({
      pos: "WR", recipes: gated, features: { x: { ...skill(xFit), n }, y: skill(0.5), slot: skill(0.8), g: skill(0.3) },
      heightIn: null, weightLb: null, sample: { n: 150, unit: "routes" }, confidenceAt: { medium: 100, high: 200 },
    });
    expect(roleLabel(run(0.9, 3))).toBe("X?");                                      // top outright: X?
    expect(run(0.78, 3).best).toBe("slot");                                         // near tie: unproven X can't take it
    expect(roleLabel(run(0.78, 3))).toBe("Slot / X?");
    expect(run(0.78, 12).best).toBe("x");                                           // proven: takes the tie
    expect(roleFitTooltip(run(0.9, 3))).toContain("X?: needs 10 reps (has 3)");
  });

  it("treats X and Y as one level: a near tie goes to the higher match, and either beats Slot", () => {
    expect(fit({ x: skill(0.76), y: skill(0.8), slot: skill(0.5), g: skill(0.3) }).best).toBe("y");
    expect(roleLabel(fit({ x: skill(0.8), y: skill(0.77), slot: skill(0.5), g: skill(0.3) }))).toBe("X / Y");
    expect(fit({ x: skill(0.5), y: skill(0.76), slot: skill(0.8), g: skill(0.3) }).best).toBe("y");
  });

  it("makes Gadget the catch-all: it leads only when X, Y and Slot are all under 50%, and never competes", () => {
    const weak = fit({ x: skill(0.45), y: skill(0.4), slot: skill(0.48), g: skill(0.3) });
    expect(weak.best).toBe("gadget");
    expect(weak.hybrid).toBeNull();
    expect(roleLabel(weak)).toBe("Gadget");
    // A higher Gadget % doesn't beat a real role that clears the line.
    const slot = fit({ x: skill(0.3), y: skill(0.4), slot: skill(0.55), g: skill(0.9) });
    expect(slot.best).toBe("slot");
    expect(slot.hybrid).toBeNull();
    expect(FALLBACK_LINE).toBe(50);
  });

  it("explains one role's match in its tooltip", () => {
    const r = fit({ x: { ...skill(0.9), label: "Press", display: "+8 pts" }, y: skill(0.5), slot: skill(0.5), g: skill(0.5) });
    expect(matchTooltip(r, "x")).toMatch(/^X 90%: Excels vs press/);
    expect(matchTooltip(r, "x")).toContain("+ Press: +8 pts");
  });
});
