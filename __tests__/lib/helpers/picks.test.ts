import { describe, it, expect } from "vitest";
import {
  getPickValueKey,
  getStoredPickValue,
  isSnakeDraft,
  getDraftRoundSlot,
  rookieDraftRoundCount,
  applyPickValueOverrides,
  cleanPickValueOverrides,
  nextPickValueClass,
  pickBandForSlot,
  slotValueFrom,
  userSlotCurveRounds,
} from "@/lib/helpers/picks";
import { CURRENT_YEAR } from "@/lib/helpers/season";

// Fixtures use the same NFL-season-year source the code compares against, so
// "current-year" assertions hold year-round (incl. the Jan/Feb rollover window).
const CY = CURRENT_YEAR;
const NY = String(Number(CURRENT_YEAR) + 1);

// ── getPickValueKey ──────────────────────────────────────────────────

describe("getPickValueKey", () => {
  it("returns slot-format key for a current-year pick with a known slot", () => {
    expect(getPickValueKey({ season: CY, round: 1, slot: "1.04" })).toBe(`${CY}-1.04`);
  });

  it("returns round-format key for a current-year pick with no slot", () => {
    expect(getPickValueKey({ season: CY, round: 2 })).toBe(`${CY}-2`);
  });

  it("returns round-format key for a current-year pick with a slot that has no dot", () => {
    expect(getPickValueKey({ season: CY, round: 1, slot: "7" })).toBe(`${CY}-1`);
  });

  it("returns round-format key for a future-year pick even when slot is set", () => {
    expect(getPickValueKey({ season: NY, round: 1, slot: "1.03" })).toBe(`${NY}-1`);
  });

  it("handles numeric season values", () => {
    const numCY = Number(CY);
    expect(getPickValueKey({ season: numCY, round: 3 })).toBe(`${CY}-3`);
  });
});

// ── getStoredPickValue ───────────────────────────────────────────────

describe("getStoredPickValue", () => {
  it("returns exact slot value when present", () => {
    const pickValues = { [`${CY}-1.04`]: 800, [`${CY}-1`]: 600 };
    const pick = { season: CY, round: 1, slot: "1.04" };
    expect(getStoredPickValue(pickValues, pick)).toBe(800);
  });

  it("falls back to round key when slot key is missing", () => {
    const pickValues = { [`${CY}-1`]: 600 };
    const pick = { season: CY, round: 1, slot: "1.09" };
    // slot key "2026-1.09" not present → falls back to "2026-1"
    expect(getStoredPickValue(pickValues, pick)).toBe(600);
  });

  it("returns 0 when neither key exists", () => {
    const pick = { season: NY, round: 2 };
    expect(getStoredPickValue({}, pick)).toBe(0);
  });

  it("returns round-format value for future-year picks", () => {
    const pickValues = { [`${NY}-1`]: 1200 };
    const pick = { season: NY, round: 1 };
    expect(getStoredPickValue(pickValues, pick)).toBe(1200);
  });
});

// ── isSnakeDraft ─────────────────────────────────────────────────────

describe("isSnakeDraft", () => {
  it("returns true when top-level type is 'snake'", () => {
    expect(isSnakeDraft({ type: "snake" })).toBe(true);
  });

  it("returns true when settings.type is 'snake'", () => {
    expect(isSnakeDraft({ settings: { type: "snake" } })).toBe(true);
  });

  it("returns true when settings.draft_type is 'snake'", () => {
    expect(isSnakeDraft({ settings: { draft_type: "snake" } })).toBe(true);
  });

  it("returns true when metadata.type is 'snake'", () => {
    expect(isSnakeDraft({ metadata: { type: "snake" } })).toBe(true);
  });

  it("returns true when metadata.draft_type is 'snake'", () => {
    expect(isSnakeDraft({ metadata: { draft_type: "snake" } })).toBe(true);
  });

  it("returns false for a linear draft type", () => {
    expect(isSnakeDraft({ type: "linear" })).toBe(false);
  });

  it("returns false for an empty draft object", () => {
    expect(isSnakeDraft({})).toBe(false);
  });

  it("is case-insensitive (SNAKE → true)", () => {
    expect(isSnakeDraft({ type: "SNAKE" })).toBe(true);
  });
});

