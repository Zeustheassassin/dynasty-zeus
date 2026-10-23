import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countPlayEras, gameSource, isTaggedPlay, playEra, POSITION_TAGS, SITUATION_TAGS, tagColumns } from "@/lib/scouting/playEra";
import { DIFFICULTY_TAGS } from "@/lib/scouting/tagCorrection";

const imported = { created_at: "2026-04-30T20:07:28Z" };
const inApp = { created_at: "2026-06-01T00:00:00Z" };

describe("tag registry", () => {
  it("puts the four situation tags on every position, first", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) {
      expect(tagColumns(pos).slice(0, 4)).toEqual(["red_zone", "third_fourth_down", "short_yardage", "garbage_time"]);
    }
    expect(SITUATION_TAGS.map((t) => t.entry)).toEqual(["sticky", "exception", "exception", "sticky"]);
  });

  it("uses new columns for broken tackles after the catch, never the old NOT NULL broken_tackle", () => {
    for (const pos of ["QB", "RB", "WR", "TE"] as const) expect(tagColumns(pos)).not.toContain("broken_tackle");
    expect(tagColumns("RB")).toContain("broken_tackle_after_catch");
    expect(tagColumns("WR")).toContain("broken_tackle_after_catch");
  });

  it("matches migration 062's enum CHECKs and presets", () => {
    const qb = Object.fromEntries(POSITION_TAGS.QB.map((t) => [t.column, t]));
    expect(qb.release_timing.values).toEqual(["early", "on_time", "late"]);
    expect(qb.release_timing.preset).toBe("on_time");
    expect(qb.sack_fault.values).toEqual(["qb", "line", "coverage"]);
    expect(qb.sack_fault.preset).toBe("line");
    const te = Object.fromEntries(POSITION_TAGS.TE.map((t) => [t.column, t]));
    expect(te.blocked_defender.values).toEqual(["dl", "lb", "db"]);
    expect(te.blocked_defender.preset).toBe("dl");
    expect(POSITION_TAGS.RB.find((t) => t.column === "pass_pro_loss")?.values).toEqual(["wrong_man", "beaten"]);
  });

  it("adds migration 078's catch difficulty tags to WR and TE, matching its columns and CHECKs, scored nowhere", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/078_catch_difficulty_tags.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE|UPDATE)\b/);
    expect(code).toMatch(/ARRAY\['route_plays', 'te_plays'\]/);
    const checkValues = (col: string) =>
      [...(code.match(new RegExp(`${col} IN \\(([^)]*)\\)`))?.[1] ?? "").matchAll(/''(\w+)''/g)].map((m) => m[1]);
    expect(checkValues("ball_placement")).toEqual(["on_target", "high", "low", "behind", "in_front", "outside_frame"]);
    for (const pos of ["WR", "TE"] as const) {
      const tags = Object.fromEntries(POSITION_TAGS[pos].map((t) => [t.column, t]));
      // 080 retired the single pick for the ball placement toggles.
      expect(tags.ball_placement).toBeUndefined();
      // 079 added Out of bounds to 078's two answers.
      expect(tags.incompletion_reason.values).toEqual([...checkValues("incompletion_reason"), "out_of_bounds"]);
      expect(tags.incompletion_reason.required).toBe(true);
      for (const col of ["ball_placement", "adjusted_to_ball", "hit_at_catch", "sideline_target", "incompletion_reason"]) {
        expect(code).toContain(`ADD COLUMN IF NOT EXISTS ${col} `);
        // Data collection only (the user, 2026-10-23): no Above-Expected correction reads them.
        for (const specs of Object.values(DIFFICULTY_TAGS)) expect(specs.map((s) => s.column)).not.toContain(col);
      }
    }
  });

  it("matches migration 080's ball placement toggles, copying 078's picks with its one approved UPDATE", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/080_ball_placement_toggles.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const BALL = ["ball_high", "ball_low", "ball_in_front", "ball_behind", "ball_outside_frame"];
    for (const pos of ["WR", "TE"] as const) {
      const tags = Object.fromEntries(POSITION_TAGS[pos].map((t) => [t.column, t]));
      expect(BALL.map((c) => tags[c]?.excludes ?? null)).toEqual(["ball_low", "ball_high", "ball_behind", "ball_in_front", null]);
      expect(tags.ball_outside_frame.onWith).toEqual(["ball_high", "ball_low", "ball_in_front", "ball_behind"]);
      for (const c of BALL) {
        expect(tags[c]).toMatchObject({ entry: "exception", appliesTo: "target", step: "target", group: "Ball placement" });
        expect(code).toContain(`ADD COLUMN IF NOT EXISTS ${c} boolean`);
        for (const specs of Object.values(DIFFICULTY_TAGS)) expect(specs.map((s) => s.column)).not.toContain(c);
      }
    }
    expect(code).toMatch(/CHECK \(NOT \(ball_high AND ball_low\)\)/);
    expect(code).toMatch(/CHECK \(NOT \(ball_in_front AND ball_behind\)\)/);
    expect(code).toMatch(/CHECK \(ball_outside_frame IS TRUE OR NOT \(COALESCE\(ball_high, false\) OR COALESCE\(ball_low, false\) OR COALESCE\(ball_in_front, false\) OR COALESCE\(ball_behind, false\)\)\)/);
    // The one UPDATE (the user, 2026-10-23): only rows with an old pick and no new value.
    expect(code.match(/\bUPDATE\b/g)).toHaveLength(1);
    expect(code).toMatch(/WHERE ball_placement IS NOT NULL\s+AND ball_high IS NULL AND ball_low IS NULL AND ball_in_front IS NULL\s+AND ball_behind IS NULL AND ball_outside_frame IS NULL/);
    // ball_placement is only read (right of each =), never set.
    expect(code).not.toMatch(/^\s*ball_placement\s*=/m);
    expect(code).not.toMatch(/\b(DROP|DELETE|TRUNCATE)\b/);
  });

  it("matches migration 079's Why incomplete answers, dropping only 078's check, after the new one is on", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/079_incompletion_out_of_bounds.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    const values = [...(code.match(/incompletion_reason IN \(([^)]*)\)/)?.[1] ?? "").matchAll(/''(\w+)''/g)].map((m) => m[1]);
    for (const pos of ["WR", "TE"] as const) {
      const spec = POSITION_TAGS[pos].find((t) => t.column === "incompletion_reason");
      expect(spec?.values).toEqual(values);
      expect(spec?.valueLabels).toEqual(["Uncatchable", "Broken up", "Out of bounds"]);
    }
    // The one DROP is the approved one (the user, 2026-10-23), after the new check goes on.
    expect(code.match(/\bDROP\b/g)).toHaveLength(1);
    expect(code).toMatch(/DROP CONSTRAINT IF EXISTS %I', tbl, tbl \|\| '_incompletion_reason_check'/);
    expect(code.indexOf("ADD CONSTRAINT")).toBeLessThan(code.indexOf("DROP CONSTRAINT"));
    expect(code).not.toMatch(/\b(DELETE|TRUNCATE|UPDATE)\b/);
  });

  it("adds migration 076's QB tag: Didn't sense pressure, off unless clicked, every dropback", () => {
    const qb = Object.fromEntries(POSITION_TAGS.QB.map((t) => [t.column, t]));
    expect(qb.didnt_sense_pressure).toMatchObject({ label: "Didn't sense pressure", entry: "exception", appliesTo: "dropback" });
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/076_qb_backpedal_sense_pressure.sql"), "utf8");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS didnt_sense_pressure boolean;/);
  });
});

