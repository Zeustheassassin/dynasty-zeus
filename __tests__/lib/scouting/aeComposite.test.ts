import { describe, it, expect } from "vitest";
import {
  trustAt,
  matchedCeiling,
  WR_CORE_FULL_TRUST,
  WR_ALL_FULL_TRUST,
  QB_FULL_TRUST,
  RB_FULL_TRUST,
  POSITION_BASELINE,
  estimateSpread,
  buildPositionComposite,
  buildAEComposite,
  MIN_POOL,
  type CompositeMetric,
} from "@/lib/scouting/aeComposite";
import type { AESample } from "@/lib/types";

const s = (ae: number, variance = 4, n = 100): AESample => ({ ae, n, variance });
const pool = (aes: number[], variance = 4) =>
  new Map<string, AESample | null>(aes.map((ae, i) => [`p${i}`, s(ae, variance)]));
const metric = (samples: Map<string, AESample | null>, weight = 1, key = "aae", label = "AAE"): CompositeMetric =>
  ({ key, label, weight, samples });

// Ten AEs, mean 0, sum of squares 132: sample variance 132 / 9.
const SPREAD = [-6, -4, -3, -2, -1, 1, 2, 3, 4, 6];
const SPREAD_VAR = 132 / 9;

describe("estimateSpread (Paule–Mandel)", () => {
  it("with equal noise, takes the noise out of the observed variance", () => {
    const est = estimateSpread([...pool(SPREAD).values()] as AESample[]);
    expect(est.tau2).toBeCloseTo(SPREAD_VAR - 4, 6);
    expect(est.mean).toBeCloseTo(0, 9);
  });

  it("is 0 when the pool spreads no more than its noise alone would", () => {
    // SD of 10 pts of noise each, values within ±6: nothing left over for talent.
    const est = estimateSpread([...pool(SPREAD, 100).values()] as AESample[]);
    expect(est.tau2).toBe(0);
  });

  it("centres on the pool, not on 0", () => {
    const est = estimateSpread([...pool(SPREAD.map((x) => x + 5)).values()] as AESample[]);
    expect(est.mean).toBeCloseTo(5, 6);
    expect(est.tau2).toBeCloseTo(SPREAD_VAR - 4, 6);
  });

  it("leans on the precise samples for the mean", () => {
    // One very precise +10 against nine noisy 0s: the mean sits well above the
    // simple average (+1).
    const xs = [s(10, 1), ...Array.from({ length: 9 }, () => s(0, 400))];
    expect(estimateSpread(xs).mean).toBeGreaterThan(5);
  });
});

