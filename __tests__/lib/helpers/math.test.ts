import { describe, it, expect } from "vitest";
import {
  ordinal,
  average,
  clamp,
  sum,
  logisticWinProb,
  createSeededRandom,
  buildRoundRobinSchedule,
  percentileFromCounts,
  rankAgainstLeague,
} from "@/lib/helpers/math";

// ── ordinal ─────────────────────────────────────────────────────────────────

describe("ordinal", () => {
  it("returns '-' for falsy input", () => {
    expect(ordinal(0)).toBe("-");
  });

  it("handles the 11th/12th/13th teen exceptions", () => {
    expect(ordinal(11)).toBe("11th");
    expect(ordinal(12)).toBe("12th");
    expect(ordinal(13)).toBe("13th");
    expect(ordinal(111)).toBe("111th");
    expect(ordinal(112)).toBe("112th");
    expect(ordinal(113)).toBe("113th");
  });

  it("appends 'st' for 1, 21, 31, etc.", () => {
    expect(ordinal(1)).toBe("1st");
    expect(ordinal(21)).toBe("21st");
    expect(ordinal(101)).toBe("101st");
  });

  it("appends 'nd' for 2, 22, 32, etc.", () => {
    expect(ordinal(2)).toBe("2nd");
    expect(ordinal(22)).toBe("22nd");
  });

  it("appends 'rd' for 3, 23, 33, etc.", () => {
    expect(ordinal(3)).toBe("3rd");
    expect(ordinal(23)).toBe("23rd");
  });

  it("appends 'th' for all other numbers", () => {
    expect(ordinal(4)).toBe("4th");
    expect(ordinal(10)).toBe("10th");
    expect(ordinal(20)).toBe("20th");
    expect(ordinal(100)).toBe("100th");
  });
});

// ── average ─────────────────────────────────────────────────────────────────

describe("average", () => {
  it("returns 0 for empty array", () => {
    expect(average([])).toBe(0);
  });

  it("returns the value for a single-element array", () => {
    expect(average([5])).toBe(5);
  });

  it("rounds to one decimal place", () => {
    expect(average([1, 2, 3])).toBe(2);
    expect(average([1, 2])).toBe(1.5);
    expect(average([1, 1, 2])).toBe(1.3);
  });
});

// ── clamp ────────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns value unchanged when within bounds", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });

  it("handles equal bounds", () => {
    expect(clamp(7, 5, 5)).toBe(5);
  });
});

// ── sum ──────────────────────────────────────────────────────────────────────

describe("sum", () => {
  it("returns 0 for empty array", () => {
    expect(sum([])).toBe(0);
  });

  it("sums positive numbers", () => {
    expect(sum([1, 2, 3, 4])).toBe(10);
  });

  it("handles negatives", () => {
    expect(sum([-1, 1])).toBe(0);
  });
});

// ── logisticWinProb ──────────────────────────────────────────────────────────

describe("logisticWinProb", () => {
  it("returns ~0.5 for equal scores", () => {
    expect(logisticWinProb(100, 100)).toBeCloseTo(0.5, 2);
  });

  it("returns a high probability for a large advantage", () => {
    // scale=180; a 400-pt gap gives logistic(400/180) ≈ 0.90
    expect(logisticWinProb(500, 100)).toBeGreaterThan(0.9);
  });

  it("returns a low probability for a large disadvantage", () => {
    expect(logisticWinProb(100, 500)).toBeLessThan(0.1);
  });

  it("clamps to [0.05, 0.95]", () => {
    const high = logisticWinProb(1000, 0);
    const low  = logisticWinProb(0, 1000);
    expect(high).toBeLessThanOrEqual(0.95);
    expect(low).toBeGreaterThanOrEqual(0.05);
  });
});

// ── createSeededRandom ────────────────────────────────────────────────────────

describe("createSeededRandom", () => {
  it("produces values in [0, 1)", () => {
    const rng = createSeededRandom(42);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("produces the same sequence for the same seed", () => {
    const rng1 = createSeededRandom(99);
    const rng2 = createSeededRandom(99);
    for (let i = 0; i < 20; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it("produces different sequences for different seeds", () => {
    const seq1 = Array.from({ length: 5 }, createSeededRandom(1));
    const seq2 = Array.from({ length: 5 }, createSeededRandom(2));
    expect(seq1).not.toEqual(seq2);
  });
});

// ── buildRoundRobinSchedule ───────────────────────────────────────────────────

describe("buildRoundRobinSchedule", () => {
  it("returns correct number of weeks", () => {
    const schedule = buildRoundRobinSchedule([1, 2, 3, 4], 14);
    expect(schedule).toHaveLength(14);
  });

  it("each week has matchup pairs", () => {
    const schedule = buildRoundRobinSchedule([1, 2, 3, 4], 3);
    schedule.forEach((week) => {
      expect(Array.isArray(week)).toBe(true);
      week.forEach(([a, b]) => {
        expect(a).not.toBe(b);
        expect(typeof a).toBe("number");
        expect(typeof b).toBe("number");
      });
    });
  });

  it("handles fewer than 2 rosters gracefully", () => {
    const schedule = buildRoundRobinSchedule([1], 5);
    expect(schedule).toHaveLength(5);
    schedule.forEach((week) => expect(week).toHaveLength(0));
  });

  it("handles empty roster list", () => {
    const schedule = buildRoundRobinSchedule([], 5);
    expect(schedule).toHaveLength(5);
  });
});

// ── percentileFromCounts ──────────────────────────────────────────────────────

describe("percentileFromCounts", () => {
  it("returns 0 for empty counts", () => {
    expect(percentileFromCounts([], 0.5)).toBe(0);
  });

  it("returns the correct bucket for median", () => {
    // counts: [10, 10] — 50th percentile is at index 0 (cumulative 10 >= 10)
    expect(percentileFromCounts([10, 10], 0.5)).toBe(0);
  });

  it("returns the last index when percentile is 1.0", () => {
    const counts = [1, 1, 1, 1];
    expect(percentileFromCounts(counts, 1.0)).toBe(3);
  });
});

// ── rankAgainstLeague ─────────────────────────────────────────────────────────

describe("rankAgainstLeague", () => {
  it("returns 1 for the highest value", () => {
    expect(rankAgainstLeague([100, 80, 60], 100)).toBe(1);
  });

  it("returns last place for the lowest value", () => {
    expect(rankAgainstLeague([100, 80, 60], 60)).toBe(3);
  });

  it("handles a value lower than all totals", () => {
    expect(rankAgainstLeague([100, 80, 60], 10)).toBe(3);
  });

  it("returns 1 for an empty totals array", () => {
    expect(rankAgainstLeague([], 50)).toBe(1);
  });
});
