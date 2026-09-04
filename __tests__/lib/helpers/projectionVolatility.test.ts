import { describe, it, expect } from "vitest";
import {
  getProjectionVolatility,
  MIN_VOLATILITY_SOURCES,
  HIGH_VOLATILITY_PCT,
  LOW_VOLATILITY_PCT,
} from "@/lib/helpers/projectionVolatility";

describe("getProjectionVolatility", () => {
  it("returns null when sourceFpts is missing", () => {
    expect(getProjectionVolatility({ fpts: 17.5, sourceFpts: null })).toBeNull();
  });

  it("returns null when fewer than MIN_VOLATILITY_SOURCES sources matched", () => {
    expect(MIN_VOLATILITY_SOURCES).toBe(3);
    expect(
      getProjectionVolatility({ fpts: 17.5, sourceFpts: { sleeper: 17.8, espn: 17.3 } })
    ).toBeNull();
  });

  it("flags a wide spread as volatile (user's own example: 12.8-20.6 vs 17.5 consensus)", () => {
    const v = getProjectionVolatility({
      fpts: 17.325,
      sourceFpts: { fantasypros: 12.8, numberfire: 20.6, espn: 17.5, sleeper: 18.4 },
    });
    expect(v).not.toBeNull();
    expect(v!.floor).toBe(12.8);
    expect(v!.ceiling).toBe(20.6);
    expect(v!.range).toBeCloseTo(7.8, 5);
    expect(v!.sourceCount).toBe(4);
    expect(v!.level).toBe("volatile");
  });

  it("flags a tight spread as safe (user's own example: 17.3-18.1)", () => {
    const v = getProjectionVolatility({
      fpts: 17.675,
      sourceFpts: { fantasypros: 17.8, numberfire: 17.3, espn: 17.5, sleeper: 18.1 },
    });
    expect(v).not.toBeNull();
    expect(v!.range).toBeCloseTo(0.8, 5);
    expect(v!.level).toBe("safe");
  });

  it("leaves a middling spread unflagged (neutral)", () => {
    // range/fpts = 2/20 = 10%, between the 8% "safe" floor and 20% "volatile" ceiling.
    const v = getProjectionVolatility({
      fpts: 20,
      sourceFpts: { fantasypros: 19, numberfire: 21, espn: 20, sleeper: 20 },
    });
    expect(v!.level).toBe("neutral");
  });

  it("respects the exact HIGH_VOLATILITY_PCT / LOW_VOLATILITY_PCT boundaries", () => {
    expect(HIGH_VOLATILITY_PCT).toBe(0.20);
    expect(LOW_VOLATILITY_PCT).toBe(0.08);
    // range/fpts exactly 0.20 -> volatile (>=).
    const atHigh = getProjectionVolatility({
      fpts: 100,
      sourceFpts: { a: 90, b: 100, c: 110, d: 100 }, // range 20 -> 20%
    });
    expect(atHigh!.level).toBe("volatile");
    // range/fpts exactly 0.08 -> safe (<=).
    const atLow = getProjectionVolatility({
      fpts: 100,
      sourceFpts: { a: 96, b: 100, c: 104, d: 100 }, // range 8 -> 8%
    });
    expect(atLow!.level).toBe("safe");
  });

  it("treats a zero/negative consensus fpts as a 0% spread (never divides by zero)", () => {
    const v = getProjectionVolatility({
      fpts: 0,
      sourceFpts: { a: 0, b: 0, c: 0 },
    });
    expect(v!.level).toBe("safe");
  });
});
