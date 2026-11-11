// roomPressure: the measured odds a team brings in competition at a position
// (draft picks by window, a veteran it invests in), and the draft-slot odds.

import { describe, it, expect } from "vitest";
import {
  topTenOdds, topTenByTeam, needMultiplier, pickShare, roomPressure, NEED, PICK_SHARE, VETERAN_ADD, SLOT_CENTER,
} from "@/lib/roomPressure";
import { dayOfRound, type OwnedPick, type TeamDraftCapital } from "@/lib/nflDraftPicks";

/** A team's picks: `rounds` lists the round of each pick; originals default to the team itself. */
function capital(teamId: number, rounds: number[], extra: Partial<OwnedPick>[] = []): TeamDraftCapital {
  const picks: OwnedPick[] = rounds.map((round, i) => ({
    year: 2027, round, day: dayOfRound(round), original: teamId, owner: teamId, via: [teamId],
    conditional: false, relabeled: false, resolved: false, trade: null, ...(extra[i] ?? {}),
  }));
  const byRound = Array.from({ length: 7 }, (_, i) => picks.filter((p) => p.round === i + 1).length);
  const byDay: [number, number, number] = [0, 0, 0];
  for (const p of picks) byDay[p.day - 1]++;
  return { teamId, year: 2027, picks, byRound, byDay };
}
/** The usual haul: one pick a round. */
const usual = (teamId = 9) => capital(teamId, [1, 2, 3, 4, 5, 6, 7]);

describe("topTenOdds", () => {
  it("falls with rank and is a coin flip at the center", () => {
    expect(topTenOdds(1, 9)).toBeGreaterThan(topTenOdds(10, 9));
    expect(topTenOdds(10, 9)).toBeGreaterThan(topTenOdds(20, 9));
    expect(topTenOdds(SLOT_CENTER, 9)).toBeCloseTo(0.5, 9);
  });

  it("sharpens as the season runs out (measured: rank 13 is ~37% after 5 games, ~28% after 13)", () => {
    expect(topTenOdds(13, 5)).toBeCloseTo(0.37, 2);
    expect(topTenOdds(13, 13)).toBeCloseTo(0.28, 2);
    expect(topTenOdds(4, 13)).toBeGreaterThan(topTenOdds(4, 5));
    expect(topTenOdds(10, 17)).toBeGreaterThan(0.7);
    expect(topTenOdds(11, 17)).toBeLessThan(0.3);
  });
});

describe("topTenByTeam", () => {
  it("ranks by win percentage, then point differential (worst first)", () => {
    const odds = topTenByTeam([
      { teamId: 1, winPct: 0.5, pointDiff: 0, gamesPlayed: 9 },
      { teamId: 2, winPct: 0.2, pointDiff: -40, gamesPlayed: 9 },
      { teamId: 3, winPct: 0.2, pointDiff: -90, gamesPlayed: 9 },
    ]);
    expect(odds.get(3)).toBeCloseTo(topTenOdds(1, 9), 9);
    expect(odds.get(2)).toBeCloseTo(topTenOdds(2, 9), 9);
    expect(odds.get(1)).toBeCloseTo(topTenOdds(3, 9), 9);
  });
});

describe("needMultiplier", () => {
  it("runs from the full-room rate to the open-room rate, log-linear in the share open", () => {
    expect(needMultiplier("day12", "QB", 0)).toBeCloseTo(NEED.day12[0], 9);
    expect(needMultiplier("day12", "QB", 1)).toBeCloseTo(NEED.day12[1], 9);
    expect(needMultiplier("day12", "WR", 3)).toBeCloseTo(NEED.day12[1], 9);
    const third = needMultiplier("day12", "WR", 1);
    expect(third).toBeCloseTo(NEED.day12[0] ** (2 / 3) * NEED.day12[1] ** (1 / 3), 9);
    expect(needMultiplier("round1", "TE", 5)).toBeCloseTo(NEED.round1[1], 9);
  });
});

describe("pickShare", () => {
  it("blends round 1 by the pick's top-10 odds; QBs go early", () => {
    expect(pickShare("QB", 1, 1)).toBe(PICK_SHARE.QB.R1top);
    expect(pickShare("QB", 1, 0)).toBe(PICK_SHARE.QB.R1);
    expect(pickShare("QB", 1, 0.5)).toBeCloseTo((PICK_SHARE.QB.R1top + PICK_SHARE.QB.R1) / 2, 9);
    expect(pickShare("WR", 4, 1)).toBe(PICK_SHARE.WR.R4);
  });
});

describe("roomPressure", () => {
  it("without picks, gives the veteran odds only", () => {
    const p = roomPressure({ pos: "TE", openSpots: 1, capital: null });
    expect(p).toMatchObject({ round1: null, day12: null, day3: null, picks: null, veteran: VETERAN_ADD.TE[1], any: VETERAN_ADD.TE[1] });
  });

  it("an open room is likelier to draft the position than a full one", () => {
    const open = roomPressure({ pos: "QB", openSpots: 1, capital: usual() });
    const full = roomPressure({ pos: "QB", openSpots: 0, capital: usual() });
    expect(open.day12!).toBeGreaterThan(full.day12!);
    expect(open.round1!).toBeGreaterThan(full.round1!);
    expect(open.veteran).toBeGreaterThan(full.veteran);
  });

  it("matches the formula: one minus the chance no pick in the window takes the position", () => {
    const p = roomPressure({ pos: "WR", openSpots: 2, capital: capital(9, [2, 3, 3, 5]) });
    const m12 = needMultiplier("day12", "WR", 2);
    expect(p.day12!).toBeCloseTo(1 - (1 - PICK_SHARE.WR.R2 * m12) * (1 - PICK_SHARE.WR.R3 * m12) ** 2, 9);
    expect(p.round1).toBe(0);
    expect(p.day3!).toBeCloseTo(PICK_SHARE.WR.R5 * needMultiplier("day3", "WR", 2), 9);
    expect(p.veteran).toBe(VETERAN_ADD.WR[2]);
    expect(p.any).toBeCloseTo(1 - (1 - p.day12!) * (1 - p.veteran), 9);
    expect(p.picks).toEqual([0, 3, 1]);
  });

  it("a likely top-10 pick makes a QB much likelier than a late 1st, by the pick's ORIGINAL team", () => {
    const viaBadTeam = capital(20, [1, 2, 3], [{ original: 11 }]);
    const early = roomPressure({ pos: "QB", openSpots: 1, capital: viaBadTeam, topTenOf: (t) => (t === 11 ? 0.9 : 0.05) });
    const late = roomPressure({ pos: "QB", openSpots: 1, capital: viaBadTeam, topTenOf: (t) => (t === 20 ? 0.9 : 0.05) });
    expect(early.round1!).toBeGreaterThan(late.round1! * 3);
    expect(early.likelyTopTen).toBe(1);
    expect(late.likelyTopTen).toBe(0);
  });

  it("counts conditional picks (a relabeled pick's count is right, so it isn't one)", () => {
    const c = capital(20, [1, 1, 6], [{ conditional: true }, {}, { relabeled: true }]);
    const p = roomPressure({ pos: "RB", openSpots: 0, capital: c });
    expect(p.uncertainPicks).toBe(1);
    expect(p.reasons.join(" ")).toContain("1 of them conditional");
  });

  it("clamps open spots to the room's starting spots", () => {
    expect(roomPressure({ pos: "WR", openSpots: 7, capital: null }).openSpots).toBe(3);
    expect(roomPressure({ pos: "QB", openSpots: -1, capital: null }).openSpots).toBe(0);
  });
});
