import { describe, it, expect } from "vitest";
import { buildWRStatRows, WR_STAT_COLS } from "@/components/scouting/stats/WRStatsTable";
import type { ProspectWithStats } from "@/lib/types";

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
