import { describe, it, expect } from "vitest";
import {
  makeDesign, fitDifficultyModel, fitFromPlays, expectedFor, logitFromModel,
  aboveExpectedSampleForPlays, type FittedDifficulty,
} from "@/lib/scouting/difficultyModel";
import {
  fitTagCorrection, correctionFor, enabledSpecs, tagBucket, tagReadiness, heldOutTagTest, garbageTimeTest,
  eraResiduals, eraDrift, withGarbageWeight, DIFFICULTY_TAGS, ENABLED_TAG_CORRECTIONS,
  TEST_MIN_ON_PLAYS, TEST_MIN_PROSPECTS, ERA_CHECK_MIN_TAGGED, GT_MIN_PROSPECTS,
  ENABLED_SUB_ROUTES, SUB_ROUTE_TEST_MIN_REPS, subRouteSpecs, subRouteOf, subRouteLabel, subRouteReadiness, heldOutSubRouteTests,
} from "@/lib/scouting/tagCorrection";

// A tiny play: a situation bucket, the outcome, an optional tag set and owner.
interface P { game_id: string; pid: string; box: "a" | "b"; y: number; red_zone?: boolean | null; third_fourth_down?: boolean | null; short_yardage?: boolean | null; garbage_time?: boolean | null; hit_behind_line?: boolean | null }
const DESIGN = makeDesign<P>([[["a", "b"], (p) => p.box]]);
const outcome = (p: P) => p.y;
const isTagged = (p: P) => p.red_zone != null;

// Deterministic pseudo-random numbers.
function rng(seed: number) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// League: box a succeeds 60%, b 40%. Tagged plays: red zone takes 30 pts off.
function league(opts: { taggedProspects?: number; untaggedProspects?: number; rzEffect?: number; seed?: number; perProspect?: number } = {}): P[] {
  const { taggedProspects = 8, untaggedProspects = 8, rzEffect = -0.3, seed = 7, perProspect = 80 } = opts;
  const r = rng(seed);
  const out: P[] = [];
  for (let k = 0; k < untaggedProspects + taggedProspects; k++) {
    const tagged = k >= untaggedProspects;
    for (let i = 0; i < perProspect; i++) {
      const box = i % 2 ? "a" : "b";
      const rz = tagged && i % 3 === 0;
      const p = (box === "a" ? 0.6 : 0.4) + (rz ? rzEffect : 0);
      out.push({
        game_id: `g${k}-${i % 4}`, pid: `p${k}`, box, y: r() < p ? 1 : 0,
        ...(tagged ? { red_zone: rz, third_fourth_down: false, short_yardage: false, garbage_time: false, hit_behind_line: rz } : {}),
      });
    }
  }
  return out;
}
const fitted = (plays: readonly P[]) => fitFromPlays([...plays], DESIGN, outcome, 3);
const withModel = (f: FittedDifficulty<P>) => ({ ...f, model: f.model! });
const rbSpecs = DIFFICULTY_TAGS.rb_srae.filter((s) => s.column === "red_zone");

describe("fitDifficultyModel with an offset", () => {
  it("learns nothing when the offset already is the truth", () => {
    const cols = DESIGN.cols({ box: "a" } as P);
    const rows = Array.from({ length: 200 }, (_, i) => ({ cols, y: i % 5 === 0 ? 1 : 0, offset: Math.log(0.2 / 0.8) }));
    const b = fitDifficultyModel(rows, DESIGN.size, 3)!;
    expect(Math.abs(b[0])).toBeLessThan(1e-4);
  });

  it("leaves a plain fit exactly as before (no offsets)", () => {
    const plays = league();
    const a = fitDifficultyModel(plays.map((p) => ({ cols: DESIGN.cols(p), y: p.y })), DESIGN.size, 3)!;
    const b = fitDifficultyModel(plays.map((p) => ({ cols: DESIGN.cols(p), y: p.y, offset: 0 })), DESIGN.size, 3)!;
    expect([...a]).toEqual([...b]);
  });
});

