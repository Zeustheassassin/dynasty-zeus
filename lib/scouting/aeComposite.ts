// AE Score: one cross-position number from the Above-Expected metrics (QB AAE,
// RB SRAE, WR SAE, TE-SAER + TE-SAEB), so a QB and a WR can sit on one board.
//
// The raw metrics can't be compared directly. They're in different units
// (graded throw value, run success, open rate), and each position spreads
// differently: a +3 means more at a position where almost everyone sits
// within ±2. Two steps fix that.
//
// 1. Discount luck. Much of a prospect's AE is sample noise. Measured 2026-10
//    on real charting, a median QB's AAE (70 throws) was only ~19% signal, a
//    median RB's SRAE (48 runs) ~24%, a median WR's SAE (155 routes) ~47%.
//    Each AE is pulled toward the position average in proportion to how noisy
//    it is: reliability = τ² / (τ² + v), where v is the prospect's own
//    sampling variance (AESample) and τ the position's true-talent spread. A +14 on 30 throws
//    no longer outranks a +5 on 150.
// 2. Standardize. The shrunk AE is divided by τ, giving "true-talent SDs
//    above the average charted prospect at the position": comparable across
//    positions whatever the metric's units.
//
// So score = τ·(ae − μ) / (τ² + v): the prospect's estimated talent, in τ units.
//
// τ and μ come from the pool itself: every qualified prospect at the position,
// all draft classes, re-estimated live as charting grows. They are estimated
// by Paule–Mandel, the standard random-effects estimator for units with very
// different sample sizes (WRs here run 15 to 340 routes). A simple
// "observed variance minus mean noise" estimate lets the noisiest samples
// dominate and put QB's τ near 0.6 pts. Paule–Mandel puts it at ~2.0.
//
// A position joins the score only once MIN_POOL prospects clear its primary
// metric's sample floor. τ can't be read off a handful of players. TE sat at
// 3 when this shipped; it joined on 2026-10-21 with a spread floor (TE_SPREAD_FLOOR).

import type { AESample, ScoreComponent } from "../types";
import { blockingEffect, describeFieldTime, routeEquivalent, RB_PASS_DOWNS, WR_RUN_DOWNS, type AddedFieldTime } from "./fieldTime";

export type CompositePos = "QB" | "RB" | "WR" | "TE";

// Prospects that must clear a metric's sample floor before that metric's
// spread is estimated and it counts.
export const MIN_POOL = 10;

// A sampling variance under 1 pt² (an SE under 1 pt) only comes from a
// degenerate sample, e.g. every route in one cell and all of them open. Real
// samples sit near 4 pts² or more even at 340 routes.
const MIN_VARIANCE = 1;

export interface CompositeMetric {
  key: string;
  label: string;
  /** Share of the position's score. Only weights of ready metrics count. */
  weight: number;
  /** Every prospect at the position; null = under the metric's sample floor. */
  samples: Map<string, AESample | null>;
  /** Plays at which a sample counts in full (see trustAt), or a rule giving it
   *  from the metric's half point. Unset: the statistical reliability
   *  τ² / (τ² + v), which never reaches 100%. */
  fullTrustAt?: number | ((halfPoint: number) => number);
  /** A component not every prospect has (PFF results, tag-only stats): it
   *  counts only for prospects who have it, renormalized per player, with its
   *  weight scaled by how far his sample is trusted. See buildPositionComposite. */
  perPlayer?: true;
  /** Added on top of the averaged score instead of averaged in: the prospect
   *  gains weight × z (z = his shrunk distance from the pool mean, in τ), so
   *  one at the pool's mean gets exactly 0 whatever his other metrics, one
   *  better gains and one worse loses. For a modifier like fumbles, where a
   *  weighted average would drag an elite player with an average rate down. */
  additive?: true;
  /** Tooltip text for a prospect's value, e.g. "6.1% on 210 attempts (pool 4.5%)". */
  describe?: (id: string, sample: AESample) => string;
  /** A floor on the true spread, as a share of the pool's observed spread
   *  (the SD of the prospects' values). Paule–Mandel puts τ at 0 when the
   *  pool doesn't yet spread beyond its noise; the floor keeps such a metric
   *  counting, trusted by τ² / (τ² + v) at the floored τ. */
  spreadFloor?: number;
  /** Measure τ on these instead of `samples`: the same players' values before
   *  the season units (contextGrading.ts contextAdjust), so that credit moves
   *  each player's own number, never the yardstick. The pool mean is still
   *  `samples`' own (at that τ). */
  spreadSamples?: Map<string, AESample | null>;
  /** The smallest sampling variance a sample is taken to have (default
   *  MIN_VARIANCE, 1 pt², a guard for AE points). A component in other units
   *  (yards per route, say) sets its own. */
  minVariance?: number;
}

