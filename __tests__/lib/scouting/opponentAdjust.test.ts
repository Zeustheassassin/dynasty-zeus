import { describe, it, expect } from "vitest";
import {
  measureTierEffects,
  resolveEffects,
  adjustSample,
  applyOpponentStrength,
  MIN_PROSPECTS,
  SHRINK_REPS,
  RB_SHARE_OF_WR,
} from "@/lib/scouting/opponentAdjust";
import type { AESample } from "@/lib/types";

// A prospect with `p4` reps against P4 and `g5` against G5, doing `lift`
// better (as a fraction) against G5 than against P4.
const withSplit = (p4: number, g5: number, lift: number, fcs = 0): AESample => ({
  ae: 0, n: p4 + g5 + fcs, variance: 4,
  byTier: {
    P4: { n: p4, resid: 0 },
    G5: { n: g5, resid: g5 * lift },
    ...(fcs ? { FCS: { n: fcs, resid: fcs * lift } } : {}),
  },
});
const pool = (k: number, lift: number) => Array.from({ length: k }, () => withSplit(100, 25, lift));

describe("measureTierEffects", () => {
  it(`stays unmeasured below ${MIN_PROSPECTS} prospects with reps against both`, () => {
    expect(measureTierEffects(pool(MIN_PROSPECTS - 1, 0.05)).G5.effect).toBeNull();
    expect(measureTierEffects(pool(MIN_PROSPECTS, 0.05)).G5.effect).not.toBeNull();
  });

  it("compares each player against their own P4 reps, shrunk toward 0", () => {
    const m = measureTierEffects(pool(10, 0.05));
    const w = (100 * 25) / 125; // per prospect
    expect(m.G5.effect).toBeCloseTo((10 * w * 0.05) / (10 * w + SHRINK_REPS), 9);
    expect(m.G5).toMatchObject({ prospects: 10, reps: 250 });
  });

  it("ignores who the players are: a uniformly weaker G5-only group moves nothing", () => {
    const g5Only: AESample = { ae: -5, n: 100, variance: 4, byTier: { G5: { n: 100, resid: -5 } } };
    const m = measureTierEffects([...pool(6, 0.02), ...Array.from({ length: 20 }, () => g5Only)]);
    expect(m.G5.prospects).toBe(6);
    expect(m.G5.effect).toBeGreaterThan(0);
  });

  it("never lets weaker competition count as harder", () => {
    expect(measureTierEffects(pool(10, -0.05)).G5.effect).toBe(0);
  });
});

describe("resolveEffects", () => {
  it("keeps FCS at least as easy as G5 and falls back when unmeasured", () => {
    const m = measureTierEffects(pool(10, 0.05));
    const e = resolveEffects(m);
    expect(e.FCS).toBe(e.G5);
    expect(resolveEffects(measureTierEffects([]), { G5: 0.01, FCS: 0.03 })).toEqual({ G5: 0.01, FCS: 0.03 });
  });
});

describe("adjustSample", () => {
  it("takes the lift back out over every play, keeping the raw AE", () => {
    const s: AESample = { ae: 6, n: 100, variance: 4, byTier: { P4: { n: 60, resid: 0 }, G5: { n: 30, resid: 0 }, FCS: { n: 10, resid: 0 } } };
    const out = adjustSample(s, { G5: 0.02, FCS: 0.04 })!;
    expect(out.ae).toBeCloseTo(6 - ((30 * 0.02 + 10 * 0.04) / 100) * 100, 9);
    expect(out.rawAe).toBe(6);
    expect(out.variance).toBe(4);
  });

  it("uses the season-weighted share of reps when the sample carries weights", () => {
    // 50 G5 reps from an older season (weight 0.9), 50 P4 reps from the newest.
    const s: AESample = { ae: 6, n: 100, w: 95, variance: 4, byTier: { P4: { n: 50, resid: 0, w: 50 }, G5: { n: 50, resid: 0, w: 45 } } };
    expect(adjustSample(s, { G5: 0.02, FCS: 0.04 })!.ae).toBeCloseTo(6 - ((45 * 0.02) / 95) * 100, 9);
  });

  it("leaves P4-only and unsplit samples alone", () => {
    const p4: AESample = { ae: 3, n: 50, variance: 4, byTier: { P4: { n: 50, resid: 0 } } };
    expect(adjustSample(p4, { G5: 0.02, FCS: 0.04 })).toBe(p4);
    const none: AESample = { ae: 3, n: 50, variance: 4 };
    expect(adjustSample(none, { G5: 0.02, FCS: 0.04 })).toBe(none);
    expect(adjustSample(null, { G5: 0.02, FCS: 0.04 })).toBeNull();
  });
});

describe("applyOpponentStrength", () => {
  const ids = (xs: AESample[], prefix: string) => new Map(xs.map((s, i) => [`${prefix}${i}`, s]));
  const thinRB = new Map<string, AESample | null>([["rb0", withSplit(50, 10, 0.5)]]);
  const thinTE = new Map<string, AESample | null>([["te0", withSplit(40, 10, 0.5)]]);

  it("measures WR, lends TE the WR effect and RB half of it", () => {
    const wr = ids(pool(10, 0.05), "wr");
    const adj = applyOpponentStrength({ rb: thinRB, wr, wrCore: wr, teRoute: thinTE, teBlock: thinTE });
    const wrE = adj.effects.WR.effects.G5;
    expect(adj.effects.WR.source).toBe("measured");
    expect(adj.effects.TE).toMatchObject({ source: "from WR", effects: { G5: wrE } });
    expect(adj.effects.RB.source).toBe("half of WR");
    expect(adj.effects.RB.effects.G5).toBeCloseTo(wrE * RB_SHARE_OF_WR, 12);
    // A G5 rep's lift comes out of the RB's AE: 10 of 60 reps at half the WR effect.
    expect(adj.rb.get("rb0")!.ae).toBeCloseTo(-((10 * wrE * RB_SHARE_OF_WR) / 60) * 100, 9);
  });

  it("adjusts nothing until WR can be measured", () => {
    const adj = applyOpponentStrength({ rb: thinRB, wr: thinTE, wrCore: thinTE, teRoute: thinTE, teBlock: thinTE });
    expect(adj.effects.WR.source).toBe("none");
    expect(adj.rb.get("rb0")).toBe(thinRB.get("rb0"));
  });
});
