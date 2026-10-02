// Per-prospect "Above Expected" metric calculators for RB / QB / TE (WR SAE
// lives in aggregateMerge.ts, fed from server-side cell counts).
//
// Each function returns a Map<prospect_id, number | null> where the number
// is the metric in percentage points (e.g. +5.2 means 5.2 pp better than
// the league would be expected to do on the same plays). Returns null for
// prospects under the minimum sample or with no league to compare against.
//
// All of them share one shape: actual rate − the mean per-play expected rate
// from the league difficulty model (difficultyModel.ts), which judges each
// play against plays like it, every situation tag's effect stacked. They
// differ only in the outcome, the situation dimensions, and the ridge strength.
//
// A prospect's plays are season-weighted (seasonWeight.ts): older tape counts
// a little less than his newest. The per-game functions (`*ForPlays`) take a
// single game, so they're unweighted.

import type {
  AESample,
  Prospect,
  ScoutingGame,
  RBPlay,
  QBPlay,
  TEPlay,
  RBFormation,
  RBRunType,
  QBDepthZone,
  QBTiming,
  QBPressure,
  QBPressureHandling,
  RouteType,
  TEPositioning,
  TECoverage,
} from "../types";
import { ROUTE_TYPES } from "../../components/scouting/shared/chartingConstants";
import type { OpponentTier } from "./opponentTier";
import {
  makeDesign,
  fitDifficultyModel,
  fitFromPlays,
  expectedFromModel,
  aboveExpectedForPlays,
  aboveExpectedSampleForPlays,
  emptyResidualSums,
  addResidual,
  residualVariancePts,
  type DifficultyDim,
  type ModelRow,
  type FittedDifficulty,
} from "./difficultyModel";
import { playWeights, type PlayWeight } from "./seasonWeight";

const RB_RUN_TYPES: RBRunType[] = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];
const RB_FORMATIONS: RBFormation[] = ["gun", "pistol", "under_center"];

const QB_DEPTH_ZONES: QBDepthZone[] = [
  "deep_left", "deep_center", "deep_right",
  "mid_left",  "mid_center",  "mid_right",
  "short_left","short_center","short_right",
];
// Throw-result timings only — scramble/sack/throw_away leave accuracy null and
// are already filtered out of AAE.
const QB_TIMING_BUCKETS: QBTiming[] = ["first_option", "second_option", "checkdown", "extended_play"];
const QB_PRESSURE_BUCKETS: QBPressure[] = ["clean", "mid", "backside", "front_side"];
// Platform dimension is split on its side: an on-the-run throw is bucketed by
// whether it was strong-side or cross-body (cross-body throws are meaningfully
// harder). platform_side is only charted on `on_the_run` plays, so on-platform /
// off-platform keep a single bucket each. `on_the_run` (no side charted) is the
// fallback bucket for older plays.
type QBPlatformKey =
  | "on_platform" | "off_platform"
  | "on_the_run" | "on_the_run_strong" | "on_the_run_cross";
const QB_PLATFORM_KEYS: QBPlatformKey[] = [
  "on_platform", "off_platform", "on_the_run", "on_the_run_strong", "on_the_run_cross",
];
function platformKey(pl: QBPlay): QBPlatformKey | null {
  if (!pl.platform) return null;
  if (pl.platform !== "on_the_run") return pl.platform; // on_platform | off_platform
  if (pl.platform_side === "strong_side") return "on_the_run_strong";
  if (pl.platform_side === "cross_body")  return "on_the_run_cross";
  return "on_the_run";
}

const TE_POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back", "wing_back"];
// Coverage buckets for TE routes. Press is its own bucket (a harder look than
// off man), not folded into man: the difficulty model has no need for the
// mutually-exclusive merge the old weighted average relied on.
const TE_COVERAGES: TECoverage[] = ["man", "press", "zone", "double"];

const MIN_SAMPLE = 15;
// QB AAE samples 7 dimensions so each dimension's expected estimate is noisier
// than the 2-dimension RB/TE versions — raise the minimum to compensate.
const QB_MIN_SAMPLE = 25;
// Empirical-Bayes shrinkage strength for league bucket baselines. A bucket's
// rate is pulled toward the global mean throw value by SHRINK_K pseudo-throws:
//   shrunk = (sum_value + SHRINK_K * globalMean) / (n + SHRINK_K)
// Thin buckets (a depth zone seen only a handful of times) collapse toward the
// league average instead of swinging the metric on noise; fat buckets are
// barely moved. Tune up as samples stay small, down as the dataset grows.
const SHRINK_K = 10;

// The by-slice breakdowns (QB throws by location, RB runs by run type) need
// this many plays in the slice itself, on top of the prospect clearing the
// headline floor. Measured 2026-09: the median charted QB has 12 deep throws
// (some have 3) and the median back 17 outside runs; a 3-play slice swings
// ±30 pts on one rep and would top any sort. 10 keeps most prospects' slices
// visible and blanks the ones that are only noise.
const SLICE_MIN_SAMPLE = 10;

// One slice's above-expected value (pts; null = under a floor) and how many of
// the prospect's plays fell in it.
export interface AESlice { ae: number | null; n: number }