export interface MetricSpread {
  key: string;
  label: string;
  weight: number;
  /** Prospects with a sample (cleared the floor). */
  qualified: number;
  /** In the score: ≥ MIN_POOL qualified and a non-zero spread. */
  ready: boolean;
  /** Pool mean, pts (precision-weighted). Null when not ready. */
  mean: number | null;
  /** True-talent SD, pts. Null when not ready. */
  tau: number | null;
  /** With fullTrustAt: the plays at which a typical prospect is half-trusted
   *  statistically (median per-play noise / τ²), which sets the curve's shape. */
  halfPoint?: number;
  fullTrustAt?: number;
  /** A per-player component (CompositeMetric.perPlayer). */
  perPlayer?: true;
  /** Added on top, not averaged in (CompositeMetric.additive). */
  additive?: true;
  /** τ is the spread floor's, not Paule–Mandel's (CompositeMetric.spreadFloor). */
  floored?: true;
  /** τ was measured before the season units (CompositeMetric.spreadSamples). */
  heldSpread?: true;
}

/** A metric that counts through a rule with another skill instead of as a
 *  weighted share: blocking through field time (fieldTime.ts). Its weight is
 *  0; it adds the rule's effect (ScoreComponent.contribution), not weight × z.
 *  Two ways the effect counts:
 *   - "averaged" (TE): routes and blocking scored as one. combine gives the
 *     pair's z in the primary's SDs (the route equivalent), standing in for
 *     the primary's z in the weighted average: the modifier adds
 *     primary weight × (combine − z). combine(z, 0, τ) must be z.
 *   - "added" (RB pass pro, WR run blocking): combine gives the modifier's own
 *     effect in score units, added on top of the averaged score like an
 *     additive component. combine(z, 0, τ) must be 0.
 *  Either way a prospect without a modifier sample is average on it, so the
 *  rule leaves his score as it was. */
export type PairedMetrics = {
  /** The metric that works through the rule (weight 0; a per-player one is
   *  kept in the score at weight 0 for this). */
  modifier: string;
  /** From the skill's z, the modifier's shrunk z and its spread τ (pts),
   *  which turns its z back into points. */
  combine: (zSkill: number, zModifier: number, tauModifier: number) => number;
  /** How the rule read him, for the breakdown. */
  describe?: (zSkill: number, zModifier: number, tauModifier: number) => string;
} & (
  | {
      counts: "averaged";
      /** The metric the pair is scored in; its weight is the pair's. */
      primary: string;
    }
  | {
      counts: "added";
      /** The skill the rule reads, as weights over his shrunk z's: Σ w·z / Σ w,
       *  a metric he has no sample on counting as average (0). */
      skill: Readonly<Record<string, number>>;
    }
);

export type { ScoreComponent };

export interface AEScore {
  score: number;
  /** One per ready metric the prospect has a sample for; a ready metric without one counts as 0. */
  components: ScoreComponent[];
  /** The position's baseline shift (POSITION_BASELINE), already in `score`. */
  baseline?: number;
}

export interface PositionComposite {
  pos: CompositePos;
  /** The primary (first) metric is ready, so the position is scored. */
  ready: boolean;
  metrics: MetricSpread[];
  /** Prospects with a primary-metric sample. Empty when not ready. */
  scores: Map<string, AEScore>;
}

