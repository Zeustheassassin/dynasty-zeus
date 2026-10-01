import { describe, it, expect } from "vitest";
import {
  careerWindowAdjustment,
  sizeFlags,
  scoreDynasty,
  DRAFT_CAPITAL,
  DEFAULT_DYNASTY_WEIGHTS,
  SIZE_FLAG_PENALTY,
  type DynastyInputs,
} from "@/lib/scouting/dynastyScore";

describe("careerWindowAdjustment", () => {
  it("credits young rookies and docks old ones, more so at short-prime positions", () => {
    // RB prime ends at 28: a typical 22-year-old has 6 prime seasons.
    expect(careerWindowAdjustment("RB", 22)).toBeCloseTo(0, 9);
    expect(careerWindowAdjustment("RB", 21)).toBeCloseTo(7 / 6 - 1, 9);
    expect(careerWindowAdjustment("RB", 25)).toBeCloseTo(-0.5, 9);
    // Same 25-year-old rookie costs a QB (prime to 34) far less.
    expect(careerWindowAdjustment("QB", 25)).toBeCloseTo(9 / 12 - 1, 9);
    // Past the prime: the whole window is gone, no further.
    expect(careerWindowAdjustment("RB", 30)).toBe(-1);
  });
});

describe("sizeFlags", () => {
  it("flags only the extremes the research backs", () => {
    expect(sizeFlags("RB", 66, 187).map((f) => f.value)).toEqual([SIZE_FLAG_PENALTY]);          // light
    expect(sizeFlags("RB", 74, 230).map((f) => f.value)).toEqual([SIZE_FLAG_PENALTY]);          // 6'2": tall
    expect(sizeFlags("RB", 70, 215)).toEqual([]);
    expect(sizeFlags("WR", 69, 164)).toHaveLength(1);
    expect(sizeFlags("WR", 75, 210)).toEqual([]);
    expect(sizeFlags("QB", 72, 190)).toEqual([]);
    expect(sizeFlags("RB", null, null)).toEqual([]);
  });
});

describe("scoreDynasty", () => {
  const base: DynastyInputs = {
    pos: "RB", aeScore: 0.8, rookieAge: { years: 21, estimated: false }, heightIn: 70, weightLb: 215, draftRound: null,
  };

  it("adds the weighted window and size flags to the AE Score", () => {
    const d = scoreDynasty({ ...base, weightLb: 190 }, DEFAULT_DYNASTY_WEIGHTS);
    expect(d.dynasty).toBeCloseTo(0.8 + (7 / 6 - 1) + SIZE_FLAG_PENALTY, 9);
    expect(d.plus).toBeNull();
  });

  it("adds draft capital for Plus once a round is set", () => {
    const r1 = scoreDynasty({ ...base, draftRound: 1 }, DEFAULT_DYNASTY_WEIGHTS);
    const udfa = scoreDynasty({ ...base, draftRound: 8 }, DEFAULT_DYNASTY_WEIGHTS);
    expect(r1.plus).toBeCloseTo(r1.dynasty + 1, 9);
    expect(udfa.plus).toBeCloseTo(udfa.dynasty - 1, 9);
  });

  it("scales each piece by its weight; zero weights leave the AE Score", () => {
    const d = scoreDynasty({ ...base, weightLb: 190, draftRound: 3 }, { age: 0, size: 0, draft: 0 });
    expect(d.dynasty).toBe(0.8);
    expect(d.plus).toBe(0.8);
    const half = scoreDynasty({ ...base, draftRound: 3 }, { age: 1, size: 1, draft: 0.5 });
    expect(half.plus! - half.dynasty).toBeCloseTo(0.5 * DRAFT_CAPITAL[3], 9);
  });

  it("treats an unknown age as no adjustment", () => {
    const d = scoreDynasty({ ...base, rookieAge: null }, DEFAULT_DYNASTY_WEIGHTS);
    expect(d.window).toBeNull();
    expect(d.dynasty).toBe(0.8);
  });

  it("orders draft capital from round 1 down to undrafted", () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8].map((r) => DRAFT_CAPITAL[r]);
    expect(vals[0]).toBe(1);
    expect(vals[7]).toBe(-1);
    for (let i = 1; i < vals.length; i++) expect(vals[i]).toBeLessThan(vals[i - 1]);
  });
});
