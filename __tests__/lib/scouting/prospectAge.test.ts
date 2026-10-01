import { describe, it, expect } from "vitest";
import { prospectAgeAt, rookieSeasonAge, parseHeightInches } from "@/lib/scouting/prospectAge";

describe("prospect age", () => {
  it("uses the birthday when there is one", () => {
    const a = prospectAgeAt(new Date("2026-06-01"), "2004-06-01", 2021)!;
    expect(a.estimated).toBe(false);
    expect(a.years).toBeCloseTo(22, 2);
  });

  it("estimates from the HS class year: HS class + 18.4 years at the late-April draft", () => {
    const a = prospectAgeAt(new Date(Date.UTC(2027, 3, 25)), null, 2023)!;
    expect(a.estimated).toBe(true);
    expect(a.years).toBeCloseTo(2027 - 2023 + 18.4, 1);
  });

  it("is null with neither", () => {
    expect(prospectAgeAt(new Date(), null, null)).toBeNull();
    expect(prospectAgeAt(new Date(), "not a date", null)).toBeNull();
  });

  it("measures the rookie season at Sept 1 of the draft year", () => {
    expect(rookieSeasonAge(2027, "2005-09-01", null)!.years).toBeCloseTo(22, 2);
  });
});

describe("parseHeightInches", () => {
  it("reads the ways heights get typed", () => {
    expect(parseHeightInches(`6'2"`)).toBe(74);
    expect(parseHeightInches("6’2”")).toBe(74);
    expect(parseHeightInches("5-11")).toBe(71);
    expect(parseHeightInches("74")).toBe(74);
    expect(parseHeightInches("")).toBeNull();
    expect(parseHeightInches("tall")).toBeNull();
  });
});
