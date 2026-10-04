import { describe, it, expect } from "vitest";
import {
  classifyInjuryNews,
  buildInjuryNewsFlags,
  INJURY_NEWS_MAX_AGE_MS,
} from "@/lib/helpers/injuryNews";
import type { EspnInjuryEntry } from "@/lib/helpers/injuryOverrides";
import type { SleeperPlayer } from "@/lib/types";

// Real ESPN notes from the 2026-10-04 feed unless marked otherwise.
describe("classifyInjuryNews — real ESPN notes", () => {
  it.each([
    ["Coker (quadriceps) is unlikely to suit up for Sunday night's game against the Lions, Adam Schefter of ESPN reports.", "Jalen Coker"],
    ["Wallace (knee) has been ruled out for Thursday's game against the Steelers.", "Tylan Wallace"],
    ["Allen (groin) has been downgraded to out for Sunday's game against Washington.", "Keenan Allen"],
    ["Slayton (coach's decision) is inactive for Sunday's game against the Commanders in London.", "Darius Slayton"],
    ["Smith (knee) underwent surgery Wednesday to repair a torn ACL and will miss the rest of the season, Antwan V. Staley of the New York Daily News reports.", "Arian Smith"],
  ])("reads %s as likely out", (note, name) => {
    expect(classifyInjuryNews(note, name)).toBe("likely-out");
  });

  it.each([
    ["McConkey (foot), who is listed as questionable for Sunday's game at Seattle, is likely to suit up, Ian Rapoport of NFL Network reports.", "Ladd McConkey"],
    ["Flowers (hamstring) is listed as active Sunday against the Titans.", "Zay Flowers"],
    ["Richardson is active for Sunday's game against the Commanders in London.", "Anthony Richardson Sr."],
    ["Coleman (ankle) doesn't have an injury designation for Sunday's game against the Patriots.", "Keon Coleman"],
    ["O'Connell (personal) had his injury designation for Sunday's Week 4 matchup against Kansas City cleared Saturday, Ryan McFadden of ESPN.com reports.", "Aidan O'Connell"],
    ["Bagent is expected to start Sunday versus the Jets after getting most of the first-team reps in practice, Ian Rapoport of NFL Network reports.", "Tyson Bagent"],
  ])("reads %s as likely in", (note, name) => {
    expect(classifyInjuryNews(note, name)).toBe("likely-in");
  });

  it.each([
    "Lance (groin) is listed as questionable for Sunday's game against Seattle.",
    "Evans (ribs) has said \"he'll do his best to be out there\" Sunday against the Broncos, Ian Rapoport of NFL Network reports.",
    "questionable",
    "Smythe (heel) was a full participant in Thursday's practice.",
    "Mendoza did not play in the Raiders' 35-27 Week 3 win over the Saints.",
  ])("finds no game-status call in %s", (note) => {
    expect(classifyInjuryNews(note)).toBeNull();
  });

  it("ignores a teammate's status in the same note", () => {
    expect(classifyInjuryNews(
      "Holani (rib) doesn't have an injury designation for Sunday's game against the Chargers, while teammate Jadarian Price (chest) has been ruled out.",
      "George Holani",
    )).toBe("likely-in");
    expect(classifyInjuryNews(
      "Ben Standig of The Team 980 Washington D.C. reports that Terry McLaurin (hamstring) is expected to miss Sunday's game against the Colts in London, which would leave Diggs as the top wide receiver for the Commanders.",
      "Stefon Diggs",
    )).toBeNull();
    expect(classifyInjuryNews(
      "Schultz is in line to see an increase in targets in Sunday's Week 3 matchup against the Colts due to Nico Collins (hamstring) being ruled out.",
      "Dalton Schultz",
    )).toBeNull();
  });
});