describe("buildPositionComposite", () => {
  it(`leaves a position out until ${MIN_POOL} prospects clear the floor`, () => {
    const nine = pool(SPREAD.slice(0, 9));
    nine.set("under", null);
    const waiting = buildPositionComposite("TE", [metric(nine)]);
    expect(waiting.ready).toBe(false);
    expect(waiting.scores.size).toBe(0);
    expect(waiting.metrics[0]).toMatchObject({ qualified: 9, ready: false, tau: null, mean: null });

    const ready = buildPositionComposite("TE", [metric(pool(SPREAD))]);
    expect(ready.ready).toBe(true);
    expect(ready.scores.size).toBe(MIN_POOL);
  });

  it("scores τ·(ae − μ) / (τ² + v): shrunk, then put in true-talent SDs", () => {
    const pc = buildPositionComposite("QB", [metric(pool(SPREAD))]);
    const tau2 = SPREAD_VAR - 4;
    const top = pc.scores.get("p9")!; // ae +6
    expect(top.score).toBeCloseTo((Math.sqrt(tau2) * 6) / (tau2 + 4), 6);
    expect(top.components[0].reliability).toBeCloseTo(tau2 / (tau2 + 4), 6);
    expect(pc.metrics[0].tau).toBeCloseTo(Math.sqrt(tau2), 6);
    // Symmetric pool, so the bottom mirrors the top.
    expect(pc.scores.get("p0")!.score).toBeCloseTo(-top.score, 6);
  });

  it("ranks a big AE on a thin sample below a smaller one on a big sample", () => {
    const samples = pool(SPREAD);
    samples.set("thin", s(14, 60, 30));    // +14 on 30 throws
    samples.set("solid", s(6, 2, 150));    // +6 on 150
    const pc = buildPositionComposite("QB", [metric(samples)]);
    expect(pc.scores.get("solid")!.score).toBeGreaterThan(pc.scores.get("thin")!.score);
  });

  it("leaves a secondary metric out until it's ready itself", () => {
    const route = pool(SPREAD);
    const block = pool(SPREAD.slice(0, 9).map((x) => -x)); // 9: not ready
    const pc = buildPositionComposite("TE", [
      metric(route, 0.8, "te_saer", "TE-SAER"),
      metric(block, 0.2, "te_saeb", "TE-SAEB"),
    ]);
    expect(pc.metrics.map((m) => m.ready)).toEqual([true, false]);
    const only = buildPositionComposite("TE", [metric(route, 0.8, "te_saer", "TE-SAER")]);
    // Weights renormalize over the ready metrics, so the score is the route z alone.
    expect(pc.scores.get("p9")!.score).toBeCloseTo(only.scores.get("p9")!.score, 9);
    expect(pc.scores.get("p9")!.components.map((c) => c.key)).toEqual(["te_saer"]);
  });

  it("blends ready metrics by weight, a missing sample counting as average", () => {
    const route = pool(SPREAD);
    const block = pool(SPREAD.map((x) => -x));
    block.set("p9", null); // no blocking sample: average, 0
    block.set("blocker", s(0)); // keeps blocking at 10 qualified, so it's ready
    const pc = buildPositionComposite("TE", [
      metric(route, 0.8, "te_saer", "TE-SAER"),
      metric(block, 0.2, "te_saeb", "TE-SAEB"),
    ]);
    expect(pc.metrics.map((m) => m.ready)).toEqual([true, true]);
    const p0 = pc.scores.get("p0")!;
    const [r, b] = p0.components;
    expect(p0.score).toBeCloseTo(0.8 * r.z + 0.2 * b.z, 9);
    const p9 = pc.scores.get("p9")!;
    expect(p9.components.map((c) => c.key)).toEqual(["te_saer"]);
    expect(p9.score).toBeCloseTo(0.8 * p9.components[0].z, 9);
  });

  it("gives no score without the primary metric, whatever the secondary says", () => {
    const route = pool(SPREAD);
    route.set("blocker", null);
    const block = pool(SPREAD);
    block.set("blocker", s(20));
    const pc = buildPositionComposite("TE", [
      metric(route, 0.8, "te_saer", "TE-SAER"),
      metric(block, 0.2, "te_saeb", "TE-SAEB"),
    ]);
    expect(pc.scores.has("blocker")).toBe(false);
  });

  it("stays out when the pool shows no real spread", () => {
    const pc = buildPositionComposite("QB", [metric(pool(SPREAD, 100))]);
    expect(pc.ready).toBe(false);
    expect(pc.metrics[0].qualified).toBe(MIN_POOL);
  });
});

describe("buildAEComposite", () => {
  it("scores every ready position on one scale and holds TE back until it has the numbers", () => {
    const tag = (prefix: string, m: Map<string, AESample | null>) =>
      new Map([...m].map(([id, v]) => [`${prefix}${id}`, v]));
    const comp = buildAEComposite({
      qb: tag("qb", pool(SPREAD)),
      rb: tag("rb", pool(SPREAD.map((x) => x * 2))),
      wr: tag("wr", pool(SPREAD)),
      wrCore: tag("wr", pool(SPREAD.map((x) => x * 0.8))),
      teRoute: tag("te", pool([3, -1, 2])),
      teBlock: tag("te", pool([1, 0, -2])),
    });
    expect(comp.positions.TE.ready).toBe(false);
    expect(comp.positions.TE.metrics[0].qualified).toBe(3);
    expect(comp.scores.size).toBe(30);
    // RB's AEs are twice as spread out, and so is its τ: the same place in the
    // pool earns about the same score.
    const ratio = comp.scores.get("rbp9")!.score / comp.scores.get("qbp9")!.score;
    expect(Math.abs(ratio - 1)).toBeLessThan(0.15);
    expect(comp.positions.TE.metrics.map((m) => m.weight)).toEqual([0.8, 0.2]);
    // WR leads with cSAE (70%), SAE behind it (30%).
    expect(comp.positions.WR.metrics.map((m) => [m.key, m.weight])).toEqual([["csae", 0.7], ["sae", 0.3]]);
    const wr = comp.scores.get("wrp9")!;
    expect(wr.score).toBeCloseTo(0.7 * wr.components[0].z + 0.3 * wr.components[1].z, 9);
  });

  it("scores a WR only with enough core routes, whatever the SAE", () => {
    const empty = new Map<string, AESample | null>();
    const wrCore = pool(SPREAD);
    wrCore.set("goScreenGuy", null); // under 15 core routes
    const wr = pool(SPREAD);
    wr.set("goScreenGuy", s(12));
    const comp = buildAEComposite({ qb: empty, rb: empty, wr, wrCore, teRoute: empty, teBlock: empty });
    expect(comp.scores.has("goScreenGuy")).toBe(false);
    expect(comp.scores.has("p0")).toBe(true);
  });
});

