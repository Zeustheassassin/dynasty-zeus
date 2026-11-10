import { describe, it, expect } from "vitest";
import {
  isTEBlock, teBlockDefaults, tePlayTypeForPositioning, teRetiredTargetFlags, TE_ROUTE_DEFAULTS,
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
  it("a route starts in Zone, not targeted", () => {
    expect(TE_ROUTE_DEFAULTS).toEqual({ coverage: "zone", targeted: false });
  });

  it("an edit keeps an older play's contested / broken tackle picks unless it makes them impossible (2026-11-10)", () => {
    const contested = { contested_target: true };
    // Still a catch: untouched.
    expect(teRetiredTargetFlags(contested, true, true)).toEqual({});
    // No longer caught: no broken tackle, and a contested target wasn't a contested catch.
    expect(teRetiredTargetFlags(contested, true, false)).toEqual({ broken_tackle: false, contested_catch: false });
    expect(teRetiredTargetFlags({ contested_target: null }, true, false)).toEqual({ broken_tackle: false, contested_catch: null });
    // No longer a target: none of them.
    expect(teRetiredTargetFlags(contested, false, false)).toEqual({ contested_target: null, contested_catch: null, broken_tackle: false });
  });

  it("run and pass blocks are block reps; routes and decoys aren't", () => {
    expect([isTEBlock("run_block"), isTEBlock("pass_block"), isTEBlock("route_run"), isTEBlock("decoy")]).toEqual([true, true, false, false]);
  });
});
