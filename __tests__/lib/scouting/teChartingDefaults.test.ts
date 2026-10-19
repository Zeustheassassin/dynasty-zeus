import { describe, it, expect } from "vitest";
import {
  isTEBlock, teBlockDefaults, tePlayTypeForPositioning, TE_ROUTE_DEFAULTS, TE_TARGET_DEFAULTS,
} from "@/lib/scouting/teChartingDefaults";

// The user's TE charting defaults (2026-10-19): pre-filled, changeable picks by alignment.
describe("teBlockDefaults", () => {
  it("wide: Movement on a DB, Success", () => {
    expect(teBlockDefaults("wide")).toEqual({ blockType: "movement", blockSuccess: true, blockedDefender: "db" });
  });

  it("slot: Movement on an LB, Success", () => {
    expect(teBlockDefaults("slot")).toEqual({ blockType: "movement", blockSuccess: true, blockedDefender: "lb" });
  });

  it("inline and wing back: Inline on a DL, Success", () => {
    for (const pos of ["inline", "wing_back"] as const) {
      expect(teBlockDefaults(pos)).toEqual({ blockType: "inline", blockSuccess: true, blockedDefender: "dl" });
    }
  });

  it("full back and running back assume nothing past the DL preset", () => {
    for (const pos of ["full_back", "running_back"] as const) {
      expect(teBlockDefaults(pos)).toEqual({ blockType: null, blockSuccess: null, blockedDefender: "dl" });
    }
  });
});

describe("tePlayTypeForPositioning", () => {
  it("starts Inline and Wing Back as a Run Block, whatever was on", () => {
    expect(tePlayTypeForPositioning("inline", "route_run")).toBe("run_block");
    expect(tePlayTypeForPositioning("wing_back", "pass_block")).toBe("run_block");
  });

  it("leaves the play type alone everywhere else", () => {
    expect(tePlayTypeForPositioning("wide", "run_block")).toBe("run_block");
    expect(tePlayTypeForPositioning("slot", "route_run")).toBe("route_run");
    expect(tePlayTypeForPositioning("full_back", "decoy")).toBe("decoy");
  });
});

describe("route and block helpers", () => {
  it("a route starts in Zone, not targeted; a target starts uncontested", () => {
    expect(TE_ROUTE_DEFAULTS).toEqual({ coverage: "zone", targeted: false });
    expect(TE_TARGET_DEFAULTS).toEqual({ contestedTarget: false });
  });

  it("run and pass blocks are block reps; routes and decoys aren't", () => {
    expect([isTEBlock("run_block"), isTEBlock("pass_block"), isTEBlock("route_run"), isTEBlock("decoy")]).toEqual([true, true, false, false]);
  });
});
