import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRESSURE_HANDLINGS } from "@/components/scouting/qb/qbConstants";

describe("QB pressure handling", () => {
  it("offers Backpedal as the 4th answer (the user, 2026-10-22)", () => {
    expect(PRESSURE_HANDLINGS.map((h) => h.label)).toEqual(["Step Up", "Bail Front Side", "Bail Backside", "Backpedal"]);
  });

  it("matches migration 076's check, and drops only 032's old one after it", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/076_qb_backpedal_sense_pressure.sql"), "utf8");
    const m = sql.match(/pressure_handling IN \(([^)]*)\)/);
    expect([...(m?.[1] ?? "").matchAll(/'(\w+)'/g)].map((x) => x[1])).toEqual(PRESSURE_HANDLINGS.map((h) => h.key));
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code.match(/\bDROP\b/g)).toHaveLength(1);
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS qb_plays_pressure_handling_check;/);
    expect(code.indexOf("ADD CONSTRAINT qb_plays_pressure_handling_values")).toBeLessThan(code.indexOf("DROP CONSTRAINT"));
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE)\b/);
  });
});
