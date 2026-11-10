import { describe, it, expect } from "vitest";
import {
  careerWindowAdjustment,
  sizeFlags,
  scoreDynasty,
  DRAFT_CAPITAL,
  DEFAULT_DYNASTY_WEIGHTS,
  ROUND_MIDDLE_PICK,
  SIZE_CAP,
  WR_LIGHT_PENALTY,
  draftCapitalAt,
  draftCapitalForPick,
  type DynastyInputs,
} from "@/lib/scouting/dynastyScore";
import { draftCapitalLabel } from "@/lib/draftRound";

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
    pos: "RB", aeScore: 0.8, rookieAge: { years: 21, estimated: false }, heightIn: 71, weightLb: 211, draftRound: null, draftPick: null,
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
    const d = scoreDynasty({ ...base, weightLb: 190, draftRound: 3 }, { age: 0, size: 0, draft: 0, landing: 0, role: 0 });
    expect(d.dynasty).toBe(0.8);
    expect(d.plus).toBe(0.8);
    const half = scoreDynasty({ ...base, draftRound: 3 }, { age: 1, size: 1, draft: 0.5, landing: 1, role: 1 });
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

  it("reads draft capital from the overall pick once one is set", () => {
    const early = scoreDynasty({ ...base, draftRound: 2, draftPick: 33 }, DEFAULT_DYNASTY_WEIGHTS);
    const late = scoreDynasty({ ...base, draftRound: 2, draftPick: 64 }, DEFAULT_DYNASTY_WEIGHTS);
    expect(early.draftCapital).toBeCloseTo(draftCapitalForPick(33), 12);
    expect(early.plus! - late.plus!).toBeCloseTo(2 * (draftCapitalForPick(33) - draftCapitalForPick(64)), 9);
    expect(early.plus!).toBeGreaterThan(late.plus!);
  });
});

describe("draft capital by pick", () => {
  it("puts each round's table value at the round's middle pick", () => {
    for (const r of [1, 2, 3, 4, 5, 6, 7]) {
      expect(draftCapitalForPick(ROUND_MIDDLE_PICK[r])).toBeCloseTo(DRAFT_CAPITAL[r], 12);
    }
  });

  it("falls with every later pick, across round lines", () => {
    for (let pick = 2; pick <= 262; pick++) {
      expect(draftCapitalForPick(pick)).toBeLessThan(draftCapitalForPick(pick - 1));
    }
    // The last pick in round 1 and the first in round 2 sit next to each other.
    expect(draftCapitalForPick(32) - draftCapitalForPick(33)).toBeCloseTo(0.0125, 9);
  });

  it("keeps each round's average at about its table value", () => {
    const avg = (from: number, to: number) => {
      let s = 0;
      for (let p = from; p <= to; p++) s += draftCapitalForPick(p);
      return s / (to - from + 1);
    };
    // Round 1 is one straight line, so it averages exactly.
    expect(avg(1, 32)).toBeCloseTo(DRAFT_CAPITAL[1], 9);
    // Later rounds bend at their middle pick: within 0.025 (2025's round lines).
    const rounds: [number, number, number][] = [[2, 33, 64], [3, 65, 102], [4, 103, 138], [5, 139, 176], [6, 177, 216], [7, 217, 257]];
    for (const [r, from, to] of rounds) expect(Math.abs(avg(from, to) - DRAFT_CAPITAL[r])).toBeLessThan(0.025);
  });

  it("carries the end segments past the first and last middles, never below undrafted", () => {
    expect(draftCapitalForPick(1)).toBeCloseTo(1.19375, 9);
    expect(draftCapitalForPick(32)).toBeCloseTo(0.80625, 9);
    expect(draftCapitalForPick(257)).toBeCloseTo(-0.75, 9);
    expect(draftCapitalForPick(2000)).toBe(DRAFT_CAPITAL[8]);
  });

  it("uses the pick when set, the round's average without one, and −1 for undrafted", () => {
    expect(draftCapitalAt(null, 20)).toBeNull();
    expect(draftCapitalAt(5, null)).toBe(DRAFT_CAPITAL[5]);
    expect(draftCapitalAt(5, 0)).toBe(DRAFT_CAPITAL[5]);
    expect(draftCapitalAt(1, 20)).toBeCloseTo(draftCapitalForPick(20), 12);
    // The Rookie Draft Hub writes undrafted as round 8, pick 300.
    expect(draftCapitalAt(8, 300)).toBe(-1);
    expect(draftCapitalAt(8, null)).toBe(-1);
  });

  it("labels what the capital was read from", () => {
    expect(draftCapitalLabel(1, 20)).toBe("1st round, pick 20");
    expect(draftCapitalLabel(5, null)).toBe("5th round (no pick set, the round's average)");
    expect(draftCapitalLabel(8, 300)).toBe("Undrafted");
  });
});
