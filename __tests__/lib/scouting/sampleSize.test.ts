import { describe, it, expect } from "vitest";
import type { AESample, ProspectWithStats } from "../../../lib/types";
import type { AEComposite, MetricSpread } from "../../../lib/scouting/aeComposite";
import type { CompositeInputs } from "../../../lib/scouting/prospectScores";
import { sampleCeilings, samplePartText, sampleSizes, sampleTier } from "../../../lib/scouting/sampleSize";

const prospect = (id: string, position: string) => ({ id, name: id, position }) as ProspectWithStats;
const smp = (n: number): AESample => ({ ae: 0, n, variance: 4 });
const samples = (entries: Record<string, number | null>) =>
  new Map(Object.entries(entries).map(([id, n]) => [id, n == null ? null : smp(n)]));
const inputs = (over: Partial<CompositeInputs> = {}): CompositeInputs => ({
  qb: new Map(), rb: new Map(), wr: new Map(), wrCore: new Map(), teRoute: new Map(), teBlock: new Map(), ...over,
});
// Only TE's metrics are read (for its matched ceilings).
const composite = (te: Partial<MetricSpread>[] = []) => ({ positions: { TE: { metrics: te } } }) as unknown as AEComposite;

describe("sampleTier", () => {
  it("splits at the user's lines: full, 50%, 25%", () => {
    expect(sampleTier(1, true)).toBe("full");
    expect(sampleTier(0.999, false)).toBe("half");
    expect(sampleTier(0.5, false)).toBe("half");
    expect(sampleTier(0.4999, false)).toBe("quarter");
    expect(sampleTier(0.25, false)).toBe("quarter");
    expect(sampleTier(0.2499, false)).toBe("low");
    expect(sampleTier(0, false)).toBe("low");
  });

  it("is full only when every ceiling is reached, not on a share that rounds to 1", () => {
    expect(sampleTier(1, false)).toBe("half");
  });
});

describe("sampleSizes", () => {
  it("reads QB throws against 232 and RB runs against 160", () => {
    const m = sampleSizes(
      [prospect("q", "QB"), prospect("r1", "RB"), prospect("r2", "RB"), prospect("r3", "RB")],
      inputs({ qb: samples({ q: 232 }), rb: samples({ r1: 80, r2: 40, r3: 39 }) }),
      composite(),
    );
    expect(m.get("q")).toMatchObject({ share: 1, tier: "full" });
    expect(m.get("r1")).toMatchObject({ share: 0.5, tier: "half" });
    expect(m.get("r2")).toMatchObject({ share: 0.25, tier: "quarter" });
    expect(m.get("r3")!.tier).toBe("low");
  });

  it("blends a WR's core and total routes 70/30, full only at both ceilings", () => {
    const m = sampleSizes(
      [prospect("full", "WR"), prospect("core", "WR"), prospect("half", "WR")],
      inputs({ wrCore: samples({ full: 168, core: 300, half: 84 }), wr: samples({ full: 232, core: 116, half: 116 }) }),
      composite(),
    );
    expect(m.get("full")!.tier).toBe("full");
    expect(m.get("core")).toMatchObject({ share: 0.85, tier: "half" });
    expect(m.get("half")).toMatchObject({ share: 0.5, tier: "half" });
  });

  it("counts a sample under its floor as nothing, and skips positions without a sample", () => {
    const m = sampleSizes(
      [prospect("q", "QB"), prospect("k", "K")],
      inputs({ qb: samples({ q: null }) }),
      composite(),
    );
    expect(m.get("q")).toMatchObject({ share: 0, tier: "low", parts: [{ key: "aae", n: null, full: 232 }] });
    expect(m.has("k")).toBe(false);
  });

  it("reads a TE's routes against WR's 232 until TEs have their own ceilings", () => {
    const m = sampleSizes([prospect("t", "TE")], inputs({ teRoute: samples({ t: 116 }), teBlock: samples({ t: 500 }) }), composite());
    expect(m.get("t")).toMatchObject({ share: 0.5, parts: [{ key: "te_saer", full: 232, weight: 1 }] });
  });

  it("uses TE's matched ceilings and weights once TEs are in the AE Score, never a per-player component", () => {
    const te = composite([
      { key: "te_saer", label: "TE-SAER", weight: 0.8, fullTrustAt: 100 },
      { key: "te_saeb", label: "TE-SAEB", weight: 0.2, fullTrustAt: 60 },
      { key: "pff_yprr", label: "YPRR", weight: 0.5, fullTrustAt: 50, perPlayer: true },
    ]);
    expect(sampleCeilings("TE", te).map((c) => c.key)).toEqual(["te_saer", "te_saeb"]);
    const m = sampleSizes([prospect("t", "TE")], inputs({ teRoute: samples({ t: 50 }), teBlock: samples({ t: 60 }) }), te);
    expect(m.get("t")!.share).toBeCloseTo(0.8 * 0.5 + 0.2 * 1, 10);
  });
});

describe("samplePartText", () => {
  it("gives the count against the ceiling, the count once full, or the floor", () => {
    const part = { key: "aae", label: "AAE", full: 232, weight: 1 };
    expect(samplePartText({ ...part, n: 150 })).toBe("150 of 232 throws");
    expect(samplePartText({ ...part, n: 240 })).toBe("240 throws (full at 232)");
    expect(samplePartText({ ...part, n: null })).toBe("under the AAE sample floor (full at 232 throws)");
  });
});
