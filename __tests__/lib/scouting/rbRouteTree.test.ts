import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RB_BACKFIELD_ROUTES, rbBucketFor, rbRouteOffered } from "@/lib/scouting/rbRouteTree";
import { ROUTE_VARIANTS, routeVariantsFor } from "@/lib/scouting/routeVariants";
import { ROUTE_TYPES } from "@/components/scouting/shared/chartingConstants";

describe("RB route tree (the user, 2026-10-23)", () => {
  it("offers Screen / Flat / Curl / Other from the backfield and every route split out wide", () => {
    expect(RB_BACKFIELD_ROUTES).toEqual(["screen", "flat", "curl", "other"]);
    for (const rt of ROUTE_TYPES) {
      expect(rbRouteOffered(rt, true)).toBe(true);
      expect(rbRouteOffered(rt, false)).toBe(RB_BACKFIELD_ROUTES.includes(rt));
    }
  });

  it("uses the WR / TE sub-routes, without the QB-only Scramble Drill", () => {
    for (const rt of ROUTE_TYPES) expect(routeVariantsFor(rt, "RB")).toEqual(routeVariantsFor(rt, "WR"));
    expect(routeVariantsFor("other", "RB").map((v) => v.key)).not.toContain("called_scramble_drill");
  });

  it("saves each tree route under the user's RB bucket", () => {
    for (const v of ROUTE_VARIANTS.screen) expect(rbBucketFor("screen", v.key)).toBe("mid_curl");
    for (const v of ROUTE_VARIANTS.curl) expect(rbBucketFor("curl", v.key)).toBe("mid_curl");
    for (const v of ROUTE_VARIANTS.flat) expect(rbBucketFor("flat", v.key)).toBe("flats");
    expect(rbBucketFor("other", "option")).toBe("flats");
    expect(rbBucketFor("other", "block_release")).toBe("flats");
    for (const v of ["texas", "wheel", "out_and_up", "zig"] as const) expect(rbBucketFor("other", v)).toBe("big_boy_route");
    // Split out wide, every other route is the hard bucket, whatever its sub-route.
    for (const rt of ["nine", "post", "dig", "slant", "comeback", "out", "corner"] as const) {
      for (const v of ROUTE_VARIANTS[rt]) expect(rbBucketFor(rt, v.key)).toBe("big_boy_route");
    }
  });
});

describe("migration 077", () => {
  const sql = readFileSync(join(process.cwd(), "supabase/migrations/077_rb_route_tree.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

  it("only adds: no DROP, DELETE, TRUNCATE or UPDATE", () => {
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/);
  });

  it("allows the 11 routes, on route plays only, with sub-routes from the shared list", () => {
    const check = code.match(/route_detail IN \(([^)]*)\)/)?.[1] ?? "";
    expect([...check.matchAll(/'(\w+)'/g)].map((m) => m[1]).sort()).toEqual([...ROUTE_TYPES].sort());
    expect(code).toMatch(/CHECK \(route_detail IS NULL OR run_type = 'route'\)/);
    expect(code).toMatch(/FOREIGN KEY \(route_detail, route_variant\) REFERENCES public\.route_variant_options \(route_type, route_variant\)/);
    expect(code).toMatch(/CHECK \(route_variant IS NULL OR route_detail IS NOT NULL\)/);
  });
});
