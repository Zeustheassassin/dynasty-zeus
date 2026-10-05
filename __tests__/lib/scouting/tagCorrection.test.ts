import { describe, it, expect } from "vitest";
import {
  makeDesign, fitDifficultyModel, fitFromPlays, expectedFor, logitFromModel,
  aboveExpectedSampleForPlays, type FittedDifficulty,
} from "@/lib/scouting/difficultyModel";
import {
  fitTagCorrection, correctionFor, enabledSpecs, tagReadiness, heldOutTagTest, garbageTimeTest,
  eraResiduals, eraDrift, withGarbageWeight, DIFFICULTY_TAGS, ENABLED_TAG_CORRECTIONS,
  TEST_MIN_ON_PLAYS, TEST_MIN_PROSPECTS, ERA_CHECK_MIN_TAGGED, GT_MIN_PROSPECTS,
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

  it("is off unless a tag is switched on (all off today)", () => {
    for (const k of Object.keys(ENABLED_TAG_CORRECTIONS) as (keyof typeof ENABLED_TAG_CORRECTIONS)[]) expect(ENABLED_TAG_CORRECTIONS[k]).toEqual([]);
    expect(correctionFor("rb_srae", base, { rows: plays, outcome, tagged: isTagged })).toBeNull();
    expect(correctionFor("rb_srae", base, { rows: plays, outcome, tagged: isTagged }, { enabled: ["red_zone"] })).not.toBeNull();
    expect(enabledSpecs("te_saeb", ["blocked_defender"]).map((s) => s.column)).toEqual(["blocked_defender"]);
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