describe("the tag correction", () => {
  const plays = league();
  const base = withModel(fitted(plays));
  const corr = fitTagCorrection(base, { rows: plays, outcome, tagged: isTagged }, rbSpecs)!;

  it("learns a hard tag as a negative effect", () => {
    expect(corr.model[1]).toBeLessThan(-0.5);
  });

  it("keeps the tagged plays' expected total where today's model puts it (anchored level)", () => {
    const tagged = plays.filter(isTagged);
    const before = tagged.reduce((s, p) => s + expectedFor(base, p), 0);
    const after = tagged.reduce((s, p) => s + expectedFor({ ...base, correction: corr }, p), 0);
    expect(after).toBeCloseTo(before, 6);
  });

  it("never touches an untagged play, and makes a tagged red-zone rep easier to fail", () => {
    const withCorr = { ...base, correction: corr };
    const old: P = { game_id: "x", pid: "x", box: "a", y: 0 };
    expect(expectedFor(withCorr, old)).toBe(expectedFor(base, old));
    const rz: P = { ...old, red_zone: true, third_fourth_down: false, short_yardage: false, garbage_time: false };
    expect(expectedFor(withCorr, rz)).toBeLessThan(expectedFor(base, rz) - 0.1);
  });

  it("leaves an untagged prospect's AE sample bit-for-bit as it was", () => {
    const withCorr = { ...base, correction: corr };
    const mine = plays.filter((p) => p.pid === "p0");
    expect(aboveExpectedSampleForPlays(mine, withCorr, outcome)).toEqual(aboveExpectedSampleForPlays(mine, base, outcome));
    // A tagged prospect whose reps were all in the red zone: judged against
    // red-zone difficulty, he's well above where today's model put him.
    const rzOnly = plays.filter((p) => p.pid === "p12" && p.red_zone);
    expect(aboveExpectedSampleForPlays(rzOnly, withCorr, outcome)!.ae).toBeGreaterThan(aboveExpectedSampleForPlays(rzOnly, base, outcome)!.ae + 10);
  });

  it("is off unless a tag is switched on", () => {
    // What's on (2026-10-21): the tags that passed held out, plus every TE block tag and Double coverage by the user's call.
    expect(ENABLED_TAG_CORRECTIONS).toEqual({
      qb_aae: ["play_action"],
      rb_srae: ["hit_behind_line", "short_yardage", "third_fourth_down"],
      wr_sae: ["double_coverage"],
      te_saer: ["double_coverage"],
      te_saeb: ["blocked_defender", "red_zone", "third_fourth_down", "short_yardage"],
    });
    expect(correctionFor("rb_srae", base, { rows: plays, outcome, tagged: isTagged }, { enabled: [] })).toBeNull();
    expect(correctionFor("rb_srae", base, { rows: plays, outcome, tagged: isTagged }, { enabled: ["red_zone"] })).not.toBeNull();
    expect(enabledSpecs("te_saeb", ["blocked_defender"]).map((s) => s.column)).toEqual(["blocked_defender"]);
    expect(enabledSpecs("te_saeb").map((s) => s.column)).toEqual(["blocked_defender", "red_zone", "third_fourth_down", "short_yardage"]);
  });

  it("splits a TE block on 3rd/4th down by pass or run block", () => {
    const spec = DIFFICULTY_TAGS.te_saeb.find((s) => s.column === "third_fourth_down")!;
    expect(spec.buckets).toEqual(["pass_block", "run_block"]);
    expect(tagBucket(spec, { third_fourth_down: true, play_type: "pass_block" })).toBe("pass_block");
    expect(tagBucket(spec, { third_fourth_down: true, play_type: "run_block" })).toBe("run_block");
    // 1st/2nd down is the reference, and an untagged block has no bucket.
    expect(tagBucket(spec, { third_fourth_down: false, play_type: "pass_block" })).toBeNull();
    expect(tagBucket(spec, { third_fourth_down: null, play_type: "run_block" })).toBeNull();
    // Every other model keeps the plain on / off 3rd/4th-down tag.
    expect(DIFFICULTY_TAGS.rb_srae.find((s) => s.column === "third_fourth_down")!.buckets).toEqual(["on"]);
  });

  it("anchors on the base model's full logit, a design offset included", () => {
    // No columns: each box's rate rides in on the offset alone.
    const off = makeDesign<P>([], (p) => (p.box === "a" ? Math.log(0.6 / 0.4) : Math.log(0.4 / 0.6)));
    const b = withModel(fitFromPlays([...plays], off, outcome, 3));
    const logit = (p: number) => Math.log(p / (1 - p));
    // The offset is in every expected: the two boxes sit exactly its gap apart.
    expect(logit(expectedFor(b, { box: "a" } as P)) - logit(expectedFor(b, { box: "b" } as P))).toBeCloseTo(2 * Math.log(1.5), 9);
    const c = correctionFor("rb_srae", b, { rows: plays, outcome, tagged: isTagged }, { enabled: ["red_zone"] })!;
    const tagged = plays.filter(isTagged);
    const sum = (f: FittedDifficulty<P> & { model: Float64Array }) => tagged.reduce((s, p) => s + expectedFor(f, p), 0);
    expect(sum({ ...b, correction: c })).toBeCloseTo(sum(b), 6);
  });

  it("re-centers the tagged era on the older plays when asked", () => {
    // Tagged plays charted 10 pts better than the model expects, tags aside.
    const drifted = plays.map((p) => (isTagged(p) && !p.red_zone && p.y === 0 && p.game_id.endsWith("-0") ? { ...p, y: 1 } : p));
    const b = withModel(fitted(drifted));
    const c = correctionFor("rb_srae", b, { rows: drifted, outcome, tagged: isTagged }, { enabled: [], recenter: true })!;
    const mean = (xs: P[], f: FittedDifficulty<P> & { model: Float64Array }) => xs.reduce((s, p) => s + p.y - expectedFor(f, p), 0) / xs.length;
    const older = mean(drifted.filter((p) => !isTagged(p)), b);
    expect(mean(drifted.filter(isTagged), { ...b, correction: c })).toBeCloseTo(older, 6);
  });
});

