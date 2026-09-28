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

import type {
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
import {
  makeDesign,
  fitDifficultyModel,
  fitFromPlays,
  expectedFromModel,
  aboveExpectedForPlays,
  type ModelRow,
  type FittedDifficulty,
} from "./difficultyModel";

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
const RB_DESIGN = makeDesign<RBPlay>([
  [RB_FORMATIONS,           (pl) => pl.formation],
  [["loaded", "unloaded"],  (pl) => (pl.loaded_box ? "loaded" : "unloaded")],
  [["unblocked", "blocked"], (pl) => (pl.unblocked_defender ? "unblocked" : "blocked")],
]);

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

export function computeRBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(rbPlays, gameToProspect);
  const baselines = buildRBBaselines(rbPlays);

  for (const p of prospects) {
    if (p.position !== "RB") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    if (pPlays.filter(isKnownRun).length < MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, computeRBAboveExpectedForPlays(pPlays, baselines));
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
// baseline biases the row positive league-wide.
function expectedFor<K extends string>(
  ratedPasses: QBPlay[],
  bucketFn: (pl: QBPlay) => K | null | undefined,
  rates: Map<K, number>,
  buckets: readonly K[],
): { expected: number | null; actual: number | null; n: number } {
  const total = ratedPasses.length;
  if (!total) return { expected: null, actual: null, n: 0 };
  let exp = 0;
  let weight = 0;
  let filled = 0;
  let filledVal = 0;
  for (const b of buckets) {
    const inBucket = ratedPasses.filter((pl) => bucketFn(pl) === b);
    const n = inBucket.length;
    const r = rates.get(b);
    if (n > 0 && r != null) {
      const share = n / total;
      exp += share * r;
      weight += share;
      filled += n;
      for (const pl of inBucket) filledVal += throwValue(pl);
    }
  }
  return {
    expected: weight > 0 ? exp / weight : null,
    actual: filled > 0 ? filledVal / filled : null,
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

function breakdownFor(ratedPasses: QBPlay[], R: ResolvedBaselines): QBAAEBreakdown {
  const denom = ratedPasses.length;
  if (!denom) {
    return { ratedPasses: 0, actualOnTgtPct: null, total: null, dims: [] };
  }
  // Literal on-target% kept for display only — the AAE math below runs on graded
  // throw value, not this binary rate.
  const onTgt = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / denom;

  const rows: QBAAEDimRow[] = [
    { key: "depth",    label: "Depth Zone",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.depth_zone,        R.depth,    QB_DEPTH_ZONES)) },
    { key: "coverage", label: "Coverage",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.coverage === "man" || pl.coverage === "zone" ? pl.coverage : null, R.cvg, ["man", "zone"] as const)) },
    { key: "timing",   label: "Timing",            ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.timing,            R.timing,   QB_TIMING_BUCKETS)) },
    { key: "pressure", label: "Pressure",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.pressure,          R.pressure, QB_PRESSURE_BUCKETS)) },
    { key: "platform", label: "Platform",          ...toAaeRow(expectedFor(ratedPasses, platformKey,                  R.platform, QB_PLATFORM_KEYS)) },
    // Pressure Handling has no standalone AAE row by design — it still feeds the
    // overall AAE total through the difficulty model (expectedForPlay).
    { key: "route",    label: "Route Type",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.route_type,        R.route,    ROUTE_TYPES)) },
  ];

  // Overall AAE: each throw's actual value vs the difficulty model's expected
  // for that throw's full situation mix. Intentionally NOT the mean of the
  // per-dim AAEs above — those are one-dimension views, and averaging them
  // double-counts correlated dims (e.g. a broken-pocket throw would be judged
  // four times across the pressure cluster). See expectedForPlay.
  let sumExpected = 0;
  let sumActual = 0;
  let nContrib = 0;
  for (const pl of ratedPasses) {
    const exp = expectedForPlay(pl, R);
    if (exp == null) continue;
    sumExpected += exp;
    sumActual += throwValue(pl);
    nContrib++;
  }
  const total = nContrib > 0
    ? parseFloat((((sumActual - sumExpected) / nContrib) * 100).toFixed(2))
    : null;

  return {
    ratedPasses: denom,
    actualOnTgtPct: parseFloat((onTgt * 100).toFixed(2)),
    total,
    dims: rows,
  };
}

// Overall AAE for an arbitrary QB play subset (a prospect's whole sample, or
// just one game's) against already-resolved league baselines. No minimum-
// sample gate — see computeRBAboveExpectedForPlays for why.
export function computeQBAAEForPlays(plays: QBPlay[], baselines: ResolvedBaselines): number | null {
  return breakdownFor(plays.filter(isQBGradedThrow), baselines).total;
}

function toAaeRow(dim: { expected: number | null; actual: number | null; n: number }): { aae: number | null; n: number } {
  return {
    aae: dim.expected != null && dim.actual != null
      ? parseFloat(((dim.actual - dim.expected) * 100).toFixed(2))
      : null,
    n: dim.n,
  };
}

export function computeQBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(qbPlays, gameToProspect);
  const R = resolveBaselines(buildQBBaselines(qbPlays));

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    if (ratedPasses.length < QB_MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, breakdownFor(ratedPasses, R).total);
  }

  return out;
}

// Per-dimension AAE for a single prospect, given that prospect's plays and the
// full league play set used to build baselines. Surfaces in the prospect
// Overview panel; the aggregate `computeQBAboveExpected` calls the same guts
// internally so the total line matches the table.
export function computeQBAAEBreakdown(
  prospectPlays: QBPlay[],
  leaguePlays: QBPlay[],
): QBAAEBreakdown {
  const R = resolveBaselines(buildQBBaselines(leaguePlays));
  const ratedPasses = prospectPlays.filter(isQBGradedThrow);
  return breakdownFor(ratedPasses, R);
}

// Bulk variant — builds baselines once and produces per-prospect breakdowns
// for every QB. Used by the Analysis-tab stats table so each row can surface
// per-dimension AAE columns without re-running the baseline scan per prospect.
// Prospects under the QB_MIN_SAMPLE gate are omitted (consistent with the
// overall AAE column hiding their value).
export function computeQBAAEBreakdownMap(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, QBAAEBreakdown> {
  const out = new Map<string, QBAAEBreakdown>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(qbPlays, gameToProspect);
  const R = resolveBaselines(buildQBBaselines(qbPlays));

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    if (ratedPasses.length < QB_MIN_SAMPLE) continue;
    out.set(p.id, breakdownFor(ratedPasses, R));
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

export function computeTERouteAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);
  const baselines = buildTERouteBaselines(tePlays);

  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    if (pPlays.filter(isRatedTERoute).length < MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, computeTERouteAboveExpectedForPlays(pPlays, baselines));
  }

  return out;
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

export function computeTEBlockAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);
  const baselines = buildTEBlockBaselines(tePlays);

  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    if (pPlays.filter(isRatedTEBlock).length < MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, computeTEBlockAboveExpectedForPlays(pPlays, baselines));
  }

  return out;
}
