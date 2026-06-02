import { describe, it, expect } from "vitest";
import type { PlayerWithValue, PickWithValue } from "@/components/tradeHub/shared";
import {
  isAgingAsset,
  isOldProducerBuy,
  isYoungBuildingBlock,
  isFutureInsulationAsset,
  getAgeUrgency,
  getFutureValue,
  yearsToCliff,
  isPremiumCurrentPick,
  packageOk,
  posTotals,
  tradeWaiverAdj,
  isBalanced,
  computeTeamWindow,
  getPickSlotBonus,
} from "@/components/tradeHub/FinderScoring";
import { CURRENT_YEAR } from "@/lib/helpers/season";

// Fixtures use the same NFL-season-year source the code compares against, so
// "current-year" assertions hold year-round (incl. the Jan/Feb rollover window).
const CY = CURRENT_YEAR;
const NY = String(Number(CURRENT_YEAR) + 1);

const p = (position: string, age: number | null, value = 0) =>
  ({ position, age, value }) as unknown as PlayerWithValue;

const pick = (slot: string, round: number, season = CY, value = 0) =>
  ({ slot, round, season, value }) as unknown as PickWithValue;

// ── isAgingAsset ─────────────────────────────────────────────────────

describe("isAgingAsset", () => {
  it("QB: aging at 30, not at 29", () => {
    expect(isAgingAsset(p("QB", 30))).toBe(true);
    expect(isAgingAsset(p("QB", 29))).toBe(false);
  });

  it("RB: aging at 26, not at 25", () => {
    expect(isAgingAsset(p("RB", 26))).toBe(true);
    expect(isAgingAsset(p("RB", 25))).toBe(false);
  });

  it("WR: aging at 29, not at 28", () => {
    expect(isAgingAsset(p("WR", 29))).toBe(true);
    expect(isAgingAsset(p("WR", 28))).toBe(false);
  });

  it("TE: aging at 29, not at 28", () => {
    expect(isAgingAsset(p("TE", 29))).toBe(true);
    expect(isAgingAsset(p("TE", 28))).toBe(false);
  });

  it("unknown position falls back to cutoff 29", () => {
    expect(isAgingAsset(p("K", 29))).toBe(true);
    expect(isAgingAsset(p("K", 28))).toBe(false);
  });
});

// ── isOldProducerBuy ─────────────────────────────────────────────────

describe("isOldProducerBuy", () => {
  it("RB: old at 25, not at 24", () => {
    expect(isOldProducerBuy(p("RB", 25))).toBe(true);
    expect(isOldProducerBuy(p("RB", 24))).toBe(false);
  });

  it("QB: old at 31, not at 30", () => {
    expect(isOldProducerBuy(p("QB", 31))).toBe(true);
    expect(isOldProducerBuy(p("QB", 30))).toBe(false);
  });

  it("WR: old at 29, not at 28", () => {
    expect(isOldProducerBuy(p("WR", 29))).toBe(true);
    expect(isOldProducerBuy(p("WR", 28))).toBe(false);
  });

  it("TE: old at 29, not at 28", () => {
    expect(isOldProducerBuy(p("TE", 29))).toBe(true);
    expect(isOldProducerBuy(p("TE", 28))).toBe(false);
  });
});

// ── isYoungBuildingBlock ──────────────────────────────────────────────

describe("isYoungBuildingBlock", () => {
  it("QB age 24 → true", () => expect(isYoungBuildingBlock(p("QB", 24))).toBe(true));
  it("QB age 25 → false", () => expect(isYoungBuildingBlock(p("QB", 25))).toBe(false));
  it("WR age 24 → true", () => expect(isYoungBuildingBlock(p("WR", 24))).toBe(true));
  it("RB age 24 → false (wrong position)", () => expect(isYoungBuildingBlock(p("RB", 24))).toBe(false));
  it("QB null age → false (99 > 24)", () => expect(isYoungBuildingBlock(p("QB", null))).toBe(false));
});

// ── isFutureInsulationAsset ───────────────────────────────────────────