describe("readiness and the held-out test", () => {
  it("says what's missing before a tag can be tested", () => {
    const thin = league({ taggedProspects: 2, perProspect: 20 });
    const r = tagReadiness("rb_srae", { rows: thin, outcome, tagged: isTagged }, (p) => p.pid).find((x) => x.column === "red_zone")!;
    expect(r.testable).toBe(false);
    expect(r.short).toContain(`2/${TEST_MIN_PROSPECTS} prospects`);
    expect(r.short).toContain(`/${TEST_MIN_ON_PLAYS}`);
    expect(heldOutTagTest("rb_srae", { rows: thin, outcome, tagged: isTagged }, (p) => p.pid, fitted)).toEqual([]);
  });

  it("passes a tag that really changes difficulty, and only reports testable tags", () => {
    const plays = league({ taggedProspects: 10, perProspect: 120 });
    const res = heldOutTagTest("rb_srae", { rows: plays, outcome, tagged: isTagged }, (p) => p.pid, fitted);
    const rz = res.find((t) => t.column === "red_zone")!;
    expect(rz.improves).toBe(true);
    expect(rz.withLoss).toBeLessThan(rz.baseLoss);
    expect(rz.effects.on).toBeLessThan(0);
    // 3rd/4th down is never on in this league: not testable, so not reported.
    expect(res.find((t) => t.column === "third_fourth_down")).toBeUndefined();
  });

  it("doesn't pass a tag that does nothing", () => {
    const plays = league({ taggedProspects: 10, perProspect: 120, rzEffect: 0, seed: 11 });
    const rz = heldOutTagTest("rb_srae", { rows: plays, outcome, tagged: isTagged }, (p) => p.pid, fitted).find((t) => t.column === "red_zone")!;
    expect(rz.withLoss).toBeGreaterThanOrEqual(rz.baseLoss - 5e-4);
  });
});