describe("isTaggedPlay", () => {
  it("treats a play with every tag null or absent as charted before the tags existed", () => {
    expect(isTaggedPlay({ route_type: "nine" }, "WR")).toBe(false);
    expect(isTaggedPlay({ red_zone: null, press_release: null }, "WR")).toBe(false);
    // An old RB row's NOT NULL DEFAULT false columns don't make it tagged.
    expect(isTaggedPlay({ broken_tackle: false, explosive_play: false }, "RB")).toBe(false);
  });

  it("treats any non-null situation tag, false included, as a tagged play", () => {
    expect(isTaggedPlay({ red_zone: false }, "QB")).toBe(true);
    expect(isTaggedPlay({ garbage_time: false, third_fourth_down: false }, "TE")).toBe(true);
    expect(isTaggedPlay({ red_zone: false, release_timing: "on_time" }, "QB")).toBe(true);
  });

  it("a position tag alone leaves an old play old (RPO play action backfilled by 067)", () => {
    expect(isTaggedPlay({ play_type: "rpo", play_action: true, red_zone: null }, "QB")).toBe(false);
    expect(isTaggedPlay({ release_timing: "on_time" }, "QB")).toBe(false);
    expect(isTaggedPlay({ press_release: "won" }, "TE")).toBe(false);
  });
});

describe("playEra", () => {
  it("labels each play by its own era, so one prospect can have all three", () => {
    expect(playEra({}, imported, "WR")).toBe("imported");
    expect(playEra({ red_zone: null }, inApp, "WR")).toBe("in_app");
    expect(playEra({ red_zone: false }, inApp, "WR")).toBe("tagged");
  });

  it("follows coverageEra for the game's source", () => {
    expect(gameSource(imported)).toBe("imported");
    expect(gameSource(inApp)).toBe("in_app");
    expect(gameSource(undefined)).toBe("in_app");
  });

  it("counts plays per era", () => {
    const games = new Map([["g1", imported], ["g2", inApp]]);
    const plays = [
      { game_id: "g1" }, { game_id: "g1" },
      { game_id: "g2" }, { game_id: "g2", red_zone: true }, { game_id: "g2", short_yardage: false },
    ];
    expect(countPlayEras(plays, games, "RB")).toEqual({ imported: 2, in_app: 1, tagged: 2 });
  });
});
