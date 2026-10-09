import { describe, it, expect } from "vitest";
import type { AESample, ProspectWithStats } from "../../../lib/types";
import type { CompositeInputs } from "../../../lib/scouting/prospectScores";
import { SAMPLE_FULL, sampleSizes, sampleText, sampleTier } from "../../../lib/scouting/sampleSize";

const prospect = (id: string, position: string) => ({ id, name: id, position }) as ProspectWithStats;
const smp = (n: number): AESample => ({ ae: 0, n, variance: 4 });
const samples = (entries: Record<string, number | null>) =>
  new Map(Object.entries(entries).map(([id, n]) => [id, n == null ? null : smp(n)]));
const inputs = (over: Partial<CompositeInputs> = {}): CompositeInputs => ({
  qb: new Map(), rb: new Map(), wr: new Map(), wrCore: new Map(), teRoute: new Map(), teBlock: new Map(), ...over,
});

describe("sampleTier", () => {
  it("splits at the user's lines: full, 50%, 25%", () => {
    expect(sampleTier(180, 180)).toBe("full");
    expect(sampleTier(240, 180)).toBe("full");
    expect(sampleTier(179, 180)).toBe("half");
    expect(sampleTier(90, 180)).toBe("half");
    expect(sampleTier(89, 180)).toBe("quarter");
    expect(sampleTier(45, 180)).toBe("quarter");
    expect(sampleTier(44, 180)).toBe("low");
    expect(sampleTier(0, 180)).toBe("low");
  });

  it("takes an odd full sample's half and quarter as they fall, 62.5 and 31.25 runs of 125", () => {
    expect(sampleTier(63, 125)).toBe("half");
    expect(sampleTier(62, 125)).toBe("quarter");
    expect(sampleTier(32, 125)).toBe("quarter");
    expect(sampleTier(31, 125)).toBe("low");
  });
});

describe("sampleSizes", () => {
  it("uses the user's full samples: QB 180 throws, RB 125 runs, WR 160 routes, TE 140 routes", () => {
    expect(Object.fromEntries(Object.entries(SAMPLE_FULL).map(([pos, f]) => [pos, f.full])))
      .toEqual({ QB: 180, RB: 125, WR: 160, TE: 140 });
  });

  it("reads each position's headline plays against its full sample", () => {
    const m = sampleSizes(
      [prospect("q", "QB"), prospect("r", "RB"), prospect("w", "WR"), prospect("t", "TE")],
      inputs({
        qb: samples({ q: 180 }), rb: samples({ r: 70 }), wr: samples({ w: 40 }), teRoute: samples({ t: 20 }),
        // Not counted: WR core routes and TE blocks.
        wrCore: samples({ w: 500 }), teBlock: samples({ t: 500 }),
      }),
    );
    expect(m.get("q")).toMatchObject({ key: "aae", n: 180, share: 1, tier: "full" });
    expect(m.get("r")).toMatchObject({ key: "srae", n: 70, share: 0.56, tier: "half" });
    expect(m.get("w")).toMatchObject({ key: "sae", n: 40, share: 0.25, tier: "quarter" });
    expect(m.get("t")).toMatchObject({ key: "te_saer", n: 20, tier: "low" });
  });

  it("caps the share at full", () => {
    expect(sampleSizes([prospect("q", "QB")], inputs({ qb: samples({ q: 400 }) })).get("q")!.share).toBe(1);
  });

  it("counts a sample under its floor as nothing, and skips positions without a sample", () => {
    const m = sampleSizes([prospect("q", "QB"), prospect("k", "K")], inputs({ qb: samples({ q: null }) }));
    expect(m.get("q")).toMatchObject({ n: null, share: 0, tier: "low" });
    expect(m.has("k")).toBe(false);
  });
});

describe("sampleText", () => {
  it("gives the count against full, the count once full, or the floor", () => {
    const qb = SAMPLE_FULL.QB;
    expect(sampleText({ ...qb, n: 150 })).toBe("150 of 180 throws");
    expect(sampleText({ ...qb, n: 240 })).toBe("240 throws (full at 180)");
    expect(sampleText({ ...qb, n: null })).toBe("under the AAE sample floor (full at 180 throws)");
    expect(sampleText({ ...SAMPLE_FULL.RB, n: 60 })).toBe("60 of 125 runs");
  });
});
