import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_ROUTE_VARIANT, ROUTE_VARIANTS, defaultRouteVariant, routeVariantMissing, routeVariantSpec, routeVariantsFor, splitByRouteVariant,
  type RouteVariant,
} from "@/lib/scouting/routeVariants";
import { ROUTE_TYPES } from "@/components/scouting/shared/chartingConstants";
import type { RouteType } from "@/lib/types";

describe("route sub-routes", () => {
  it("breaks every route bucket down, in the user's order", () => {
    const labels = (rt: RouteType) => routeVariantsFor(rt, "WR").map((v) => v.label);
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
    expect(labels("nine")).toEqual(["Nine", "Back Shoulder Fade", "Seam Route", "Love of the Game", "Sluggo", "Stop and Go", "Out and Up"]);
    expect(labels("other")).toEqual(["Option", "Texas", "Wheel", "Block and Release", "Zig"]);
    // Every other bucket is the same on every board.
    for (const rt of ROUTE_TYPES.filter((r) => r !== "other")) {
      for (const board of ["TE", "QB", "RB"] as const) expect(routeVariantsFor(rt, board)).toEqual(routeVariantsFor(rt, "WR"));
    }
    for (const rt of ROUTE_TYPES) {
      const keys = ROUTE_VARIANTS[rt].map((v) => v.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("offers Scramble Drill under Other on the QB board only", () => {
    const keys = (board: "WR" | "TE" | "QB" | "RB") => routeVariantsFor("other", board).map((v) => v.key);
    expect(keys("QB")).toEqual(["option", "texas", "wheel", "block_release", "zig", "called_scramble_drill"]);
    expect(keys("WR")).not.toContain("called_scramble_drill");
    expect(keys("TE")).toEqual(keys("WR"));
    expect(keys("RB")).toEqual(keys("WR"));
    expect(routeVariantSpec("other", "called_scramble_drill")).toMatchObject({ label: "Scramble Drill", short: "Scramble Drill", boards: ["QB"] });
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

  it("matches the database's sub-route list (route_variant_options, 074 on) pair for pair", () => {
    // Every migration's INSERT INTO and DELETE FROM route_variant_options, in
    // order, so a sub-route added (or moved, like Out and Up in 095) later in
    // its own migration is read too.
    const dir = join(process.cwd(), "supabase/migrations");
    const fromSql = new Set<string>();
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = readFileSync(join(dir, f), "utf8");
      for (const st of sql.matchAll(/(INSERT INTO|DELETE FROM) public\.route_variant_options[^;]*;/g)) {
        if (st[1] === "INSERT INTO") {
          for (const m of st[0].matchAll(/\('(\w+)',\s*'(\w+)'\)/g)) fromSql.add(`${m[1]}|${m[2]}`);
        } else {
          const m = st[0].match(/WHERE route_type = '(\w+)' AND route_variant = '(\w+)'/);
          expect(m, `${f}: a DELETE names its one pair first`).not.toBeNull();
          fromSql.delete(`${m![1]}|${m![2]}`);
        }
      }
    }
    const fromCode = new Set(ROUTE_TYPES.flatMap((rt) => ROUTE_VARIANTS[rt].map((v) => `${rt}|${v.key}`)));
    expect([...fromSql].sort()).toEqual([...fromCode].sort());
    expect(fromSql.has("other|zig")).toBe(true);
    expect(fromSql.has("other|called_scramble_drill")).toBe(true);
    expect(fromSql.has("nine|out_and_up")).toBe(true);
    expect(fromSql.has("other|out_and_up")).toBe(false);
  });

  it("moves Out and Up to Nine in 095: the plays first, then the one guarded delete", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/095_out_and_up_to_nine.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    // Each play table's Out and Ups move, and only those (no other column changes).
    for (const [tbl, col] of [["route_plays", "route_type"], ["te_plays", "route_type"], ["qb_plays", "route_type"], ["rb_plays", "route_detail"]]) {
      expect(code).toMatch(new RegExp(`UPDATE public\\.${tbl}\\s+SET ${col}\\s+= 'nine' WHERE ${col}\\s+= 'other' AND route_variant = 'out_and_up';`));
    }
    expect(code.match(/\bUPDATE\b/g)).toHaveLength(4);
    // The one DELETE: one list row, after the moves, only once no play on any table uses it.
    expect(code.match(/\bDELETE\b/g)).toHaveLength(1);
    expect(code.indexOf("INSERT INTO public.route_variant_options")).toBeLessThan(code.indexOf("UPDATE"));
    expect(code.lastIndexOf("UPDATE")).toBeLessThan(code.indexOf("DELETE"));
    const del = code.slice(code.indexOf("DELETE"), code.indexOf(";", code.indexOf("DELETE")));
    for (const tbl of ["route_plays", "te_plays", "qb_plays", "rb_plays"]) expect(del).toContain(`NOT EXISTS (SELECT 1 FROM public.${tbl} `);
  });

  it("drops only 073's two CHECKs in 074, after each table's foreign key is on", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/074_route_variant_options.sql"), "utf8");
    // Comments aside, the one DROP is the approved one (the user, 2026-10-22).
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code.match(/\bDROP\b/g)).toHaveLength(1);
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS %I', tbl, tbl \|\| '_route_variant_check'/);
    expect(code.indexOf("_route_variant_fkey' AND conrelid")).toBeLessThan(code.indexOf("DROP CONSTRAINT"));
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE)\b/);
  });
});
