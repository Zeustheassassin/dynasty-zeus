import { describe, it, expect } from "vitest";
import { opponentSchool, opponentTier, schoolByExactName, tierGames } from "@/lib/scouting/opponentTier";

describe("opponentTier", () => {
  it("reads team names and the other names they go by", () => {
    expect(opponentTier("Ohio State", 2025)).toBe("P4");
    expect(opponentTier("UNC", 2025)).toBe("P4");
    expect(opponentTier("Georgia State", 2025)).toBe("G5");
    expect(opponentTier("Miami OH", 2025)).toBe("G5");
    expect(opponentTier("Miami", 2025)).toBe("P4");
    expect(opponentTier("North Dakota State", 2025)).toBe("FCS");
    expect(opponentTier("Notre Dame", 2025)).toBe("P4");
  });

  it("ignores game tags like CFP and conference championship", () => {
    expect(opponentTier("Alabama CC", 2025)).toBe("P4");
    expect(opponentTier("Miami - CFP", 2025)).toBe("P4");
    expect(opponentTier("Georgia CFP", 2025)).toBe("P4");
    expect(opponentTier("Georgia SEC Championship", 2025)).toBe("P4");
  });

  it("catches small typos, and the aliases charting has used", () => {
    expect(opponentTier("Flordia State", 2025)).toBe("P4");
    expect(opponentTier("South Flordia", 2025)).toBe("G5");
    expect(opponentTier("Louisiana-Lafayete", 2025)).toBe("G5");
    expect(opponentTier("North Carolina State", 2025)).toBe("P4");
    expect(opponentTier("South Antonio", 2025)).toBe("G5");
    expect(opponentTier("WIsconsin", 2025)).toBe("P4");
  });

  it("uses the tier for the game's season", () => {
    expect(opponentTier("Missouri State", 2024)).toBe("FCS");
    expect(opponentTier("Missouri State", 2025)).toBe("G5");
  });

  it("returns null for a name it can't place", () => {
    expect(opponentTier("Somewhere Tech Academy", 2025)).toBeNull();
    expect(opponentTier("", 2025)).toBeNull();
    expect(opponentTier(null, 2025)).toBeNull();
  });
});

describe("tierGames", () => {
  it("maps each game and lists the names it couldn't place", () => {
    const t = tierGames([
      { id: "a", opponent: "Texas", season_year: 2025 },
      { id: "b", opponent: "Georgia State", season_year: 2025 },
      { id: "c", opponent: "Mystery U", season_year: 2025 },
      { id: "d", opponent: "Mystery U", season_year: 2025 },
    ]);
    expect([...t.byGame]).toEqual([["a", "P4"], ["b", "G5"]]);
    expect([...t.unrecognized]).toEqual([["Mystery U", 2]]);
  });
});

describe("opponentSchool / schoolByExactName", () => {
  it("resolves a charted opponent to CFD's school name, tags and typos allowed", () => {
    expect(opponentSchool("Miami - CFP")).toBe("Miami");
    expect(opponentSchool("Flordia State")).toBe("Florida State");
    expect(opponentSchool("UNC")).toBe("North Carolina");
    expect(opponentSchool("Mystery U")).toBeNull();
    expect(opponentSchool(null)).toBeNull();
  });

  it("matches other sources' names exactly, never by typo distance", () => {
    expect(schoolByExactName("Miami (FL)")).toBe("Miami");
    expect(schoolByExactName("Texas")).toBe("Texas");
    // Two letters from "Mississippi St": a typo match would pick the wrong school.
    expect(schoolByExactName("Mississippi")).toBeNull();
    expect(schoolByExactName("")).toBeNull();
  });
});