describe("classifyInjuryNews — phrasing rules", () => {
  it("never reads a negated play phrase as playing", () => {
    expect(classifyInjuryNews("Doe (ankle) is not expected to play Sunday.")).toBe("likely-out");
    expect(classifyInjuryNews("Doe (ankle) isn't expected to play Sunday.")).toBe("likely-out");
    expect(classifyInjuryNews("Doe (ankle) won't play Sunday against Dallas.")).toBe("likely-out");
  });

  it("reads a negated miss phrase as playing", () => {
    expect(classifyInjuryNews("Doe (ankle) isn't expected to miss Sunday's game.")).toBe("likely-in");
    expect(classifyInjuryNews("Doe (ankle) is unlikely to miss Sunday's game.")).toBe("likely-in");
    expect(classifyInjuryNews("Doe (ankle) won't miss any time.")).toBe("likely-in");
  });

  it("flags game-time decisions and not-ruled-out notes as uncertain", () => {
    expect(classifyInjuryNews("Doe (knee) will be a game-time decision Sunday.")).toBe("uncertain");
    expect(classifyInjuryNews("Doe (knee) hasn't been ruled out for Sunday.")).toBe("uncertain");
  });

  it("skips sentences that only describe what happens if he can't go", () => {
    expect(classifyInjuryNews(
      "Doe (knee) is questionable. If Doe is listed among the inactives, Roe will start.",
      "John Doe",
    )).toBeNull();
    expect(classifyInjuryNews("Roe would start if Doe can't play Sunday.", "Rich Roe")).toBeNull();
  });

  it("reads a team ruling him out", () => {
    expect(classifyInjuryNews("The Panthers ruled Doe out for Sunday's game.", "John Doe")).toBe("likely-out");
  });

  it("keeps a dealing-with aside from hiding the call", () => {
    expect(classifyInjuryNews(
      "Doe, who is dealing with a sore hamstring, is expected to play Sunday.",
      "John Doe",
    )).toBe("likely-in");
  });

  it("handles abbreviations without splitting the sentence", () => {
    expect(classifyInjuryNews(
      "St. Brown (knee) is not expected to play Sunday, the team's No. 1 receiver said.",
      "Amon-Ra St. Brown",
    )).toBe("likely-out");
  });
});

describe("buildInjuryNewsFlags", () => {
  const now = Date.parse("2026-10-04T15:00:00Z");
  const mk = (id: string, name: string, position: string, team: string): SleeperPlayer =>
    ({ player_id: id, full_name: name, position, team } as SleeperPlayer);
  const players = {
    "11646": mk("11646", "Jalen Coker", "WR", "CAR"),
    "2": mk("2", "Ladd McConkey", "WR", "LAC"),
    "3": mk("3", "Elijah Sarratt", "WR", "BAL"),
  };
  const entry = (over: Partial<EspnInjuryEntry>): EspnInjuryEntry => ({
    name: "Jalen Coker", position: "WR", team: "CAR", status: "Questionable",
    date: "2026-10-04T11:26Z",
    comment: "Coker (quadriceps) is unlikely to suit up for Sunday night's game against the Lions, Adam Schefter of ESPN reports.",
    ...over,
  });

  it("flags a Questionable player whose note says he's unlikely to play", () => {
    const flags = buildInjuryNewsFlags(players, [entry({})], now);
    expect(flags["11646"]).toMatchObject({ lean: "likely-out", date: "2026-10-04T11:26Z" });
    expect(flags["11646"].comment).toContain("unlikely to suit up");
  });

  it("ignores players ESPN doesn't list as Questionable (an Active row can carry last week's note)", () => {
    const flags = buildInjuryNewsFlags(players, [entry({
      name: "Elijah Sarratt", team: "BAL", status: "Active", date: "2026-09-27T16:00Z",
      comment: "Sarratt (coach's decision) is inactive for Sunday's game against Dallas.",
    })], now);
    expect(flags).toEqual({});
  });

  it("ignores notes older than the max age", () => {
    const old = new Date(now - INJURY_NEWS_MAX_AGE_MS - 60_000).toISOString();
    expect(buildInjuryNewsFlags(players, [entry({ date: old })], now)).toEqual({});
  });

  it("ignores notes with no date, no comment, or no game-status call", () => {
    expect(buildInjuryNewsFlags(players, [entry({ date: null })], now)).toEqual({});
    expect(buildInjuryNewsFlags(players, [entry({ comment: null })], now)).toEqual({});
    expect(buildInjuryNewsFlags(players, [entry({ comment: "questionable" })], now)).toEqual({});
  });

  it("keeps likely-in reads too (they silence the late-game warning)", () => {
    const flags = buildInjuryNewsFlags(players, [entry({
      name: "Ladd McConkey", team: "LAC",
      comment: "McConkey (foot), who is listed as questionable for Sunday's game at Seattle, is likely to suit up, Ian Rapoport of NFL Network reports.",
    })], now);
    expect(flags["2"].lean).toBe("likely-in");
  });
});