const varianceOf = (s: AESample, min = MIN_VARIANCE) => Math.max(s.variance, min);

// Generalized Q at a candidate τ²: each prospect weighted by 1 / (v + τ²).
function generalizedQ(xs: AESample[], tau2: number, minVar: number): { q: number; mean: number } {
  let sw = 0, swy = 0;
  for (const s of xs) { const w = 1 / (varianceOf(s, minVar) + tau2); sw += w; swy += w * s.ae; }
  const mean = swy / sw;
  let q = 0;
  for (const s of xs) q += ((s.ae - mean) ** 2) / (varianceOf(s, minVar) + tau2);
  return { q, mean };
}

// Paule–Mandel: the τ² at which the generalized Q equals its expectation
// (k − 1). Q falls as τ² grows, so bisect. τ² = 0 when the pool spreads no
// more than its noise alone would (Q already ≤ k − 1 at τ² = 0). The search
// starts at the pool's own scale, so metrics in small units (yards per route)
// bisect as finely as AE points.
export function estimateSpread(xs: AESample[], minVar = MIN_VARIANCE): { mean: number; tau2: number } {
  if (xs.length < 2) return { mean: xs[0]?.ae ?? 0, tau2: 0 };
  const target = xs.length - 1;
  if (generalizedQ(xs, 0, minVar).q <= target) return { mean: generalizedQ(xs, 0, minVar).mean, tau2: 0 };
  let lo = 0;
  let hi = minVar === MIN_VARIANCE ? 1 : Math.max(1e-12, observedSD(xs) ** 2);
  while (generalizedQ(xs, hi, minVar).q > target) { lo = hi; hi *= 2; }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (generalizedQ(xs, mid, minVar).q > target) lo = mid; else hi = mid;
  }
  const tau2 = (lo + hi) / 2;
  return { mean: generalizedQ(xs, tau2, minVar).mean, tau2 };
}

// Trust with a full-trust ceiling (the user's call for WRs, 2026-10-01: 232
// total routes, 168 core). At or above `full` plays a sample counts at face
// value. Below, trust follows the statistical curve n / (n + halfPoint), which
// gains fast early and flattens later, rescaled so it reaches 1 exactly at
// `full`. It depends only on the play count, so every prospect at the ceiling
// is treated alike.
export function trustAt(n: number, full: number, halfPoint: number): number {
  if (n >= full) return 1;
  const f = (x: number) => x / (x + halfPoint);
  return f(n) / f(full);
}

const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a[Math.floor(a.length / 2)]; };

// The SD of the prospects' values as observed (true spread and noise together).
function observedSD(xs: readonly AESample[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x.ae, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x.ae - mean) ** 2, 0) / (xs.length - 1));
}