// ── Sub-routes ───────────────────────────────────────────────────────────
// Routes in two families. Unsplit routes (charted before sub-routes) carry no
// variant and aren't tagged; split ones are tagged. Nines: Love of the Game
// is a clear-out (5%), a real nine 60%; curls 80%.
interface R { game_id: string; pid: string; route_type: "nine" | "curl"; route_variant?: string | null; y: number; red_zone?: boolean | null }
const RDESIGN = makeDesign<R>([[["nine", "curl"], (r) => r.route_type]]);
const rOutcome = (r: R) => r.y;
const rTagged = (r: R) => r.red_zone != null;
function routes({ prospects = 12, perProspect = 60, lotgRate = 0.05, seed = 3 } = {}): R[] {
  const r = rng(seed);
  const out: R[] = [];
  for (let k = 0; k < prospects; k++) {
    const split = k >= prospects / 2;
    for (let i = 0; i < perProspect; i++) {
      const route_type = i % 3 === 0 ? "curl" : "nine";
      const lotg = route_type === "nine" && i % 5 === 1;
      const p = route_type === "curl" ? 0.8 : lotg ? lotgRate : 0.6;
      out.push({
        game_id: `g${k}`, pid: `p${k}`, route_type, y: r() < p ? 1 : 0,
        ...(split ? { red_zone: i % 7 === 0, route_variant: route_type === "nine" ? (lotg ? "love_of_the_game" : "nine") : "short" } : {}),
      });
    }
  }
  return out;
}
const rFitted = (rows: readonly R[]) => fitFromPlays([...rows], RDESIGN, rOutcome, 3);
const LOTG = "nine:love_of_the_game" as const;

