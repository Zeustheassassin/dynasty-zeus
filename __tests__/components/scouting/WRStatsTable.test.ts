import { describe, it, expect } from "vitest";
import { buildWRStatRows, WR_STAT_COLS } from "@/components/scouting/stats/WRStatsTable";
import type { ProspectWithStats } from "@/lib/types";
import type { RoleFit } from "@/lib/scouting/roleFit";
import { roleFitCols } from "@/components/scouting/stats/roleFitCols";

// buildWRStatRows reads many fields; only the Lined Up ones matter here.
const wr = (lined_up: ProspectWithStats["lined_up"]) =>
  ({
    id: "w", name: "W", position: "WR", draft_class_year: 2027, lined_up,
    route_stats: {}, coverage_stats: { man: { count: 0 }, zone: { count: 0 }, double: { count: 0 }, press: { count: 0 } },
  }) as unknown as ProspectWithStats;

describe("WR stats: Lined Up (in-app)", () => {
  it("gives each spot's share of his in-app snaps, X on the line and Z off it", () => {
    const [row] = buildWRStatRows([wr({ snaps: 200, slot_on: 4, slot_off: 36, left_on: 70, left_off: 20, right_on: 50, right_off: 16, backfield: 4 })]);
    expect(row.lu_slot).toBe(20);
    expect(row.lu_x).toBe(60);   // 70 + 50 on the line, either side
    expect(row.lu_z).toBe(18);   // 20 + 16 off it
    expect(row.lu_left).toBe(45);
    expect(row.lu_right).toBe(33);
    expect(row.lu_backfield).toBe(2);
    expect(row.lu_snaps).toBe(200);
  });

  it("shows — without in-app snaps", () => {
    const [row] = buildWRStatRows([wr(null)]);
    expect([row.lu_slot, row.lu_x, row.lu_z, row.lu_left, row.lu_right, row.lu_backfield]).toEqual([null, null, null, null, null, null]);
    expect(row.lu_snaps).toBe(0);
  });

  it("sits before the open rates, uncolored, and keeps the open-rate groups distinct", () => {
    const groups = [...new Set(WR_STAT_COLS.map((c) => c.group))];
    expect(groups.indexOf("Lined Up (in-app)")).toBe(groups.indexOf("Open% by Alignment") - 1);
    expect(groups).toContain("Open% On/Off LOS");
    expect(WR_STAT_COLS.filter((c) => c.group === "Lined Up (in-app)").every((c) => c.colorDir == null)).toBe(true);
  });
});

describe("WR stats: Role Fit", () => {
  const match = (role: RoleFit["best"], pct: number, drivers: string[] = []) => ({ role, pct, sizeDrop: 0, sizeNote: null, drivers, proven: true });
  const FIT: RoleFit = {
    pos: "WR", best: "x", also: ["y"], versatile: true, usedAs: "slot", confidence: "medium",
    sample: { n: 150, unit: "routes" }, skillOnly: false, features: {},
    matches: [match("x", 82, ["+ vs press (in-app): +9.0 pts on 40 in-app routes"]), match("y", 79), match("slot", 55), match("gadget", 40)],
  };
  const withFit = (role_fit: RoleFit | null) => ({ ...wr(null), role_fit }) as ProspectWithStats;

  it("shows the best case, every role's match, usage, Versatile and confidence, with the why in each cell's tooltip", () => {
    const [row] = buildWRStatRows([withFit(FIT)]);
    expect(row.role).toBe("X / Y");
    expect([row.role_x, row.role_y, row.role_slot, row.role_gadget]).toEqual([82, 79, 55, 40]);
    expect([row.role_used, row.role_vers, row.role_conf]).toEqual(["Slot", "Yes", "Medium"]);
    expect(row.role_x_tip).toContain("+ vs press (in-app): +9.0 pts on 40 in-app routes");
    expect(row.role_tip).toContain("Best case: X, equally a Y");
  });

  it("is blank under the floor", () => {
    const [row] = buildWRStatRows([withFit(null)]);
    expect([row.role, row.role_x, row.role_used, row.role_vers, row.role_conf]).toEqual([null, null, null, null, null]);
    expect(row.role_tip).toBe("Not enough tape for a role yet");
  });

  it("has no Vers column at RB or QB", () => {
    expect(roleFitCols("RB").map((c) => c.key)).not.toContain("role_vers");
    expect(roleFitCols("QB").map((c) => c.key)).not.toContain("role_vers");
    expect(roleFitCols("TE").map((c) => c.key)).toContain("role_vers");
  });

  it("sits right after Identity, one % column per role", () => {
    const groups = [...new Set(WR_STAT_COLS.map((c) => c.group))];
    expect(groups.slice(0, 2)).toEqual(["Identity", "Role Fit"]);
    expect(WR_STAT_COLS.filter((c) => c.group === "Role Fit").map((c) => c.label)).toEqual(["Role", "X%", "Y%", "Slot%", "Gadget%", "Used as", "Vers", "Conf"]);
  });
});
