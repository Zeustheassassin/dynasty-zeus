import { describe, it, expect } from "vitest";
import {
  getPickValueKey,
  getStoredPickValue,
  isSnakeDraft,
  getDraftRoundSlot,
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
