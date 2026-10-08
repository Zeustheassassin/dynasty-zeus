import { describe, it, expect } from "vitest";
import { learnOpponents, opponentSchool, opponentTier, schoolByExactName, tierGames } from "@/lib/scouting/opponentTier";

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
    expect(opponentSchool("LA Tech")).toBe("Louisiana Tech");
    expect(opponentSchool("Florida Atlantic University")).toBe("Florida Atlantic");
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

describe("learnOpponents", () => {
  const linked = (id: string, opponent: string, extra: object = {}) =>
    ({ id, opponent, season_year: 2026, pff_game_id: 1, pff_match_status: "confirmed", ...extra });
  const ctx = (game_id: string, opponent_school: string | null) => ({ game_id, opponent_school });

  it("learns a name the tables can't read from the PFF game it was linked to", () => {
    const games = [
      linked("a", "Owls of Boca"),
      { id: "b", opponent: "owls of boca - CFP", season_year: 2026 },
      { id: "c", opponent: "Mystery U", season_year: 2026 },
    ];
    const learned = learnOpponents(games, [ctx("a", "Florida Atlantic")]);
    expect([...learned.byGame]).toEqual([["a", "Florida Atlantic"]]);
    // The other game typed the same way reads as that school too.
    expect(opponentSchool("Owls of Boca", learned.byName)).toBe("Florida Atlantic");
    const t = tierGames(games, learned);
    expect([...t.byGame]).toEqual([["a", "G5"], ["b", "G5"]]);
    expect([...t.unrecognized]).toEqual([["Mystery U", 1]]);
    expect(opponentTier("Owls of Boca", 2026, learned.byName)).toBe("G5");
  });

  it("learns only from linked games, and never overrides a name it can read", () => {
    const learned = learnOpponents(
      [
        linked("a", "Owls of Boca", { pff_match_status: "review" }),
        linked("b", "Owls of Boca", { pff_game_id: null }),
        linked("c", "Missouri State"),
        linked("d", "Mystery U"),
      ],
      [ctx("a", "Florida Atlantic"), ctx("b", "Florida Atlantic"), ctx("c", "Southeast Missouri State"), ctx("d", null)],
    );
    expect(learned.byGame.size).toBe(0);
    expect(learned.byName.size).toBe(0);
  });

  it("keeps each game's own link but forgets a name linked to two schools", () => {
    const learned = learnOpponents(
      [linked("a", "State U"), linked("b", "State U")],
      [ctx("a", "Florida Atlantic"), ctx("b", "Louisiana Tech")],
    );
    expect([...learned.byGame]).toEqual([["a", "Florida Atlantic"], ["b", "Louisiana Tech"]]);
    expect(learned.byName.size).toBe(0);
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
