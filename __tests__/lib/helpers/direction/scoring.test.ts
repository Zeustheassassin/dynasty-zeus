import { describe, it, expect } from "vitest";
import { computeWindowScore, getAdjustedDirectionBucket } from "@/lib/helpers/direction/scoring";

describe("computeWindowScore", () => {
  it("returns 0 for null/undefined profile", () => {
    expect(computeWindowScore(null)).toBe(0);
    expect(computeWindowScore(undefined)).toBe(0);
  });

  it("returns positive score for a young roster (coreAge=24, youngCoreCount=3)", () => {
    const score = computeWindowScore({ coreAge: 24, youngCoreCount: 3, oldCoreCount: 0 });
    // age bonus: (26-24)*0.25=0.5; young bonus: 3*0.85=2.55 → 3.05
    expect(score).toBeGreaterThan(0);
  });

  it("returns negative score for an aging roster (coreAge=30, oldCoreCount=4)", () => {
    const score = computeWindowScore({ coreAge: 30, youngCoreCount: 0, oldCoreCount: 4 });
    // age penalty: (30-26)*0.55=2.2; old penalty: 4*1.05=4.2 → -6.4
    expect(score).toBeLessThan(0);
  });

  it("returns 0 when coreAge is exactly 26 and other counts are 0", () => {
    expect(computeWindowScore({ coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 })).toBe(0);
  });

  it("age penalty dominates over young count when roster is very old", () => {
    // coreAge=32 → -(32-26)*0.55=-3.3; young=1 → +0.85; old=3 → -3.15 → -5.6
    const score = computeWindowScore({ coreAge: 32, youngCoreCount: 1, oldCoreCount: 3 });
    expect(score).toBeLessThan(-3);
  });

  it("clamps age bonus at prime: no bonus when coreAge=0 (missing data)", () => {
    // coreAge=0 → max(0, 26-0)=26 but coreAge=0 means no data → the guard 'if (coreAge > 0)' skips it
    const score = computeWindowScore({ coreAge: 0, youngCoreCount: 0, oldCoreCount: 0 });
    expect(score).toBe(0);
  });
});

describe("getAdjustedDirectionBucket", () => {
  it("leaves Elite unchanged when composite is neutral (no sim data)", () => {
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      50,
      false
    );
    expect(result).toBe("Elite");
  });

  it("demotes Elite when composite is very negative (aging core, no sim data)", () => {
    // coreAge=31 → -(31-26)*0.55=-2.75; oldCoreCount=2 → -2*1.05=-2.1 → composite≈-4.85
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 31, youngCoreCount: 0, oldCoreCount: 2 },
      50,
      false
    );
    expect(["True Contender", "Fading Contender"]).toContain(result);
  });

  it("applies playoff floor: Elite → Rebuilder when playoffOdds < 15 with sim data", () => {
    const result = getAdjustedDirectionBucket(
      "Elite",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      10,
      true
    );
    expect(result).toBe("Rebuilder");
  });

  it("applies playoff floor: True Contender → Almost There when odds < 50 with sim data", () => {
    // coreAge=26 → windowScore=0; playoffPressure=(49-50)/12.5≈-0.08 → composite≈-0.08
    const result = getAdjustedDirectionBucket(
      "True Contender",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      49,
      true
    );
    expect(result).toBe("Almost There");
  });

  it("returns Fading Out for empty rawBucket", () => {
    const result = getAdjustedDirectionBucket("", null, 50, false);
    expect(result).toBe("Fading Out");
  });

  it("promotes True Contender to Elite with strong positive composite and high playoff odds", () => {
    // youngCoreCount=4 → +3.4; coreAge=23 → +(26-23)*0.25=0.75; playoffOdds=90 → (90-50)/12.5=3.2
    // composite ≈ 7.35 → triggers Elite promotion
    const result = getAdjustedDirectionBucket(
      "True Contender",
      { coreAge: 23, youngCoreCount: 4, oldCoreCount: 0 },
      90,
      true
    );
    expect(result).toBe("Elite");
  });

  it("playoff floor overrides Almost There to Rebuilder when odds < 15 with sim data", () => {
    // windowScore = (26-23)*0.25 + 2*0.85 = 2.45; playoffPressure=(10-50)/12.5=-3.2
    // composite=-0.75 → gradient keeps "Almost There"; floor (odds<15) fires → Rebuilder
    const result = getAdjustedDirectionBucket(
      "Almost There",
      { coreAge: 23, youngCoreCount: 2, oldCoreCount: 0 },
      10,
      true
    );
    expect(result).toBe("Rebuilder");
  });

  it("Rebuilder stays Rebuilder with neutral composite", () => {
    const result = getAdjustedDirectionBucket(
      "Rebuilder",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      50,
      false
    );
    expect(result).toBe("Rebuilder");
  });

  it("passes through unknown rawBucket unchanged", () => {
    const result = getAdjustedDirectionBucket(
      "Purgatory",
      { coreAge: 26, youngCoreCount: 0, oldCoreCount: 0 },
      50,
      false
    );
    expect(result).toBe("Purgatory");
  });
});
