import { describe, it, expect } from "vitest";
import {
  combineEquivalent, fortyDetail, fortyDisplay, formatForty, parseFortyTime, speedFlag, speedScore,
  FORTY_MAX, FORTY_MIN, PRO_DAY_ADJUST, RB_SPEED_FLOOR,
} from "@/lib/scouting/speedFloor";

// The value the ramp gives at a Speed Score, from the floor's own numbers.
const ramp = (ss: number) =>
  RB_SPEED_FLOOR.value * Math.max(0, Math.min(1, (RB_SPEED_FLOOR.none - ss) / (RB_SPEED_FLOOR.none - RB_SPEED_FLOOR.full)));

describe("speedScore", () => {
  it("is Barnwell's weight × 200 ÷ 40⁴", () => {
    expect(speedScore(214, 4.52)).toBeCloseTo((214 * 200) / 4.52 ** 4, 12);
    expect(speedScore(214, 4.52)).toBeCloseTo(102.5, 1);
    // Heavier at the same time scores higher; slower at the same weight lower.
    expect(speedScore(225, 4.6)).toBeGreaterThan(speedScore(200, 4.6));
    expect(speedScore(214, 4.7)).toBeLessThan(speedScore(214, 4.6));
  });
});

describe("combineEquivalent / formatForty", () => {
  it("reads a hand-timed pro day 0.05 slower, a combine time as it is", () => {
    expect(PRO_DAY_ADJUST).toBe(0.05);
    expect(combineEquivalent(4.48, "pro_day")).toBeCloseTo(4.53, 12);
    expect(combineEquivalent(4.48, "combine")).toBe(4.48);
    expect(formatForty(4.5, "combine")).toBe("4.50");
    expect(formatForty(4.48, "pro_day")).toBe("4.48 PD");
    expect(formatForty(4.48, null)).toBe("4.48");
  });

  it("shows a real 40 first, else a projection marked ~ that says it doesn't count", () => {
    expect(fortyDisplay({ forty_time: "4.47", forty_source: "pro_day", forty_projected: 4.4 }))
      .toEqual({ text: "4.47 PD", title: "Pro day (hand-timed): 4.52 on the combine's scale", projected: false, sortValue: 4.47 + 0.05 });
    const proj = fortyDisplay({ forty_projected: "4.5", forty_projected_from: "WalterFootball" })!;
    expect(proj).toMatchObject({ text: "~4.50", projected: true, sortValue: 4.5 });
    expect(proj.title).toMatch(/^Projected by WalterFootball: shown only. The speed floor counts a real 40/);
    expect(fortyDisplay({})).toBeNull();
  });

  it("describes where he ran it and his weigh-in", () => {
    expect(fortyDetail(4.47, "pro_day", null)).toBe("Pro day (hand-timed): 4.52 on the combine's scale");
    expect(fortyDetail(4.5, "combine", 212)).toBe("Combine · weighed 212 lb");
    expect(fortyDetail(4.5, null, undefined)).toBe("Combine");
  });
});

describe("parseFortyTime", () => {
  it("rounds to hundredths, blank is null, anything else isn't a time yet", () => {
    expect(parseFortyTime("4.52")).toBe(4.52);
    expect(parseFortyTime(" 4.5 ")).toBe(4.5);
    expect(parseFortyTime("4.567")).toBe(4.57);
    expect(parseFortyTime("")).toBeNull();
    expect(parseFortyTime("  ")).toBeNull();
    // Half-typed or out of range: leave the last good value in place.
    expect(parseFortyTime("4")).toBeUndefined();
    expect(parseFortyTime("4.")).toBeUndefined();
    expect(parseFortyTime("45")).toBeUndefined();
    expect(parseFortyTime("abc")).toBeUndefined();
    expect(parseFortyTime("-4.5")).toBeUndefined();
    expect(parseFortyTime(FORTY_MIN.toFixed(2))).toBe(FORTY_MIN);
    expect(parseFortyTime(FORTY_MAX.toFixed(2))).toBe(FORTY_MAX);
  });
});

