import { describe, it, expect } from "vitest";
import {
  TE_FIELD_TIME,
  teSnapShare,
  tePerSnap,
  teFieldTimeIndex,
  teRouteEquivalent,
  describeFieldTime,
} from "@/lib/scouting/teFieldTime";

// The user's scenarios (2026-10-21) as shrunk z's, with blocking's spread at
// 5 win-rate points per SD (about what every TE projected to 8 games showed):
// elite +1.0, great +0.7, slightly below −0.3 (1.5 pts under average). A super
// poor route runner is −1.0; a super poor blocker is 10 pts under, −2.0.
const TAU_B = 5;
const ELITE = 1.0, GREAT = 0.7, SLIGHTLY_BELOW = -0.3, SUPER_POOR_ROUTES = -1.0, SUPER_POOR_BLOCK = -10 / TAU_B;
const share = (zR: number, zB: number) => teSnapShare(zR, zB, TAU_B);
const index = (zR: number, zB: number) => teFieldTimeIndex(zR, zB, TAU_B);
const score = (zR: number, zB: number) => teRouteEquivalent(zR, zB, TAU_B);

describe("TE field time: the user's scenarios", () => {
  it("puts an elite route runner and an elite blocker both on the field ~85% of the time", () => {
    expect(share(ELITE, SLIGHTLY_BELOW)).toBeCloseTo(0.85, 9);
    expect(share(SLIGHTLY_BELOW, ELITE)).toBeCloseTo(0.85, 9);
  });

  it("gets more out of those snaps for the elite route runner", () => {
    expect(index(ELITE, SLIGHTLY_BELOW)).toBeGreaterThan(index(SLIGHTLY_BELOW, ELITE) + 20);
  });

  it("plays a great pass catcher who is a super poor blocker less than a great blocker who is a super poor route runner", () => {
    expect(share(GREAT, SUPER_POOR_BLOCK)).toBeLessThan(share(SUPER_POOR_ROUTES, GREAT) - 0.2);
  });

  it("puts that great blocker slightly ahead", () => {
    const blocker = index(SUPER_POOR_ROUTES, GREAT);
    const catcher = index(GREAT, SUPER_POOR_BLOCK);
    expect(blocker).toBeGreaterThan(catcher);
    expect(blocker - catcher).toBeLessThan(3);
    expect(score(SUPER_POOR_ROUTES, GREAT)).toBeGreaterThan(score(GREAT, SUPER_POOR_BLOCK));
  });

  it("plays a TE elite at both the most, ahead of one elite at only one", () => {
    expect(share(ELITE, ELITE)).toBeCloseTo(0.95, 9);
    expect(score(ELITE, ELITE)).toBeGreaterThan(score(ELITE, 0) + 0.4);
  });
});

describe("TE field time: the shape", () => {
  it("scores an average TE at 100, 75% of snaps", () => {
    expect(index(0, 0)).toBeCloseTo(100, 9);
    expect(share(0, 0)).toBe(TE_FIELD_TIME.baseShare);
  });

  it("cuts blocking by win-rate points under the average TE, from 5 points down", () => {
    for (const pts of [0, -1, -3, -5]) expect(share(0, pts / TAU_B)).toBeCloseTo(0.75, 9);
    expect(share(0, -7 / TAU_B)).toBeCloseTo(0.75 - 0.06 * 2, 9);
    // The same points cut the same, whatever the pool's spread.
    expect(teSnapShare(0, -7 / 2.6, 2.6)).toBeCloseTo(teSnapShare(0, -7 / 6, 6), 9);
  });

  it("takes production per snap from route running alone", () => {
    expect(tePerSnap(0.4)).toBeCloseTo(1.1, 9);
    expect(index(0.4, 0.2) / share(0.4, 0.2)).toBeCloseTo(index(0.4, -0.2) / share(0.4, -0.2), 9);
  });

  it("scores an average blocker at exactly his route z", () => {
    for (const zR of [-2, -1.27, -0.5, 0, 0.3, 0.74, 1, 1.8]) expect(score(zR, 0)).toBeCloseTo(zR, 9);
  });

  it("never scores better blocking or better routes lower", () => {
    const zs = [-2.5, -1.5, -1, -0.6, -0.4, -0.2, 0, 0.3, 0.7, 1, 1.5];
    for (const a of zs) for (let i = 1; i < zs.length; i++) {
      expect(score(a, zs[i])).toBeGreaterThanOrEqual(score(a, zs[i - 1]) - 1e-9);
      expect(score(zs[i], a)).toBeGreaterThanOrEqual(score(zs[i - 1], a) - 1e-9);
    }
  });

  it("starts with the user's dials", () => {
    expect(TE_FIELD_TIME).toMatchObject({ baseShare: 0.75, earnPerSD: 0.1, bothPerSD: 0.1, cutStartsAtPts: -5, cutPerPt: 0.06, perSnapPerSD: 0.25 });
    expect(TE_FIELD_TIME.perSnapPerSD).toBeGreaterThan(0); // teRouteEquivalent needs it
  });

  it("reads as snaps × production per snap", () => {
    expect(describeFieldTime(0.74, -0.43, 2.61)).toBe("82% of snaps × 1.19 per snap");
  });
});