// The headline calculators come in pairs: `compute*AboveExpectedSamples` keeps
// each prospect's play count and sampling variance (the composite needs them),
// and `compute*AboveExpected` is just its values. Callers that need both should
// take the samples and map them through aeValues, so the league model is fit once.
// The RB / TE sample functions also take an optional game → opponent tier map,
// which sums each prospect's residuals by tier (AESample.byTier) for the AE
// Score's opponent adjustment. The values are the same either way. QB takes
// none: the user expects no cross-level effect on accuracy.
export function aeValues(samples: Map<string, AESample | null>): Map<string, number | null> {
  return new Map([...samples].map(([id, s]) => [id, s?.ae ?? null]));
}

// #3-modified — graded "throw value" replacing the old binary on-target flag.
// An on_target throw is a perfect 1.0 (caught or dropped — placement is the
// QB's, the catch is the receiver's). Every OFF-target grade scores the same,
// regardless of severity: high / low / in_front / behind all = MISS_BASE. The
// metric is on-target vs not, not a ranking of miss types. A small CATCH_BONUS
// layers on so a functional, caught miss edges an identical dropped one ("not as
// bad as his accuracy looks") without letting catchable inaccuracy out-score a
// pinpoint passer.
//
//   on_target            → 1.00
//   any miss, caught     → MISS_BASE + CATCH_BONUS  (0.30)
//   any miss, not caught → MISS_BASE                (0.20)
//
// All values are tunable. Both the QB's actual value and every league baseline
// are computed on this scale. tipped_ball / null accuracy never reach here
// (filtered out by isQBGradedThrow).
const MISS_BASE = 0.2;
const CATCH_BONUS = 0.1;
function throwValue(pl: QBPlay): number {
  if (pl.accuracy === "on_target") return 1;
  if (pl.accuracy == null) return 0;  // not reached — filtered upstream
  return pl.completion === "caught" ? MISS_BASE + CATCH_BONUS : MISS_BASE;
}

function buildPlaysByProspect<T extends { game_id: string }>(
  plays: T[],
  gameToProspect: Map<string, string>,
): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const pl of plays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    if (!m.has(pid)) m.set(pid, []);
    m.get(pid)!.push(pl);
  }
  return m;
}

function buildGameToProspect(games: ScoutingGame[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of games) m.set(g.id, g.prospect_id);
  return m;
}

// ── RB SRAE ──────────────────────────────────────────────────────────────
// Success Rate Above Expected: the RB's success rate on known runs minus the
// difficulty model's expected success for those same runs. Situation
// dimensions:
//   formation, box (loaded / not), unblocked defender (yes / no).
// A stuffed run into a loaded box with a free defender costs almost nothing;
// making something of it earns a lot.
//
// Run type (inside/outside zone, man/gap) is deliberately NOT a dimension:
// measured 2026-09 on 1,756 known runs, adding it made predictions for held-out
// RBs worse, not better — which run schemes a back sees tracks his team more
// than the difficulty of the rep.
//
// Ridge strength 3, chosen by 5-fold held-out-RB validation over 1–30: the
// error is flat from 1 to 3 and rises above that; 3 keeps a little more
// protection for the thin buckets (under center, unblocked: ~100 runs each).
const RB_RIDGE_LAMBDA = 3;

const isKnownRun = (pl: RBPlay) =>
  RB_RUN_TYPES.includes(pl.run_type as RBRunType) && pl.success !== null;
const rbSuccess = (pl: RBPlay) => (pl.success ? 1 : 0);
const RB_DIMS: DifficultyDim<RBPlay>[] = [
  [RB_FORMATIONS,           (pl) => pl.formation],
  [["loaded", "unloaded"],  (pl) => (pl.loaded_box ? "loaded" : "unloaded")],
  [["unblocked", "blocked"], (pl) => (pl.unblocked_defender ? "unblocked" : "blocked")],
];
const RB_DESIGN = makeDesign(RB_DIMS);

// The fitted league model. Built once from the full league play set and shared
// across every prospect (and, for the per-game badge, every game).
export type RBBaselines = FittedDifficulty<RBPlay>;

export function buildRBBaselines(rbPlays: RBPlay[]): RBBaselines {
  return fitFromPlays(rbPlays.filter(isKnownRun), RB_DESIGN, rbSuccess, RB_RIDGE_LAMBDA);
}

// Actual-vs-expected for an arbitrary RB play subset (a prospect's whole
// sample, or just one game's). No minimum-sample gate — callers that need
// the reliability floor (season/career) apply MIN_SAMPLE themselves; the
// per-game badge intentionally has none (small samples are expected there).
export function computeRBAboveExpectedForPlays(
  plays: RBPlay[],
  baselines: RBBaselines,
): number | null {
  return aboveExpectedForPlays(plays.filter(isKnownRun), baselines, rbSuccess);
}

export function computeRBAboveExpectedSamples(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
  tierByGame?: ReadonlyMap<string, OpponentTier>,
): Map<string, AESample | null> {
  const out = new Map<string, AESample | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(rbPlays, gameToProspect);
  const baselines = buildRBBaselines(rbPlays);
  const weightOf = playWeights(games);
  const tierOf = tierByGame && ((pl: RBPlay) => tierByGame.get(pl.game_id));

  for (const p of prospects) {
    if (p.position !== "RB") continue;
    const runs = (playsByProspect.get(p.id) ?? []).filter(isKnownRun);
    out.set(p.id, runs.length < MIN_SAMPLE ? null : aboveExpectedSampleForPlays(runs, baselines, rbSuccess, { tierOf, weightOf }));
  }

  return out;
}