describe("isFutureInsulationAsset", () => {
  it("QB age 25 → true; age 26 → false", () => {
    expect(isFutureInsulationAsset(p("QB", 25))).toBe(true);
    expect(isFutureInsulationAsset(p("QB", 26))).toBe(false);
  });

  it("WR age 25 → true; age 26 → false", () => {
    expect(isFutureInsulationAsset(p("WR", 25))).toBe(true);
    expect(isFutureInsulationAsset(p("WR", 26))).toBe(false);
  });

  it("TE age 25 → true; age 26 → false", () => {
    expect(isFutureInsulationAsset(p("TE", 25))).toBe(true);
    expect(isFutureInsulationAsset(p("TE", 26))).toBe(false);
  });

  it("RB age 23 → true; age 24 → false", () => {
    expect(isFutureInsulationAsset(p("RB", 23))).toBe(true);
    expect(isFutureInsulationAsset(p("RB", 24))).toBe(false);
  });
});

// ── getAgeUrgency ────────────────────────────────────────────────────

describe("getAgeUrgency", () => {
  it("returns 0 for age=0 regardless of position", () => {
    expect(getAgeUrgency(p("RB", 0))).toBe(0);
  });

  it("RB urgency curve", () => {
    expect(getAgeUrgency(p("RB", 22))).toBe(0);
    expect(getAgeUrgency(p("RB", 24))).toBe(0.15);
    expect(getAgeUrgency(p("RB", 25))).toBe(0.40);
    expect(getAgeUrgency(p("RB", 26))).toBe(0.70);
    expect(getAgeUrgency(p("RB", 27))).toBe(0.90);
    expect(getAgeUrgency(p("RB", 28))).toBe(1.0);
  });

  it("QB urgency curve", () => {
    expect(getAgeUrgency(p("QB", 26))).toBe(0);
    expect(getAgeUrgency(p("QB", 29))).toBe(0.15);
    expect(getAgeUrgency(p("QB", 31))).toBe(0.40);
    expect(getAgeUrgency(p("QB", 33))).toBe(0.75);
    expect(getAgeUrgency(p("QB", 34))).toBe(1.0);
  });

  it("WR urgency curve", () => {
    expect(getAgeUrgency(p("WR", 24))).toBe(0);
    expect(getAgeUrgency(p("WR", 26))).toBe(0.15);
    expect(getAgeUrgency(p("WR", 28))).toBe(0.35);
    expect(getAgeUrgency(p("WR", 30))).toBe(0.65);
    expect(getAgeUrgency(p("WR", 31))).toBe(0.85);
    expect(getAgeUrgency(p("WR", 32))).toBe(1.0);
  });
});

// ── getFutureValue ────────────────────────────────────────────────────

describe("getFutureValue", () => {
  it("returns 1 - getAgeUrgency", () => {
    const rb22 = p("RB", 22);
    const rb28 = p("RB", 28);
    expect(getFutureValue(rb22)).toBe(1 - getAgeUrgency(rb22));
    expect(getFutureValue(rb28)).toBe(1 - getAgeUrgency(rb28));
  });

  it("prime-age RB (22) has future value 1.0", () => {
    expect(getFutureValue(p("RB", 22))).toBe(1.0);
  });

  it("over-the-hill RB (28+) has future value 0", () => {
    expect(getFutureValue(p("RB", 28))).toBe(0);
  });
});

// ── yearsToCliff ──────────────────────────────────────────────────────

describe("yearsToCliff", () => {
  it("returns 5 when age is 0 (missing data default)", () => {
    expect(yearsToCliff(p("RB", 0))).toBe(5);
  });

  it("RB cliff is 28", () => {
    expect(yearsToCliff(p("RB", 25))).toBe(3);
    expect(yearsToCliff(p("RB", 28))).toBe(0);
    expect(yearsToCliff(p("RB", 29))).toBe(0); // max(0, …)
  });

  it("QB cliff is 35", () => {
    expect(yearsToCliff(p("QB", 30))).toBe(5);
    expect(yearsToCliff(p("QB", 35))).toBe(0);
  });

  it("WR/TE cliff is 32", () => {
    expect(yearsToCliff(p("WR", 28))).toBe(4);
    expect(yearsToCliff(p("TE", 32))).toBe(0);
  });
});

// ── isPremiumCurrentPick ──────────────────────────────────────────────

