import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isRBCarry, usualRBPlay, usualTEAlignment, usualWRAlignment } from "@/lib/scouting/usualAlignment";
import type { RBPlay, RBRunType } from "@/lib/types";

// The user (2026-10-23): a WR / TE play starts where that player lines up most.
describe("usualWRAlignment", () => {
  it("is null with no plays, so the board keeps Right on the line", () => {
    expect(usualWRAlignment([])).toBeNull();
  });

  it("takes his most common alignment, then his line there", () => {
    expect(usualWRAlignment([
      { alignment: "slot", on_line: false },
      { alignment: "left", on_line: true },
      { alignment: "slot", on_line: false },
      { alignment: "slot", on_line: true },
    ])).toEqual({ alignment: "slot", onLine: false });
  });

  it("picks the alignment first, not the most common alignment + line pair", () => {
    // Left on the line is the top pair (3), but he's at Right more (4).
    expect(usualWRAlignment([
      { alignment: "right", on_line: false },
      { alignment: "right", on_line: false },
      { alignment: "left", on_line: true },
      { alignment: "left", on_line: true },
      { alignment: "left", on_line: true },
      { alignment: "right", on_line: true },
      { alignment: "right", on_line: true },
    ])).toEqual({ alignment: "right", onLine: true }); // line tie 2-2: the latest
  });

  it("gives a tie to the one charted most recently", () => {
    expect(usualWRAlignment([
      { alignment: "left", on_line: true },
      { alignment: "right", on_line: true },
      { alignment: "right", on_line: true },
      { alignment: "left", on_line: true },
    ])).toEqual({ alignment: "left", onLine: true });
  });
});

describe("usualTEAlignment", () => {
  it("is null with no plays, so the board keeps Left Inline", () => {
    expect(usualTEAlignment([])).toBeNull();
  });

  it("takes his most common positioning, then his location there", () => {
    expect(usualTEAlignment([
      { location: "right", positioning: "inline" },
      { location: "left", positioning: "slot" },
      { location: "right", positioning: "inline" },
      { location: "backfield", positioning: "full_back" },
    ])).toEqual({ location: "right", positioning: "inline" });
  });

  it("picks the positioning first, not the most common location + positioning pair", () => {
    // Left Slot is the top pair (3), but he's Inline more (4), split Left / Right.
    expect(usualTEAlignment([
      { location: "left", positioning: "slot" },
      { location: "left", positioning: "inline" },
      { location: "right", positioning: "inline" },
      { location: "left", positioning: "slot" },
      { location: "left", positioning: "slot" },
      { location: "left", positioning: "inline" },
      { location: "right", positioning: "inline" },
    ])).toEqual({ location: "right", positioning: "inline" }); // side tie 2-2: the latest
  });

  it("gives a tie to the one charted most recently", () => {
    expect(usualTEAlignment([
      { location: "left", positioning: "wide" },
      { location: "right", positioning: "wing_back" },
    ])).toEqual({ location: "right", positioning: "wing_back" });
  });
});

// The user (2026-11-18): an RB play starts on his most common run, e.g. Fluff
// Bothwell → Gun, RB, Inside Gap, Success.
describe("usualRBPlay", () => {
  type P = Pick<RBPlay, "formation" | "aligned_as_wr" | "run_type" | "success">;
  const play = (run_type: RBRunType, success: boolean | null = null, extra: Partial<P> = {}): P =>
    ({ formation: "gun", aligned_as_wr: false, run_type, success, ...extra });

  it("is null with no plays, so the board keeps Gun / RB / Outside Zone", () => {
    expect(usualRBPlay([])).toBeNull();
  });

  it("reads the run and its result from carries only, formation and alignment from every play", () => {
    // Bothwell's shape: routes and decoys outnumber any one carry, but they aren't runs.
    const plays: P[] = [
      ...Array.from({ length: 6 }, () => play("route", null, { formation: "pistol", aligned_as_wr: true })),
      ...Array.from({ length: 5 }, () => play("decoy")),
      ...Array.from({ length: 4 }, (_, i) => play("inside_man_gap", i < 3)),
      ...Array.from({ length: 3 }, () => play("outside_zone", false)),
      ...Array.from({ length: 4 }, () => play("pass_block", false)),
    ];
    // 16 gun vs 6 pistol, 16 RB vs 6 split out; carries: 4 Inside Gap (3 success), 3 Outside Zone (all fail)
    // → results 3 success vs 4 fail over carries.
    expect(usualRBPlay(plays)).toEqual({ formation: "gun", alignedAsWr: false, runType: "inside_man_gap", success: false });
    // Two more successful carries tip the result; pass-block fails never count.
    expect(usualRBPlay([...plays, play("inside_zone", true), play("inside_zone", true)])!.success).toBe(true);
  });

  it("leaves the run and result blank with no carries, and breaks ties toward the latest play", () => {
    expect(usualRBPlay([play("route"), play("pass_block", true)])).toEqual({ formation: "gun", alignedAsWr: false, runType: null, success: null });
    expect(usualRBPlay([play("outside_zone", true), play("inside_zone", false)])).toMatchObject({ runType: "inside_zone", success: false });
    expect(usualRBPlay([play("inside_zone", false), play("outside_zone", true)])).toMatchObject({ runType: "outside_zone", success: true });
  });

  it("counts a carry as one of the four designed runs", () => {
    expect((["outside_man_gap", "inside_man_gap", "outside_zone", "inside_zone"] as RBRunType[]).every(isRBCarry)).toBe(true);
    expect((["pass_block", "run_block", "decoy", "route"] as RBRunType[]).some(isRBCarry)).toBe(false);
  });

  it("is what the RB board opens on and resets to, and a switch to a block clears the result", () => {
    const board = readFileSync(join(process.cwd(), "components/scouting/rb/RBChartingBoard.tsx"), "utf8");
    expect(board).toMatch(/usual\.current = u;/);
    expect(board).toMatch(/setFormation\(usual\.current\?\.formation \?\? "gun"\)/);
    expect(board).toMatch(/setRunType\(usual\.current\?\.runType \?\? "outside_zone"\)/);
    expect(board).toMatch(/setAlignedAsWr\(usual\.current\?\.alignedAsWr \?\? false\)/);
    expect(board).toMatch(/if \(isRBCarry\(rt\) !== isRBCarry\(runType\)\) setSuccess\(isRBCarry\(rt\) \? usual\.current\?\.success \?\? null : null\);/);
    // Every play-type button goes through it.
    expect(board).not.toMatch(/onClick=\{\(\) => setRunType\(/);
  });
});