export function computeRBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
): Map<string, number | null> {
  return aeValues(computeRBAboveExpectedSamples(prospects, games, rbPlays));
}

// ── RB SRAE by run type ──────────────────────────────────────────────────
// SRAE over one slice of a back's runs: outside vs inside, zone vs man/gap.
// Each slice pairs two of the four run types.
//
// Judged by a SECOND model: the SRAE model plus run type. The headline leaves
// run type out (see RB_RIDGE_LAMBDA), but a slice has to be compared with the
// league on the same kind of run. Measured 2026-09 on 1,775 known runs, the
// headline model left outside runs +3.1 pts above expected league-wide and
// inside runs −1.7, so every back would have read "better outside, worse
// inside" from the run type alone. With run type in, all four slices net to
// within 0.1 pt of 0 league-wide. Zone vs man/gap barely moved (±0.2).
//
// The flip side: the slices are measured against a different baseline than
// the headline, so a back's Outside and Inside don't average back to his SRAE.
export type RBRunSliceKey = "outside" | "inside" | "zone" | "man_gap";
const RB_RUN_SLICES: readonly { key: RBRunSliceKey; runTypes: readonly RBRunType[] }[] = [
  { key: "outside", runTypes: ["outside_zone", "outside_man_gap"] },
  { key: "inside",  runTypes: ["inside_zone", "inside_man_gap"] },
  { key: "zone",    runTypes: ["outside_zone", "inside_zone"] },
  { key: "man_gap", runTypes: ["outside_man_gap", "inside_man_gap"] },
];
const RB_SLICE_DESIGN = makeDesign<RBPlay>([...RB_DIMS, [RB_RUN_TYPES, (pl) => pl.run_type]]);

// Every RB gets an entry; a slice's `ae` is null under the 15-run headline
// floor or the slice's own SLICE_MIN_SAMPLE.
export function computeRBRunSliceSRAE(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
): Map<string, Record<RBRunSliceKey, AESlice>> {
  const out = new Map<string, Record<RBRunSliceKey, AESlice>>();
  const playsByProspect = buildPlaysByProspect(rbPlays, buildGameToProspect(games));
  const fitted = fitFromPlays(rbPlays.filter(isKnownRun), RB_SLICE_DESIGN, rbSuccess, RB_RIDGE_LAMBDA);
  const weightOf = playWeights(games);

  for (const p of prospects) {
    if (p.position !== "RB") continue;
    const runs = (playsByProspect.get(p.id) ?? []).filter(isKnownRun);
    const slices = {} as Record<RBRunSliceKey, AESlice>;
    for (const s of RB_RUN_SLICES) {
      const sub = runs.filter((pl) => s.runTypes.includes(pl.run_type));
      slices[s.key] = {
        n: sub.length,
        ae: runs.length < MIN_SAMPLE || sub.length < SLICE_MIN_SAMPLE ? null : aboveExpectedForPlays(sub, fitted, rbSuccess, weightOf),
      };
    }
    out.set(p.id, slices);
  }

  return out;
}

// ── QB AAE ───────────────────────────────────────────────────────────────
// "Accuracy Above Expected" — the QB's actual mean throw value minus the mean
// expected throw value of the same throws. Each throw's expected comes from a
// league difficulty model over seven situational dimensions:
//   depth zone, coverage, timing, pressure, platform (incl. on-the-run side),
//   pressure handling, route type.
//
// Throw value is the graded score from throwValue() — on-target vs not, plus a
// small bonus if a miss was caught — so the metric leans on QB placement, not
// receiver bail-outs.
//
// The difficulty model (difficultyModel.ts) is a ridge-regularized fractional
// logistic regression of throw value on one-hot buckets of all seven
// dimensions, fit once on every league throw. Each bucket learns how much it adds to or
// takes from a throw's odds, and those effects STACK: a deep nine thrown cross-
// body on the run under pressure is expected to be harder than any one of those
// tags alone, so a miss there costs much less than the same miss from a clean
// pocket, and a hit earns much more. A throw is judged against throws like it.
// Fitting every dimension jointly also lets correlated tags (nine ↔ deep,
// pressure ↔ handling ↔ platform) share credit instead of double-counting. The
// unpenalized intercept makes the league's expected sum equal its actual sum,
// so league-wide AAE is 0 by construction.
//
// This replaced a discrimination-weighted AVERAGE of single-dimension bucket
// rates, which could not stack difficulty and washed out rare-but-hard buckets
// (cross-body, bail-backside): measured 2026-09 on 1,717 league throws, a
// pressured cross-body miss cost within ~2 pts of a clean-pocket one, and on
// held-out QBs the hardest fifth of throws was expected ~8 pts too high.
// Interaction terms (e.g. cross-body hurting more on deep throws than short)
// are deliberately left out until the data can support them.
//
// The per-dimension breakdown rows still use SHRINK_K-shrunk single-dimension
// bucket rates: each row asks "how does he do vs the league within this one
// dimension", which a marginal answers directly.
//
// A dimension that is NULL on a play adds no effect for that play (older plays
// charted before Pressure / Platform / Handling existed aren't pulled either
// way).
//
// Excluded from both numerator and denominator:
//   - Run plays (no throw)
//   - Plays with accuracy == null (sack / scramble / throw_away)
//   - Tipped balls (the intended trajectory is unknowable after a deflection)
const isQBGradedThrow = (pl: QBPlay) =>
  // Include RPO throws — they're real pass attempts with accuracy ratings.
  pl.play_type !== "run" && pl.accuracy != null && pl.accuracy !== "tipped_ball";

