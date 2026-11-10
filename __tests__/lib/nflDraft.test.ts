import { describe, it, expect } from "vitest";
import {
  draftChanges, draftSkillPosition, isCompleteDraft, matchDraftPicks, nflTeamId, toDraftPickRow,
  type DraftPickRow, type DraftedProspect,
} from "@/lib/nflDraft";

const pick = (overall: number, name: string, position: string, team: string, extra: Partial<DraftPickRow> = {}): DraftPickRow => ({
  year: 2027, overall, round: Math.min(7, Math.ceil(overall / 32)), pick: ((overall - 1) % 32) + 1,
  nfl_team_id: nflTeamId(team), nfl_team: team, position, name, college: null, ...extra,
});

const prospect = (id: string, name: string, position: string, extra: Partial<DraftedProspect> = {}): DraftedProspect => ({
  id, name, school: "State", position, draft_class_year: 2027, draft_round: null, draft_pick: null, draft_team: null, ...extra,
});

describe("nflTeamId", () => {
  it("reads nicknames, abbreviations and full names, not bare cities", () => {
    expect(nflTeamId("Eagles")).toBe(21);
    expect(nflTeamId("PHI")).toBe(21);
    expect(nflTeamId("Philadelphia Eagles")).toBe(21);
    expect(nflTeamId("jets")).toBe(20);
    expect(nflTeamId("WSH")).toBe(28);
    expect(nflTeamId("49ers")).toBe(25);
    expect(nflTeamId("New York")).toBeNull();
    expect(nflTeamId("")).toBeNull();
    expect(nflTeamId(null)).toBeNull();
  });
});

describe("toDraftPickRow", () => {
  it("names the team from CFD's id, since its team field is a city", () => {
    const row = toDraftPickRow({
      year: 2026, overall: 2, round: 1, pick: 2, nflTeamId: 20, nflTeam: "New York",
      position: "Wide Receiver", name: " Ace Catcher ", collegeTeam: "Ohio State",
    });
    expect(row).toEqual({
      year: 2026, overall: 2, round: 1, pick: 2, nfl_team_id: 20, nfl_team: "Jets",
      position: "Wide Receiver", name: "Ace Catcher", college: "Ohio State",
    });
    expect(toDraftPickRow({ year: 2026, overall: 3, round: 1, pick: 3, nflTeamId: 99, nflTeam: "Somewhere", position: "Tight End", name: "X" })!.nfl_team).toBe("Somewhere");
    expect(toDraftPickRow({ year: 2026, overall: 3, round: 1, name: "X", position: "Tight End" })).toBeNull();
  });
});

describe("draftSkillPosition / isCompleteDraft", () => {
  it("maps CFD's position names to the four fantasy positions", () => {
    expect(draftSkillPosition("Wide Receiver")).toBe("WR");
    expect(draftSkillPosition("Tight End")).toBe("TE");
    expect(draftSkillPosition("Running Back")).toBe("RB");
    expect(draftSkillPosition("Quarterback")).toBe("QB");
    expect(draftSkillPosition("Defensive Edge")).toBeNull();
  });
  it("calls a draft finished once round 7 is in", () => {
    expect(isCompleteDraft([{ round: 1 }, { round: 6 }])).toBe(false);
    expect(isCompleteDraft([{ round: 7 }])).toBe(true);
  });
});

describe("matchDraftPicks", () => {
  it("matches by name with suffixes and punctuation dropped, in his class only", () => {
    const picks = [pick(20, "Makai Lemon Jr.", "Wide Receiver", "Eagles"), pick(40, "Other Guy", "Running Back", "Bills")];
    const m = matchDraftPicks([prospect("a", "Makai Lemon", "WR"), prospect("b", "Other Guy", "RB", { draft_class_year: 2028 })], picks);
    expect(m.get("a")?.overall).toBe(20);
    expect(m.has("b")).toBe(false);
  });

  it("breaks a shared name by school, then by position", () => {
    const picks = [
      pick(30, "Chris Smith", "Wide Receiver", "Bears", { college: "Georgia" }),
      pick(90, "Chris Smith", "Running Back", "Lions", { college: "Iowa" }),
    ];
    expect(matchDraftPicks([prospect("a", "Chris Smith", "RB", { school: "Iowa" })], picks).get("a")?.overall).toBe(90);
    expect(matchDraftPicks([prospect("a", "Chris Smith", "WR", { school: "Elsewhere" })], picks).get("a")?.overall).toBe(30);
  });

  it("gives a pick claimed by two prospects to neither", () => {
    const m = matchDraftPicks([prospect("a", "Sam Hand", "WR"), prospect("b", "Sam Hand", "WR")], [pick(10, "Sam Hand", "Wide Receiver", "Colts")]);
    expect(m.size).toBe(0);
  });
});

describe("draftChanges", () => {
  it("lists matched skill players whose round, pick or team differ", () => {
    const picks = [pick(20, "Ace One", "Wide Receiver", "Eagles"), pick(50, "Bee Two", "Tight End", "Chiefs"), pick(60, "Cee Three", "Linebacker", "Jets")];
    const ps = [
      prospect("a", "Ace One", "WR", { draft_round: 2 }),                                          // projected round 2 → actual
      prospect("b", "Bee Two", "TE", { draft_round: 2, draft_pick: 50, draft_team: "Chiefs" }),  // already right
      prospect("c", "Cee Three", "LB"),                                                          // not a skill position
    ];
    expect(draftChanges(ps, picks, 2027).map((c) => c.update)).toEqual([
      { id: "a", draft_round: 1, draft_pick: 20, draft_team: "Eagles" },
    ]);
  });
});
