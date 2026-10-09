import { describe, it, expect } from "vitest";
import { draftBoardClass, firstKickoff } from "../../../lib/helpers/draftClass";
import type { TeamGameState } from "../../../lib/types";

// The 2026 opener, NE @ SEA: 8:20 pm ET on Wednesday 9/9/2026 (ESPN's Week 1).
const KICKOFF_2026 = Date.parse("2026-09-10T00:20:00Z");
const at = (iso: string) => new Date(iso);
const sleeper = (season: string, season_type: string, week: number) => ({ season, season_type, week });

describe("draftBoardClass", () => {
  it("shows this year's class until the first Week 1 kickoff, next year's from it", () => {
    expect(draftBoardClass(at("2026-05-01T12:00:00Z"), KICKOFF_2026)).toEqual({ year: 2026, source: "espn" });
    expect(draftBoardClass(at("2026-09-10T00:19:59Z"), KICKOFF_2026)).toEqual({ year: 2026, source: "espn" });
    expect(draftBoardClass(at("2026-09-10T00:20:00Z"), KICKOFF_2026)).toEqual({ year: 2027, source: "espn" });
    expect(draftBoardClass(at("2026-12-20T12:00:00Z"), KICKOFF_2026)).toEqual({ year: 2027, source: "espn" });
  });

  it("keeps next year's class through New Year's, when the calendar catches up", () => {
    // January 2027: the 2027 season's schedule isn't out, so no kickoff, and
    // Sleeper still says 2026 (playoffs).
    expect(draftBoardClass(at("2027-01-15T12:00:00Z"), null, sleeper("2026", "post", 1))).toEqual({ year: 2027, source: "sleeper" });
    // May 2027: the schedule is out, the opener is ahead.
    expect(draftBoardClass(at("2027-05-20T12:00:00Z"), Date.parse("2027-09-10T00:20:00Z"))).toEqual({ year: 2027, source: "espn" });
  });

  it("trusts ESPN's kickoff over Sleeper, whose week reaches 1 a few days early", () => {
    expect(draftBoardClass(at("2026-09-08T12:00:00Z"), KICKOFF_2026, sleeper("2026", "regular", 1))).toEqual({ year: 2026, source: "espn" });
  });

  it("falls back to Sleeper's regular-season week without a kickoff", () => {
    expect(draftBoardClass(at("2026-10-09T12:00:00Z"), null, sleeper("2026", "regular", 6))).toEqual({ year: 2027, source: "sleeper" });
    expect(draftBoardClass(at("2026-08-20T12:00:00Z"), null, sleeper("2026", "pre", 2))).toEqual({ year: 2026, source: "sleeper" });
    expect(draftBoardClass(at("2026-03-20T12:00:00Z"), null, sleeper("2026", "off", 0))).toEqual({ year: 2026, source: "sleeper" });
  });

  it("uses the calendar year with neither", () => {
    expect(draftBoardClass(at("2026-10-09T12:00:00Z"), null, null)).toEqual({ year: 2026, source: "calendar" });
    // A malformed Sleeper reply doesn't count.
    expect(draftBoardClass(at("2026-10-09T12:00:00Z"), null, { season: "", season_type: "regular", week: 6 })).toEqual({ year: 2026, source: "calendar" });
  });
});

describe("firstKickoff", () => {
  const game = (iso: string): TeamGameState => ({ kickoffAt: Date.parse(iso), state: "Upcoming" });

  it("takes the earliest game", () => {
    const week1 = {
      NE: game("2026-09-10T00:20:00Z"), SEA: game("2026-09-10T00:20:00Z"),
      DAL: game("2026-09-13T17:00:00Z"), KC: game("2026-09-15T00:15:00Z"),
    };
    expect(firstKickoff(week1, 2026)).toBe(KICKOFF_2026);
  });

  it("is null for no games, and ignores games from another season", () => {
    expect(firstKickoff({}, 2027)).toBeNull();
    expect(firstKickoff(null, 2027)).toBeNull();
    expect(firstKickoff({ NE: game("2026-09-10T00:20:00Z") }, 2027)).toBeNull();
  });
});
