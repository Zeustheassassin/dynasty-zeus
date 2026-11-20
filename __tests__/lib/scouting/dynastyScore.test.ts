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
  qbRoundAverage,
  rookieCompetition,
  QB_DRAFT_CAPITAL,
  QB_FULL_CAPITAL_LAST,
  QB_PREDRAFT_SCALE,
  qbPredraftDiscount,
  QB_SLOT_RATES,
  qbSlotValue,
  ROUND_PICKS,
  type DynastyInputs,
} from "@/lib/scouting/dynastyScore";
import { UNDRAFTED_ROUND, draftCapitalLabel } from "@/lib/draftRound";

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
    const slow = { time: 4.8, source: "combine" as const };
    const insideTag = { key: "inside" as const, label: "Inside", why: "inside +20 vs outside −4" };
    const d = scoreDynasty(
      { ...base, weightLb: 190, forty: slow, draftRound: 3, heightIn: 70, runSideTag: insideTag },
      { age: 0, size: 0, speed: 0, lightInside: 0, draft: 0, landing: 0, role: 0, offense: 0, rushing: 0 },
    );
    expect(d.dynasty).toBe(0.8);
    expect(d.plus).toBe(0.8);
    const half = scoreDynasty({ ...base, draftRound: 3 }, { age: 1, size: 1, speed: 1, lightInside: 1, draft: 0.5, landing: 1, role: 1, offense: 1, rushing: 1 });
    expect(half.plus! - half.dynasty).toBeCloseTo(0.5 * DRAFT_CAPITAL[3], 9);
  });

  it("takes an RB's speed floor at the Speed slider's weight, into Dynasty and so Dynasty+; none for a WR (2026-11-15)", () => {
    // 4.75 at 211 lb: Speed Score 82.9, all of the floor's −0.7.
    const forty = { time: 4.75, source: "combine" as const };
    const without = scoreDynasty({ ...base, draftRound: 4 }, DEFAULT_DYNASTY_WEIGHTS);
    const rb = scoreDynasty({ ...base, draftRound: 4, forty }, DEFAULT_DYNASTY_WEIGHTS);
    expect(DEFAULT_DYNASTY_WEIGHTS.speed).toBe(1);
    expect(rb.speed!.value).toBeCloseTo(-0.7, 12);
    expect(rb.dynasty - without.dynasty).toBeCloseTo(-0.7, 12);
    expect(rb.plus! - without.plus!).toBeCloseTo(-0.7, 12);
    const doubled = scoreDynasty({ ...base, forty }, { ...DEFAULT_DYNASTY_WEIGHTS, speed: 2 });
    expect(doubled.dynasty - without.dynasty).toBeCloseTo(-1.4, 12);
    // A fast back gets nothing extra; no 40 and a WR's 40 count for nothing.
    expect(scoreDynasty({ ...base, forty: { time: 4.35, source: "combine" } }, DEFAULT_DYNASTY_WEIGHTS).dynasty).toBeCloseTo(without.dynasty, 12);
    expect(without.speed).toBeNull();
    const wr = scoreDynasty({ ...base, pos: "WR", forty }, DEFAULT_DYNASTY_WEIGHTS);
    expect(wr.speed).toBeNull();
    expect(wr.dynasty).toBeCloseTo(scoreDynasty({ ...base, pos: "WR" }, DEFAULT_DYNASTY_WEIGHTS).dynasty, 12);
  });

  it("drops the speed floor once his class is drafted, from Dynasty and Dynasty+ (the user, 2026-11-15)", () => {
    const forty = { time: 4.75, source: "combine" as const };
    const without = scoreDynasty({ ...base, draftRound: 4, classDrafted: true }, DEFAULT_DYNASTY_WEIGHTS);
    const drafted = scoreDynasty({ ...base, draftRound: 4, forty, classDrafted: true }, DEFAULT_DYNASTY_WEIGHTS);
    expect(drafted.speed!.value).toBe(0);
    expect(drafted.speed!.speedScore).toBeCloseTo(82.9, 1);
    expect(drafted.dynasty).toBeCloseTo(without.dynasty, 12);
    expect(drafted.plus!).toBeCloseTo(without.plus!, 12);
    // Before the draft it counts.
    expect(scoreDynasty({ ...base, draftRound: 4, forty, classDrafted: false }, DEFAULT_DYNASTY_WEIGHTS).dynasty - without.dynasty).toBeCloseTo(-0.7, 12);
  });

  // 2026-11-19, the user: "I would do the -0.5 and maybe after the draft reduce it to -0.25 I still want it to be penalised".
  it("takes an RB's light-inside red flag at its slider's weight, into Dynasty and Dynasty+; halved once drafted, never off", () => {
    const insideTag = { key: "inside" as const, label: "Inside", why: "inside +20.1 pts on 22 runs vs outside −3.6 pts on 47 runs (SRAE)" };
    const light = { ...base, heightIn: 70, weightLb: 185, draftRound: 3 };
    const without = scoreDynasty(light, DEFAULT_DYNASTY_WEIGHTS);
    const flagged = scoreDynasty({ ...light, runSideTag: insideTag }, DEFAULT_DYNASTY_WEIGHTS);
    expect(DEFAULT_DYNASTY_WEIGHTS.lightInside).toBe(1);
    expect(without.lightInside).toBeNull();
    expect(flagged.lightInside!.value).toBeCloseTo(-0.5, 12);
    expect(flagged.dynasty - without.dynasty).toBeCloseTo(-0.5, 12);
    expect(flagged.plus! - without.plus!).toBeCloseTo(-0.5, 12);
    // The slider scales it; 0 turns it off.
    expect(scoreDynasty({ ...light, runSideTag: insideTag }, { ...DEFAULT_DYNASTY_WEIGHTS, lightInside: 2 }).dynasty - without.dynasty).toBeCloseTo(-1, 12);
    expect(scoreDynasty({ ...light, runSideTag: insideTag }, { ...DEFAULT_DYNASTY_WEIGHTS, lightInside: 0 }).dynasty).toBeCloseTo(without.dynasty, 12);
    // Drafted: −0.25, still on.
    const drafted = scoreDynasty({ ...light, runSideTag: insideTag, classDrafted: true }, DEFAULT_DYNASTY_WEIGHTS);
    expect(drafted.dynasty - scoreDynasty({ ...light, classDrafted: true }, DEFAULT_DYNASTY_WEIGHTS).dynasty).toBeCloseTo(-0.25, 12);
    // A 198 weigh-in clears it; an Outside tag or a WR never gets it.
    expect(scoreDynasty({ ...light, runSideTag: insideTag, weighInLb: 198 }, DEFAULT_DYNASTY_WEIGHTS).lightInside).toBeNull();
    expect(scoreDynasty({ ...light, runSideTag: { ...insideTag, key: "outside", label: "Outside" } }, DEFAULT_DYNASTY_WEIGHTS).lightInside).toBeNull();
    expect(scoreDynasty({ ...light, pos: "WR", runSideTag: insideTag }, DEFAULT_DYNASTY_WEIGHTS).lightInside).toBeNull();
  });

  it("counts 80% of a QB's AE Score before the draft, and never in Dynasty+ (the user, 2026-11-18)", () => {
    expect(QB_PREDRAFT_SCALE).toBe(0.8);
    const zero = { ...DEFAULT_DYNASTY_WEIGHTS, age: 0, size: 0, speed: 0, rushing: 0 };
    const qb = (aeScore: number, extra: Partial<DynastyInputs> = {}) =>
      scoreDynasty({ ...base, pos: "QB", aeScore, ...extra }, zero);
    // A strong QB loses 20% of his edge, a weak one comes 20% back toward 0.
    expect(qb(1.65).dynasty).toBeCloseTo(1.32, 12);
    expect(qb(1.65).qbDiscount!.value).toBeCloseTo(-0.33, 12);
    expect(qb(-1).dynasty).toBeCloseTo(-0.8, 12);
    expect(qb(0).qbDiscount).toBeNull();
    // Off once his class is drafted.
    expect(qb(1.65, { classDrafted: true }).dynasty).toBeCloseTo(1.65, 12);
    expect(qb(1.65, { classDrafted: true }).qbDiscount).toBeNull();
    // Dynasty+ backs it out, so a pick set before May 1 doesn't stack it with the QB capital curve.
    const early = qb(1.65, { draftRound: 1, draftPick: 3 });
    const drafted = qb(1.65, { draftRound: 1, draftPick: 3, classDrafted: true });
    expect(early.plus!).toBeCloseTo(drafted.plus!, 12);
    expect(early.plus!).toBeCloseTo(1.65 + 2 * draftCapitalForPick(3, "QB"), 12);
    // Other positions never.
    for (const pos of ["RB", "WR", "TE"] as const) {
      expect(qbPredraftDiscount(pos, 1.65, false)).toBeNull();
      expect(scoreDynasty({ ...base, pos, aeScore: 1.65 }, zero).dynasty).toBeCloseTo(1.65, 12);
    }
  });

  it("adds a QB's rushing bonus at the Rushing slider's weight, into Dynasty and so Dynasty+, and only for a QB (2026-11-10)", () => {
    const rushing = { value: 0.2, label: "55 rush yds/game" };
    const w = { ...DEFAULT_DYNASTY_WEIGHTS, rushing: 1.5 };
    const without = scoreDynasty({ ...base, pos: "QB", draftRound: 2 }, w);
    const qb = scoreDynasty({ ...base, pos: "QB", draftRound: 2, rushing }, w);
    expect(qb.rushing).toEqual(rushing);
    expect(qb.dynasty - without.dynasty).toBeCloseTo(0.3, 12);
    expect(qb.plus! - without.plus!).toBeCloseTo(0.3, 12);
    expect(scoreDynasty({ ...base, pos: "QB", rushing }, { ...w, rushing: 0 }).dynasty).toBeCloseTo(without.dynasty, 12);
    const wr = scoreDynasty({ ...base, pos: "WR", rushing }, w);
    expect(wr.rushing).toBeNull();
    expect(DEFAULT_DYNASTY_WEIGHTS.rushing).toBe(1);
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

describe("a QB's draft capital", () => {
  it("is everyone's through pick 5, then under everyone's and falling with every pick", () => {
    for (let pick = 1; pick <= QB_FULL_CAPITAL_LAST; pick++) {
      expect(draftCapitalForPick(pick, "QB")).toBeCloseTo(draftCapitalForPick(pick), 12);
    }
    for (let pick = QB_FULL_CAPITAL_LAST + 1; pick <= 262; pick++) {
      expect(draftCapitalForPick(pick, "QB")).toBeLessThan(draftCapitalForPick(pick));
      expect(draftCapitalForPick(pick, "QB")).toBeLessThan(draftCapitalForPick(pick - 1, "QB"));
    }
    expect(QB_DRAFT_CAPITAL[UNDRAFTED_ROUND]).toBe(DRAFT_CAPITAL[UNDRAFTED_ROUND]);
  });

  it("tapers inside round 1 by the user's 8+ year starter rates (2026-11-18)", () => {
    expect(QB_SLOT_RATES.map((s) => [s.first, s.last])).toEqual([[1, 5], [6, 10], [11, 15], [16, 32]]);
    // Each slot sits at its middle pick, between picks 1–5 (everyone's) and round 2 (QB table) on log-odds.
    expect(qbSlotValue(0.375)).toBeCloseTo(draftCapitalForPick(3), 12);
    expect(qbSlotValue(0.1)).toBeCloseTo(QB_DRAFT_CAPITAL[2], 12);
    expect(draftCapitalForPick(8, "QB")).toBeCloseTo(qbSlotValue(0.275), 12);
    expect(draftCapitalForPick(13, "QB")).toBeCloseTo(qbSlotValue(0.225), 12);
    expect(draftCapitalForPick(24, "QB")).toBeCloseTo(qbSlotValue(0.125), 12);
    expect(qbSlotValue(0.275)).toBeCloseTo(0.8645, 4);
    expect(qbSlotValue(0.225)).toBeCloseTo(0.6872, 4);
    expect(qbSlotValue(0.125)).toBeCloseTo(0.2167, 4);
    // The user's test board: Carr at pick 6 keeps most of his first-round value; a QB at 24 sits near a 2nd-rounder.
    expect(draftCapitalForPick(6) - draftCapitalForPick(6, "QB")).toBeCloseTo(0.0806, 4);
    expect(draftCapitalForPick(24, "QB")).toBeLessThan(draftCapitalForPick(48, "WR"));
  });

  it("puts the QB table at each later round's middle, under everyone's", () => {
    for (const r of [2, 3, 4, 5, 6, 7]) {
      expect(draftCapitalForPick(ROUND_MIDDLE_PICK[r], "QB")).toBeCloseTo(QB_DRAFT_CAPITAL[r], 12);
      expect(QB_DRAFT_CAPITAL[r]).toBeLessThan(DRAFT_CAPITAL[r]);
    }
    expect(QB_DRAFT_CAPITAL[1]).toBeUndefined(); // round 1 goes by slot
  });

  it("runs from round 1's last slot into round 2, and a 4th-rounder to about a 7th-round WR", () => {
    const v24 = qbSlotValue(0.125);
    expect(draftCapitalForPick(33, "QB")).toBeCloseTo(v24 + (9 * (0.05 - v24)) / 24.5, 9);
    // Drake Lindsey at pick 109 in the 2027 mock: between round 3's middle (−0.15) and round 4's (−0.6).
    expect(draftCapitalForPick(109, "QB")).toBeCloseTo(-0.15 - (26 * 0.45) / 37, 9);
    expect(draftCapitalForPick(109)).toBeCloseTo(0.25 - (26 * 0.4) / 37, 9); // everyone else: about −0.03
    expect(draftCapitalForPick(257, "QB")).toBeCloseTo(-0.825, 9);
    expect(draftCapitalForPick(2000, "QB")).toBe(-1);
  });

  it("averages the QB curve over a round without a pick, and leaves the others on the table", () => {
    expect(qbRoundAverage(1)).toBeCloseTo(0.5854, 4); // tapered: well under everyone's 1.0
    expect(qbRoundAverage(2)).toBeCloseTo(0.054, 3); // the taper's last stretch runs into round 2
    expect(qbRoundAverage(9)).toBeNull();
    expect(draftCapitalAt(1, null, "QB")).toBeCloseTo(qbRoundAverage(1)!, 12);
    expect(draftCapitalAt(2, null, "QB")).toBeCloseTo(qbRoundAverage(2)!, 12);
    expect(draftCapitalAt(2, null, "WR")).toBe(DRAFT_CAPITAL[2]);
    expect(draftCapitalAt(4, 109, "QB")).toBeCloseTo(draftCapitalForPick(109, "QB"), 12);
    expect(draftCapitalAt(8, 300, "QB")).toBe(-1);
    expect(ROUND_PICKS[7]).toEqual([217, 257]);
  });

  it("scores a QB on his curve, and his rookie competition too", () => {
    const qb = (draftPick: number): DynastyInputs => ({
      pos: "QB", aeScore: 0, rookieAge: null, heightIn: null, weightLb: null, draftRound: 4, draftPick,
    });
    expect(scoreDynasty(qb(109), DEFAULT_DYNASTY_WEIGHTS).draftCapital).toBeCloseTo(draftCapitalForPick(109, "QB"), 12);
    // A QB taken at 20 ahead of one at 109: on the QB curve they're 0.85 of capital
    // apart (0.17 of the 0.2); on everyone else's, 0.987 apart.
    const ahead = { name: "Ahead", position: "QB" as const, overall: 20, round: 1, moveTe: false };
    const qbGap = draftCapitalForPick(20, "QB") - draftCapitalForPick(109, "QB");
    expect(qbGap).toBeCloseTo(0.854, 3);
    expect(rookieCompetition(draftCapitalForPick(109, "QB"), [ahead]).competitors[0].cost).toBeCloseTo(0.2 * qbGap, 12);
    expect(rookieCompetition(draftCapitalForPick(109), [{ ...ahead, position: "WR" as const }]).competitors[0].cost)
      .toBeCloseTo(0.2 * (draftCapitalForPick(20) - draftCapitalForPick(109)), 12);
  });

  it("says a QB past pick 5 is on the QB scale", () => {
    const tail = ", on the QB scale (QBs fall faster after the top 5 picks)";
    expect(draftCapitalLabel(2, 40, "QB")).toBe(`2nd round, pick 40${tail}`);
    expect(draftCapitalLabel(3, null, "QB")).toBe(`3rd round (no pick set, the round's average)${tail}`);
    expect(draftCapitalLabel(1, 26, "QB")).toBe(`1st round, pick 26${tail}`);
    expect(draftCapitalLabel(1, null, "QB")).toBe(`1st round (no pick set, the round's average)${tail}`);
    expect(draftCapitalLabel(1, 5, "QB")).toBe("1st round, pick 5");
    expect(draftCapitalLabel(2, 40, "WR")).toBe("2nd round, pick 40");
    expect(draftCapitalLabel(8, 300, "QB")).toBe("Undrafted");
  });
});
