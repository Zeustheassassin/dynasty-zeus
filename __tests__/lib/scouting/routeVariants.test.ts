import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ROUTE_VARIANT, ROUTE_VARIANTS, defaultRouteVariant, routeVariantMissing, routeVariantSpec, splitByRouteVariant,
  type RouteVariant,
} from "@/lib/scouting/routeVariants";
import { ROUTE_TYPES } from "@/components/scouting/shared/chartingConstants";
import type { RouteType } from "@/lib/types";

describe("route sub-routes", () => {
  it("breaks every route bucket down, in the user's order", () => {
    const labels = (rt: RouteType) => ROUTE_VARIANTS[rt].map((v) => v.label);
    expect(Object.keys(ROUTE_VARIANTS).sort()).toEqual([...ROUTE_TYPES].sort());
    expect(labels("screen")).toEqual(["WR Screen", "Bubble Screen", "Interior Screen"]);
    expect(labels("flat")).toEqual(["True Flat", "Quick Out"]);
    expect(labels("slant")).toEqual(["Drag", "Slant Stop", "True Slant", "Deep Slant"]);
    expect(labels("comeback")).toEqual(["Short", "Intermediate", "Deep"]);
    expect(labels("curl")).toEqual(["Short", "Intermediate", "Deep"]);
    expect(labels("out")).toEqual(["Intermediate", "Deep"]);
    expect(labels("dig")).toEqual(["Short", "Intermediate", "Deep", "Post Dig"]);
    expect(labels("corner")).toEqual(["Short", "Intermediate", "Deep"]);
    expect(labels("post")).toEqual(["Short", "Intermediate", "Deep", "Post Sit"]);
    expect(labels("nine")).toEqual(["Nine", "Back Shoulder Fade", "Seam Route", "Love of the Game", "Sluggo", "Stop and Go"]);
    expect(labels("other")).toEqual(["Option", "Texas", "Wheel", "Block and Release", "Out and Up"]);
    for (const rt of ROUTE_TYPES) {
      const keys = ROUTE_VARIANTS[rt].map((v) => v.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("starts each route on the user's default (Other on none), and every default is one of its sub-routes", () => {
    expect(DEFAULT_ROUTE_VARIANT).toEqual({
      screen: "wr_screen", flat: "true_flat", slant: "true_slant", comeback: "intermediate", curl: "short",
      out: "intermediate", dig: "intermediate", corner: "intermediate", post: "intermediate", nine: "nine", other: null,
    });
    for (const rt of ROUTE_TYPES) {
      const d = defaultRouteVariant(rt);
      if (d) expect(routeVariantSpec(rt, d)).not.toBeNull();
    }
    expect(defaultRouteVariant(null)).toBeNull();
  });

  it("labels the depths with PFF's bands", () => {
    const yards = Object.fromEntries(ROUTE_VARIANTS.curl.map((v) => [v.key, v.yards]));
    expect(yards).toEqual({ short: "0–9", intermediate: "10–19", deep: "20+" });
    expect(routeVariantSpec("dig", "post_dig")?.yards).toBeUndefined();
  });

  it("needs a pick only while the sub-route is empty or not the route's, never on an old route left as is", () => {
    expect(routeVariantMissing("other", null, false)).toBe(true);
    expect(routeVariantMissing("other", "texas", false)).toBe(false);
    expect(routeVariantMissing("curl", "short", false)).toBe(false);
    expect(routeVariantMissing("curl", "post_dig", false)).toBe(true);
    expect(routeVariantMissing("curl", null, true)).toBe(false);
    expect(routeVariantMissing("other", null, true)).toBe(false);
    expect(routeVariantMissing(null, null, false)).toBe(false);
  });

  it("splits one route's plays by sub-route in button order, with the old routes apart", () => {
    const plays: { id: number; route_variant?: RouteVariant | null }[] = [
      { id: 1, route_variant: "deep" }, { id: 2, route_variant: null }, { id: 3, route_variant: "short" },
      { id: 4 }, { id: 5, route_variant: "deep" },
    ];
    const { splits, unsplit } = splitByRouteVariant("curl", plays);
    expect(splits.map((s) => [s.spec.key, s.plays.map((p) => p.id)])).toEqual([["short", [3]], ["deep", [1, 5]]]);
    expect(unsplit.map((p) => p.id)).toEqual([2, 4]);
    expect(splitByRouteVariant("curl", [{ route_variant: null }]).splits).toEqual([]);
  });

  it("matches migration 073's CHECK pair for pair", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/073_route_variants.sql"), "utf8");
    const fromSql: Record<string, string[]> = {};
    for (const m of sql.matchAll(/WHEN ''(\w+)''\s+THEN route_variant IN \(([^)]*)\)/g)) {
      fromSql[m[1]] = [...m[2].matchAll(/''(\w+)''/g)].map((k) => k[1]);
    }
    const fromCode = Object.fromEntries(ROUTE_TYPES.map((rt) => [rt, ROUTE_VARIANTS[rt].map((v) => v.key)]));
    expect(fromSql).toEqual(fromCode);
  });
});