interface Acc { v: number; n: number }  // v = summed throw value, n = plays
type Bucketed<K extends string> = Partial<Record<K, Acc>>;

// ── Difficulty model ──
// Ridge strength in pseudo-throws: each bucket's effect is pulled toward 0
// (league average) as if backed by QB_RIDGE_LAMBDA throws of no information. It
// plays the role SHRINK_K plays for the marginal rows — a bucket seen a handful
// of times (comeback, corner, cross-body) can't swing the model. Chosen 2026-09
// by 5-fold held-out-QB validation over 1–100: error is flat across 10–30, and
// 10 is the most even between the hardest and easiest fifths of throws (each
// ~2 pts off). Below ~5 it overfits hard throws; above ~30 it flattens back
// toward average. Re-validate as the dataset grows.
const QB_RIDGE_LAMBDA = 10;

const QB_HANDLING_BUCKETS: QBPressureHandling[] = ["step_up", "bail_front_side", "bail_backside"];
// One one-hot column per bucket of every dimension (see difficultyModel.ts).
const QB_DESIGN = makeDesign<QBPlay>([
  [QB_DEPTH_ZONES,      (pl) => pl.depth_zone],
  [["man", "zone"],     (pl) => pl.coverage],
  [QB_TIMING_BUCKETS,   (pl) => pl.timing],
  [QB_PRESSURE_BUCKETS, (pl) => pl.pressure],
  [QB_PLATFORM_KEYS,    platformKey],
  [QB_HANDLING_BUCKETS, (pl) => pl.pressure_handling],
  [ROUTE_TYPES,         (pl) => pl.route_type],
]);

interface QBBaselines {
  depth:    Bucketed<QBDepthZone>;
  cvg:      Record<"man" | "zone", Acc>;
  timing:   Bucketed<QBTiming>;
  pressure: Bucketed<QBPressure>;
  platform: Bucketed<QBPlatformKey>;
  route:    Bucketed<RouteType>;
  global:   Acc;  // all graded throws — the shrinkage target
  rows:     ModelRow[];  // one per graded throw — the difficulty model's training set
}

export function buildQBBaselines(leaguePlays: QBPlay[]): QBBaselines {
  const b: QBBaselines = {
    depth: {}, cvg: { man: { v: 0, n: 0 }, zone: { v: 0, n: 0 } },
    timing: {}, pressure: {}, platform: {}, route: {},
    global: { v: 0, n: 0 }, rows: [],
  };
  const add = (acc: Acc | undefined, v: number): Acc => {
    const a = acc ?? { v: 0, n: 0 };
    a.v += v; a.n++;
    return a;
  };
  for (const pl of leaguePlays) {
    if (!isQBGradedThrow(pl)) continue;
    const v = throwValue(pl);
    b.global.v += v; b.global.n++;
    if (pl.depth_zone)        b.depth[pl.depth_zone]   = add(b.depth[pl.depth_zone], v);
    if (pl.coverage === "man" || pl.coverage === "zone") b.cvg[pl.coverage] = add(b.cvg[pl.coverage], v);
    if (pl.timing)            b.timing[pl.timing]      = add(b.timing[pl.timing], v);
    if (pl.pressure)          b.pressure[pl.pressure]  = add(b.pressure[pl.pressure], v);
    const pk = platformKey(pl);
    if (pk)                   b.platform[pk]           = add(b.platform[pk], v);
    if (pl.route_type)        b.route[pl.route_type]   = add(b.route[pl.route_type], v);
    b.rows.push({ cols: QB_DESIGN.cols(pl), y: v });
  }
  return b;
}

// Resolved baselines: each dimension's raw counts collapsed into shrunk bucket
// rates (for the per-dimension rows) plus the fitted difficulty model (for the
// overall total). Built once per league scan and shared by every prospect's
// breakdown.
export interface ResolvedBaselines {
  depth:    Map<QBDepthZone, number>;
  cvg:      Map<"man" | "zone", number>;
  timing:   Map<QBTiming, number>;
  pressure: Map<QBPressure, number>;
  platform: Map<QBPlatformKey, number>;
  route:    Map<RouteType, number>;
  model:    Float64Array | null;  // fitDifficultyModel coefficients; null = no league throws
}

// Collapse one dimension's raw buckets into shrunk rates.
function resolveDim<K extends string>(raw: { [k: string]: Acc | undefined }, mean: number): Map<K, number> {
  const rates = new Map<K, number>();
  for (const k of Object.keys(raw)) {
    const acc = raw[k];
    if (!acc || acc.n <= 0) continue;
    rates.set(k as K, (acc.v + SHRINK_K * mean) / (acc.n + SHRINK_K));
  }
  return rates;
}

export function resolveBaselines(b: QBBaselines): ResolvedBaselines {
  const mean = b.global.n > 0 ? b.global.v / b.global.n : 0;
  return {
    depth:    resolveDim<QBDepthZone>(b.depth, mean),
    cvg:      resolveDim<"man" | "zone">(b.cvg, mean),
    timing:   resolveDim<QBTiming>(b.timing, mean),
    pressure: resolveDim<QBPressure>(b.pressure, mean),
    platform: resolveDim<QBPlatformKey>(b.platform, mean),
    route:    resolveDim<RouteType>(b.route, mean),
    model:    fitDifficultyModel(b.rows, QB_DESIGN.size, QB_RIDGE_LAMBDA),
  };
}