// metrics[0] is the primary metric: it decides whether the position is scored
// and who gets a score. Later metrics add to that score once they're ready
// themselves; until then they're left out and the weights renormalize.
// `baseline` shifts every score at the position (see POSITION_BASELINE).
//
// Two kinds of later metric:
//   - The user's own AEs (WR SAE, TE-SAEB): a prospect under the floor counts
//     0 (average) for it, at its full weight. That's the right estimate for a
//     metric everyone at the position is charted on.
//   - Per-player components (`perPlayer`: PFF results, tag-only stats), which
//     many prospects can never have: an old game has no tags, and some games
//     have no PFF row. Counting those as 0 at full weight would pull every
//     prospect without one toward the middle, so instead each counts only for
//     prospects who have it, renormalized per player, and its weight scales
//     with his trust in it (weight × reliability): one tagged game barely
//     moves a player, a full sample counts at the full weight. Its numerator
//     is the same shrunk z as any metric (weight × reliability × raw z), so
//     a component that agrees with his other metrics leaves his score where
//     it was. A prospect without a per-player sample keeps exactly the score
//     he'd have without the component; so do positions whose component isn't
//     ready, or weighted 0.
//   - Additive components (`additive`, also per-player: fumbles) aren't
//     averaged at all. He gains weight × z on top of the averaged score, so
//     a prospect at the pool's mean gets 0 however good the rest of his game
//     is (averaged in, an average rate would pull an elite back down and lift
//     a poor one), and the trust in his sample is already in z.
//
// `paired` counts one metric through a rule with another skill (PairedMetrics,
// blocking through field time). "averaged" (TE): the primary adds weight × z
// as usual, and the modifier adds the rest of the pair's score,
// weight × (combine(z, zModifier) − z), so the pieces still sum to the score.
// "added" (RB, WR): the modifier adds combine(skill z, zModifier) on top of
// the averaged score, like an additive component.
export function buildPositionComposite(pos: CompositePos, metrics: CompositeMetric[], baseline = 0, paired?: PairedMetrics): PositionComposite {
  const fitted = metrics.map((m) => {
    const xs = [...m.samples.values()].filter((s): s is AESample => s != null);
    const minVar = m.minVariance ?? MIN_VARIANCE;
    // The yardstick's pool: before the season units when given (spreadSamples).
    const held = m.spreadSamples ? [...m.spreadSamples.values()].filter((s): s is AESample => s != null) : null;
    const sx = held && held.length === xs.length ? held : xs;
    const pm = xs.length >= MIN_POOL ? estimateSpread(sx, minVar) : null;
    const floor2 = pm && m.spreadFloor ? (m.spreadFloor * observedSD(sx)) ** 2 : 0;
    const spread0 = pm && floor2 > pm.tau2 ? { ...pm, tau2: floor2 } : pm;
    // The mean is the scored values' own, weighted at that τ.
    const est = spread0 && sx !== xs ? { ...spread0, mean: generalizedQ(xs, spread0.tau2, minVar).mean } : spread0;
    const ready = est != null && est.tau2 > 0;
    const spread: MetricSpread = {
      key: m.key, label: m.label, weight: m.weight,
      qualified: xs.length,
      ready,
      mean: ready ? est.mean : null,
      tau: ready ? Math.sqrt(est.tau2) : null,
      ...(m.perPlayer ? { perPlayer: true as const } : {}),
      ...(m.additive ? { additive: true as const } : {}),
      ...(ready && spread0 !== pm ? { floored: true as const } : {}),
      ...(ready && sx !== xs ? { heldSpread: true as const } : {}),
    };
    if (ready && m.fullTrustAt != null) {
      spread.halfPoint = median(xs.map((s) => varianceOf(s, minVar) * s.n)) / est.tau2;
      spread.fullTrustAt = typeof m.fullTrustAt === "function" ? m.fullTrustAt(spread.halfPoint) : m.fullTrustAt;
    }
    return { m, spread, minVar };
  });
  const spreads = fitted.map((f) => f.spread);
  const scores = new Map<string, AEScore>();
  const primary = fitted[0];
  if (!primary?.spread.ready) return { pos, ready: false, metrics: spreads, scores };

  // A per-player component at weight 0 is shown, not scored, unless it's the
  // pair's modifier, which counts through the rule at weight 0.
  const ready = fitted.filter((f) => f.spread.ready && !(f.m.perPlayer && !(f.m.weight > 0) && f.m.key !== paired?.modifier));
  const totalWeight = ready.reduce((s, f) => s + (f.m.perPlayer ? 0 : f.m.weight), 0);
  for (const [id, primarySample] of primary.m.samples) {
    if (!primarySample) continue;
    const components: ScoreComponent[] = [];
    let weighted = 0;
    let perPlayerWeight = 0;
    let added = 0;
    for (const { m, spread, minVar } of ready) {
      const s = m.samples.get(id);
      if (!s) continue; // no evidence on this metric: the best estimate is average, 0
      const tau = spread.tau!;
      const reliability = spread.fullTrustAt != null
        ? trustAt(s.n, spread.fullTrustAt, spread.halfPoint!)
        : (tau * tau) / (tau * tau + varianceOf(s, minVar));
      const z = (reliability * (s.ae - spread.mean!)) / tau;
      const c: ScoreComponent = { key: m.key, label: m.label, weight: m.weight, ae: s.ae, rawAe: s.rawAe, n: s.n, reliability, z };
      if (m.describe) c.text = m.describe(id, s);
      components.push(c);
      if (m.additive) {
        c.perPlayer = true;
        c.additive = true;
        added += m.weight * z;
        continue;
      }
      if (m.key === paired?.modifier) { // adds through the pair's rule, below
        if (m.perPlayer) c.perPlayer = true;
        continue;
      }
      if (m.perPlayer) {
        c.perPlayer = true;
        c.effectiveWeight = m.weight * reliability;
        perPlayerWeight += c.effectiveWeight;
      }
      weighted += m.weight * z;
    }
    const mod = paired && components.find((c) => c.key === paired.modifier);
    const modTau = paired && ready.find((f) => f.m.key === paired.modifier)?.spread.tau;
    if (paired && mod && modTau) {
      if (paired.counts === "averaged") {
        const lead = components.find((c) => c.key === paired.primary);
        if (lead) {
          mod.contribution = lead.weight * (paired.combine(lead.z, mod.z, modTau) - lead.z);
          if (paired.describe) mod.via = paired.describe(lead.z, mod.z, modTau);
          weighted += mod.contribution;
        }
      } else {
        const zOf = (key: string) => components.find((c) => c.key === key)?.z ?? 0;
        const sw = Object.values(paired.skill).reduce((a, w) => a + w, 0);
        const zSkill = sw > 0 ? Object.entries(paired.skill).reduce((a, [key, w]) => a + w * zOf(key), 0) / sw : 0;
        mod.additive = true;
        mod.contribution = paired.combine(zSkill, mod.z, modTau);
        if (paired.describe) mod.via = paired.describe(zSkill, mod.z, modTau);
        added += mod.contribution;
      }
    }
    scores.set(id, { score: weighted / (totalWeight + perPlayerWeight) + added + baseline, components, ...(baseline ? { baseline } : {}) });
  }
  return { pos, ready: true, metrics: spreads, scores };
}

