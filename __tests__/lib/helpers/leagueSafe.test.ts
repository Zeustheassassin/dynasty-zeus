import { describe, it, expect } from "vitest";
import {
  normalizeLeagueSafeUrl,
  resolveLeagueSafeLinks,
  getLeagueSafeCarryForward,
  getMissingLeagueSafeYears,
} from "@/lib/helpers/leagueSafe";

// LeagueSafe links per league per season (10/24). Sleeper gives a renewed league a new
// league_id each season, so links are read through previous_league_id and copied forward.

const YEARS = [2026, 2027, 2028, 2029];

describe("normalizeLeagueSafeUrl", () => {
  it("keeps an https link", () => {
    expect(normalizeLeagueSafeUrl("https://www.leaguesafe.com/league/12345")).toBe("https://www.leaguesafe.com/league/12345");
  });

  it("trims and adds https:// to a bare link", () => {
    expect(normalizeLeagueSafeUrl("  www.leaguesafe.com/league/12345 ")).toBe("https://www.leaguesafe.com/league/12345");
  });

  it("returns empty for a blank field, which clears the season", () => {
    expect(normalizeLeagueSafeUrl("   ")).toBe("");
  });

  it("rejects anything that isn't a web address", () => {
    expect(normalizeLeagueSafeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeLeagueSafeUrl("not a link")).toBeNull();
    expect(normalizeLeagueSafeUrl("ftp://leaguesafe.com/x")).toBeNull();
  });
});

describe("resolveLeagueSafeLinks", () => {
  it("reads links saved under the league it renewed from", () => {
    const stored = { old: { 2027: "https://a.com/27", 2028: "https://a.com/28" } };
    expect(resolveLeagueSafeLinks({ league_id: "new", previous_league_id: "old" }, stored))
      .toEqual({ 2027: "https://a.com/27", 2028: "https://a.com/28" });
  });

  it("lets the league's own row win, even a cleared one", () => {
    const stored = {
      old: { 2027: "https://a.com/27", 2028: "https://a.com/28" },
      new: { 2027: "https://b.com/27", 2028: "" },
    };
    expect(resolveLeagueSafeLinks({ league_id: "new", previous_league_id: "old" }, stored))
      .toEqual({ 2027: "https://b.com/27", 2028: "" });
  });

  it("is empty for a league with nothing saved", () => {
    expect(resolveLeagueSafeLinks({ league_id: "x", previous_league_id: null }, {})).toEqual({});
  });
});

describe("getLeagueSafeCarryForward", () => {
  it("copies the previous league's links for seasons the renewed league has no row for", () => {
    const stored = {
      old: { 2026: "https://a.com/26", 2027: "https://a.com/27", 2028: "https://a.com/28" },
      new: { 2028: "" },
    };
    expect(getLeagueSafeCarryForward([{ league_id: "new", previous_league_id: "old" }], stored, [2027, 2028, 2029, 2030]))
      .toEqual([{ league_id: "new", season: 2027, url: "https://a.com/27" }]);
  });

  it("skips cleared seasons, seasons outside the window, and leagues that weren't renewed", () => {
    const stored = { old: { 2025: "https://a.com/25", 2027: "" } };
    expect(getLeagueSafeCarryForward(
      [{ league_id: "new", previous_league_id: "old" }, { league_id: "fresh", previous_league_id: null }],
      stored,
      YEARS,
    )).toEqual([]);
  });

  it("copies nothing once the renewed league has its own rows", () => {
    const stored = { old: { 2027: "https://a.com/27" }, new: { 2027: "https://a.com/27" } };
    expect(getLeagueSafeCarryForward([{ league_id: "new", previous_league_id: "old" }], stored, YEARS)).toEqual([]);
  });
});

describe("getMissingLeagueSafeYears", () => {
  it("lists every season with no link, cleared ones included", () => {
    expect(getMissingLeagueSafeYears({ 2026: "https://a.com/26", 2028: "" }, YEARS)).toEqual([2027, 2028, 2029]);
  });

  it("is every season for a league with no links", () => {
    expect(getMissingLeagueSafeYears(undefined, YEARS)).toEqual(YEARS);
  });
});
