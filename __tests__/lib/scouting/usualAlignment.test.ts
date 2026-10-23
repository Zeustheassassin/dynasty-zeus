import { describe, it, expect } from "vitest";
import { usualTEAlignment, usualWRAlignment } from "@/lib/scouting/usualAlignment";

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