describe("sub-routes", () => {
  it("are switched on one at a time: Love of the Game for WR SAE and TE-SAER (2026-11-10)", () => {
    expect(ENABLED_SUB_ROUTES).toEqual({ qb_aae: [], rb_srae: [], te_saeb: [], wr_sae: [LOTG], te_saer: [LOTG] });
    expect(enabledSpecs("wr_sae").map((s) => s.column)).toEqual(["double_coverage", "sub_route:nine"]);
    expect(enabledSpecs("wr_sae", undefined, []).map((s) => s.column)).toEqual(["double_coverage"]);
    expect(subRouteLabel(LOTG)).toBe("Nine: Love of the game");
    expect(subRouteOf({ route_type: "nine", route_variant: "seam" })).toBe("nine:seam");
    expect(subRouteOf({ route_type: "nine", route_variant: null })).toBeNull();
  });

  it("give each family one spec: its switched-on sub-routes, and the rest of its split routes pooled", () => {
    const specs = subRouteSpecs([LOTG, "curl:short", "nine:seam"]);
    expect(specs.map((s) => [s.column, s.family, s.buckets])).toEqual([
      ["sub_route:nine", "nine", ["love_of_the_game", "seam", "rest"]],
      ["sub_route:curl", "curl", ["short", "rest"]],
    ]);
    const nine = specs[0];
    expect(tagBucket(nine, { route_type: "nine", route_variant: "love_of_the_game" })).toBe("love_of_the_game");
    expect(tagBucket(nine, { route_type: "nine", route_variant: "sluggo" })).toBe("rest");
    // Unsplit, or another family: no bucket, so not touched.
    expect(tagBucket(nine, { route_type: "nine", route_variant: null })).toBeNull();
    expect(tagBucket(nine, { route_type: "curl", route_variant: "love_of_the_game" })).toBeNull();
  });

  const rows = routes();
  const base = { ...rFitted(rows), model: rFitted(rows).model! };
  const specs = [...DIFFICULTY_TAGS.rb_srae.filter((s) => s.column === "red_zone"), ...subRouteSpecs([LOTG])];
  const corr = fitTagCorrection(base, { rows, outcome: rOutcome, tagged: rTagged }, specs)!;
  const on = { ...base, correction: corr };
  const sum = (xs: R[], f: FittedDifficulty<R> & { model: Float64Array }) => xs.reduce((s, x) => s + expectedFor(f, x), 0);
  const tagged = rows.filter(rTagged);
  const splitNines = tagged.filter((x) => x.route_type === "nine");

  it("judge Love of the Game against its own rate and raise the family's other split nines to match", () => {
    const lotg = splitNines.find((x) => x.route_variant === "love_of_the_game" && !x.red_zone)!;
    const nine = splitNines.find((x) => x.route_variant === "nine" && !x.red_zone)!;
    expect(expectedFor(on, lotg)).toBeLessThan(expectedFor(base, lotg) - 0.2);
    expect(expectedFor(on, nine)).toBeGreaterThan(expectedFor(base, nine) + 0.03);
  });

  it("keep the family's split routes, and every tagged route, at today's expected total", () => {
    // The same correction with the family's columns zeroed: the red-zone tag and level alone.
    const noFamily = { ...on, correction: { ...corr, model: Float64Array.from(corr.model).map((v, j) => (j >= 2 ? 0 : v)) } };
    expect(sum(splitNines, on)).toBeCloseTo(sum(splitNines, noFamily), 6);
    expect(sum(tagged, on)).toBeCloseTo(sum(tagged, base), 6);
    // Split curls aren't in the family: only the red-zone tag and level move them.
    const curls = tagged.filter((x) => x.route_type === "curl");
    expect(sum(curls, on)).toBeCloseTo(sum(curls, noFamily), 9);
  });

  it("never touch an unsplit route", () => {
    const old = rows.find((x) => !rTagged(x) && x.route_type === "nine")!;
    expect(expectedFor(on, old)).toBe(expectedFor(base, old));
  });

  it("move nothing when the family has no split routes", () => {
    const unsplit = rows.filter((x) => !rTagged(x));
    const c = fitTagCorrection(base, { rows: [...unsplit, ...tagged.filter((x) => x.route_type === "curl")], outcome: rOutcome, tagged: rTagged }, subRouteSpecs([LOTG]))!;
    const curl = tagged.find((x) => x.route_type === "curl")!;
    expect(expectedFor({ ...base, correction: c }, curl)).toBeCloseTo(expectedFor(base, curl), 9);
  });

  it("report every sub-route charted, its rest of family, and what's missing before a test", () => {
    const thin = routes({ prospects: 4, perProspect: 30 });
    const ready = subRouteReadiness("wr_sae", { rows: thin, outcome: rOutcome, tagged: rTagged }, (x) => x.pid);
    const lotg = ready.find((r) => r.id === LOTG)!;
    const splitLotg = thin.filter((x) => rTagged(x) && x.route_variant === "love_of_the_game");
    expect(lotg.reps).toBe(splitLotg.length);
    expect(lotg.wins).toBe(splitLotg.filter((x) => x.y === 1).length);
    expect(lotg.restReps).toBe(thin.filter((x) => rTagged(x) && x.route_variant === "nine").length);
    expect(lotg.enabled).toBe(true);
    expect(lotg.testable).toBe(false);
    expect(lotg.short).toContain(`/${SUB_ROUTE_TEST_MIN_REPS} routes`);
    expect(ready.find((r) => r.id === "curl:short")!.short).toContain("other split routes to compare");
  });

  it("pass a sub-route that really plays differently, held out by prospect, and not one that doesn't", () => {
    const big = routes({ prospects: 20, perProspect: 90 });
    const t = heldOutSubRouteTests("wr_sae", { rows: big, outcome: rOutcome, tagged: rTagged }, (x) => x.pid, rFitted).find((x) => x.column === LOTG)!;
    expect(t.improves).toBe(true);
    expect(t.foldsBetter).toBeGreaterThanOrEqual(4);
    expect(t.effects.love_of_the_game).toBeLessThan(t.effects.rest);
    const same = routes({ prospects: 20, perProspect: 90, lotgRate: 0.6, seed: 9 });
    const u = heldOutSubRouteTests("wr_sae", { rows: same, outcome: rOutcome, tagged: rTagged }, (x) => x.pid, rFitted).find((x) => x.column === LOTG)!;
    expect(u.withLoss).toBeGreaterThanOrEqual(u.baseLoss - 5e-4);
  });
});

