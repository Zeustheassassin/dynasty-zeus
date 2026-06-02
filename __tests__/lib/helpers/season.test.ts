import { describe, it, expect } from "vitest";
import {
  BASE_YEAR,
  CURRENT_YEAR,
  YEARS,
  ROUNDS,
  calendarSeasonYear,
  getSeasonYear,
} from "@/lib/helpers/season";

// ── calendarSeasonYear ───────────────────────────────────────────────────────
// The NFL season year rolls over in ~March, NOT on Jan 1: Jan/Feb belong to the
// just-completed season.

describe("calendarSeasonYear", () => {
  it("treats January as the prior season year", () => {
    expect(calendarSeasonYear(new Date(2027, 0, 15))).toBe(2026);
  });

  it("treats February as the prior season year", () => {
    expect(calendarSeasonYear(new Date(2027, 1, 28))).toBe(2026);
  });

  it("advances to the new season year in March", () => {
    expect(calendarSeasonYear(new Date(2027, 2, 1))).toBe(2027);
  });

  it("stays on the season year for the rest of the calendar year", () => {
    expect(calendarSeasonYear(new Date(2027, 6, 4))).toBe(2027);
    expect(calendarSeasonYear(new Date(2027, 11, 31))).toBe(2027);
  });
});

// ── CURRENT_YEAR ─────────────────────────────────────────────────────────────

describe("CURRENT_YEAR", () => {
  it("is a string", () => {
    expect(typeof CURRENT_YEAR).toBe("string");
  });

  it("is the NFL season year (calendarSeasonYear), not the raw calendar year", () => {
    expect(CURRENT_YEAR).toBe(String(calendarSeasonYear()));
  });

  it("is a 4-digit year string", () => {
    expect(CURRENT_YEAR).toMatch(/^\d{4}$/);
  });
});

// ── getSeasonYear ────────────────────────────────────────────────────────────
// Prefers Sleeper's authoritative /state/nfl season; falls back to CURRENT_YEAR.

describe("getSeasonYear", () => {
  it("prefers a valid 4-digit nflState.season", () => {
    expect(getSeasonYear({ season: "2025" })).toBe("2025");
  });

  it("falls back to CURRENT_YEAR when nflState is null/undefined", () => {
    expect(getSeasonYear(null)).toBe(CURRENT_YEAR);
    expect(getSeasonYear(undefined)).toBe(CURRENT_YEAR);
  });

  it("falls back to CURRENT_YEAR when season is missing or malformed", () => {
    expect(getSeasonYear({})).toBe(CURRENT_YEAR);
    expect(getSeasonYear({ season: "" })).toBe(CURRENT_YEAR);
    expect(getSeasonYear({ season: "off" })).toBe(CURRENT_YEAR);
    expect(getSeasonYear({ season: null })).toBe(CURRENT_YEAR);
  });
});

// ── YEARS ────────────────────────────────────────────────────────────────────

describe("YEARS", () => {
  it("contains exactly 3 elements", () => {
    expect(YEARS).toHaveLength(3);
  });

  it("starts with the current NFL season year", () => {
    expect(YEARS[0]).toBe(CURRENT_YEAR);
  });

  it("is a consecutive three-year window from the season year", () => {
    const base = Number(CURRENT_YEAR);
    expect(YEARS).toEqual([String(base), String(base + 1), String(base + 2)]);
  });

  it("contains only 4-digit year strings", () => {
    YEARS.forEach((y) => expect(y).toMatch(/^\d{4}$/));
  });
});

// ── BASE_YEAR ────────────────────────────────────────────────────────────────
// The raw calendar year (anchors rookie/class/film windows), independent of the
// NFL-season rollover.

describe("BASE_YEAR", () => {
  it("is the raw calendar year", () => {
    expect(BASE_YEAR).toBe(new Date().getFullYear());
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
