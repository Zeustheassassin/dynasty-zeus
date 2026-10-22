// TE field time: how blocking counts in a TE's AE Score (the user, 2026-10-21).
//
// Blocking scores no fantasy points, but it decides how often a TE is on the
// field, and snaps are opportunity: "if you are a really really shitty blocker
// you will never be on the field". So a TE isn't scored on a weighted average
// of routes and blocking. He's scored on snaps × production per snap:
//
//   - Snap share comes from whichever skill earns him the field. Elite at
//     either one plays about 85% of snaps, and a TE good at both plays more
//     (up to 95%). Average to slightly below-average blocking costs nothing;
//     a clearly poor blocker loses snaps fast.
//   - Production per snap comes from his route running alone.
//
// The user's own checks, kept as tests (__tests__/lib/scouting/teFieldTime.test.ts):
// an elite route runner who blocks slightly below average and an elite blocker
// who runs routes slightly below average both play ~85%, and the route runner
// does more with it. A great pass catcher who is a super poor blocker plays
// less than a great blocker who is a super poor route runner, and the blocker
// comes out slightly ahead.
//
// The skills are shrunk z's from aeComposite.ts (estimated talent in
// true-talent SDs, 0 = the average charted TE), so a thin sample sits near 0
// and is cut little. The blocking cut alone is in block-win-rate points (his
// shrunk TE-SAEB against the average TE's, z × τ): SD units moved with the
// pool's spread, and with every TE projected to 8 games a TE ~3 points under
// average read as a −1 SD "super poor" blocker while the spread sat at its
// floor (2026-10-21).
//
// The result goes back on the AE scale as a route equivalent: the route z an
// average blocker would need for the same field-time value. An average
// blocker scores exactly his route z, so TE stays on the same footing as the
// other positions (each in its own primary metric's SDs), and
// POSITION_BASELINE (aeComposite.ts) moves every TE up or down.

export interface FieldTimeDials {
  /** Snap share of an average TE. */
  baseShare: number;
  /** Snap share earned per SD of his better skill, up to 1 SD (elite at either: base + this). */
  earnPerSD: number;
  /** Extra snap share per SD of his weaker skill when both are above average,
   *  up to 1 SD: the do-everything TE. */
  bothPerSD: number;
  /** Blocking, in win-rate points against the average TE, below which the snap cut starts. */
  cutStartsAtPts: number;
  /** Snap share lost per point of blocking below cutStartsAtPts. */
  cutPerPt: number;
  /** Production per snap gained (or lost) per SD of route running. Must be > 0. */
  perSnapPerSD: number;
  minShare: number;
  maxShare: number;
}

// The user's starting dials (2026-10-21), to hone after about 30–40 more TE
// games. A blocker 10 points under the average TE (super poor) loses 30 points
// of snaps, which lets the great blocker / super poor route runner just edge
// the great pass catcher / super poor blocker (82 vs 81 on the index). The
// good-at-both bonus of 0.10 is what puts a TE elite at both (Patrick
// Overmyer's one game, projected to 8) at the top of the board, as the user
// expected.
export const TE_FIELD_TIME: FieldTimeDials = {
  baseShare: 0.75,
  earnPerSD: 0.10,
  bothPerSD: 0.10,
  cutStartsAtPts: -5,
  cutPerPt: 0.06,
  perSnapPerSD: 0.25,
  minShare: 0.2,
  maxShare: 0.95,
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** His share of snaps (0–1) from his route and blocking z's; `tauBlock` turns blocking z into points. */
export function teSnapShare(zRoute: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME): number {
  const better = clamp(Math.max(zRoute, zBlock), -1, 1);
  const both = clamp(Math.min(zRoute, zBlock), 0, 1);
  const cut = d.cutPerPt * Math.max(0, d.cutStartsAtPts - zBlock * tauBlock);
  return clamp(d.baseShare + d.earnPerSD * better + d.bothPerSD * both - cut, d.minShare, d.maxShare);
}

/** His production per snap, relative to an average TE's (1). */
export function tePerSnap(zRoute: number, d: FieldTimeDials = TE_FIELD_TIME): number {
  return Math.max(0, 1 + d.perSnapPerSD * zRoute);
}

/** Snaps × production per snap, 100 = an average TE. */
export function teFieldTimeIndex(zRoute: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME): number {
  return (100 * teSnapShare(zRoute, zBlock, tauBlock, d) * tePerSnap(zRoute, d)) / d.baseShare;
}

/**
 * The route z an average blocker (blocking z 0) would need for the same
 * field-time index. For an average blocker it's his own route z. The index
 * of an average blocker only rises with route z, so bisect.
 */
export function teRouteEquivalent(zRoute: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME): number {
  const target = teFieldTimeIndex(zRoute, zBlock, tauBlock, d);
  const at = (z: number) => teFieldTimeIndex(z, 0, tauBlock, d);
  let lo = -1 / d.perSnapPerSD; // production per snap 0: index 0
  if (target <= at(lo)) return lo;
  let hi = Math.max(1, zRoute);
  while (at(hi) < target) hi *= 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** How his field time reads, e.g. "82% of snaps × 1.19 per snap". */
export function describeFieldTime(zRoute: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME): string {
  return `${Math.round(teSnapShare(zRoute, zBlock, tauBlock, d) * 100)}% of snaps × ${tePerSnap(zRoute, d).toFixed(2)} per snap`;
}
