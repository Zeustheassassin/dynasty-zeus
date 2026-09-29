import { describe, it, expect } from "vitest";
import {
  matchEspnAthlete,
  cleanEspnComment,
  toInjuryDetail,
  seasonForDate,
  type EspnListPlayer,
} from "@/lib/helpers/espnInjuryDetail";

const LIST: EspnListPlayer[] = [
  { id: 1, fullName: "Jordyn Tyson", lastName: "Tyson", proTeamId: 18, defaultPositionId: 3 },
  { id: 2, fullName: "Mike Williams", lastName: "Williams", proTeamId: 20, defaultPositionId: 3 },
  { id: 3, fullName: "Mike Williams", lastName: "Williams", proTeamId: 24, defaultPositionId: 3 },
  { id: 4, fullName: "Hollywood Brown", lastName: "Brown", proTeamId: 12, defaultPositionId: 3 },
  { id: 5, fullName: "Josh Allen", lastName: "Allen", proTeamId: 2, defaultPositionId: 1 },
  { id: 6, fullName: "Josh Allen", lastName: "Allen", proTeamId: 30, defaultPositionId: 11 },
  { id: 7, fullName: "Kenneth Walker III", lastName: "Walker III", proTeamId: 0, defaultPositionId: 2 },
];

describe("matchEspnAthlete", () => {
  it("matches a unique full name", () => {
    expect(matchEspnAthlete(LIST, { name: "Jordyn Tyson", team: "NO", position: "WR" })).toBe(1);
  });
  it("breaks a shared name by team, and refuses to guess without one", () => {
    expect(matchEspnAthlete(LIST, { name: "Mike Williams", team: "NYJ", position: "WR" })).toBe(2);
    expect(matchEspnAthlete(LIST, { name: "Mike Williams", team: "LAC", position: "WR" })).toBe(3);
    expect(matchEspnAthlete(LIST, { name: "Mike Williams", position: "WR" })).toBeNull();
  });
  it("uses position to split the QB from the linebacker", () => {
    expect(matchEspnAthlete(LIST, { name: "Josh Allen", team: "BUF", position: "QB" })).toBe(5);
    expect(matchEspnAthlete(LIST, { name: "Josh Allen", team: "JAX", position: "LB" })).toBe(6);
  });
  it("falls back to last name + team for nicknames", () => {
    expect(matchEspnAthlete(LIST, { name: "Marquise Brown", team: "KC", position: "WR" })).toBe(4);
    // …but not without a team to anchor it.
    expect(matchEspnAthlete(LIST, { name: "Marquise Brown", position: "WR" })).toBeNull();
  });
  it("ignores name suffixes and treats ESPN team 0 as unknown", () => {
    expect(matchEspnAthlete(LIST, { name: "Kenneth Walker", team: "SEA", position: "RB" })).toBe(7);
  });
  it("returns null for someone ESPN doesn't list", () => {
    expect(matchEspnAthlete(LIST, { name: "John Michael Gyllenborg", team: "KC", position: "TE" })).toBeNull();
  });
});

describe("cleanEspnComment", () => {
  it("drops the mangled link seen in a real 2026-09 blurb", () => {
    const raw = "during Sunday's 24-10 loss to https://www.palmbeachpost.com/story/sports/nfl/dolphins/2026/09/28/miami-dolphins-jeff-hafley-devon-achane/91989229007/\"&gt;Hal Habib of The Palm Beach Post. With";
    expect(cleanEspnComment(raw)).toBe("during Sunday's 24-10 loss to Hal Habib of The Palm Beach Post. With");
  });
  it("decodes entities, strips tags and bare URLs", () => {
    expect(cleanEspnComment("Coach said &quot;soon&quot; <b>today</b> — see https://x.com/y for more &amp; less."))
      .toBe("Coach said \"soon\" today — see for more & less.");
  });
  it("returns null for empty text", () => {
    expect(cleanEspnComment("")).toBeNull();
    expect(cleanEspnComment(null)).toBeNull();
  });
});

describe("toInjuryDetail", () => {
  it("takes the newest record and drops ESPN's 'Not Specified' filler", () => {
    const d = toInjuryDetail([
      { status: "Out", date: "2026-09-01T10:00Z", details: { type: "Ankle" } },
      {
        status: "Injured Reserve", date: "2026-09-28T18:38Z", shortComment: "Placed on IR.",
        details: { fantasyStatus: { abbreviation: "IR" }, type: "Heel", side: "Left", detail: "Not Specified", returnDate: "2026-10-25" },
      },
    ], 2026);
    expect(d).toMatchObject({
      found: true, season: 2026, status: "Injured Reserve", fantasyStatus: "IR",
      type: "Heel", side: "Left", detail: null, returnDate: "2026-10-25", shortComment: "Placed on IR.",
    });
  });
  it("rejects a malformed return date and reports nothing found for no records", () => {
    expect(toInjuryDetail([{ status: "Out", date: "2026-09-28", details: { returnDate: "soon" } }], 2026).returnDate).toBeNull();
    expect(toInjuryDetail([], 2026)).toEqual({ found: false });
  });
});

describe("seasonForDate", () => {
  it("puts January and February in the prior season", () => {
    expect(seasonForDate(new Date("2027-02-10T00:00:00Z"))).toBe(2026);
    expect(seasonForDate(new Date("2026-09-29T00:00:00Z"))).toBe(2026);
    expect(seasonForDate(new Date("2027-03-01T00:00:00Z"))).toBe(2027);
  });
});