// ── The board's inputs ───────────────────────────────────────────────────
// One headline metric each for QB and RB. Blocking counts through field time
// at TE, RB and WR (fieldTime.ts): it scores no fantasy points but decides how
// often he's on the field, so it moves his score through his snaps, not as a
// weighted share. TE pairs route running (SAER) with blocking (SAEB); RB adds
// pass protection (charted PB%) on passing downs and WR run blocking (PFF's
// run-block grade) on run downs.
//
// WR leans on cSAE, 70/30 with SAE, by the user's call (2026-10-01). A nine is
// often a clear-out with no intent to win, and a screen is close to an
// automatic win, so cSAE (neither) is the read on the routes a receiver is
// actually trying to win. cSAE is the primary metric: a WR needs 15 core routes
// to be scored. Its routes are a subset of SAE's, so in effect core routes
// count in full and nines and screens at about 30%.
export const WR_CORE_WEIGHT = 0.7;
export const WR_ALL_WEIGHT = 0.3;
// WR samples count in full from these route counts (the user's call,
// 2026-10-01; see trustAt).
export const WR_CORE_FULL_TRUST = 168;
export const WR_ALL_FULL_TRUST = 232;

// QB and RB ceilings, also the user's (2026-10-02): a QB counts in full at 232
// throws, an RB at 160 runs. They replace ceilings matched to WR's, which had
// drifted to ~282 throws and ~234 runs, out of an RB's reach (the most charted
// has 103). Below a ceiling a lower one lifts every sample's trust by the same
// factor, so it only widens the position's spread: on the real data ×1.09 for
// QB and ×1.19 for RB, with the 2027 top 34 mix unchanged.
export const QB_FULL_TRUST = 232;
export const RB_FULL_TRUST = 160;