// Per-play expected throw value from the difficulty model: the league's odds
// for a throw carrying exactly this play's situation tags, every filled
// dimension's effect stacked. Null only when there is no model (no league
// throws).
function expectedForPlay(pl: QBPlay, R: ResolvedBaselines): number | null {
  return R.model ? expectedFromModel(R.model, QB_DESIGN.cols(pl)) : null;
}

// Weighted expected throw value for one dimension AND the QB's actual throw
// value over the same subset of plays (those where the dimension is filled and
// the league has a matching bucket). Comparing actual to expected on the same
// subset keeps the per-dim rows honest — pressure_handling, say, is only logged
// on pressured throws, so comparing all-throw value against a pressured-only
// baseline biases the row positive league-wide. Bucket shares and the actual
// value are season-weighted (weightOf; default 1).
function expectedFor<K extends string>(
  ratedPasses: QBPlay[],
  bucketFn: (pl: QBPlay) => K | null | undefined,
  rates: Map<K, number>,
  buckets: readonly K[],
  weightOf?: PlayWeight,
): { expected: number | null; actual: number | null; n: number } {
  if (!ratedPasses.length) return { expected: null, actual: null, n: 0 };
  const wOf = (pl: QBPlay) => (weightOf ? weightOf(pl) : 1);
  let total = 0;
  for (const pl of ratedPasses) total += wOf(pl);
  let exp = 0;
  let weight = 0;
  let filled = 0;
  let filledW = 0;
  let filledVal = 0;
  for (const b of buckets) {
    const inBucket = ratedPasses.filter((pl) => bucketFn(pl) === b);
    const n = inBucket.length;
    const r = rates.get(b);
    if (n > 0 && r != null) {
      let bucketW = 0;
      for (const pl of inBucket) {
        const w = wOf(pl);
        bucketW += w;
        filledVal += w * throwValue(pl);
      }
      const share = bucketW / total;
      exp += share * r;
      weight += share;
      filled += n;
      filledW += bucketW;
    }
  }
  return {
    expected: weight > 0 ? exp / weight : null,
    actual: filled > 0 ? filledVal / filledW : null,
    n: filled,
  };
}

// Per-dimension AAE row: actual throw value minus the dimension's expected,
// in percentage points. `n` is how many of the QB's rated passes had this
// dimension filled (a sample-size signal for the UI).
export interface QBAAEDimRow {
  key: "depth" | "coverage" | "timing" | "pressure" | "platform" | "route";
  label: string;
  aae: number | null;
  n: number;
}

export interface QBAAEBreakdown {
  ratedPasses: number;        // total graded throws (denominator of actual on-target%)
  actualOnTgtPct: number | null;  // literal on-target% — display only, not the AAE basis
  total: number | null;       // overall AAE — actual throw value minus mean per-play expected
  dims: QBAAEDimRow[];
}

function breakdownFor(ratedPasses: QBPlay[], R: ResolvedBaselines, weightOf?: PlayWeight): QBAAEBreakdown {
  const denom = ratedPasses.length;
  if (!denom) {
    return { ratedPasses: 0, actualOnTgtPct: null, total: null, dims: [] };
  }
  // Literal on-target% kept for display only — the AAE math below runs on graded
  // throw value, not this binary rate. A raw stat, so not season-weighted.
  const onTgt = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / denom;

  const rows: QBAAEDimRow[] = [
    { key: "depth",    label: "Depth Zone",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.depth_zone,        R.depth,    QB_DEPTH_ZONES, weightOf)) },
    { key: "coverage", label: "Coverage",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.coverage === "man" || pl.coverage === "zone" ? pl.coverage : null, R.cvg, ["man", "zone"] as const, weightOf)) },
    { key: "timing",   label: "Timing",            ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.timing,            R.timing,   QB_TIMING_BUCKETS, weightOf)) },
    { key: "pressure", label: "Pressure",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.pressure,          R.pressure, QB_PRESSURE_BUCKETS, weightOf)) },
    { key: "platform", label: "Platform",          ...toAaeRow(expectedFor(ratedPasses, platformKey,                  R.platform, QB_PLATFORM_KEYS, weightOf)) },
    // Pressure Handling has no standalone AAE row by design — it still feeds the
    // overall AAE total through the difficulty model (expectedForPlay).
    { key: "route",    label: "Route Type",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.route_type,        R.route,    ROUTE_TYPES, weightOf)) },
  ];

  return {
    ratedPasses: denom,
    actualOnTgtPct: parseFloat((onTgt * 100).toFixed(2)),
    // Intentionally NOT the mean of the per-dim AAEs above — those are
    // one-dimension views, and averaging them double-counts correlated dims
    // (e.g. a broken-pocket throw would be judged four times across the
    // pressure cluster).
    total: modelAAE(ratedPasses, R, weightOf),
    dims: rows,
  };
}

