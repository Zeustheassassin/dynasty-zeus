import { describe, it, expect } from "vitest";
import {
  COMPETITION_CAP, COMPETITION_PER_PLAYER, DEFAULT_DYNASTY_WEIGHTS, draftCapitalForPick, rookieCompetition, scoreDynasty,
  type Competitor,
} from "@/lib/scouting/dynastyScore";
import { isMoveTe, landingInputsFrom, landingLines, type LandingProspect } from "@/lib/scouting/landingSpot";
import { nflTeamId, type DraftPickRow } from "@/lib/nflDraft";
import type { RoleFit } from "@/lib/scouting/roleFit";
import type { RoleStanding } from "@/lib/scouting/roleStanding";

const pick = (overall: number, name: string, position: string, team: string, year = 2027): DraftPickRow => ({
  year, overall, round: Math.min(7, Math.ceil(overall / 32)), pick: ((overall - 1) % 32) + 1,
  nfl_team_id: nflTeamId(team), nfl_team: team, position, name, college: null,
});

const prospect = (id: string, name: string, position: string, extra: Partial<LandingProspect> = {}): LandingProspect => ({
  id, name, school: "State", position, draft_class_year: 2027, draft_round: null, draft_pick: null, draft_team: null,
  will_play_post: "", ...extra,
});

const comp = (overall: number, extra: Partial<Competitor> = {}): Competitor => ({
  name: `P${overall}`, position: "WR", overall, round: Math.ceil(overall / 32), moveTe: false, ...extra,
});

describe("rookieCompetition", () => {
  it("costs each teammate ahead up to 0.2, by how much more capital he got", () => {
    // The user's example: a 6th-round WR (pick 190) whose team took WRs at picks 50 and 85.
    const mine = draftCapitalForPick(190);
    const r = rookieCompetition(mine, [comp(50), comp(85)]);
    const second = COMPETITION_PER_PLAYER * (draftCapitalForPick(85) - mine); // gap under 1.0
    expect(r.competitors[0].cost).toBeCloseTo(COMPETITION_PER_PLAYER, 12);   // gap over 1.0: full cost
    expect(r.competitors[1].cost).toBeCloseTo(second, 12);
    expect(r.value).toBeCloseTo(-(COMPETITION_PER_PLAYER + second), 12);
    expect(r.value).toBeCloseTo(-0.357, 3);
  });

  it("caps the total and costs a near-equal pick almost nothing", () => {
    expect(rookieCompetition(draftCapitalForPick(220), [comp(10), comp(20), comp(30)]).value).toBe(-COMPETITION_CAP);
    expect(rookieCompetition(draftCapitalForPick(25), [comp(24)]).value).toBeCloseTo(-COMPETITION_PER_PLAYER * 0.0125, 12);
    expect(rookieCompetition(0.5, []).value).toBeCloseTo(0, 12);
  });
});

describe("scoreDynasty with a landing spot", () => {
  const base = {
    pos: "WR" as const, aeScore: 0.5, rookieAge: null, heightIn: null, weightLb: null, draftRound: 6, draftPick: 190,
  };

  it("adds landing weight × rookie competition to Plus", () => {
    const none = scoreDynasty(base, DEFAULT_DYNASTY_WEIGHTS);
    const crowded = scoreDynasty({ ...base, landing: { competitors: [comp(50), comp(85)] } }, { ...DEFAULT_DYNASTY_WEIGHTS, landing: 2 });
    expect(none.landing).toBeNull();
    expect(crowded.landing!.competition!.value).toBeCloseTo(-0.357, 3);
    expect(crowded.landing!.standing).toBeNull();
    expect(crowded.plus! - none.plus!).toBeCloseTo(2 * crowded.landing!.competition!.value, 12);
  });

  it("adds role weight × role standing to Plus, beside rookie competition", () => {
    const none = scoreDynasty(base, DEFAULT_DYNASTY_WEIGHTS);
    const standing = { value: 0.2 } as RoleStanding;
    const d = scoreDynasty({ ...base, landing: { competitors: [comp(50)], standing } }, { ...DEFAULT_DYNASTY_WEIGHTS, landing: 1, role: 2 });
    expect(d.landing!.standing).toBe(standing);
    expect(d.plus! - none.plus!).toBeCloseTo(d.landing!.competition!.value + 2 * 0.2, 12);
    // Role standing counts even while the competition can't be known.
    const noDraft = scoreDynasty({ ...base, landing: { competitors: null, note: "x", standing } }, DEFAULT_DYNASTY_WEIGHTS);
    expect(noDraft.plus! - none.plus!).toBeCloseTo(0.2, 12);
  });

  it("adds nothing while the competition can't be known, and says why", () => {
    const d = scoreDynasty({ ...base, landing: { competitors: null, note: "no NFL team set" } }, DEFAULT_DYNASTY_WEIGHTS);
    expect(d.landing).toEqual({ competition: null, standing: null, note: "no NFL team set" });
    expect(d.plus).toBeCloseTo(scoreDynasty(base, DEFAULT_DYNASTY_WEIGHTS).plus!, 12);
  });
});

describe("isMoveTe", () => {
  it("goes by Will Play (Post) when it names a TE role, else his best role bucket", () => {
    expect(isMoveTe({ will_play_post: "move" }, undefined)).toBe(true);
    expect(isMoveTe({ will_play_post: "Move/Big slot" }, undefined)).toBe(true);
    expect(isMoveTe({ will_play_post: "inline_y" }, { best: "move" } as unknown as RoleFit)).toBe(false);
    // An older free-text answer isn't a role: his best bucket decides.
    expect(isMoveTe({ will_play_post: "Move TE" }, { best: "inline_y" } as unknown as RoleFit)).toBe(false);
    expect(isMoveTe({ will_play_post: "" }, { best: "move" } as unknown as RoleFit)).toBe(true);
    expect(isMoveTe({ will_play_post: "" }, { best: "inline_y" } as unknown as RoleFit)).toBe(false);
    expect(isMoveTe(undefined, undefined)).toBe(false);
  });
});