// Every RB's AE Score sits 0.1 lower (the user's call; −0.2 on 2026-10-02,
// halved 2026-11-22). Each position's 0 is its own average charted prospect,
// and on that footing RBs crowded the board: 13 of the 2027 top 34, against
// about 10 in the user's own rankings (15 WR, 10 RB, 9 QB). Scaling RB scores
// down couldn't fix that: it pulls good RBs down but lifts below-average ones
// toward 0, right where the cut sits. So the level moves instead. At −0.2 the
// 2027 top 34 went from 8 QB, 13 RB, 13 WR to 8 / 11 / 15. By 11/22 (season
// units, more charting) −0.2 left RBs at 8 of the Dynasty top 34; −0.1 gives
// 7 QB / 10 RB / 14 WR / 3 TE and keeps Keyjuan Brown (2.19) under the 2.25
// Generational line, where 0 would put him over it (2.29).
export const POSITION_BASELINE: Partial<Record<CompositePos, number>> = { RB: -0.1 };

// TE's ceiling is matched to WR's, so TE neither gains nor loses on WR when it
// joins. A ceiling F lifts trust below it by (F + h) / F, where h is the
// metric's half point. A TE metric's ceiling sits at the same multiple of its
// own half point as WR's do, recomputed from the data every time, so the boost
// matches. (QB and RB used this until their own ceilings were set.) With no WR
// ceiling to match (WR not ready), TE keeps the statistical reliability.
export function matchedCeiling(wr: PositionComposite): ((halfPoint: number) => number) | undefined {
  const capped = wr.metrics.filter((m) => m.ready && m.fullTrustAt != null && m.halfPoint != null);
  if (!capped.length) return undefined;
  const totalW = capped.reduce((a, m) => a + m.weight, 0);
  const boost = capped.reduce((a, m) => a + m.weight * (m.fullTrustAt! + m.halfPoint!) / m.fullTrustAt!, 0) / totalW;
  if (!(boost > 1)) return undefined;
  const multiple = 1 / (boost - 1);
  return (h) => Math.round(multiple * h);
}
// TE: routes carry the charted weight in full and blocking adds through field
// time (weight 0, PairedMetrics). Replaced SAER 0.8 + SAEB 0.2 on 2026-10-21.
export const TE_ROUTE_WEIGHT = 1;
export const TE_BLOCK_WEIGHT = 0;
export const TE_FIELD_TIME_PAIR: PairedMetrics = {
  counts: "averaged",
  primary: "te_saer",
  modifier: "te_saeb",
  combine: (z, zB, tau) => routeEquivalent(z, zB, tau),
  describe: (z, zB, tau) => describeFieldTime(z, zB, tau),
};

// RB and WR blocking, added on top of the score through field time (the
// user, 2026-11-18). Each blocking component has weight 0 in
// chartedComponents.ts / pffComponents.ts and counts only here.
const addedFieldTime = (modifier: string, skill: Readonly<Record<string, number>>, rule: AddedFieldTime): PairedMetrics => ({
  counts: "added",
  modifier,
  skill,
  combine: (z, zB, tau) => blockingEffect(z, zB, tau, rule),
  describe: (z, zB, tau) => describeFieldTime(z, zB, tau, rule.dials, rule.snaps),
});
// RB: pass protection decides his passing downs; what he does with them is
// his receiving, read from the receiving components at their own weights
// (Open% 0.1, Drop% 0.1, PFF YPRR 0.2).
export const RB_FIELD_TIME_PAIR = addedFieldTime("ch_rb_pb", { ch_rb_open: 0.1, ch_rb_drop: 0.1, pff_rb_yprr: 0.2 }, RB_PASS_DOWNS);
// WR: run blocking decides his run downs; what he does with them is his route
// running, cSAE and SAE at their 70/30.
export const WR_FIELD_TIME_PAIR = addedFieldTime("pff_wr_rbg", { csae: WR_CORE_WEIGHT, sae: WR_ALL_WEIGHT }, WR_RUN_DOWNS);
/** The metrics that count only through field time (Grading checks). */
export const FIELD_TIME_MODIFIERS: ReadonlySet<string> = new Set([TE_FIELD_TIME_PAIR, RB_FIELD_TIME_PAIR, WR_FIELD_TIME_PAIR].map((p) => p.modifier));

