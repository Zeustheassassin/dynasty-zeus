import { describe, it, expect } from "vitest";
import {
  getLeaguePositionalBaseline,
  getRosterPositionalStrength,
} from "@/lib/helpers/direction/baseline";

const rosters = [
  { roster_id: 1, players: ["p1", "p2"] }, // QB 100, RB 50
  { roster_id: 2, players: ["p3"] },       // QB 300
  { roster_id: 3, players: ["p4"] },       // RB 200
];

const players: Record<string, { position: string }> = {
  p1: { position: "QB" },
  p2: { position: "RB" },
  p3: { position: "QB" },
  p4: { position: "RB" },
};

const values: Record<string, number> = { p1: 100, p2: 50, p3: 300, p4: 200 };
const dynastyValueForPlayer = (id: string) => values[id] ?? 0;

describe("getLeaguePositionalBaseline", () => {
  it("sums each roster's value per position", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    const qb = baseline.find((b) => b.pos === "QB")!;
    expect(qb.rosterTotals).toEqual([
      { roster_id: 1, total: 100 },
      { roster_id: 2, total: 300 },
      { roster_id: 3, total: 0 },
    ]);
  });

  it("computes league average and max per position", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    const qb = baseline.find((b) => b.pos === "QB")!;
    // average() rounds to 1 decimal place
    expect(qb.leagueAvg).toBeCloseTo((100 + 300 + 0) / 3, 1);
    expect(qb.leagueMax).toBe(300);
  });

  it("defaults to QB/RB/WR/TE and returns zeroed entries for positions with no players", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    expect(baseline.map((b) => b.pos)).toEqual(["QB", "RB", "WR", "TE"]);
    const wr = baseline.find((b) => b.pos === "WR")!;
    expect(wr.leagueAvg).toBe(0);
    expect(wr.leagueMax).toBe(0);
  });

  it("respects a custom positions list", () => {
    const baseline = getLeaguePositionalBaseline({
      rosters,
      players,
      dynastyValueForPlayer,
      positions: ["QB"],
    });
    expect(baseline).toHaveLength(1);
    expect(baseline[0].pos).toBe("QB");
  });

  it("returns empty rosterTotals for an empty league", () => {
    const baseline = getLeaguePositionalBaseline({
      rosters: [],
      players: {},
      dynastyValueForPlayer,
    });
    expect(baseline.every((b) => b.rosterTotals.length === 0 && b.leagueAvg === 0 && b.leagueMax === 0)).toBe(true);
  });
});

describe("getRosterPositionalStrength", () => {
  it("slices one roster's row with rank and pctOfAvg", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    const strength = getRosterPositionalStrength(2, baseline);
    const qb = strength.find((s) => s.pos === "QB")!;
    expect(qb.total).toBe(300);
    expect(qb.rank).toBe(1); // roster 2 has the highest QB total
    expect(qb.pctOfAvg).toBe(Math.round((300 / ((100 + 300) / 3)) * 100));
  });

  it("returns total 0 and pctOfAvg 0 for a roster missing from the baseline", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    const strength = getRosterPositionalStrength(999, baseline);
    expect(strength.every((s) => s.total === 0)).toBe(true);
    expect(strength.every((s) => s.pctOfAvg === 0)).toBe(true);
  });

  it("returns pctOfAvg 0 when leagueAvg is 0 (avoids division by zero)", () => {
    const baseline = getLeaguePositionalBaseline({ rosters, players, dynastyValueForPlayer });
    const strength = getRosterPositionalStrength(1, baseline);
    const wr = strength.find((s) => s.pos === "WR")!;
    expect(wr.leagueAvg).toBe(0);
    expect(wr.pctOfAvg).toBe(0);
  });
});
