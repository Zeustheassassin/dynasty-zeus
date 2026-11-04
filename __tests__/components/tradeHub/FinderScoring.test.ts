import { describe, it, expect } from "vitest";
import type { PlayerWithValue, PickWithValue } from "@/components/tradeHub/shared";
import {
  buildQbTiers, cheapStarterCeiling, qbRoomOk, tierShapeRank, tradeImpactPasses, playoffGain, titleGain, type TradeSimImpact,
} from "@/components/tradeHub/FinderScoring";
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
  isBalancedWithStarDiscount,
  isBalancedTierUp,
  isBalancedTierUpWithStarDiscount,
  computeTeamWindow,
  getPickSlotBonus,
  computeTradeFairness,
  isNonProducer,
  fairDynastyTarget,
  fairnessScore,
  fairnessTier,
  isFairEnough,
  FAIR_CAP,
  FAIR_TILT,
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
    // give [1000, 800], receive [900] → extra give sorted desc: [1000, 800].slice(1) = [800]
    // capAdj([800]) = min(round(800*0.42), 550) = min(336, 550) = 336
    expect(tradeWaiverAdj([1000, 800], [900])).toBe(336);
  });

  it("returns adjustment when receiving more players than giving", () => {
    // give [900], receive [1000, 800] → extra recv sorted desc: [1000, 800].slice(1) = [800]
    // capAdj([800]) = 336
    expect(tradeWaiverAdj([900], [1000, 800])).toBe(336);
  });

  it("grants zero credit for sub-700 surplus bodies (low-value floor)", () => {
    // A 500-value throw-in is noise: it must not manufacture phantom balance credit.
    expect(tradeWaiverAdj([1000, 500], [800])).toBe(0);
    expect(tradeWaiverAdj([800], [1000, 500])).toBe(0);
    // A 700+ surplus body still earns its credit: round(700 * 0.42) = 294
    expect(tradeWaiverAdj([1000, 700], [800])).toBe(294);
  });

  it("caps each extra player adjustment", () => {
    // give [5000, 5000], receive [5000] → extra give [5000] sorted → slice(1)=[5000]
    // capAdj([5000]): min(round(5000*0.42), 550) = min(2100, 550) = 550
    expect(tradeWaiverAdj([5000, 5000], [5000])).toBe(550);
  });

  it("caps the COMBINED credit across 2+ extras at BALANCE_ABS_CAP, not just per-extra", () => {
    // Regression: give [2524], receive [1901, 1119, 947] (2 extras beyond give's count).
    // Per-extra credit alone: min(round(1119*0.42),550)=470, min(round(947*0.42),750)=398 → 868,
    // which by itself exceeds the 600-point abs cap this credit is supposed to fit inside.
    // Reported bug: that let a trade with a raw ~1443 gap read as "balanced" for generation.
    expect(tradeWaiverAdj([2524], [1901, 1119, 947])).toBe(600);
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

// ── isBalancedWithStarDiscount ──────────────────────────────────────────

describe("isBalancedWithStarDiscount", () => {
  it("rejects a 1-for-3 package that only 'balanced' via stacked waiver credit (toOrich regression)", () => {
    // give [2524], receive [1901, 1119, 947]: raw gap 1443. Before the BALANCE_ABS_CAP
    // total-credit cap on tradeWaiverAdj, stacked per-extra credit (470 + 398 = 868) shrank
    // the gap the gate saw down to 575 and let isBalanced() pass on its own. With that credit
    // now capped at 600, isBalanced() alone already rejects it (gap 843); the star-discount
    // re-check below is a second, independent line of defense for the same failure mode.
    expect(isBalanced([2524], [1901, 1119, 947])).toBe(false);
    expect(isBalancedWithStarDiscount([2524], [1901, 1119, 947])).toBe(false);
  });

  it("rejects a 1-for-2 package where the raw gap is real even though isBalanced()'s credit hides it (FFMattD regression)", () => {
    // give [2008], receive [1565, 1322]: raw gap 879, waiver credit (550) shrinks it to 329 for
    // isBalanced(). The tiny star discount here (-1) is incidental — what actually catches this
    // is that any >=2000 piece drops the waiver credit entirely on re-check.
    expect(isBalanced([2008], [1565, 1322])).toBe(true);
    expect(isBalancedWithStarDiscount([2008], [1565, 1322])).toBe(false);
  });

  it("still allows a 1-for-2 package with only a modest star discount", () => {
    // give [2200], receive [1300, 1200]: raw gap only 300 (already close), a mild star
    // discount (-200, ratio 0.591) still leaves it well within the abs/ratio caps.
    expect(isBalancedWithStarDiscount([2200], [1300, 1200])).toBe(true);
  });

  it("rejects a 2-for-3 package where waiver credit alone hides the gap and no piece reaches the star-discount trigger", () => {
    // give [1999, 1999], receive [1999, 1999, 1034]: the two big pairs match exactly (raw gap
    // is just the 1034 extra), and since nothing here reaches the $2000 star-discount trigger,
    // the discount is always 0 — under the old shortcut that returned "balanced" immediately
    // once credit (434) shrank the raw 1034 gap to the 600 boundary. Real displayed net has no
    // credit at all, so the card would show the full ~1034 gap despite the gate seeing exactly
    // the cap. isBalanced() alone (with credit) still passes this; only the unconditional
    // credit-free re-check catches it.
    expect(isBalanced([1999, 1999], [1999, 1999, 1034])).toBe(true);
    expect(isBalancedWithStarDiscount([1999, 1999], [1999, 1999, 1034])).toBe(false);
  });
});

// ── isBalancedTierUp / isBalancedTierUpWithStarDiscount ─────────────────
// User policy: on a contender consolidating depth into one star, deliberately
// overpaying (giving more value than received) is fine within a wider band than
// the standard even-value gate — but only in that direction.

describe("isBalancedTierUp", () => {
  it("when the user isn't overpaying (receive >= give), delegates to the standard isBalanced gate", () => {
    // Equal cardinality (1-for-1) sidesteps tradeWaiverAdj entirely, so isBalanced's
    // verdict here is just the plain abs/ratio check — an easy baseline to delegate to.
    expect(isBalancedTierUp([1000], [1000])).toBe(isBalanced([1000], [1000]));
    expect(isBalancedTierUp([1000], [1000])).toBe(true);
    // Still rejects a real gap even on the "user gains value" side.
    expect(isBalancedTierUp([100], [900])).toBe(isBalanced([100], [900]));
    expect(isBalancedTierUp([100], [900])).toBe(false);
  });

  it("allows an overpay gap beyond the standard 600 cap, up to the wider 900 tier-up cap", () => {
    // give [1300,1300]=2600, receive [1900]: raw gap=700 (fails the standard credit-free
    // 600 cap — see isBalancedWithStarDiscount below — but passes the 900 tier-up cap),
    // ratio=1900/2600=0.731 (clears the 0.72 floor). isBalanced() itself isn't a useful
    // baseline here: any 2-for-1 gets a cardinality-mismatch credit there regardless.
    expect(isBalancedWithStarDiscount([1300, 1300], [1900])).toBe(false);
    expect(isBalancedTierUp([1300, 1300], [1900])).toBe(true);
  });

  it("still rejects an overpay gap beyond the 900 cap", () => {
    // give [2000,2000]=4000, receive [2900]: gap=1100 > 900.
    expect(isBalancedTierUp([2000, 2000], [2900])).toBe(false);
  });

  it("still rejects an overpay below the 0.72 ratio floor even with gap <= 900", () => {
    // give [1300,1300]=2600, receive [1800]: gap=800 <= 900, ratio=1800/2600=0.692 < 0.72.
    expect(isBalancedTierUp([1300, 1300], [1800])).toBe(false);
  });
});

describe("isBalancedTierUpWithStarDiscount", () => {
  it("allows the same wider overpay band as isBalancedTierUp when no piece triggers a star discount", () => {
    // All values < 2000, so computeStarDiscounts contributes 0 on both sides.
    expect(isBalancedWithStarDiscount([1300, 1300], [1900])).toBe(false); // raw gap 700 > 600
    expect(isBalancedTierUpWithStarDiscount([1300, 1300], [1900])).toBe(true); // gap 700 <= 900, ratio 0.731
  });

  it("still rejects below the ratio floor", () => {
    expect(isBalancedTierUpWithStarDiscount([1300, 1300], [1700])).toBe(false); // ratio 0.654 < 0.72
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

// 10/30 user policy: lean toward trades both sides would call fair — about even between teams
// heading the same way; rebuilder slightly ahead on dynasty value and the win-now side ahead on
// redraft value when the two meet. Dynasty value never more than 8% apart.
describe("fair target", () => {
  const fair = (over: Partial<Parameters<typeof computeTradeFairness>[0]>) => computeTradeFairness({
    net: 0, giveTotal: 6000, receiveTotal: 6000, redraftGive: 3000, redraftReceive: 3000,
    user: "neutral", opp: "neutral", ...over,
  });

  it("targets even between same-direction teams and tilts 3% to the rebuilder otherwise", () => {
    expect(fairDynastyTarget("winNow", "winNow")).toBe(0);
    expect(fairDynastyTarget("rebuild", "rebuild")).toBe(0);
    expect(fairDynastyTarget("neutral", "winNow")).toBe(0);
    expect(fairDynastyTarget("rebuild", "winNow")).toBe(FAIR_TILT);
    expect(fairDynastyTarget("winNow", "rebuild")).toBe(-FAIR_TILT);
  });

  it("measures the gap from the fair mark as a share of the bigger side", () => {
    // user rebuilding, +180 on a 6,000 trade = exactly the 3% mark
    const onMark = fair({ net: 180, receiveTotal: 6180, user: "rebuild", opp: "winNow", redraftGive: 3000, redraftReceive: 1500 });
    expect(onMark.netPct).toBeCloseTo(180 / 6180, 6);
    expect(onMark.gap).toBeLessThan(0.002);
    expect(fairnessTier(onMark)).toBe(0);
    // dead even between two contenders
    expect(fair({ user: "winNow", opp: "winNow" }).gap).toBe(0);
  });

  it("allows up to 8% off on dynasty value and no more", () => {
    expect(isFairEnough(fair({ net: 480, receiveTotal: 6000, giveTotal: 5520 }))).toBe(true);
    expect(isFairEnough(fair({ net: -480, giveTotal: 6000, receiveTotal: 5520 }))).toBe(true);
    expect(isFairEnough(fair({ net: 540, receiveTotal: 6000, giveTotal: 5460 }))).toBe(false);
    expect(FAIR_CAP).toBe(0.08);
  });

  it("drops a rebuild <-> win-now trade that leaves the win-now side behind on redraft value", () => {
    // user contending, opp rebuilding: user must gain this-season value
    expect(fair({ user: "winNow", opp: "rebuild", redraftGive: 3000, redraftReceive: 3800 }).redraftOk).toBe(true);
    expect(fair({ user: "winNow", opp: "rebuild", redraftGive: 3800, redraftReceive: 3000 }).redraftOk).toBe(false);
    // user rebuilding, opp contending: the opp must gain it
    expect(fair({ user: "rebuild", opp: "winNow", redraftGive: 3000, redraftReceive: 1000 }).redraftOk).toBe(true);
    expect(fair({ user: "rebuild", opp: "winNow", redraftGive: 1000, redraftReceive: 3000 }).redraftOk).toBe(false);
    // small shortfalls are noise (under 150 or 5% of the redraft value moving)
    expect(fair({ user: "winNow", opp: "rebuild", redraftGive: 3100, redraftReceive: 3000 }).redraftOk).toBe(true);
    // same-direction trades have no redraft rule
    expect(fair({ user: "winNow", opp: "winNow", redraftGive: 3800, redraftReceive: 3000 }).redraftOk).toBe(true);
    expect(isFairEnough(fair({ user: "winNow", opp: "rebuild", redraftGive: 3800, redraftReceive: 3000 }))).toBe(false);
  });

  it("ranks the fair mark highest and falls off steeply past it", () => {
    const at = (gap: number) => fairnessScore({ netPct: gap, target: 0, gap, redraftNet: 0, crossDirection: false, redraftOk: true });
    expect(at(0)).toBe(4);
    expect(at(0.03)).toBeGreaterThan(-1);
    expect(at(0.03)).toBeLessThan(0);
    expect(at(0.08)).toBeLessThan(-15);
    expect(at(0.01)).toBeGreaterThan(at(0.02));
    expect([0.01, 0.03, 0.06].map((gap) => fairnessTier({ netPct: gap, target: 0, gap, redraftNet: 0, crossDirection: false, redraftOk: true }))).toEqual([0, 1, 2]);
    expect(fairnessTier(undefined)).toBe(2);
  });
});

// 10/30 user insight: a win-now team parts with picks, and with prospects who aren't scoring for
// it, far more readily than with a player who starts for it.
describe("isNonProducer", () => {
  it("counts a player on IR / out / PUP / NFI as not producing, whatever his redraft value", () => {
    expect(isNonProducer({ value: 3000, injury_status: "IR" }, 2800)).toBe(true);
    expect(isNonProducer({ value: 3000, injury_status: "Out" }, 2800)).toBe(true);
    expect(isNonProducer({ value: 3000, injury_status: "PUP" }, 2800)).toBe(true);
    expect(isNonProducer({ value: 3000, injury_status: "Questionable" }, 2800)).toBe(false);
  });

  it("counts a stash worth little in redraft next to his dynasty value as not producing", () => {
    expect(isNonProducer({ value: 4000 }, 1200)).toBe(true);   // 30% of dynasty value
    expect(isNonProducer({ value: 4000 }, 1700)).toBe(false);  // 42.5%
    expect(isNonProducer({ value: 3000, injury_status: null }, 3500)).toBe(false);
  });
});

describe("tierShapeRank", () => {
  const asset = (value: number, player_id?: string) => ({ value, player_id });
  const trade = (give: number[], receive: number[], picks: { give?: number[]; receive?: number[] } = {}, format = "x") => ({
    give: give.map((v, i) => asset(v, `g${i}`)),
    receive: receive.map((v, i) => asset(v, `r${i}`)),
    givePicks: (picks.give ?? []).map((v) => asset(v)),
    receivePicks: (picks.receive ?? []).map((v) => asset(v)),
    format,
  });

  it("lets everything through when the setting is Any", () => {
    expect(tierShapeRank(trade([3000], [3000]), "ANY")).toBe(0);
    expect(tierShapeRank(trade([], [800], { give: [700] }, "Lottery"), "ANY")).toBe(0);
  });

  it("Tier Up: 2 for 1 is the headline, player + pick deals are related", () => {
    expect(tierShapeRank(trade([3000, 2000], [4500]), "TIER_UP")).toBe(0);
    expect(tierShapeRank(trade([3000, 1000], [5000], { give: [900] }), "TIER_UP")).toBe(1);
    expect(tierShapeRank(trade([3000], [4000], { give: [900] }), "TIER_UP")).toBe(1);
  });

  it("Tier Up: the player coming back has to be a real step up", () => {
    // Paying 2,000 extra for a player barely better than the one going out isn't a tier up.
    expect(tierShapeRank(trade([5000, 2000], [5400]), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([5000, 2000], [5500]), "TIER_UP")).toBe(0);
    // Better only than the pick in the deal doesn't count: the best asset going out is the bar.
    expect(tierShapeRank(trade([1000], [1500], { give: [2000] }), "TIER_UP")).toBeNull();
  });

  it("Tier Up: every other shape is left off", () => {
    expect(tierShapeRank(trade([3000], [3500]), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([3000, 1000], [3500, 1000]), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([5000], [2500, 2500]), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([1000], [1500], { give: [700], receive: [200] }), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([1500, 1500], [], { receive: [2000] }), "TIER_UP")).toBeNull();
    expect(tierShapeRank(trade([], [800], { give: [700] }, "Lottery"), "TIER_UP")).toBeNull();
  });

  it("Tier Up: a sweetener on a 1 for 1 doesn't turn it into a 2 for 1", () => {
    const sweetened = { ...trade([3000, 300], [4000]), sweetenerPlayerId: "g1" };
    expect(tierShapeRank(sweetened, "TIER_UP")).toBeNull();
  });

  it("Tier Down: 1 for 2 is the headline, other splits are related", () => {
    expect(tierShapeRank(trade([6000], [3500, 3000]), "TIER_DOWN")).toBe(0);
    expect(tierShapeRank(trade([6000], [2500, 2000, 1800]), "TIER_DOWN")).toBe(1);
    expect(tierShapeRank(trade([6000], [3000, 2500], { receive: [900] }), "TIER_DOWN")).toBe(1);
    expect(tierShapeRank(trade([6000], [4500], { receive: [1200] }), "TIER_DOWN")).toBe(1);
    expect(tierShapeRank(trade([6000], [], { receive: [3000, 3000] }), "TIER_DOWN")).toBe(1);
  });

  it("Tier Down: the player going out has to be a real step above what comes back", () => {
    expect(tierShapeRank(trade([6000], [5600, 800]), "TIER_DOWN")).toBeNull();
    expect(tierShapeRank(trade([6000], [5400, 800]), "TIER_DOWN")).toBe(0);
  });

  it("Tier Down: every other shape is left off", () => {
    expect(tierShapeRank(trade([3000], [3000]), "TIER_DOWN")).toBeNull();
    expect(tierShapeRank(trade([3000, 2000], [4500]), "TIER_DOWN")).toBeNull();
    expect(tierShapeRank(trade([5000, 3000], [3000, 2500, 2500]), "TIER_DOWN")).toBeNull();
    expect(tierShapeRank(trade([3000], [1500, 1500], { give: [500] }), "TIER_DOWN")).toBeNull();
  });
});

describe("tradeImpactPasses", () => {
  const impact = (over: Partial<TradeSimImpact> = {}): TradeSimImpact => ({
    myPlayoffBefore: 60, myPlayoffAfter: 60,
    myTitleBefore: 10, myTitleAfter: 10,
    oppPlayoffDelta: 0, oppTitleDelta: 0,
    oppIsContender: false, oppIsRebuildSide: false,
    ...over,
  });

  it("reads the gains", () => {
    const i = impact({ myPlayoffAfter: 63, myTitleAfter: 12.5 });
    expect(playoffGain(i)).toBe(3);
    expect(titleGain(i)).toBe(2.5);
  });

  it("the standard board needs a real gain in playoff or title odds", () => {
    expect(tradeImpactPasses(impact(), "recommended")).toBe(false);
    expect(tradeImpactPasses(impact({ myPlayoffAfter: 60.9 }), "recommended")).toBe(false);
    expect(tradeImpactPasses(impact({ myPlayoffAfter: 61 }), "recommended")).toBe(true);
    // Nearly locked in: no playoff room left, but the title odds moved.
    expect(tradeImpactPasses(impact({ myPlayoffBefore: 92, myPlayoffAfter: 92.5, myTitleAfter: 11 }), "recommended")).toBe(true);
  });

  it("Championship Impact wants title odds, however much playoff odds moved", () => {
    expect(tradeImpactPasses(impact({ myPlayoffAfter: 70, myTitleAfter: 10.4 }), "championshipImpact")).toBe(false);
    expect(tradeImpactPasses(impact({ myTitleAfter: 10.5 }), "championshipImpact")).toBe(true);
  });

  it("a contender opponent won't make itself worse, in any view", () => {
    const hurtsThem = { myPlayoffAfter: 65, myTitleAfter: 12, oppIsContender: true, oppPlayoffDelta: -2 };
    expect(tradeImpactPasses(impact(hurtsThem), "recommended")).toBe(false);
    expect(tradeImpactPasses(impact(hurtsThem), "championshipImpact")).toBe(false);
    // A locked-in contender has no playoff odds to lose, so its title odds are what tell.
    expect(tradeImpactPasses(impact({ ...hurtsThem, oppPlayoffDelta: 0, oppTitleDelta: -1.5 }), "recommended")).toBe(false);
    expect(tradeImpactPasses(impact({ ...hurtsThem, oppPlayoffDelta: 0, oppTitleDelta: -0.5 }), "recommended")).toBe(true);
  });

  it("a rebuilder with no odds to lose can still trade (it could never fall the old required point)", () => {
    expect(tradeImpactPasses(impact({ myPlayoffAfter: 65, oppIsRebuildSide: true }), "recommended")).toBe(true);
  });

  it("a rebuilder rising blocks an ordinary swap, not a trade picked for its title odds", () => {
    const liftsThem = { myPlayoffAfter: 65, myTitleAfter: 12, oppIsRebuildSide: true, oppPlayoffDelta: 3 };
    expect(tradeImpactPasses(impact(liftsThem), "recommended")).toBe(false);
    expect(tradeImpactPasses(impact(liftsThem), "championshipImpact")).toBe(true);
  });
});

describe("QB rooms", () => {
  // FantasyCalc's Superflex dynasty values, November 2026.
  const VALUES = [
    10820, 7740, 7549, 7219, 6061, 5943, 5785, 5580, 5271, 5145, 4103, 4038, 4010, 4009, 3830, 3759, 3545, 3539, 3538,
    3271, 2469, 2412, 2354, 2317, 2302, 2283, 2052, 2034, 1960, 1753, 1706, 1605, 1476, 1474, 1425, 1321, 1145,
  ];
  const REDRAFT: Record<string, number> = {
    allen: 11125, caleb: 6118, burrow: 8178, lawrence: 5689, hurts: 900, young: 2234, stafford: 3247,
    mayfield: 1853, willis: 1114, cousins: 2298, rodgers: 2141, brissett: 526,
  };
  // FantasyCalc's 2027 2nd, 3rd and late 1st, November 2026.
  const CEILING = cheapStarterCeiling(1545, 1069, 2460);
  const tiers = buildQbTiers(VALUES, (id) => REDRAFT[id] ?? 0, CEILING);
  const qb = (player_id: string, value: number) => ({ player_id, position: "QB", value });
  const wr = (value = 4000) => ({ player_id: `wr${value}`, position: "WR", value });
  const allen = qb("allen", 10820);
  const caleb = qb("caleb", 7740);
  const burrow = qb("burrow", 7219);
  const lawrence = qb("lawrence", 6061);
  const young = qb("young", 3545);
  const hurts = qb("hurts", 3271);
  const stafford = qb("stafford", 2317);
  const mayfield = qb("mayfield", 2283);
  const simpson = qb("simpson", 2052); // valuable rookie who isn't playing
  const willis = qb("willis", 2034);
  const cousins = qb("cousins", 1753);
  const rodgers = qb("rodgers", 1476);
  const beck = qb("beck", 1425); // not playing
  const brissett = qb("brissett", 1321);
  const minshew = qb("minshew", 1145); // not playing

  describe("what a cheap starter costs", () => {
    it("a 2nd plus the part of a 3rd that really adds value, well under a 1st", () => {
      expect(CEILING).toBe(1994);
    });

    it("the raw sum of a 2nd and a 3rd would top a late 1st, which is why it isn't used", () => {
      expect(1545 + 1069).toBeGreaterThan(2460);
    });

    it("never reaches the cheapest 1st, even with a 2nd valued near it", () => {
      expect(cheapStarterCeiling(2300, 1100, 2460)).toBe(2459);
    });

    it("still works with no 1st value to compare to", () => {
      expect(cheapStarterCeiling(1545, 1069, 0)).toBe(1994);
    });

    it("follows the user's own pick values", () => {
      expect(cheapStarterCeiling(1000, 800, 2460)).toBe(1336);
    });
  });

  describe("tiers", () => {
    it("super elite is the top four", () => {
      expect([allen, caleb, burrow].every(tiers.isSuperElite)).toBe(true);
      expect(tiers.isSuperElite(lawrence)).toBe(false);
    });

    it("capable is top 32 by value or playing", () => {
      expect([allen, stafford, simpson].every(tiers.isCapable)).toBe(true); // by value
      expect([rodgers, brissett].every(tiers.isCapable)).toBe(true); // playing, outside the top 32
      expect(tiers.isCapable(beck)).toBe(false);
      expect(tiers.isCapable(minshew)).toBe(false);
    });

    it("a cheap starter is cheap and playing, like Brissett", () => {
      expect([brissett, rodgers, cousins].every(tiers.isInexpensiveStarter)).toBe(true);
      expect(tiers.isInexpensiveStarter(mayfield)).toBe(false); // too expensive
      expect(tiers.isInexpensiveStarter(willis)).toBe(false); // just over
      expect(tiers.isInexpensiveStarter(beck)).toBe(false); // not playing
      expect(tiers.isInexpensiveStarter(simpson)).toBe(false); // neither
    });

    it("counts everyone as capable and no one as elite with no values yet", () => {
      const empty = buildQbTiers([], () => 0, 0);
      expect(empty.isCapable(minshew)).toBe(true);
      expect(empty.isSuperElite(allen)).toBe(false);
    });
  });

  describe("a full room", () => {
    const full = [lawrence, stafford, hurts];

    it("the user's example: two full rooms can swap QBs", () => {
      expect(qbRoomOk(full, [hurts], [young], tiers)).toBe(true);
      expect(qbRoomOk([qb("maye", 7549), qb("love", 5145), young], [young], [hurts], tiers)).toBe(true);
    });

    it("won't take a QB unless one goes back, however good the value", () => {
      expect(qbRoomOk(full, [wr(1000)], [allen], tiers)).toBe(false);
      expect(qbRoomOk([...full, young], [wr()], [hurts], tiers)).toBe(false);
      expect(qbRoomOk(full, [wr(), wr()], [young], tiers)).toBe(false);
    });

    it("won't take a cheap starter or a backup either", () => {
      expect(qbRoomOk(full, [wr()], [brissett], tiers)).toBe(false);
      expect(qbRoomOk(full, [wr()], [minshew], tiers)).toBe(false);
    });

    it("sending a backup back doesn't make room for a fourth capable QB", () => {
      expect(qbRoomOk(full, [minshew], [young], tiers)).toBe(false);
    });

    it("a cheap starter fills a spot: two good QBs and Brissett is a full room", () => {
      expect(qbRoomOk([lawrence, stafford, brissett], [wr()], [rodgers], tiers)).toBe(false);
      expect(qbRoomOk([lawrence, stafford, brissett], [wr()], [allen], tiers)).toBe(false);
    });
  });

  describe("a team with two adding a third", () => {
    const lowerTier = [young, stafford];

    it("takes a super elite QB, moving on from a lower-tier starter", () => {
      expect(qbRoomOk(lowerTier, [wr()], [allen], tiers)).toBe(true);
      expect(qbRoomOk([burrow, stafford], [wr()], [allen], tiers)).toBe(true);
    });

    it("won't take a super elite QB with no lower-tier starter to move on from", () => {
      expect(qbRoomOk([allen, burrow], [wr()], [caleb], tiers)).toBe(false);
    });

    it("takes a cheap starter, however good the two it has", () => {
      expect(qbRoomOk(lowerTier, [wr()], [brissett], tiers)).toBe(true);
      expect(qbRoomOk([allen, burrow], [wr()], [brissett], tiers)).toBe(true);
    });

    it("won't take anyone in between, even a QB who'd start for it", () => {
      expect(qbRoomOk(lowerTier, [wr()], [lawrence], tiers)).toBe(false);
      expect(qbRoomOk(lowerTier, [wr()], [hurts], tiers)).toBe(false);
      expect(qbRoomOk(lowerTier, [wr()], [mayfield], tiers)).toBe(false);
    });

    it("won't take a backup who isn't playing", () => {
      expect(qbRoomOk(lowerTier, [wr()], [minshew], tiers)).toBe(false);
      expect(qbRoomOk(lowerTier, [wr()], [simpson], tiers)).toBe(false);
    });

    it("can make any swap: a QB going back isn't adding a third", () => {
      expect(qbRoomOk(lowerTier, [stafford], [hurts], tiers)).toBe(true);
      expect(qbRoomOk(lowerTier, [young], [lawrence], tiers)).toBe(true);
    });
  });

  describe("a team with room", () => {
    it("takes any QB, up to two", () => {
      expect(qbRoomOk([stafford], [wr()], [hurts], tiers)).toBe(true);
      expect(qbRoomOk([], [wr()], [minshew], tiers)).toBe(true);
    });

    it("the fix: a team under three makes any trade that doesn't touch its QBs", () => {
      expect(qbRoomOk([young, stafford], [wr()], [wr()], tiers)).toBe(true);
      expect(qbRoomOk([stafford], [wr(), wr()], [wr()], tiers)).toBe(true);
      expect(qbRoomOk([], [wr()], [], tiers)).toBe(true);
    });
  });

  describe("selling", () => {
    it("nobody sells below three, but a QB coming back keeps the count", () => {
      expect(qbRoomOk([lawrence, stafford, hurts], [hurts], [wr()], tiers)).toBe(false);
      expect(qbRoomOk([stafford, hurts], [hurts], [wr()], tiers)).toBe(false);
      expect(qbRoomOk([stafford, hurts], [hurts], [young], tiers)).toBe(true);
    });

    it("a surplus can be sold down to three", () => {
      expect(qbRoomOk([lawrence, stafford, hurts, young], [hurts], [wr()], tiers)).toBe(true);
    });

    it("a QB who isn't capable can be sold from any room", () => {
      expect(qbRoomOk([stafford, hurts], [minshew], [wr()], tiers)).toBe(true);
    });
  });

  describe("exceptions", () => {
    it("Tank Mode lifts only the sell floor", () => {
      expect(qbRoomOk([stafford, hurts], [hurts], [wr()], tiers, { sellFloorLifted: true })).toBe(true);
      expect(qbRoomOk([lawrence, stafford, hurts], [wr()], [young], tiers, { sellFloorLifted: true })).toBe(false);
    });

    it("searching for a QB by name lifts only the cap", () => {
      expect(qbRoomOk([lawrence, stafford, hurts], [wr()], [young], tiers, { buyCapLifted: true })).toBe(true);
      expect(qbRoomOk([young, stafford], [wr()], [hurts], tiers, { buyCapLifted: true })).toBe(true);
      expect(qbRoomOk([lawrence, stafford, hurts], [hurts], [wr()], tiers, { buyCapLifted: true })).toBe(false);
    });
  });
});