describe("landingInputsFrom", () => {
  const draft = [
    pick(20, "Alpha Wideout", "Wide Receiver", "Eagles"),
    pick(54, "Move Tight", "Tight End", "Eagles"),
    pick(60, "Block Tight", "Tight End", "Eagles"),
    pick(70, "Lemon Guy", "Wide Receiver", "Eagles"),
    pick(75, "Rival Team WR", "Wide Receiver", "Dolphins"),
    pick(100, "Later Wideout", "Wide Receiver", "Eagles"),
    pick(110, "Eagles Back", "Running Back", "Eagles"),
  ];
  const board = [
    prospect("me", "Lemon Guy", "WR", { draft_round: 3, draft_pick: 70, draft_team: "Eagles" }),
    prospect("mt", "Move Tight", "TE", { draft_round: 2, draft_pick: 54, draft_team: "Eagles", will_play_post: "move" }),
    prospect("bt", "Block Tight", "TE", { draft_round: 2, draft_pick: 60, draft_team: "PHI" }),
  ];
  const fits = new Map<string, RoleFit>([["bt", { best: "inline_y" } as unknown as RoleFit]]);

  it("counts his team's same-position picks ahead of him, and WRs and Move TEs against each other", () => {
    const m = landingInputsFrom(board, draft, fits);
    expect(m.get("me")!.competitors!.map((c) => [c.name, c.moveTe])).toEqual([["Alpha Wideout", false], ["Move Tight", true]]);
    // A Move TE also counts the WRs ahead of him (Alpha Wideout at 20; Lemon Guy at 70 is after him).
    expect(m.get("mt")!.competitors!.map((c) => [c.name, c.position])).toEqual([["Alpha Wideout", "WR"]]);
    // An inline TE counts only the TEs ahead of him, not WRs.
    expect(m.get("bt")!.competitors!.map((c) => c.name)).toEqual(["Move Tight"]);
  });

  it("reads a Move TE prospect from his role bucket when Will Play (Post) is blank", () => {
    const m = landingInputsFrom(
      [prospect("rb", "Block Tight", "TE", { draft_round: 2, draft_pick: 60, draft_team: "Eagles" })],
      draft,
      new Map([["rb", { best: "move" } as unknown as RoleFit]]),
    );
    // The WR at 20 counts because he reads Move; the TE at 54 counts as a TE either way.
    expect(m.get("rb")!.competitors!.map((c) => c.name)).toEqual(["Alpha Wideout", "Move Tight"]);
  });

  it("falls back to earlier rounds without a pick, and counts everyone for an undrafted player", () => {
    const m = landingInputsFrom([
      prospect("r", "Round Only", "WR", { draft_round: 3, draft_team: "Eagles" }),
      prospect("u", "Free Agent", "WR", { draft_round: 8, draft_team: "Eagles" }),
    ], draft, fits);
    expect(m.get("r")!.competitors!.map((c) => c.name)).toEqual(["Alpha Wideout"]);
    expect(m.get("u")!.competitors!.map((c) => c.name)).toEqual(["Alpha Wideout", "Lemon Guy", "Later Wideout"]);
  });

  it("leaves out the 2026 class and undrafted-yet prospects, and says why when it can't tell", () => {
    const m = landingInputsFrom([
      prospect("old", "Lemon Guy", "WR", { draft_class_year: 2026, draft_round: 1, draft_pick: 20, draft_team: "Eagles" }),
      prospect("pre", "Not Yet", "WR"),
      prospect("noteam", "No Team", "WR", { draft_round: 4 }),
      prospect("y28", "Next Year", "WR", { draft_class_year: 2028, draft_round: 1, draft_team: "Bills" }),
    ], draft, fits);
    expect(m.has("old")).toBe(false);
    expect(m.has("pre")).toBe(false);
    expect(m.get("noteam")).toEqual({ competitors: null, note: "no NFL team set", standing: null });
    expect(m.get("y28")!.note).toBe("the 2028 draft results aren't loaded (Post-Draft tab)");
  });
});

describe("landingLines", () => {
  it("lists each teammate ahead with his cost, at the slider weight", () => {
    const d = scoreDynasty({
      pos: "WR", aeScore: 0, rookieAge: null, heightIn: null, weightLb: null, draftRound: 6, draftPick: 190,
      landing: { competitors: [comp(50, { name: "Alpha" }), comp(85, { name: "Tight", position: "TE", moveTe: true })] },
    }, DEFAULT_DYNASTY_WEIGHTS);
    const w = { landing: 1, role: 1 };
    expect(landingLines(d.landing, 2027, w)).toEqual([
      "Rookie competition: Alpha (WR, pick 50, −0.20); Tight (Move TE, pick 85, −0.16) → −0.36",
      "Role standing: no role yet (not enough tape for a role fit) → +0.00",
    ]);
    expect(landingLines(null, 2027, w)).toEqual([]);
    expect(landingLines({ competition: null, standing: null, note: "no NFL team set" }, 2027, w)[0]).toBe("Rookie competition: no NFL team set → +0.00");
    expect(landingLines({ competition: { value: 0, competitors: [] }, standing: null }, 2027, w)[0]).toMatch(/nobody his team drafted ahead of him/);
  });
});