// TEs joined before their pool showed its own spread (the user's call,
// 2026-10-21: 11 TEs at ~40 routes each, Paule–Mandel τ 0 on both metrics,
// the observed spread no wider than the noise). The floor keeps τ at half the
// observed spread, the same floor the components use (aeComponents.ts), so
// scores stay heavily shrunk; Paule–Mandel takes over once it reads higher.
// To revisit after about 30–40 more TE games.
export const TE_SPREAD_FLOOR = 0.5;

export interface AECompositeInputs {
  qb: Map<string, AESample | null>;
  rb: Map<string, AESample | null>;
  /** WR SAE (every route). */
  wr: Map<string, AESample | null>;
  /** WR cSAE (no nines or screens). */
  wrCore: Map<string, AESample | null>;
  teRoute: Map<string, AESample | null>;
  teBlock: Map<string, AESample | null>;
  /** Per-player components by position (PFF results, tag-only stats), each a
   *  `perPlayer` metric after the user's own. */
  extra?: Partial<Record<CompositePos, CompositeMetric[]>>;
  /** A headline metric's samples before its season units, to measure its
   *  spread on (CompositeMetric.spreadSamples); keyed like the inputs above. */
  spreadFrom?: Partial<Record<"qb" | "rb" | "wr" | "wrCore" | "teRoute" | "teBlock", Map<string, AESample | null>>>;
}

export interface AEComposite {
  positions: Record<CompositePos, PositionComposite>;
  /** Every scored prospect, all positions. */
  scores: Map<string, AEScore>;
}

export function buildAEComposite(inp: AECompositeInputs): AEComposite {
  const extra = (pos: CompositePos) => (inp.extra?.[pos] ?? []).map((m) => ({ ...m, perPlayer: true as const }));
  const held = (k: keyof NonNullable<AECompositeInputs["spreadFrom"]>) => {
    const s = inp.spreadFrom?.[k];
    return s ? { spreadSamples: s } : {};
  };
  const WR = buildPositionComposite("WR", [
    { key: "csae", label: "cSAE", weight: WR_CORE_WEIGHT, samples: inp.wrCore, fullTrustAt: WR_CORE_FULL_TRUST, ...held("wrCore") },
    { key: "sae", label: "SAE", weight: WR_ALL_WEIGHT, samples: inp.wr, fullTrustAt: WR_ALL_FULL_TRUST, ...held("wr") },
    ...extra("WR"),
  ], POSITION_BASELINE.WR, WR_FIELD_TIME_PAIR);
  const matched = matchedCeiling(WR);
  const positions: Record<CompositePos, PositionComposite> = {
    QB: buildPositionComposite("QB", [{ key: "aae", label: "AAE", weight: 1, samples: inp.qb, fullTrustAt: QB_FULL_TRUST, ...held("qb") }, ...extra("QB")], POSITION_BASELINE.QB),
    // RB's samples come in at the NFL run mix (runMix.ts), so its label says so.
    RB: buildPositionComposite("RB", [{ key: "srae", label: "SRAE (NFL run mix)", weight: 1, samples: inp.rb, fullTrustAt: RB_FULL_TRUST, ...held("rb") }, ...extra("RB")], POSITION_BASELINE.RB, RB_FIELD_TIME_PAIR),
    WR,
    TE: buildPositionComposite("TE", [
      { key: "te_saer", label: "TE-SAER", weight: TE_ROUTE_WEIGHT, samples: inp.teRoute, fullTrustAt: matched, spreadFloor: TE_SPREAD_FLOOR, ...held("teRoute") },
      { key: "te_saeb", label: "TE-SAEB", weight: TE_BLOCK_WEIGHT, samples: inp.teBlock, fullTrustAt: matched, spreadFloor: TE_SPREAD_FLOOR, ...held("teBlock") },
      ...extra("TE"),
    ], POSITION_BASELINE.TE, TE_FIELD_TIME_PAIR),
  };
  const scores = new Map<string, AEScore>();
  for (const pc of Object.values(positions)) for (const [id, sc] of pc.scores) scores.set(id, sc);
  return { positions, scores };
}
