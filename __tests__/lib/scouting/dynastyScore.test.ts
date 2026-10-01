import { describe, it, expect } from "vitest";
import {
  careerWindowAdjustment,
  sizeFlags,
  scoreDynasty,
  DRAFT_CAPITAL,
  DEFAULT_DYNASTY_WEIGHTS,
  SIZE_CAP,
  WR_LIGHT_PENALTY,
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
  const total = (pos: "RB" | "WR" | "QB" | "TE", h: number | null, lb: number | null) =>
    sizeFlags(pos, h, lb).reduce((a, f) => a + f.value, 0);

  it("lifts backs carrying more weight for their height", () => {
    // Jadan Baugh, 6'1" 231: 3.16 lb per inch vs a typical RB's 2.97.
    expect(total("RB", 73, 231)).toBeCloseTo(((231 / 73 - 2.97) / 0.135) * 0.1, 9);
    expect(total("RB", 73, 231)).toBeGreaterThan(0.1);
    expect(sizeFlags("RB", 73, 231)[0].label).toBe(`heavy for the frame (6'1" 231: 3.16 lb per inch vs a typical RB's 2.97)`);
  });

  it("treats the same weight on a taller frame as leaner", () => {
    // 200 lb on 5'9" is compact; on 6'5" it's thin, and more fragile.
    expect(total("RB", 69, 200)).toBeGreaterThan(total("RB", 77, 200));
    expect(total("RB", 77, 200)).toBeLessThan(-0.25);
    expect(total("RB", 69, 200)).toBeGreaterThan(-0.1);
  });

  it("docks a 170-lb receiver on any frame, a tall one more", () => {
    const tall = total("WR", 75, 170);  // 6'3" 170
    const short = total("WR", 70, 170); // 5'10" 170
    expect(short).toBeLessThan(WR_LIGHT_PENALTY);  // light penalty plus a lean frame
    expect(tall).toBeLessThan(short);
    expect(sizeFlags("WR", 75, 170).map((f) => f.label)).toContain("under 175 lb (170): fragile on any frame");
    // A sturdy receiver gains.
    expect(total("WR", 73, 220)).toBeGreaterThan(0);
  });

  it("caps the frame piece, and assumes a typical height with none on file", () => {
    expect(total("RB", 70, 260)).toBe(SIZE_CAP);
    expect(total("RB", 72, 175)).toBe(-SIZE_CAP);
    expect(total("RB", null, 211)).toBeCloseTo(total("RB", 71, 211), 12);
    expect(sizeFlags("RB", 71, 211)).toEqual([]); // dead on typical
  });

  it("leaves QBs and TEs alone", () => {
    expect(sizeFlags("QB", 72, 190)).toEqual([]);
    expect(sizeFlags("TE", 76, 220)).toEqual([]);
    expect(sizeFlags("RB", 70, null)).toEqual([]);
  });
});

describe("scoreDynasty", () => {
  const base: DynastyInputs = {
    pos: "RB", aeScore: 0.8, rookieAge: { years: 21, estimated: false }, heightIn: 71, weightLb: 211, draftRound: null,
  };

  it("adds the weighted window and size flags to the AE Score", () => {
    const d = scoreDynasty({ ...base, weightLb: 190 }, DEFAULT_DYNASTY_WEIGHTS);
    const size = ((190 / 71 - 2.97) / 0.135) * 0.1; // 5'11" 190: lean for the frame
    expect(d.dynasty).toBeCloseTo(0.8 + (7 / 6 - 1) + size, 9);
    expect(d.plus).toBeNull();
  });

  it("adds draft capital for Plus once a round is set", () => {
    const r1 = scoreDynasty({ ...base, draftRound: 1 }, DEFAULT_DYNASTY_WEIGHTS);
    const udfa = scoreDynasty({ ...base, draftRound: 8 }, DEFAULT_DYNASTY_WEIGHTS);
    // Draft weight defaults to 2.
    expect(DEFAULT_DYNASTY_WEIGHTS.draft).toBe(2);
    expect(r1.plus).toBeCloseTo(r1.dynasty + 2, 9);
    expect(udfa.plus).toBeCloseTo(udfa.dynasty - 2, 9);
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