describe("isPremiumCurrentPick", () => {
  it("returns truthy for current-year 1.01–1.06 slots", () => {
    expect(isPremiumCurrentPick(pick("1.01", 1))).toBeTruthy();
    expect(isPremiumCurrentPick(pick("1.04", 1))).toBeTruthy();
    expect(isPremiumCurrentPick(pick("1.06", 1))).toBeTruthy();
  });

  it("returns falsy for slot 1.07 (outside premium range)", () => {
    expect(isPremiumCurrentPick(pick("1.07", 1))).toBeFalsy();
  });

  it("returns falsy for a future-year pick even with premium slot", () => {
    expect(isPremiumCurrentPick(pick("1.03", 1, NY))).toBeFalsy();
  });

  it("returns falsy when pick has no slot", () => {
    expect(isPremiumCurrentPick(pick("", 1))).toBeFalsy();
  });
});

// ── packageOk ────────────────────────────────────────────────────────

describe("packageOk", () => {
  it("empty package is ok", () => expect(packageOk([])).toBe(true));
  it("one QB is ok", () => expect(packageOk([p("QB", 27), p("WR", 25)])).toBe(true));
  it("two QBs is not ok", () => expect(packageOk([p("QB", 27), p("QB", 29)])).toBe(false));
  it("one TE is ok", () => expect(packageOk([p("QB", 27), p("TE", 26)])).toBe(true));
  it("two TEs is not ok", () => expect(packageOk([p("TE", 26), p("TE", 28)])).toBe(false));
  it("pure skill (no QB/TE) is ok", () => expect(packageOk([p("RB", 24), p("WR", 25), p("WR", 23)])).toBe(true));
});

// ── posTotals ────────────────────────────────────────────────────────

describe("posTotals", () => {
  it("empty list returns all zeros", () => {
    expect(posTotals([])).toEqual({ QB: 0, RB: 0, WR: 0, TE: 0 });
  });

  it("sums values correctly by position", () => {
    const list = [
      { position: "WR", value: 300 },
      { position: "WR", value: 200 },
      { position: "RB", value: 400 },
    ];
    const totals = posTotals(list);
    expect(totals.WR).toBe(500);
    expect(totals.RB).toBe(400);
    expect(totals.QB).toBe(0);
    expect(totals.TE).toBe(0);
  });

  it("passes unknown positions through without affecting skill-pos totals", () => {
    const list = [{ position: "K", value: 999 }];
    const totals = posTotals(list);
    expect(totals.QB).toBe(0);
    expect(totals.RB).toBe(0);
    expect(totals.WR).toBe(0);
    expect(totals.TE).toBe(0);
  });
});

// ── tradeWaiverAdj ────────────────────────────────────────────────────

describe("tradeWaiverAdj", () => {
  it("returns 0 for equal-length arrays", () => {
    expect(tradeWaiverAdj([1000], [800])).toBe(0);
    expect(tradeWaiverAdj([1000, 500], [800, 400])).toBe(0);
  });

  it("returns adjustment when giving more players than receiving", () => {
    // give [1000, 500], receive [800] → extra give sorted desc: [1000, 500].slice(1) = [500]
    // capAdj([500]) = min(round(500*0.42), 550) = min(210, 550) = 210
    expect(tradeWaiverAdj([1000, 500], [800])).toBe(210);
  });

  it("returns adjustment when receiving more players than giving", () => {
    // give [800], receive [1000, 500] → extra recv sorted desc: [1000, 500].slice(1) = [500]
    // capAdj([500]) = 210
    expect(tradeWaiverAdj([800], [1000, 500])).toBe(210);
  });

  it("caps each extra player adjustment", () => {
    // give [5000, 5000], receive [5000] → extra give [5000] sorted → slice(1)=[5000]
    // capAdj([5000]): min(round(5000*0.42), 550) = min(2100, 550) = 550
    expect(tradeWaiverAdj([5000, 5000], [5000])).toBe(550);
  });
});

// ── isBalanced ────────────────────────────────────────────────────────

