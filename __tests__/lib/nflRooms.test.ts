import { describe, it, expect } from "vitest";
import {
  REGULAR_SHARE, buildNflRooms, positionBars, roomPos, snapShares,
  type PffOffenseRow, type PffRosterRow,
} from "@/lib/nflRooms";

const off = (player_id: number, franchise_id: number, position: string, grade: number | null, snaps: number, pass?: number): PffOffenseRow => ({
  player_id, franchise_id, position, grades_offense: grade, grades_pass: pass ?? null, snap_counts_total: snaps,
});
const ros = (playerId: number, name: string, position: string, depthOrder: number, eligibilityYear = 2020, birthDate: string | null = null): PffRosterRow => ({
  playerId, name, position, depthOrder, eligibilityYear, birthDate,
});

describe("roomPos", () => {
  it("reads PFF's codes; HB is a running back, FB isn't a room", () => {
    expect(roomPos("QB")).toBe("QB");
    expect(roomPos("HB")).toBe("RB");
    expect(roomPos("wr")).toBe("WR");
    expect(roomPos("TE")).toBe("TE");
    expect(roomPos("FB")).toBeNull();
    expect(roomPos("T")).toBeNull();
    expect(roomPos(null)).toBeNull();
  });
});

describe("snapShares", () => {
  it("divides each player's snaps by the most any teammate played", () => {
    const m = snapShares([off(1, 9, "T", 70, 1000), off(2, 9, "WR", 80, 400), off(3, 8, "G", 60, 500), off(4, 8, "WR", 60, 500), off(5, 9, "WR", null, 0)]);
    expect(m.get(2)).toBeCloseTo(0.4, 12);
    expect(m.get(4)).toBe(1);
    expect(m.has(5)).toBe(false);
  });
});

describe("positionBars", () => {
  it("takes the bottom and top quarter of each position's regulars, and needs four of them", () => {
    const rows = [off(100, 1, "T", 70, 1000)];
    [50, 60, 70, 80, 90].forEach((g, i) => rows.push(off(i + 1, 1, "WR", g, 600)));
    rows.push(off(20, 1, "WR", 99, 100)); // under REGULAR_SHARE: not a regular
    [70, 75, 80].forEach((g, i) => rows.push(off(30 + i, 1, "TE", g, 600)));
    const bars = positionBars(rows);
    expect(REGULAR_SHARE).toBe(0.4);
    expect(bars.WR).toEqual({ regular: 60, star: 80 });
    expect(bars.TE).toBeNull();
    expect(bars.QB).toBeNull();
  });
});

describe("buildNflRooms", () => {
  const teams = [
    { franchiseId: 24, name: "Philadelphia Eagles" },
    { franchiseId: 16, name: "Kansas City Chiefs" },
    { franchiseId: 99, name: "Nowhere Team" },
  ];
  const offense = [
    off(1, 24, "T", 70, 1000),
    off(2, 24, "WR", 90.5, 880),
    off(3, 16, "T", 70, 1000),
    off(4, 16, "WR", 70, 500),          // moved to the Eagles: brings his Chiefs share along
    off(5, 24, "QB", 80, 950, 82.3),
  ];
  const rosters = new Map<number, PffRosterRow[]>([
    [24, [
      ros(5, "Quarterback One", "QB", 1),
      ros(2, "Wide One", "WR", 2),
      ros(2, "Wide One", "WR", 1),       // listed in two slots: keeps the lower depth
      ros(4, "Free Agent", "WR", 3),
      ros(6, "Rookie Wide", "WR", 4, 2027),
      ros(7, "Full Back", "FB", 1),
      ros(8, "Back One", "HB", 1, 2019, "1999-01-01"),
    ]],
    [16, []],
  ]);
  const passing = [{ teamId: 24, name: "Philadelphia Eagles", isPassOe: -0.013, passPlayPct: 0.66, targetShareWR: 0.6, targetShareTE: 0.2, targetShareRB: 0.2 }];

  it("joins the live depth chart with last season's grades by player id", () => {
    const r = buildNflRooms({ year: 2027, asOf: "2027-05-01T00:00:00.000Z", teams, passing, offense, rosters });
    expect(r.season).toBe(2026);
    expect(r.missing).toEqual([]);
    expect(r.teams.map((t) => [t.teamId, t.name])).toEqual([[21, "Philadelphia Eagles"], [12, "Kansas City Chiefs"]]);
    const phi = r.teams[0];
    expect(phi.passOe).toBe(-0.013);
    expect(phi.targetShare).toEqual({ RB: 0.2, WR: 0.6, TE: 0.2 });
    expect(phi.players.map((p) => [p.name, p.pos, p.depth])).toEqual([
      // By depth, then grade.
      ["Wide One", "WR", 1], ["Quarterback One", "QB", 1], ["Back One", "RB", 1], ["Free Agent", "WR", 3], ["Rookie Wide", "WR", 4],
    ]);
    const byName = new Map(phi.players.map((p) => [p.name, p]));
    expect(byName.get("Quarterback One")).toMatchObject({ grade: 80, passGrade: 82.3, share: 0.95, rookie: false });
    expect(byName.get("Wide One")).toMatchObject({ grade: 90.5, passGrade: null, share: 0.88 });
    expect(byName.get("Free Agent")).toMatchObject({ grade: 70, share: 0.5 });
    expect(byName.get("Rookie Wide")).toMatchObject({ rookie: true, grade: null, share: null });
    expect(byName.get("Back One")).toMatchObject({ birthDate: "1999-01-01", grade: null });
    expect(r.teams[1]).toMatchObject({ passOe: null, players: [] });
  });

  it("lists a team whose depth chart wasn't read as missing", () => {
    const r = buildNflRooms({ year: 2027, asOf: "x", teams, passing, offense, rosters: new Map([[24, []]]) });
    expect(r.missing).toEqual(["Kansas City Chiefs"]);
    expect(r.teams).toHaveLength(1);
  });
});
