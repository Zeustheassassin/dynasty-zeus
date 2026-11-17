import { describe, it, expect } from "vitest";
import { INT_TYPES, intTypeShort } from "@/components/scouting/qb/qbConstants";
import type { QBIntType } from "@/lib/types";

// 2026-11-17, the user: "to QB Charting can we add to INT Type WR Error".
// One list feeds the board's buttons, the play list's code and the Overview counts.

describe("QB INT types", () => {
  it("lists every type once, WR Error last, each with its own label and code", () => {
    const all: QBIntType[] = ["bad_throw", "bad_decision", "fifty_fifty", "tipped", "wr_error"];
    expect(INT_TYPES.map((t) => t.key)).toEqual(all);
    expect(INT_TYPES.find((t) => t.key === "wr_error")!.label).toBe("WR Error");
    expect(new Set(INT_TYPES.map((t) => t.label)).size).toBe(all.length);
    expect(new Set(INT_TYPES.map((t) => t.short)).size).toBe(all.length);
  });

  it("gives the play list's code, and nothing for no type", () => {
    expect(intTypeShort("bad_throw")).toBe("BT");
    expect(intTypeShort("tipped")).toBe("TP");
    expect(intTypeShort("wr_error")).toBe("WR err");
    expect(intTypeShort(null)).toBe("");
    expect(intTypeShort(undefined)).toBe("");
  });
});
