// Field time: how blocking counts in an AE Score. Blocking scores no fantasy
// points, but it decides how often a player is on the field, and snaps are
// opportunity. So blocking never counts as a weighted share of the score; it
// moves the score through his snaps. One rule, three positions:
//
//   - TE (the user, 2026-10-21): "if you are a really really shitty blocker
//     you will never be on the field". Routes and blocking (TE-SAER, TE-SAEB)
//     decide his share of every snap, and the score is a route equivalent
//     (below).
//   - RB (the user, 2026-11-18): "a bad pass blocking RB more rarely sees the
//     field on third downs which significantly reduces the amount of time they
//     will also run routes. and catches = big points for running backs." Pass
//     protection (your charted PB%) and receiving decide his share of the
//     passing downs.
//   - WR (the user, 2026-11-18, "a little less than RB's"): good blocking keeps
//     a receiver on the field in 2-WR sets, and a bad blocker comes off (Brian
//     Thomas Jr. lost playing time to it). Run blocking (PFF's run-block
//     grade) and route running decide his share of the run downs. Slot or
//     outside makes no difference (the user's call).
//
// The snap-share model is the same at every position:
//
//   - Snap share comes from whichever skill earns him the field. Elite at
//     either one plays about 85% of those snaps, and good at both plays more
//     (up to 95%). Average to slightly below-average blocking costs nothing; a
//     clearly poor blocker loses snaps fast.
//   - Production per snap comes from his other skill (routes, receiving) alone.
//
// The TE checks, kept as tests (__tests__/lib/scouting/fieldTime.test.ts): an
// elite route runner who blocks slightly below average and an elite blocker
// who runs routes slightly below average both play ~85%, and the route runner
// does more with it. A great pass catcher who is a super poor blocker plays
// less than a great blocker who is a super poor route runner, and the blocker
// comes out slightly ahead.
//
// The skills are shrunk z's from aeComposite.ts (estimated talent in
// true-talent SDs, 0 = the average charted prospect at the position), so a
// thin sample sits near 0 and is cut little. The blocking cut alone is in the
// blocking metric's own points (his shrunk value against the average one's,
// z × τ): SD units moved with the pool's spread, and with every TE projected
// to 8 games a TE ~3 points under average read as a −1 SD "super poor" blocker
// while the spread sat at its floor (2026-10-21).
//
// How the result reaches the score differs:
//   - TE: a route equivalent (routeEquivalent), the route z an average blocker
//     would need for the same field-time value, in place of his route z in the
//     weighted average. An average blocker scores exactly his route z.
//   - RB and WR: blocking's own effect (blockingEffect), added on top of the
//     score: the change in his field-time value against an average blocker's,
//     times the position's weight. An average blocker (or one with no blocking
//     sample) gets exactly 0, so everything else in the score is untouched.