describe("full-trust ceilings", () => {
  it("counts a sample in full at the ceiling, and tapers below it", () => {
    expect(trustAt(232, 232, 160)).toBe(1);
    expect(trustAt(400, 232, 160)).toBe(1);
    const f = (n: number) => n / (n + 160);
    expect(trustAt(116, 232, 160)).toBeCloseTo(f(116) / f(232), 12);
    // Early routes buy more trust than late ones.
    expect(trustAt(116, 232, 160) - trustAt(58, 232, 160)).toBeGreaterThan(trustAt(232, 232, 160) - trustAt(174, 232, 160));
  });

  it("scores a sample at the ceiling at face value", () => {
    const samples = pool(SPREAD); // n = 100 each
    const pc = buildPositionComposite("WR", [{ key: "csae", label: "cSAE", weight: 1, samples, fullTrustAt: 100 }]);
    const top = pc.scores.get("p9")!.components[0];
    expect(top.reliability).toBe(1);
    expect(top.z).toBeCloseTo((6 - pc.metrics[0].mean!) / pc.metrics[0].tau!, 12);
  });

  const tag = (prefix: string, m: Map<string, AESample | null>) => new Map([...m].map(([id, v]) => [`${prefix}${id}`, v]));
  const fullBoard = () => buildAEComposite({
    qb: tag("qb", pool(SPREAD, 9)),
    rb: tag("rb", pool(SPREAD.map((x) => x * 2), 16)),
    wr: tag("wr", pool(SPREAD)),
    wrCore: tag("wr", pool(SPREAD)),
    teRoute: tag("te", pool(SPREAD)), teBlock: new Map(),
  });

  it("gives QB and RB their own ceilings: 232 throws, 160 runs", () => {
    const comp = fullBoard();
    expect(comp.positions.WR.metrics.map((m) => m.fullTrustAt)).toEqual([WR_CORE_FULL_TRUST, WR_ALL_FULL_TRUST]);
    expect(comp.positions.QB.metrics[0].fullTrustAt).toBe(QB_FULL_TRUST);
    expect(comp.positions.RB.metrics[0].fullTrustAt).toBe(RB_FULL_TRUST);
    expect([QB_FULL_TRUST, RB_FULL_TRUST]).toEqual([232, 160]);
  });

  it("matches TE's ceiling to WR's, so TE gets the same lift", () => {
    const comp = fullBoard();
    const lift = (m: { fullTrustAt?: number; halfPoint?: number }) => (m.fullTrustAt! + m.halfPoint!) / m.fullTrustAt!;
    const wr = comp.positions.WR.metrics;
    const te = comp.positions.TE.metrics[0];
    expect(te.fullTrustAt).toBeGreaterThan(0);
    expect(lift(te)).toBeCloseTo(0.7 * lift(wr[0]) + 0.3 * lift(wr[1]), 1);
    // Nothing to match without a ceiling.
    expect(matchedCeiling(buildPositionComposite("WR", [metric(pool(SPREAD))]))).toBeUndefined();
  });
});

describe("position baseline", () => {
  it("sets every RB 0.2 lower, recorded on the score, and leaves the other positions alone", () => {
    expect(POSITION_BASELINE).toEqual({ RB: -0.2 });
    const rb = pool(SPREAD, 16);
    const comp = buildAEComposite({ qb: pool(SPREAD, 9), rb, wr: new Map(), wrCore: new Map(), teRoute: new Map(), teBlock: new Map() });
    const plain = buildPositionComposite("RB", [{ key: "srae", label: "SRAE", weight: 1, samples: rb, fullTrustAt: RB_FULL_TRUST }]);
    for (const [id, sc] of plain.scores) {
      const shifted = comp.positions.RB.scores.get(id)!;
      expect(shifted.score).toBeCloseTo(sc.score - 0.2, 12);
      expect(shifted.baseline).toBe(-0.2);
      expect(shifted.components).toEqual(sc.components); // the parts are untouched
      expect(sc.baseline).toBeUndefined();
    }
    for (const sc of comp.positions.QB.scores.values()) expect(sc.baseline).toBeUndefined();
  });
});