describe("speedFlag (RB speed floor)", () => {
  it("costs nothing at Speed Score 91 and up, all of 0.7 at 88 and under, a straight line between", () => {
    expect(RB_SPEED_FLOOR).toEqual({ none: 91, full: 88, value: -0.7 });
    // 4.60 at 214 lb: Speed Score 95.6, clear.
    const clear = speedFlag("RB", { time: 4.6, source: "combine" }, 214)!;
    expect(clear.value).toBe(0);
    expect(clear.speedScore).toBeCloseTo(95.6, 1);
    expect(clear.label).toBe("4.60 at the combine at 214 lb (bio weight, no weigh-in): Speed Score 95.6, clear of the floor (91)");
    // 4.75 at 214 lb: 84.1, all of it.
    const slow = speedFlag("RB", { time: 4.75, source: "combine", weightLb: 214 }, 230)!;
    expect(slow.value).toBeCloseTo(-0.7, 12);
    expect(slow.label).toBe("4.75 at the combine weighing 214: Speed Score 84.1, under the floor (all of it at 88 and under)");
    // 4.68 at 214 lb: 89.2, partway down the ramp.
    const mid = speedFlag("RB", { time: 4.68, source: "combine" }, 214)!;
    expect(mid.value).toBeCloseTo(ramp(speedScore(214, 4.68)), 12);
    expect(mid.value).toBeLessThan(-0.35);
    expect(mid.value).toBeGreaterThan(-0.5);
    expect(mid.label).toContain("under the floor (91 down to 88)");
  });

  it("reads weight: the same 4.62 is clear for a 225-lb back and under the floor for a 200-lb one", () => {
    expect(speedFlag("RB", { time: 4.62, source: "combine" }, 225)!.value).toBe(0);
    expect(speedFlag("RB", { time: 4.62, source: "combine" }, 200)!.value).toBeCloseTo(-0.7, 12);
  });

  it("puts a pro-day time on the combine's scale first", () => {
    // 4.62 at a pro day reads 4.67: 90.0 at 214 lb, a third of the way down.
    const pd = speedFlag("RB", { time: 4.62, source: "pro_day" }, 214)!;
    expect(pd.speedScore).toBeCloseTo(speedScore(214, 4.67), 12);
    expect(pd.value).toBeCloseTo(ramp(speedScore(214, 4.67)), 12);
    expect(pd.label).toContain("4.62 at his pro day (+0.05 hand-timed = 4.67) at 214 lb");
    expect(speedFlag("RB", { time: 4.62, source: "combine" }, 214)!.value).toBe(0);
  });

  it("reads the weigh-in over the bio weight, which runs heavy (Robert Henry: bio 205, combine 196)", () => {
    const run = { time: 4.52, source: "combine" as const };
    expect(speedFlag("RB", run, 205)!.speedScore).toBeCloseTo(98.2, 1);
    expect(speedFlag("RB", { ...run, weightLb: 196 }, 205)!.speedScore).toBeCloseTo(93.9, 1);
    // A weigh-in with no bio weight still scores; null falls back to the bio weight.
    expect(speedFlag("RB", { ...run, weightLb: 196 }, null)!.speedScore).toBeCloseTo(93.9, 1);
    expect(speedFlag("RB", { ...run, weightLb: null }, 205)!.speedScore).toBeCloseTo(98.2, 1);
  });

  it("never gives a bonus, however fast", () => {
    expect(speedFlag("RB", { time: 4.28, source: "combine" }, 215)!.value).toBe(0);
  });

  it("is 0 without a weight (no penalty on a guess), and null off RB or without a 40", () => {
    const noWeight = speedFlag("RB", { time: 4.8, source: "combine" }, null)!;
    expect(noWeight).toEqual({ label: "4.80 at the combine, no weight on file for a Speed Score", value: 0, speedScore: null });
    expect(speedFlag("RB", null, 214)).toBeNull();
    expect(speedFlag("RB", undefined, 214)).toBeNull();
    // No WR floor: the draft already prices WR speed. QB and TE weren't studied.
    for (const pos of ["WR", "QB", "TE"] as const) expect(speedFlag(pos, { time: 4.8, source: "combine" }, 200)).toBeNull();
  });
});
