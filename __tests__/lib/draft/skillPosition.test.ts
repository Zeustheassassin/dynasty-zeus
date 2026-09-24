import { describe, it, expect } from "vitest";
import {
  SKILL_POSITIONS,
  isSkillPosition,
  countsAsSkillPlayer,
  displayPosition,
} from "@/lib/draft/skillPosition";

describe("isSkillPosition", () => {
  it("accepts exactly QB / RB / WR / TE", () => {
    expect(SKILL_POSITIONS).toEqual(["QB", "RB", "WR", "TE"]);
    for (const pos of SKILL_POSITIONS) expect(isSkillPosition(pos)).toBe(true);
  });

  it("rejects fullbacks, kickers, defenses and defenders", () => {
    for (const pos of ["FB", "K", "DEF", "DL", "DB", "LB", "CB", "S", "OT", "OL"]) {
      expect(isSkillPosition(pos), pos).toBe(false);
    }
  });

  it("rejects empty and nullish positions rather than throwing", () => {
    expect(isSkillPosition("")).toBe(false);
    expect(isSkillPosition(null)).toBe(false);
    expect(isSkillPosition(undefined)).toBe(false);
  });
});

describe("countsAsSkillPlayer", () => {
  it("admits an ordinary skill player off the compiled position alone", () => {
    expect(countsAsSkillPlayer({ compiled: "WR" })).toBe(true);
    expect(countsAsSkillPlayer({ compiled: "QB", current: "QB", fantasyPositions: ["QB"] })).toBe(true);
  });

  it("admits Travis Hunter, who Sleeper lists as a DB with WR eligibility", () => {
    // The real shape from Sleeper's player map for id 12530.
    const hunter = { current: "DB", fantasyPositions: ["DB", "WR"] };
    // Via his compiled 2025 pick metadata, which says WR:
    expect(countsAsSkillPlayer({ ...hunter, compiled: "WR" })).toBe(true);
    // And still admitted if a recompile ever falls back to the player map:
    expect(countsAsSkillPlayer({ ...hunter, compiled: "DB" })).toBe(true);
    expect(countsAsSkillPlayer(hunter)).toBe(true);
  });

  it("admits a player reclassified to a skill position since the board was compiled", () => {
    // Sione Vaki: compiled as DB in 2024, an RB in Sleeper today.
    expect(countsAsSkillPlayer({
      compiled: "DB", current: "RB", fantasyPositions: ["RB"],
    })).toBe(true);
  });

  it("keeps fullbacks off the board despite their RB eligibility", () => {
    // Every FB in Sleeper's map is position FB with fantasy_positions ["RB"] —
    // a SINGLE entry. Dropping the length check would readmit all 112 of them.
    expect(countsAsSkillPlayer({
      compiled: "FB", current: "FB", fantasyPositions: ["RB"],
    })).toBe(false);
  });

  it("does not admit a single-eligibility conversion (one entry is not dual)", () => {
    // Brandon Williams: CB with fantasy_positions ["TE"] and nothing else.
    expect(countsAsSkillPlayer({ current: "CB", fantasyPositions: ["TE"] })).toBe(false);
  });

  it("rejects real defenders, kickers and defenses", () => {
    expect(countsAsSkillPlayer({ compiled: "DB", current: "DB", fantasyPositions: ["DB"] })).toBe(false);
    expect(countsAsSkillPlayer({ compiled: "LB", current: "LB", fantasyPositions: ["DL", "LB"] })).toBe(false);
    expect(countsAsSkillPlayer({ compiled: "K",  current: "K",  fantasyPositions: ["K"] })).toBe(false);
    expect(countsAsSkillPlayer({ compiled: "DEF" })).toBe(false);
  });

  it("rejects linemen whose multi-eligibility is all non-skill", () => {
    expect(countsAsSkillPlayer({ current: "OT", fantasyPositions: ["OL", "OT"] })).toBe(false);
  });

  it("handles a player the Sleeper map has never heard of", () => {
    expect(countsAsSkillPlayer({ compiled: "WR", current: undefined, fantasyPositions: undefined })).toBe(true);
    expect(countsAsSkillPlayer({ compiled: "DB", current: undefined, fantasyPositions: undefined })).toBe(false);
    expect(countsAsSkillPlayer({})).toBe(false);
  });

  it("tolerates null fields from a sparse cache row", () => {
    expect(countsAsSkillPlayer({ compiled: null, current: null, fantasyPositions: null })).toBe(false);
    expect(countsAsSkillPlayer({ compiled: "", current: "TE", fantasyPositions: [] })).toBe(true);
  });
});

describe("displayPosition", () => {
  it("prefers the compiled position when it is already a skill position", () => {
    expect(displayPosition({ compiled: "WR", current: "DB", fantasyPositions: ["DB", "WR"] })).toBe("WR");
  });

  it("falls forward to the current position for a reclassified player", () => {
    // Sione Vaki reads as RB, not the "DB" frozen into his 2024 pick metadata.
    expect(displayPosition({ compiled: "DB", current: "RB", fantasyPositions: ["RB"] })).toBe("RB");
  });

  it("falls through to the skill half of a dual eligibility", () => {
    expect(displayPosition({ compiled: "DB", current: "DB", fantasyPositions: ["DB", "WR"] })).toBe("WR");
  });

  it("keeps whatever label exists when nothing is a skill position", () => {
    expect(displayPosition({ compiled: "K", current: "K" })).toBe("K");
    expect(displayPosition({ compiled: "", current: "LB" })).toBe("LB");
    expect(displayPosition({})).toBe("");
  });

  it("never returns a non-skill label for a player it admits", () => {
    const admitted = [
      { compiled: "WR", current: "DB", fantasyPositions: ["DB", "WR"] },
      { compiled: "DB", current: "DB", fantasyPositions: ["DB", "WR"] },
      { compiled: "DB", current: "RB", fantasyPositions: ["RB"] },
      { compiled: "TE" },
    ];
    for (const sources of admitted) {
      expect(countsAsSkillPlayer(sources)).toBe(true);
      expect(isSkillPosition(displayPosition(sources)), JSON.stringify(sources)).toBe(true);
    }
  });
});
