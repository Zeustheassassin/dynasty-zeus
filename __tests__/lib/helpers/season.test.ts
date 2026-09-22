import { describe, it, expect } from "vitest";
import {
  BASE_YEAR,
  CURRENT_YEAR,
  YEARS,
  ROUNDS,
  calendarSeasonYear,
  getCurrentNflWeek,
  getSeasonYear,
  isValidNflState,
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

// ── isValidNflState ──────────────────────────────────────────────────────────
// Catches a truthy-but-malformed /state/nfl body, not just null — the class of bug a bare
// `!nflState` check misses (code-review catch, Sept 22).

describe("isValidNflState", () => {
  it("accepts a well-formed state", () => {
    expect(isValidNflState({ season_type: "regular", week: 5, season: "2026" })).toBe(true);
  });

  it("rejects null/undefined", () => {
    expect(isValidNflState(null)).toBe(false);
    expect(isValidNflState(undefined)).toBe(false);
  });

  it("rejects a truthy-but-empty object — the exact shape a malformed 200 response could return", () => {
    expect(isValidNflState({})).toBe(false);
  });

  it("rejects a non-object", () => {
    expect(isValidNflState("regular")).toBe(false);
    expect(isValidNflState(42)).toBe(false);
  });

  it("rejects a missing or non-numeric week", () => {
    expect(isValidNflState({ season_type: "regular", season: "2026" })).toBe(false);
    expect(isValidNflState({ season_type: "regular", week: "5", season: "2026" })).toBe(false);
  });

  it("rejects a missing or malformed season", () => {
    expect(isValidNflState({ season_type: "regular", week: 5 })).toBe(false);
    expect(isValidNflState({ season_type: "regular", week: 5, season: "off" })).toBe(false);
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

describe("getCurrentNflWeek", () => {
  // Sept 22 deferred follow-up #4: six places in app/hooks/useAppState.ts re-derived this gate
  // independently, so a change to the rule could land in some copies and not others. The rule
  // lives here now specifically so it can be tested -- useAppState.ts has no test harness.

  it("returns the live week during the regular season", () => {
    expect(getCurrentNflWeek({ season_type: "regular", week: 7 })).toBe(7);
  });

  it("returns 0 outside the regular season even when a week is present", () => {
    // Sleeper keeps reporting a week through the pre- and post-season; callers treat 0 as
    // "season mode" (season-long projections, no schedule load, week-scoped UI hidden).
    expect(getCurrentNflWeek({ season_type: "pre", week: 3 })).toBe(0);
    expect(getCurrentNflWeek({ season_type: "post", week: 20 })).toBe(0);
    expect(getCurrentNflWeek({ season_type: "off", week: 0 })).toBe(0);
  });

  it("returns 0 for a regular season reporting week 0", () => {
    expect(getCurrentNflWeek({ season_type: "regular", week: 0 })).toBe(0);
  });

  it("returns 0 for a missing, null or absent nflState", () => {
    expect(getCurrentNflWeek(null)).toBe(0);
    expect(getCurrentNflWeek(undefined)).toBe(0);
    expect(getCurrentNflWeek({})).toBe(0);
    expect(getCurrentNflWeek({ season_type: "regular" })).toBe(0);
    expect(getCurrentNflWeek({ season_type: "regular", week: null })).toBe(0);
  });

  it("returns 0 rather than NaN for an unparseable week", () => {
    // safeFetch/cachedFetch cast a 200 body with no runtime shape check, so a malformed week
    // can reach here. NaN would be falsy at every call site but would also leak into
    // loadProjections/loadSchedule as NaN; 0 is the value they all already handle.
    expect(getCurrentNflWeek({ season_type: "regular", week: "junk" } as never)).toBe(0);
    expect(getCurrentNflWeek({ season_type: "regular", week: NaN })).toBe(0);
  });

  it("treats a negative week as out of season", () => {
    expect(getCurrentNflWeek({ season_type: "regular", week: -1 })).toBe(0);
  });
});