// ── getDraftRoundSlot ────────────────────────────────────────────────

describe("getDraftRoundSlot", () => {
  const snakeDraft = { type: "snake" };
  const linearDraft = { type: "linear" };

  it("returns slot unchanged for a linear draft in any round", () => {
    expect(getDraftRoundSlot(linearDraft, 1, 3, 10)).toBe(3);
    expect(getDraftRoundSlot(linearDraft, 2, 3, 10)).toBe(3);
  });

  it("returns slot unchanged for odd rounds in a snake draft", () => {
    expect(getDraftRoundSlot(snakeDraft, 1, 3, 10)).toBe(3);
    expect(getDraftRoundSlot(snakeDraft, 3, 4, 12)).toBe(4);
  });

  it("reverses slot for even rounds in a snake draft", () => {
    // totalTeams - slot + 1 = 10 - 3 + 1 = 8
    expect(getDraftRoundSlot(snakeDraft, 2, 3, 10)).toBe(8);
    // 12 - 1 + 1 = 12
    expect(getDraftRoundSlot(snakeDraft, 2, 1, 12)).toBe(12);
  });

  it("returns baseSlot as-is when baseSlot is 0", () => {
    expect(getDraftRoundSlot(snakeDraft, 2, 0, 10)).toBe(0);
  });

  it("returns baseSlot as-is when totalTeams < 2", () => {
    expect(getDraftRoundSlot(snakeDraft, 2, 3, 1)).toBe(3);
  });
});

// Pick Values' round count (2026-10-11): the Live Draft Board — the only thing that loads a draft —
// is blank in Weeks 1–17, so the league's own draft_rounds setting stands in rather than a flat 4.
describe("rookieDraftRoundCount", () => {
  it("prefers the loaded draft's rounds, from settings or the top level", () => {
    expect(rookieDraftRoundCount({ settings: { rounds: 3 } }, { draft_rounds: 5 })).toBe(3);
    expect(rookieDraftRoundCount({ rounds: 5 }, { draft_rounds: 4 })).toBe(5);
  });

  it("falls back to the league's draft_rounds when no draft is loaded", () => {
    expect(rookieDraftRoundCount(null, { draft_rounds: 3 })).toBe(3);
    expect(rookieDraftRoundCount(undefined, { draft_rounds: 6 })).toBe(6);
  });

  it("skips a startup-sized or missing count, ending at 4", () => {
    expect(rookieDraftRoundCount({ settings: { rounds: 25 } }, { draft_rounds: 3 })).toBe(3);
    expect(rookieDraftRoundCount({ settings: { rounds: 25 } }, null)).toBe(4);
    expect(rookieDraftRoundCount(null, { draft_rounds: 0 })).toBe(4);
    expect(rookieDraftRoundCount(null, null)).toBe(4);
  });
});

