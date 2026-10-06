import { describe, it, expect } from "vitest";
import { productionPage, PRODUCTION_MIN_GAMES } from "@/components/scouting/overview/production";
import { pffCols } from "@/components/scouting/stats/pffCols";

// The Production tab lays out the Analysis tables' PFF columns (pffCols.ts) for
// one prospect: same values, same tooltips, grouped the same way.
describe("productionPage", () => {
  const pff = { pff_g: 6, pff_gr_off: 78.4, pff_gr_route: 81.2, pff_routes: 194, pff_tprr: 21.6, pff_drop_pct: 6.1, pff_radot: 9.4 };
  const page = productionPage("TE", pff);
  const stat = (key: string) => page.main.flatMap((s) => s.stats).find((s) => s.key === key);

  it("groups the position's PFF columns as the Analysis table does, without the PFF prefix", () => {
    const groups = [...new Set(pffCols("TE").map((c) => c.group.replace(/^PFF /, "")))];
    expect(page.main.map((s) => s.title)).toEqual(groups);
    expect(page.main.every((s) => !s.title!.startsWith("PFF"))).toBe(true);
  });

  it("carries each column's value, format, direction and tooltip", () => {
    expect(stat("pff_routes")).toMatchObject({ value: 194, fmt: "int", dir: 0 });
    expect(stat("pff_tprr")).toMatchObject({ value: 21.6, fmt: "pct1", dir: 1 });
    expect(stat("pff_drop_pct")).toMatchObject({ dir: -1 });
    expect(stat("pff_radot")).toMatchObject({ dir: 0, fmt: "dec1" });
    expect(stat("pff_tprr")!.tooltip).toBe(pffCols("TE").find((c) => c.key === "pff_tprr")!.tooltip);
    expect(stat("pff_rectd")).toMatchObject({ value: null });
  });

  it("spells out the grade names, leaves the games count to the header, and ranks only with enough games", () => {
    expect(stat("pff_gr_off")!.label).toBe("Offense");
    expect(stat("pff_gr_route")!.label).toBe("Route running");
    expect(stat("pff_g")).toBeUndefined();
    expect(page.meta).toEqual(["6 games"]);
    expect(stat("pff_tprr")).toMatchObject({ n: 6, minN: PRODUCTION_MIN_GAMES });
  });

  it("is empty-headed with no PFF stats", () => {
    expect(productionPage("QB", {}).meta).toEqual([]);
  });
});
