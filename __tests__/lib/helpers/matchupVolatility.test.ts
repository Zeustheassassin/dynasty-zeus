import { describe, it, expect } from "vitest";
import {
  getOpponentProjectedScore,
  getLineupRange,
  getMatchupLean,
  NEUTRAL_MATCHUP_MARGIN,
} from "@/lib/helpers/matchupVolatility";
import type { ProjectionRow, SleeperMatchup } from "@/lib/types";

const HOUR = 60 * 60 * 1000;

const mkRow = (sleeperId: string, fpts: number, sourceFpts: Record<string, number> | null = null): ProjectionRow => ({
  sleeperId,
  full_name: `Player ${sleeperId}`,
  position: "WR",
  team: "SF",
  fpts,
  sources: sourceFpts ? Object.keys(sourceFpts) : ["sleeper"],
  kickoffAt: null,
  stats: null,
  sourceFpts,
});

const mkMatchup = (over: Partial<SleeperMatchup>): SleeperMatchup => ({
  matchup_id: 1,
  roster_id: 2,
  points: 0,
  custom_points: null,
  starters: [],
  players: [],
  starters_points: [],
  players_points: {},
  ...over,
});

// ── getOpponentProjectedScore ────────────────────────────────────────────

describe("getOpponentProjectedScore", () => {
  it("returns 0 for a null matchup", () => {
    expect(getOpponentProjectedScore(null, new Map())).toBe(0);
  });

  it("sums each upcoming starter's own projection", () => {
    const proj = new Map([
      ["1", mkRow("1", 18.5)],
      ["2", mkRow("2", 12.2)],
    ]);
    const matchup = mkMatchup({ starters: ["1", "2"], players_points: {} });
    expect(getOpponentProjectedScore(matchup, proj)).toBeCloseTo(30.7, 5);
  });

  it("uses actual + remaining for a live player (remaining floored at 0)", () => {
    const live = mkRow("1", 20);
    live.kickoffAt = Date.now() - 2 * HOUR; // kicked off 2h ago, within the 6h "Live" window
    const proj = new Map([["1", live]]);
    const matchup = mkMatchup({ starters: ["1"], players_points: { "1": 15 } });
    // 15 already scored + max(20-15, 0) remaining = 20
    expect(getOpponentProjectedScore(matchup, proj)).toBeCloseTo(20, 5);
  });

  it("caps remaining at 0 when a live player has already exceeded their projection", () => {
    const live = mkRow("1", 10);
    live.kickoffAt = Date.now() - 1 * HOUR;
    const proj = new Map([["1", live]]);
    const matchup = mkMatchup({ starters: ["1"], players_points: { "1": 25 } });
    expect(getOpponentProjectedScore(matchup, proj)).toBeCloseTo(25, 5);
  });

  it("uses only the actual score for a finished game (no remaining)", () => {
    const done = mkRow("1", 20);
    done.kickoffAt = Date.now() - 7 * HOUR; // outside the 6h "Live" window -> Final
    const proj = new Map([["1", done]]);
    const matchup = mkMatchup({ starters: ["1"], players_points: { "1": 14 } });
    expect(getOpponentProjectedScore(matchup, proj)).toBeCloseTo(14, 5);
  });

  it("ignores empty/'0' starter slots", () => {
    const proj = new Map([["1", mkRow("1", 10)]]);
    const matchup = mkMatchup({ starters: ["1", "0", ""] });
    expect(getOpponentProjectedScore(matchup, proj)).toBeCloseTo(10, 5);
  });
});

// ── getLineupRange ────────────────────────────────────────────────────────

describe("getLineupRange", () => {
  it("skips null rows", () => {
    expect(getLineupRange([null, null])).toEqual({ consensus: 0, floor: 0, ceiling: 0 });
  });

  it("falls back to fpts for floor/ceiling when a player lacks 3+ source values", () => {
    const row = mkRow("1", 15, { sleeper: 15, espn: 14 }); // only 2 sources
    expect(getLineupRange([row])).toEqual({ consensus: 15, floor: 15, ceiling: 15 });
  });

  it("sums real floor/ceiling across a lineup with mixed volatility", () => {
    const tight = mkRow("1", 17.675, { fantasypros: 17.8, numberfire: 17.3, espn: 17.5, sleeper: 18.1 });
    const wide = mkRow("2", 17.325, { fantasypros: 12.8, numberfire: 20.6, espn: 17.5, sleeper: 18.4 });
    const range = getLineupRange([tight, wide]);
    expect(range.consensus).toBeCloseTo(35, 3);
    expect(range.floor).toBeCloseTo(17.3 + 12.8, 5);
    expect(range.ceiling).toBeCloseTo(18.1 + 20.6, 5);
  });
});

// ── getMatchupLean ────────────────────────────────────────────────────────

describe("getMatchupLean", () => {
  it("reads as favored when comfortably ahead", () => {
    expect(NEUTRAL_MATCHUP_MARGIN).toBe(3);
    const r = getMatchupLean(168, 142);
    expect(r.margin).toBe(26);
    expect(r.lean).toBe("favored");
  });

  it("reads as underdog when comfortably behind", () => {
    const r = getMatchupLean(142, 168);
    expect(r.margin).toBe(-26);
    expect(r.lean).toBe("underdog");
  });

  it("reads as neutral inside the margin threshold", () => {
    expect(getMatchupLean(150, 148.5).lean).toBe("neutral"); // margin 1.5
    expect(getMatchupLean(148.5, 150).lean).toBe("neutral");
  });

  it("is favored/underdog exactly at the boundary (>= threshold, strictly)", () => {
    // margin exactly NEUTRAL_MATCHUP_MARGIN (3) is NOT < threshold -> not neutral.
    expect(getMatchupLean(103, 100).lean).toBe("favored");
    expect(getMatchupLean(100, 103).lean).toBe("underdog");
    // margin just under the threshold is neutral.
    expect(getMatchupLean(102.9, 100).lean).toBe("neutral");
  });
});