// 10/30: the user's own pick values (Draft Hub → Pick Values) layered over FantasyCalc.
// FantasyCalc currently prices the next class only by Early/Mid/Late band, so the 1.01 and
// the 1.04 cost the same — the gap these overrides exist to fill.
describe("pick value overrides", () => {
  const market: Record<string, number> = {
    "2027-1-early": 4942, "2027-1-mid": 3254, "2027-1-late": 2513, "2027-1": 2926,
    "2027-2-early": 2023, "2027-2-mid": 1682, "2027-2-late": 1444, "2027-2": 1597,
    "2027-3": 1093, "2027-4": 827,
    "2028-1": 2275, "2028-2": 1348,
  };

  it("returns FantasyCalc's map untouched (same object) with no overrides", () => {
    expect(applyPickValueOverrides(market, {})).toBe(market);
  });

  it("slot value falls back from exact slot to band to round", () => {
    expect(slotValueFrom(market, 2027, 1, 1)).toBe(4942);
    expect(slotValueFrom(market, 2027, 1, 6)).toBe(3254);
    expect(slotValueFrom(market, 2027, 1, 12)).toBe(2513);
    expect(slotValueFrom(market, 2027, 3, 1)).toBe(1093);
    expect(slotValueFrom({ ...market, "2027-1.01": 6000 }, 2027, 1, 1)).toBe(6000);
    expect(slotValueFrom(market, 2030, 1, 1)).toBe(0);
  });

  it("an edited 1.01 writes every slot of the class and rebuilds its bands and round average", () => {
    const out = applyPickValueOverrides(market, { "2027-1.01": 9000 });
    expect(out["2027-1.01"]).toBe(9000);
    expect(out["2027-1.02"]).toBe(4942);
    expect(out["2027-1.05"]).toBe(3254);
    expect(out["2027-1.12"]).toBe(2513);
    expect(out["2027-1-early"]).toBe(Math.round((9000 + 4942 * 3) / 4));
    expect(out["2027-1-mid"]).toBe(3254);
    expect(out["2027-1"]).toBe(Math.round((9000 + 4942 * 3 + 3254 * 4 + 2513 * 4) / 12));
    // other rounds of the same class get their slots too, at market prices, so slot lookups
    // (e.g. Draft History's pick equivalents) see the whole class
    expect(out["2027-2.01"]).toBe(2023);
    expect(out["2027-3.07"]).toBe(1093);
    expect(out["2027-2"]).toBe(Math.round((2023 * 4 + 1682 * 4 + 1444 * 4) / 12));
    // later classes untouched
    expect(out["2028-1"]).toBe(2275);
    expect(out["2028-1.01"]).toBeUndefined();
    // FantasyCalc's own map is never mutated
    expect(market["2027-1.01"]).toBeUndefined();
  });

  it("a round override replaces that round's value directly", () => {
    const out = applyPickValueOverrides(market, { "2028-1": 3100 });
    expect(out["2028-1"]).toBe(3100);
    expect(out["2028-2"]).toBe(1348);
    expect(out["2027-1.01"]).toBeUndefined();
  });

  it("cleans stored overrides: bad keys and non-positive values are dropped, values rounded", () => {
    expect(cleanPickValueOverrides({ "2027-1.01": "8500.4", "2028-2": 900, "2027-1-early": 5000, "x": 1, "2027-1.02": 0, "2027-1.03": -5 }))
      .toEqual({ "2027-1.01": 8500, "2028-2": 900 });
    expect(cleanPickValueOverrides(null)).toEqual({});
    expect(cleanPickValueOverrides([1, 2])).toEqual({});
  });

  it("knows which rounds carry the user's own slot curve", () => {
    expect([...userSlotCurveRounds({ "2027-1.01": 9000, "2027-1.02": 7000, "2027-2.05": 2100, "2028-1": 3000 })].sort())
      .toEqual(["2027-1", "2027-2"]);
  });

  it("bands split slots in thirds like the pick cards", () => {
    expect([1, 4, 5, 8, 9, 12].map((s) => pickBandForSlot(s))).toEqual(["early", "early", "mid", "mid", "late", "late"]);
    expect([1, 4, 5, 7, 8, 10].map((s) => pickBandForSlot(s, 10))).toEqual(["early", "early", "mid", "mid", "late", "late"]);
  });

  it("the editor's class is FantasyCalc's nearest priced class", () => {
    expect(nextPickValueClass(market)).toBe("2027");
    expect(nextPickValueClass({ "2028-1-early": 1, "2027-1.01": 1 })).toBe("2027");
  });
});