describe("garbage time", () => {
  it("counts in full unless the weight says otherwise", () => {
    const w = (p: P) => (p.pid === "x" ? 0.5 : 1);
    expect(withGarbageWeight("rb_srae", w)).toBe(w);
    const half = withGarbageWeight("rb_srae", w, 0.5);
    expect(half({ game_id: "", pid: "y", box: "a", y: 1, garbage_time: true })).toBe(0.5);
    expect(half({ game_id: "", pid: "y", box: "a", y: 1, garbage_time: false })).toBe(1);
  });

  it(`isn't testable until ${GT_MIN_PROSPECTS} prospects have garbage-time plays`, () => {
    const t = garbageTimeTest(league(), isTagged, (p) => p.pid, (p) => p.game_id, (p) => p.y - 0.5);
    expect(t.testable).toBe(false);
    expect(t.best).toBeNull();
  });

  it("leaves garbage time out when it says nothing about the player", () => {
    // Each prospect has a true level; garbage-time reps are pure noise around 0.
    const r = rng(3);
    const rows: P[] = [];
    for (let k = 0; k < 8; k++) {
      const level = (k - 3.5) / 10;
      for (let g = 0; g < 4; g++) for (let i = 0; i < 40; i++) {
        const garbage = i < 12;
        const y = garbage ? (r() < 0.5 ? 1 : 0) : r() < 0.5 + level ? 1 : 0;
        rows.push({ game_id: `g${k}-${g}`, pid: `p${k}`, box: "a", y, red_zone: false, garbage_time: garbage });
      }
    }
    const t = garbageTimeTest(rows, isTagged, (p) => p.pid, (p) => p.game_id, (p) => p.y - 0.5);
    expect(t.testable).toBe(true);
    expect(t.best!).toBeLessThan(1);
  });
});

describe("era scale check", () => {
  it("reports each era's mean residual and flags a drift beyond 2 SE", () => {
    const rows = [
      ...Array.from({ length: 400 }, (_, i) => ({ era: "in_app" as const, r: i % 2 ? 1 : -1 })),
      ...Array.from({ length: 400 }, (_, i) => ({ era: "tagged" as const, r: (i % 2 ? 1 : -1) + 0.5 })),
    ];
    const e = eraResiduals(rows, (x) => x.era, (x) => x.r);
    expect(e.in_app!.mean).toBeCloseTo(0, 9);
    expect(e.tagged!.mean).toBeCloseTo(0.5, 9);
    const d = eraDrift(e);
    expect(d.drift).toBeCloseTo(0.5, 9);
    expect(d.flagged).toBe(true);
  });

  it(`waits for ${ERA_CHECK_MIN_TAGGED} tagged plays`, () => {
    const rows = [...Array.from({ length: 400 }, () => ({ era: "in_app" as const, r: 0 })), ...Array.from({ length: 50 }, () => ({ era: "tagged" as const, r: 5 }))];
    const d = eraDrift(eraResiduals(rows, (x) => x.era, (x) => x.r));
    expect(d.enough).toBe(false);
    expect(d.flagged).toBe(false);
  });

  it("uses a cell's own squared residuals for its SE", () => {
    const e = eraResiduals([{ n: 10, s: 2, sq: 10 }], () => "tagged", (c) => c.s, (c) => c.n, (c) => c.sq);
    expect(e.tagged!.mean).toBeCloseTo(0.2, 9);
  });
});

describe("logitFromModel", () => {
  it("adds the offset", () => {
    const m = Float64Array.from([0.5, 1, -1]);
    expect(logitFromModel(m, [1], 2)).toBeCloseTo(3.5, 12);
  });
});
