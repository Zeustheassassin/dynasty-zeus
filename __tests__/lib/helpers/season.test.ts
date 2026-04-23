import { describe, it, expect } from "vitest";
import { CURRENT_YEAR, YEARS, ROUNDS } from "@/lib/helpers/season";

// ── CURRENT_YEAR ─────────────────────────────────────────────────────────────

describe("CURRENT_YEAR", () => {
  it("is a string", () => {
    expect(typeof CURRENT_YEAR).toBe("string");
  });

  it("matches the current calendar year", () => {
    expect(CURRENT_YEAR).toBe(String(new Date().getFullYear()));
  });

  it("is a 4-digit year string", () => {
    expect(CURRENT_YEAR).toMatch(/^\d{4}$/);
  });
});

// ── YEARS ────────────────────────────────────────────────────────────────────

describe("YEARS", () => {
  it("contains exactly 3 elements", () => {
    expect(YEARS).toHaveLength(3);
  });

  it("starts with the current year", () => {
    expect(YEARS[0]).toBe(String(new Date().getFullYear()));
  });

  it("is a consecutive three-year window", () => {
    const base = new Date().getFullYear();
    expect(YEARS).toEqual([String(base), String(base + 1), String(base + 2)]);
  });

  it("contains only 4-digit year strings", () => {
    YEARS.forEach((y) => expect(y).toMatch(/^\d{4}$/));
  });
});

// ── ROUNDS ───────────────────────────────────────────────────────────────────

describe("ROUNDS", () => {
  it("is [1, 2, 3, 4]", () => {
    expect(ROUNDS).toEqual([1, 2, 3, 4]);
  });

  it("has 4 rounds", () => {
    expect(ROUNDS).toHaveLength(4);
  });
});
