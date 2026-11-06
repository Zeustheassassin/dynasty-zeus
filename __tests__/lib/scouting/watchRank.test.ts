import { describe, it, expect } from "vitest";
import { formatWatchScore, watchSortValue } from "../../../lib/scouting/watchRank";

describe("watchRank", () => {
  it("sorts Watch Rank 1 first and prospects not on the sheet last", () => {
    const rows = [
      { name: "not on sheet", watch_rank: null },
      { name: "#12", watch_rank: 12 },
      { name: "missing field" },
      { name: "#1", watch_rank: 1 },
      { name: "#78", watch_rank: 78 },
    ];
    const sorted = [...rows].sort((a, b) => watchSortValue(a) - watchSortValue(b)).map((r) => r.name);
    expect(sorted.slice(0, 3)).toEqual(["#1", "#12", "#78"]);
    expect(sorted.slice(3).sort()).toEqual(["missing field", "not on sheet"]);
  });

  it("never lets an unranked prospect sort ahead of a ranked one", () => {
    expect(watchSortValue({ watch_rank: 9999 })).toBeLessThan(watchSortValue({ watch_rank: null }));
  });

  it("shows the score with one decimal, like the sheet", () => {
    expect(formatWatchScore(92.7)).toBe("92.7");
    expect(formatWatchScore(9)).toBe("9.0");
    expect(formatWatchScore(-100)).toBe("-100.0");
    expect(formatWatchScore(null)).toBe("—");
    expect(formatWatchScore(undefined)).toBe("—");
  });

  it("reads a numeric that arrives as a string", () => {
    // Postgres numeric can reach the client as a string; the column must still show it.
    expect(formatWatchScore("43.0" as unknown as number)).toBe("43.0");
  });
});