// AAE over a set of graded throws: each throw's actual value vs the difficulty
// model's expected for that throw's full situation mix (see expectedForPlay),
// each throw season-weighted (weightOf; default 1). The overall total and
// every throw-location slice go through here.
function modelAAE(ratedPasses: QBPlay[], R: ResolvedBaselines, weightOf?: PlayWeight): number | null {
  let sumExpected = 0;
  let sumActual = 0;
  let sumW = 0;
  for (const pl of ratedPasses) {
    const exp = expectedForPlay(pl, R);
    if (exp == null) continue;
    const w = weightOf ? weightOf(pl) : 1;
    sumExpected += w * exp;
    sumActual += w * throwValue(pl);
    sumW += w;
  }
  return sumW > 0
    ? parseFloat((((sumActual - sumExpected) / sumW) * 100).toFixed(2))
    : null;
}

// modelAAE plus the sample behind it (see AESample). Same sums in the same
// order, so `ae` is exactly modelAAE's value.
function modelAAESample(ratedPasses: QBPlay[], R: ResolvedBaselines, weightOf?: PlayWeight): AESample | null {
  if (!R.model) return null;
  const s = emptyResidualSums();
  for (const pl of ratedPasses) addResidual(s, throwValue(pl), expectedFromModel(R.model, QB_DESIGN.cols(pl)), weightOf ? weightOf(pl) : 1);
  const variance = residualVariancePts(s);
  if (variance == null) return null;
  return { ae: parseFloat((((s.actual - s.expected) / s.w) * 100).toFixed(2)), n: s.n, w: s.w, variance };
}

// Overall AAE for an arbitrary QB play subset (a prospect's whole sample, or
// just one game's) against already-resolved league baselines. No minimum-
// sample gate — see computeRBAboveExpectedForPlays for why.
export function computeQBAAEForPlays(plays: QBPlay[], baselines: ResolvedBaselines): number | null {
  return modelAAE(plays.filter(isQBGradedThrow), baselines);
}

function toAaeRow(dim: { expected: number | null; actual: number | null; n: number }): { aae: number | null; n: number } {
  return {
    aae: dim.expected != null && dim.actual != null
      ? parseFloat(((dim.actual - dim.expected) * 100).toFixed(2))
      : null,
    n: dim.n,
  };
}

export function computeQBAboveExpectedSamples(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, AESample | null> {
  const out = new Map<string, AESample | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(qbPlays, gameToProspect);
  const R = resolveBaselines(buildQBBaselines(qbPlays));
  const weightOf = playWeights(games);

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    out.set(p.id, ratedPasses.length < QB_MIN_SAMPLE ? null : modelAAESample(ratedPasses, R, weightOf));
  }

  return out;
}

export function computeQBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, number | null> {
  return aeValues(computeQBAboveExpectedSamples(prospects, games, qbPlays));
}

// Per-dimension AAE for a single prospect, given that prospect's plays and the
// full league play set used to build baselines. Surfaces in the prospect
// Overview panel; the aggregate `computeQBAboveExpected` calls the same guts
// internally so the total line matches the table. `games` (the prospect's)
// supplies the seasons for the season weighting; without it every throw
// counts in full.
export function computeQBAAEBreakdown(
  prospectPlays: QBPlay[],
  leaguePlays: QBPlay[],
  games: readonly ScoutingGame[] = [],
): QBAAEBreakdown {
  const R = resolveBaselines(buildQBBaselines(leaguePlays));
  const ratedPasses = prospectPlays.filter(isQBGradedThrow);
  return breakdownFor(ratedPasses, R, playWeights(games));
}

// ── QB AAE by throw location ─────────────────────────────────────────────
// AAE over one slice of a QB's graded throws, by where the ball went: outside
// (left or right third of the field) vs inside (middle third), and deep (20+
// yds) / intermediate (10–20) / short (under 10), all read off the 3×3 depth
// zone. Each throw is still judged by the full difficulty model, so a slice
// reads "his accuracy on these throws vs the league's on throws like them".
// Depth zone is itself a model dimension, so every slice nets to about 0
// league-wide: measured 2026-09 on 1,746 graded throws, within ±0.4 pts, and
// intermediate at −1.1 from ridge shrinkage.
//
// Unlike the RB slices these split the headline exactly: outside + inside (and
// deep + intermediate + short) cover every throw with a depth zone, so their
// mean, weighted by each slice's season-weighted throws, is his AAE on those
// throws.
//
// This replaced the per-dimension rows (Depth / Coverage / Timing / Pressure /
// Platform / Route) on the Analysis table in 2026-09. Those rows still feed
// the prospect Overview panel via computeQBAAEBreakdown.
export type QBThrowSliceKey = "outside" | "inside" | "deep" | "intermediate" | "short";
const QB_THROW_SLICES: readonly { key: QBThrowSliceKey; zones: readonly QBDepthZone[] }[] = [
  { key: "outside",      zones: ["deep_left", "deep_right", "mid_left", "mid_right", "short_left", "short_right"] },
  { key: "inside",       zones: ["deep_center", "mid_center", "short_center"] },
  { key: "deep",         zones: ["deep_left", "deep_center", "deep_right"] },
  { key: "intermediate", zones: ["mid_left", "mid_center", "mid_right"] },
  { key: "short",        zones: ["short_left", "short_center", "short_right"] },
];

