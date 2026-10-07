import { describe, it, expect } from "vitest";
import { buildGradingReport } from "@/lib/scouting/gradingChecks";
import { EMPTY_GRADING_DATA } from "@/lib/scouting/aeComponents";
import { CORRECTION_KEYS, DIFFICULTY_TAGS } from "@/lib/scouting/tagCorrection";
import type { Prospect, QBPlay, RBPlay, ScoutingGame } from "@/lib/types";

const game = (id: string, prospect_id: string, created_at = "2026-06-01T00:00:00Z"): ScoutingGame =>
  ({ id, prospect_id, season_year: 2025, created_at, opponent: "Ohio State" }) as ScoutingGame;
const rb = (game_id: string, success: boolean, tags: Partial<RBPlay> = {}): RBPlay =>
  ({ game_id, run_type: "inside_zone", formation: "gun", success, loaded_box: false, unblocked_defender: false, broken_tackle: false, explosive_play: false, ...tags }) as RBPlay;
const qb = (game_id: string, accuracy: "on_target" | "high"): QBPlay =>
  ({ game_id, play_type: "pass", accuracy, completion: "caught", depth_zone: "short_center", timing: "first_option" }) as QBPlay;

describe("buildGradingReport", () => {
  const prospects = [{ id: "r1", position: "RB" }, { id: "r2", position: "RB" }, { id: "q1", position: "QB" }] as Prospect[];
  const games = [game("ga", "r1", "2026-04-01T00:00:00Z"), game("gb", "r2"), game("gq", "q1")];
  const rbPlays = [
    ...Array.from({ length: 30 }, (_, i) => rb("ga", i % 2 === 0)),
    ...Array.from({ length: 30 }, (_, i) => rb("gb", i % 3 === 0, { red_zone: i < 5, third_fourth_down: false, short_yardage: false, garbage_time: false, hit_behind_line: false })),
  ];
  const qbPlays = Array.from({ length: 30 }, (_, i) => qb("gq", i % 4 ? "on_target" : "high"));
  const report = buildGradingReport({ prospects, games, qbPlays, rbPlays, tePlays: [], gameRouteCells: null, gradingData: EMPTY_GRADING_DATA });

  it("checks every play model (WR needs its route cells)", () => {
    expect(report.models.map((m) => m.key)).toEqual(CORRECTION_KEYS.filter((k) => k !== "wr_sae"));
  });

  it("lists every difficulty tag with its tagged and on counts, all off and not yet testable", () => {
    const rbCheck = report.models.find((m) => m.key === "rb_srae")!;
    expect(rbCheck.readiness.map((r) => r.column)).toEqual(DIFFICULTY_TAGS.rb_srae.map((s) => s.column));
    const rz = rbCheck.readiness.find((r) => r.column === "red_zone")!;
    expect(rz).toMatchObject({ taggedPlays: 30, onPlays: { on: 5 }, prospects: 1, testable: false, enabled: false });
    expect(rbCheck.tests).toEqual([]);
  });

  it("splits each model's residuals by era (imported / in-app / tagged)", () => {
    const rbCheck = report.models.find((m) => m.key === "rb_srae")!;
    expect(rbCheck.eras.imported!.n).toBe(30);
    expect(rbCheck.eras.tagged!.n).toBe(30);
    expect(rbCheck.eras.in_app).toBeUndefined();
    expect(rbCheck.drift.enough).toBe(false);
  });

  it("reports every AE Score component by position", () => {
    expect(report.components.QB.map((c) => c.result.def.key)).toContain("pff_btt");
    expect(report.components.RB.map((c) => c.result.def.key)).toEqual(expect.arrayContaining(["ch_rb_pb", "pff_rb_mtf"]));
    expect(report.components.WR.map((c) => c.result.def.key)).toContain("tag_wr_press");
  });
});
