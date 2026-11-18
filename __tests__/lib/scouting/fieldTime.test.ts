import { describe, it, expect } from "vitest";
import {
  TE_FIELD_TIME,
  RB_PASS_DOWNS,
  WR_RUN_DOWNS,
  snapShare,
  perSnap,
  fieldTimeIndex,
  routeEquivalent,
  blockingEffect,
  describeFieldTime,
} from "@/lib/scouting/fieldTime";

// The user's scenarios (2026-10-21) as shrunk z's, with blocking's spread at
// 5 win-rate points per SD (about what every TE projected to 8 games showed):
// elite +1.0, great +0.7, slightly below −0.3 (1.5 pts under average). A super
// poor route runner is −1.0; a super poor blocker is 10 pts under, −2.0.
const TAU_B = 5;
const ELITE = 1.0, GREAT = 0.7, SLIGHTLY_BELOW = -0.3, SUPER_POOR_ROUTES = -1.0, SUPER_POOR_BLOCK = -10 / TAU_B;
const share = (zR: number, zB: number) => snapShare(zR, zB, TAU_B, TE_FIELD_TIME);
const index = (zR: number, zB: number) => fieldTimeIndex(zR, zB, TAU_B, TE_FIELD_TIME);
const score = (zR: number, zB: number) => routeEquivalent(zR, zB, TAU_B);

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
    expect(snapShare(0, -7 / 2.6, 2.6, TE_FIELD_TIME)).toBeCloseTo(snapShare(0, -7 / 6, 6, TE_FIELD_TIME), 9);
  });

  it("takes production per snap from route running alone", () => {
    expect(perSnap(0.4, TE_FIELD_TIME)).toBeCloseTo(1.1, 9);
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
    expect(TE_FIELD_TIME.perSnapPerSD).toBeGreaterThan(0); // routeEquivalent needs it
  });

  it("reads as snaps × production per snap", () => {
    expect(describeFieldTime(0.74, -0.43, 2.61)).toBe("82% of snaps × 1.19 per snap");
  });
});

// RB pass protection on passing downs and WR run blocking on run downs, added
// on top of the score (the user, 2026-11-18). RB's pass-block spread was 5.7
// win-rate points (83.5% average); WR's run-block grade sat at the floor,
// ~2.5 grade points.
describe("RB / WR blocking through field time", () => {
  const RB_TAU = 5.7, WR_TAU = 2.5;
  const rb = (zR: number, pts: number) => blockingEffect(zR, pts / RB_TAU, RB_TAU, RB_PASS_DOWNS);
  const wr = (zR: number, pts: number) => blockingEffect(zR, pts / WR_TAU, WR_TAU, WR_RUN_DOWNS);

  it("adds nothing for an average blocker, whatever his other skill", () => {
    for (const zR of [-1.5, -0.4, 0, 0.6, 2]) {
      expect(rb(zR, 0)).toBe(0);
      expect(wr(zR, 0)).toBe(0);
    }
  });

  it("costs a back nothing until he's 3 win-rate points under average, then cuts fast", () => {
    // An average receiver: slightly below average blocking costs nothing.
    expect(rb(0, -1)).toBeCloseTo(0, 12);
    expect(rb(0, -3)).toBeCloseTo(0, 12);
    // 10 points under (73%): 35 points of passing-down snaps, 0.47 off the score.
    expect(rb(0, -10)).toBeCloseTo(-0.35 / 0.75, 9);
    expect(rb(0, -10)).toBeLessThan(rb(0, -5) - 0.25);
  });

  it("costs a good receiver more: he has more catches to lose on those downs", () => {
    expect(rb(1, -10)).toBeLessThan(rb(0, -10) - 0.1);
    expect(rb(-1, -10)).toBeGreaterThan(rb(0, -10));
  });

  it("credits a good pass blocker for the passing downs he earns, less than a poor one loses", () => {
    expect(rb(0, RB_TAU)).toBeCloseTo(0.1 / 0.75, 9);
    expect(rb(0, RB_TAU)).toBeLessThan(-rb(0, -10));
    // A receiver who already earns the field gains only the good-at-both bonus.
    expect(rb(1, RB_TAU)).toBeCloseTo((0.1 * 1.25) / 0.75, 9);
  });

  it("weighs a receiver's run blocking at three quarters of a back's pass protection", () => {
    expect(RB_PASS_DOWNS.weight).toBe(1);
    expect(WR_RUN_DOWNS.weight).toBe(0.75);
    // The same snaps lost count three quarters as much.
    expect(blockingEffect(0, -1, 10, WR_RUN_DOWNS) / blockingEffect(0, -1, 10, { ...RB_PASS_DOWNS, dials: WR_RUN_DOWNS.dials })).toBeCloseTo(0.75, 12);
  });

  it("cuts a receiver from 1.5 grade points under average", () => {
    expect(wr(0, -1.5)).toBeCloseTo(0, 12);
    expect(wr(0, -4)).toBeCloseTo((0.75 * -0.06 * 2.5) / 0.75, 9);
  });

  it("never scores better blocking lower", () => {
    const pts = [-15, -10, -7, -5, -3, -1, 0, 2, 5, 8];
    for (const zR of [-1, 0, 1]) for (let i = 1; i < pts.length; i++) {
      expect(rb(zR, pts[i])).toBeGreaterThanOrEqual(rb(zR, pts[i - 1]) - 1e-12);
      expect(wr(zR, pts[i])).toBeGreaterThanOrEqual(wr(zR, pts[i - 1]) - 1e-12);
    }
  });

  it("starts with the user's dials (2026-11-18, the normal level)", () => {
    expect(RB_PASS_DOWNS.dials).toMatchObject({ baseShare: 0.75, earnPerSD: 0.1, bothPerSD: 0.1, cutStartsAtPts: -3, cutPerPt: 0.05, perSnapPerSD: 0.25 });
    expect(WR_RUN_DOWNS.dials).toMatchObject({ baseShare: 0.75, earnPerSD: 0.1, bothPerSD: 0.1, cutStartsAtPts: -1.5, cutPerPt: 0.06, perSnapPerSD: 0.25 });
  });

  it("reads as the downs he plays × production per snap", () => {
    expect(describeFieldTime(0, -10 / RB_TAU, RB_TAU, RB_PASS_DOWNS.dials, RB_PASS_DOWNS.snaps)).toBe("40% of passing-down snaps × 1.00 per snap");
  });
});
