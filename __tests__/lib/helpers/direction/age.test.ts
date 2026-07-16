import { describe, it, expect } from "vitest";
import { getRosterAgeCurve } from "@/lib/helpers/direction/age";

const players: Record<string, { full_name: string; position: string; age?: number | null }> = {
  p1: { full_name: "Young QB", position: "QB", age: 24 },
  p2: { full_name: "Old RB", position: "RB", age: 30 },
  p3: { full_name: "No Age WR", position: "WR", age: null },
  p4: { full_name: "Kicker", position: "K", age: 27 },
  p5: { full_name: "Zero Age TE", position: "TE", age: 0 },
};

const values: Record<string, number> = { p1: 900, p2: 300, p3: 500, p4: 100, p5: 200 };
const dynastyValueForPlayer = (id: string) => values[id] ?? 0;

describe("getRosterAgeCurve", () => {
  it("returns one point per skill-position player with a valid age", () => {
    const points = getRosterAgeCurve({
      roster: { players: ["p1", "p2", "p3", "p4", "p5"] },
      players,
      dynastyValueForPlayer,
    });
    expect(points).toEqual([
      { player_id: "p1", full_name: "Young QB", pos: "QB", age: 24, value: 900 },
      { player_id: "p2", full_name: "Old RB", pos: "RB", age: 30, value: 300 },
    ]);
  });

  it("excludes players missing from the players map", () => {
    const points = getRosterAgeCurve({
      roster: { players: ["ghost"] },
      players,
      dynastyValueForPlayer,
    });
    expect(points).toEqual([]);
  });

  it("respects a custom positions list", () => {
    const points = getRosterAgeCurve({
      roster: { players: ["p1", "p2"] },
      players,
      dynastyValueForPlayer,
      positions: ["RB"],
    });
    expect(points.map((p) => p.player_id)).toEqual(["p2"]);
  });

  it("returns an empty array for a null/undefined roster", () => {
    expect(getRosterAgeCurve({ roster: null, players, dynastyValueForPlayer })).toEqual([]);
    expect(getRosterAgeCurve({ roster: undefined, players, dynastyValueForPlayer })).toEqual([]);
  });
});