export interface FieldTimeDials {
  /** Snap share of an average player. */
  baseShare: number;
  /** Snap share earned per SD of his better skill, up to 1 SD (elite at either: base + this). */
  earnPerSD: number;
  /** Extra snap share per SD of his weaker skill when both are above average,
   *  up to 1 SD: the do-everything player. */
  bothPerSD: number;
  /** Blocking, in its metric's points against the average player, below which the snap cut starts. */
  cutStartsAtPts: number;
  /** Snap share lost per point of blocking below cutStartsAtPts. */
  cutPerPt: number;
  /** Production per snap gained (or lost) per SD of his other skill. Must be > 0. */
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

/** Blocking added on top of the score through field time (RB, WR). */
export interface AddedFieldTime {
  dials: FieldTimeDials;
  /** Score (true-talent SDs) per unit of field-time value, 1 = all of an average player's. */
  weight: number;
  /** The snaps the rule is about, for the breakdown: "passing-down snaps". */
  snaps: string;
}

// RB: pass protection decides the passing downs (the user, 2026-11-18, the
// "normal" level of the two shown). The cut starts 3 win-rate points under the
// average back (83.5% on 2026-11-18) and costs 5 points of passing-down snaps
// per point after that. A back blocking like the average one counts 0; an
// average receiver at 73% (10 points under, once fully trusted) loses about
// 0.47, one a SD better as a receiver more, since he has more catches to lose.
// Replaces PB%'s 0.15 weighted share.
export const RB_PASS_DOWNS: AddedFieldTime = {
  dials: { baseShare: 0.75, earnPerSD: 0.10, bothPerSD: 0.10, cutStartsAtPts: -3, cutPerPt: 0.05, perSnapPerSD: 0.25, minShare: 0.2, maxShare: 0.95 },
  weight: 1,
  snaps: "passing-down snaps",
};

// WR: run blocking decides the run downs, at three quarters of RB's weight
// ("WRs a little less than RB's", the user, 2026-11-18). The cut is in PFF
// run-block grade points: it starts 1.5 points under the average receiver
// and costs 6 points of run-down snaps per grade point after that. PFF's
// grades don't yet spread beyond their noise (2026-11-18), so the spread sits
// at the component floor and every receiver's grade is shrunk hard; the
// effect grows as the charted games do.
export const WR_RUN_DOWNS: AddedFieldTime = {
  dials: { baseShare: 0.75, earnPerSD: 0.10, bothPerSD: 0.10, cutStartsAtPts: -1.5, cutPerPt: 0.06, perSnapPerSD: 0.25, minShare: 0.2, maxShare: 0.95 },
  weight: 0.75,
  snaps: "run-down snaps",
};

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** His share of snaps (0–1) from his skill and blocking z's; `tauBlock` turns blocking z into points. */
export function snapShare(zSkill: number, zBlock: number, tauBlock: number, d: FieldTimeDials): number {
  const better = clamp(Math.max(zSkill, zBlock), -1, 1);
  const both = clamp(Math.min(zSkill, zBlock), 0, 1);
  const cut = d.cutPerPt * Math.max(0, d.cutStartsAtPts - zBlock * tauBlock);
  return clamp(d.baseShare + d.earnPerSD * better + d.bothPerSD * both - cut, d.minShare, d.maxShare);
}

/** His production per snap, relative to an average player's (1). */
export function perSnap(zSkill: number, d: FieldTimeDials): number {
  return Math.max(0, 1 + d.perSnapPerSD * zSkill);
}

/** Snaps × production per snap, 100 = an average player. */
export function fieldTimeIndex(zSkill: number, zBlock: number, tauBlock: number, d: FieldTimeDials): number {
  return (100 * snapShare(zSkill, zBlock, tauBlock, d) * perSnap(zSkill, d)) / d.baseShare;
}

/**
 * TE: the route z an average blocker (blocking z 0) would need for the same
 * field-time index. For an average blocker it's his own route z. The index
 * of an average blocker only rises with route z, so bisect.
 */
export function routeEquivalent(zRoute: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME): number {
  const target = fieldTimeIndex(zRoute, zBlock, tauBlock, d);
  const at = (z: number) => fieldTimeIndex(z, 0, tauBlock, d);
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

/**
 * RB / WR: what his blocking adds to the score, against an average blocker
 * with the same skill: weight × (his share − that share) / base share ×
 * production per snap. 0 for an average blocker.
 */
export function blockingEffect(zSkill: number, zBlock: number, tauBlock: number, rule: AddedFieldTime): number {
  const d = rule.dials;
  const change = snapShare(zSkill, zBlock, tauBlock, d) - snapShare(zSkill, 0, tauBlock, d);
  return (rule.weight * change * perSnap(zSkill, d)) / d.baseShare;
}

/** How his field time reads, e.g. "82% of snaps × 1.19 per snap". */
export function describeFieldTime(zSkill: number, zBlock: number, tauBlock: number, d: FieldTimeDials = TE_FIELD_TIME, snaps = "snaps"): string {
  return `${Math.round(snapShare(zSkill, zBlock, tauBlock, d) * 100)}% of ${snaps} × ${perSnap(zSkill, d).toFixed(2)} per snap`;
}