// Every QB gets an entry; a slice's `ae` is null under the 25-throw headline
// floor or the slice's own SLICE_MIN_SAMPLE.
export function computeQBThrowSliceAAE(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, Record<QBThrowSliceKey, AESlice>> {
  const out = new Map<string, Record<QBThrowSliceKey, AESlice>>();
  const playsByProspect = buildPlaysByProspect(qbPlays, buildGameToProspect(games));
  const R = resolveBaselines(buildQBBaselines(qbPlays));
  const weightOf = playWeights(games);

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    const slices = {} as Record<QBThrowSliceKey, AESlice>;
    for (const s of QB_THROW_SLICES) {
      const sub = ratedPasses.filter((pl) => pl.depth_zone != null && s.zones.includes(pl.depth_zone));
      slices[s.key] = {
        n: sub.length,
        ae: ratedPasses.length < QB_MIN_SAMPLE || sub.length < SLICE_MIN_SAMPLE ? null : modelAAE(sub, R, weightOf),
      };
    }
    out.set(p.id, slices);
  }

  return out;
}

// ── TE (shared) ──────────────────────────────────────────────────────────
// Ridge strength for both TE models. Only a few TEs are charted yet, too few
// to validate on held-out prospects the way QB / WR / RB were, so this borrows
// QB's value (10), the heaviest of the three: with thin data the model stays
// close to league average and firms up as charting grows. Re-validate once
// ~10 TEs are charted.
const TE_RIDGE_LAMBDA = 10;

// ── TE TE-SAER (route running) ───────────────────────────────────────────
// Open Rate Above Expected: the TE's open rate on rated routes minus the
// difficulty model's expected open rate for those same routes. Situation
// dimensions:
//   route type, coverage (press its own bucket), positioning (inline / slot /
//   wide / wing / backfield).
// Mirrors WR SAE's route + coverage + alignment. Location (left / right) is
// left out — a side of the field, not a difficulty.
const isRatedTERoute = (pl: TEPlay) => pl.play_type === "route_run" && pl.was_open !== null;
const teOpen = (pl: TEPlay) => (pl.was_open ? 1 : 0);
const TE_ROUTE_DESIGN = makeDesign<TEPlay>([
  [ROUTE_TYPES,     (pl) => pl.route_type],
  [TE_COVERAGES,    (pl) => pl.coverage],
  [TE_POSITIONINGS, (pl) => pl.positioning],
]);

export type TERouteBaselines = FittedDifficulty<TEPlay>;

export function buildTERouteBaselines(tePlays: TEPlay[]): TERouteBaselines {
  return fitFromPlays(tePlays.filter(isRatedTERoute), TE_ROUTE_DESIGN, teOpen, TE_RIDGE_LAMBDA);
}

// Actual-vs-expected open rate for an arbitrary TE route-run play subset. No
// minimum-sample gate — see computeRBAboveExpectedForPlays for why.
export function computeTERouteAboveExpectedForPlays(
  plays: TEPlay[],
  baselines: TERouteBaselines,
): number | null {
  return aboveExpectedForPlays(plays.filter(isRatedTERoute), baselines, teOpen);
}

export function computeTERouteAboveExpectedSamples(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
  tierByGame?: ReadonlyMap<string, OpponentTier>,
): Map<string, AESample | null> {
  const out = new Map<string, AESample | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);
  const baselines = buildTERouteBaselines(tePlays);
  const weightOf = playWeights(games);
  const tierOf = tierByGame && ((pl: TEPlay) => tierByGame.get(pl.game_id));

  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const routes = (playsByProspect.get(p.id) ?? []).filter(isRatedTERoute);
    out.set(p.id, routes.length < MIN_SAMPLE ? null : aboveExpectedSampleForPlays(routes, baselines, teOpen, { tierOf, weightOf }));
  }

  return out;
}

export function computeTERouteAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  return aeValues(computeTERouteAboveExpectedSamples(prospects, games, tePlays));
}

// ── TE TE-SAEB (blocking) ────────────────────────────────────────────────
// Block Success Above Expected: the TE's block success rate minus the
// difficulty model's expected success for those same blocks. Situation
// dimensions:
//   run vs pass block, movement vs inline block, positioning (a detached
//   block from the slot or wing is a different rep than one from inline).
// Both run and pass blocks are included; plays missing block_type or
// block_success are excluded from both the prospect's sample and the league
// model. 15-block minimum sample.
const TE_BLOCK_PLAY_TYPES = ["run_block", "pass_block"] as const;
const TE_BLOCK_TYPES = ["movement", "inline"] as const;

const isRatedTEBlock = (pl: TEPlay) =>
  (pl.play_type === "run_block" || pl.play_type === "pass_block") &&
  pl.block_success !== null &&
  pl.block_type !== null;
const teBlockWon = (pl: TEPlay) => (pl.block_success ? 1 : 0);
const TE_BLOCK_DESIGN = makeDesign<TEPlay>([
  [TE_BLOCK_PLAY_TYPES, (pl) => pl.play_type],
  [TE_BLOCK_TYPES,      (pl) => pl.block_type],
  [TE_POSITIONINGS,     (pl) => pl.positioning],
]);

export type TEBlockBaselines = FittedDifficulty<TEPlay>;

export function buildTEBlockBaselines(tePlays: TEPlay[]): TEBlockBaselines {
  return fitFromPlays(tePlays.filter(isRatedTEBlock), TE_BLOCK_DESIGN, teBlockWon, TE_RIDGE_LAMBDA);
}