describe("isBalanced", () => {
  it("equal values are balanced", () => {
    expect(isBalanced([1000], [1000])).toBe(true);
  });

  it("gap > 600 is not balanced (absolute gate)", () => {
    expect(isBalanced([1001], [400])).toBe(false); // gap = 601
  });

  it("ratio < 0.85 is not balanced (ratio gate)", () => {
    // [1000] vs [840]: gap=160 ≤ 600, ratio=840/1000=0.84 < 0.85 → false
    expect(isBalanced([1000], [840])).toBe(false);
  });

  it("gap ≤ 600 and ratio ≥ 0.85 is balanced", () => {
    // [1000] vs [860]: gap=140 ≤ 600, ratio=860/1000=0.86 ≥ 0.85 → true
    expect(isBalanced([1000], [860])).toBe(true);
  });

  it("exactly at the 600-point gap boundary is balanced", () => {
    // [1000] vs [400]: gap=600, ratio=0.4 < 0.85 → false (fails ratio gate)
    expect(isBalanced([1000], [400])).toBe(false);
    // [1100] vs [500]: gap=600, ratio≈0.45 < 0.85 → false
    expect(isBalanced([1100], [500])).toBe(false);
  });
});

// ── computeTeamWindow ────────────────────────────────────────────────

describe("computeTeamWindow", () => {
  it("returns 3 for empty roster", () => {
    expect(computeTeamWindow([])).toBe(3);
  });

  it("computes average years-to-cliff across starters", () => {
    // 1 QB (age 30, cliff=35, years=5), 1 RB (age 25, cliff=28, years=3),
    // 1 WR (age 28, cliff=32, years=4), 1 TE (age 29, cliff=32, years=3)
    // starters selected as top-1 QB, top-2 RB, top-3 WR, top-1 TE by value
    const roster = [
      p("QB", 30, 3000),
      p("RB", 25, 2000),
      p("WR", 28, 2500),
      p("TE", 29, 1500),
    ];
    const window = computeTeamWindow(roster);
    // (5 + 3 + 4 + 3) / 4 = 3.75
    expect(window).toBeCloseTo(3.75, 5);
  });

  it("picks only the top-N starters per position by value", () => {
    // 3 RBs: values 3000, 2000, 500 — only top 2 selected (3000 + 2000)
    // 3000→age25→cliff28→years3; 2000→age24→cliff28→years4; 500→age22→NOT selected
    const roster = [
      p("RB", 25, 3000),
      p("RB", 24, 2000),
      p("RB", 22, 500),
    ];
    const window = computeTeamWindow(roster);
    // (3 + 4) / 2 = 3.5
    expect(window).toBeCloseTo(3.5, 5);
  });
});

// ── getPickSlotBonus ──────────────────────────────────────────────────

describe("getPickSlotBonus", () => {
  it("returns 0 for unresolved slot (no dot)", () => {
    expect(getPickSlotBonus(pick("", 1))).toBe(0);
    expect(getPickSlotBonus(pick("7", 1))).toBe(0);
  });

  it("round-1 slot bonuses", () => {
    expect(getPickSlotBonus(pick("1.01", 1))).toBe(10);
    expect(getPickSlotBonus(pick("1.02", 1))).toBe(10);
    expect(getPickSlotBonus(pick("1.03", 1))).toBe(7);
    expect(getPickSlotBonus(pick("1.04", 1))).toBe(7);
    expect(getPickSlotBonus(pick("1.05", 1))).toBe(4);
    expect(getPickSlotBonus(pick("1.06", 1))).toBe(4);
    expect(getPickSlotBonus(pick("1.07", 1))).toBe(1);
    expect(getPickSlotBonus(pick("1.09", 1))).toBe(1);
    expect(getPickSlotBonus(pick("1.10", 1))).toBe(0);
    expect(getPickSlotBonus(pick("1.11", 1))).toBe(-3);
    expect(getPickSlotBonus(pick("1.12", 1))).toBe(-3);
  });

  it("round-2 slot bonuses", () => {
    expect(getPickSlotBonus(pick("2.02", 2))).toBe(4);
    expect(getPickSlotBonus(pick("2.03", 2))).toBe(4);
    expect(getPickSlotBonus(pick("2.05", 2))).toBe(2);
    expect(getPickSlotBonus(pick("2.09", 2))).toBe(0);
  });

  it("round 3+ always returns 0", () => {
    expect(getPickSlotBonus(pick("3.01", 3))).toBe(0);
    expect(getPickSlotBonus(pick("4.01", 4))).toBe(0);
  });
});
