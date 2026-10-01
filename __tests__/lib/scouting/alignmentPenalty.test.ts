import { describe, it, expect } from "vitest";
import { alignmentPenalty, SIDE_MAX_PENALTY, SLOT_MAX_PENALTY } from "@/lib/scouting/alignmentPenalty";

const side = (pct: number) => alignmentPenalty({ pct_right: pct, pct_left: 0, pct_slot: 100 - pct })!.value;
const slot = (pct: number) => alignmentPenalty({ pct_slot: pct, pct_left: (100 - pct) / 2, pct_right: (100 - pct) / 2 })!.value;

describe("alignmentPenalty", () => {
  it("leaves a WR alone at or under 75% everywhere", () => {
    expect(alignmentPenalty({ pct_left: 75, pct_right: 5, pct_slot: 20 })).toBeNull();
    expect(alignmentPenalty({ pct_left: 40, pct_right: 40, pct_slot: 20 })).toBeNull();
    expect(alignmentPenalty({ pct_slot: 75, pct_left: 12, pct_right: 13 })).toBeNull();
    expect(alignmentPenalty({})).toBeNull();
  });

  it("curves a one-side penalty from 75% to its full size at 95%", () => {
    expect(side(80)).toBeCloseTo(-SIDE_MAX_PENALTY * 0.25 ** 1.5, 9);
    expect(side(90)).toBeCloseTo(-SIDE_MAX_PENALTY * 0.75 ** 1.5, 9);
    expect(side(95)).toBeCloseTo(-SIDE_MAX_PENALTY, 9);
    expect(side(99)).toBeCloseTo(-SIDE_MAX_PENALTY, 9);
    // Steeper toward 95%: 85→90 costs more than 80→85.
    expect(side(85) - side(90)).toBeGreaterThan(side(80) - side(85));
  });

  it("treats left the same as right, and names the side", () => {
    expect(alignmentPenalty({ pct_left: 90, pct_right: 0, pct_slot: 10 })!.value).toBeCloseTo(side(90), 12);
    expect(alignmentPenalty({ pct_left: 90, pct_right: 0, pct_slot: 10 })!.label).toBe("90% of snaps on the left side");
  });

  it("gives the slot the same curve, milder", () => {
    expect(slot(95)).toBeCloseTo(-SLOT_MAX_PENALTY, 9);
    expect(slot(90)).toBeCloseTo(-SLOT_MAX_PENALTY * 0.75 ** 1.5, 9);
    expect(slot(90)).toBeGreaterThan(side(90));
    expect(alignmentPenalty({ pct_slot: 96, pct_left: 0, pct_right: 4 })!.label).toBe("96% of snaps in the slot");
  });
});