// Actual-vs-expected block success for an arbitrary TE block-play subset. No
// minimum-sample gate — see computeRBAboveExpectedForPlays for why.
export function computeTEBlockAboveExpectedForPlays(
  plays: TEPlay[],
  baselines: TEBlockBaselines,
): number | null {
  return aboveExpectedForPlays(plays.filter(isRatedTEBlock), baselines, teBlockWon);
}

export function computeTEBlockAboveExpectedSamples(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
  tierByGame?: ReadonlyMap<string, OpponentTier>,
): Map<string, AESample | null> {
  const out = new Map<string, AESample | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);
  const baselines = buildTEBlockBaselines(tePlays);
  const weightOf = playWeights(games);
  const tierOf = tierByGame && ((pl: TEPlay) => tierByGame.get(pl.game_id));

  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const blocks = (playsByProspect.get(p.id) ?? []).filter(isRatedTEBlock);
    out.set(p.id, blocks.length < MIN_SAMPLE ? null : aboveExpectedSampleForPlays(blocks, baselines, teBlockWon, { tierOf, weightOf }));
  }

  return out;
}

export function computeTEBlockAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  return aeValues(computeTEBlockAboveExpectedSamples(prospects, games, tePlays));
}

// ── Role-bucket slices (roleFitRB / roleFitTE / roleFitQB) ───────────────
// Above-expected over named slices of each prospect's reps, for the role
// buckets: the same models and season weighting as the headline metrics, but
// no floors, since the buckets discount small samples themselves. Every
// prospect at the position gets an entry; an empty slice is { ae: null, n: 0 }.

function sliceOf<T extends { game_id: string }>(
  plays: T[],
  pred: (pl: T) => boolean,
  fitted: FittedDifficulty<T>,
  outcome: (pl: T) => number,
  weightOf: PlayWeight,
): AESlice {
  const sub = plays.filter(pred);
  return { n: sub.length, ae: sub.length ? aboveExpectedForPlays(sub, fitted, outcome, weightOf) : null };
}

/** An RB slice of known runs. `byRunType` judges it with the run-type model,
 *  like the SRAE breakdown columns; otherwise the headline SRAE model. */
export interface RBRoleSlice { pred: (pl: RBPlay) => boolean; byRunType?: boolean }

export function computeRBRoleSlices<K extends string>(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
  slices: Record<K, RBRoleSlice>,
): Map<string, Record<K, AESlice>> {
  const out = new Map<string, Record<K, AESlice>>();
  const playsByProspect = buildPlaysByProspect(rbPlays, buildGameToProspect(games));
  const headline = buildRBBaselines(rbPlays);
  const byRunType = fitFromPlays(rbPlays.filter(isKnownRun), RB_SLICE_DESIGN, rbSuccess, RB_RIDGE_LAMBDA);
  const weightOf = playWeights(games);
  const keys = Object.keys(slices) as K[];
  for (const p of prospects) {
    if (p.position !== "RB") continue;
    const runs = (playsByProspect.get(p.id) ?? []).filter(isKnownRun);
    const rec = {} as Record<K, AESlice>;
    for (const k of keys) rec[k] = sliceOf(runs, slices[k].pred, slices[k].byRunType ? byRunType : headline, rbSuccess, weightOf);
    out.set(p.id, rec);
  }
  return out;
}

/** QB slices of graded throws, each judged by the full AAE model. */
export function computeQBRoleSlices<K extends string>(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
  slices: Record<K, (pl: QBPlay) => boolean>,
): Map<string, Record<K, AESlice>> {
  const out = new Map<string, Record<K, AESlice>>();
  const playsByProspect = buildPlaysByProspect(qbPlays, buildGameToProspect(games));
  const R = resolveBaselines(buildQBBaselines(qbPlays));
  const weightOf = playWeights(games);
  const keys = Object.keys(slices) as K[];
  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const graded = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    const rec = {} as Record<K, AESlice>;
    for (const k of keys) {
      const sub = graded.filter(slices[k]);
      rec[k] = { n: sub.length, ae: sub.length ? modelAAE(sub, R, weightOf) : null };
    }
    out.set(p.id, rec);
  }
  return out;
}

/** TE slices: of rated routes (TE-SAER model) and of rated blocks (TE-SAEB model). */
export function computeTERoleSlices<R extends string, B extends string>(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
  routeSlices: Record<R, (pl: TEPlay) => boolean>,
  blockSlices: Record<B, (pl: TEPlay) => boolean>,
): Map<string, { route: Record<R, AESlice>; block: Record<B, AESlice> }> {
  const out = new Map<string, { route: Record<R, AESlice>; block: Record<B, AESlice> }>();
  const playsByProspect = buildPlaysByProspect(tePlays, buildGameToProspect(games));
  const routeModel = buildTERouteBaselines(tePlays);
  const blockModel = buildTEBlockBaselines(tePlays);
  const weightOf = playWeights(games);
  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const plays = playsByProspect.get(p.id) ?? [];
    const routes = plays.filter(isRatedTERoute);
    const blocks = plays.filter(isRatedTEBlock);
    const route = {} as Record<R, AESlice>;
    const block = {} as Record<B, AESlice>;
    for (const k of Object.keys(routeSlices) as R[]) route[k] = sliceOf(routes, routeSlices[k], routeModel, teOpen, weightOf);
    for (const k of Object.keys(blockSlices) as B[]) block[k] = sliceOf(blocks, blockSlices[k], blockModel, teBlockWon, weightOf);
    out.set(p.id, { route, block });
  }
  return out;
}
