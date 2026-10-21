import { describe, it, expect } from "vitest";
import { ROUTE_COVERAGE_PATTERN, routeCoverageOffset } from "@/lib/scouting/routeCoveragePattern";
import { ROUTE_TYPES } from "@/components/scouting/shared/chartingConstants";

describe("routeCoveragePattern", () => {
  it("reads WR's route × coverage shape: a nine plays easier against press, a curl harder", () => {
    expect(routeCoverageOffset("nine", "press")).toBeGreaterThan(routeCoverageOffset("nine", "zone"));
    expect(routeCoverageOffset("curl", "press")).toBeLessThan(routeCoverageOffset("curl", "zone"));
  });

  it("adds nothing when the route or coverage is missing, or the pair had too few WR routes", () => {
    expect(routeCoverageOffset(null, "man")).toBe(0);
    expect(routeCoverageOffset("nine", null)).toBe(0);
    expect(routeCoverageOffset("nine", "double")).toBe(0);
    expect(routeCoverageOffset("flat", "press")).toBe(0);
  });

  it("only names charted routes and coverages, with small log-odds", () => {
    for (const [route, row] of Object.entries(ROUTE_COVERAGE_PATTERN)) {
      expect(ROUTE_TYPES).toContain(route);
      for (const [cov, v] of Object.entries(row)) {
        expect(["man", "press", "zone", "double"]).toContain(cov);
        expect(Math.abs(v!)).toBeLessThan(1);
      }
    }
  });
});
