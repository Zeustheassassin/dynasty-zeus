// Per-prospect "Above Expected" metric calculators for RB / QB / TE.
//
// Each function returns a Map<prospect_id, number | null> where the number
// is the metric in percentage points (e.g. +5.2 means 5.2 pp better than
// the league baseline given the prospect's situation mix). Returns null
// for prospects under the 15-known-play minimum or with no comparable
// league baseline.
//
// All three follow the same shape: actual rate − weighted expected rate
// derived from league averages over two situation dimensions, averaged.
// The math here is a verbatim extraction of the calcs that previously
// lived inline in RBStatsTable / QBStatsTable / TEStatsTable so the
// numbers stay consistent across Analysis and the Games Log.

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

function combine(a: number | null, b: number | null): number | null {
  if (a != null && b != null) return (a + b) / 2;
  return a ?? b;
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
export interface RBBaselines {
  lgFormation: Record<RBFormation, { s: number; n: number }>;
  lgBox: { loaded: { s: number; n: number }; unloaded: { s: number; n: number } };
}

// League baselines: per-formation success rate and loaded-vs-unloaded box.
// Built once from the full league play set and shared across every prospect
// (and, for the per-game badge, every game) so the scan only runs once.
export function buildRBBaselines(rbPlays: RBPlay[]): RBBaselines {
  const lgFormation: Record<RBFormation, { s: number; n: number }> = {
    gun: { s: 0, n: 0 }, pistol: { s: 0, n: 0 }, under_center: { s: 0, n: 0 },
  };
  const lgBox = { loaded: { s: 0, n: 0 }, unloaded: { s: 0, n: 0 } };
  for (const pl of rbPlays) {
    if (!RB_RUN_TYPES.includes(pl.run_type as RBRunType)) continue;
    if (pl.success === null) continue;
    lgFormation[pl.formation].n++;
    if (pl.success) lgFormation[pl.formation].s++;
    if (pl.loaded_box) { lgBox.loaded.n++; if (pl.success) lgBox.loaded.s++; }
    else { lgBox.unloaded.n++; if (pl.success) lgBox.unloaded.s++; }
  }
  return { lgFormation, lgBox };
}

// Actual-vs-expected for an arbitrary RB play subset (a prospect's whole
// sample, or just one game's). No minimum-sample gate — callers that need
// the reliability floor (season/career) apply MIN_SAMPLE themselves; the
// per-game badge intentionally has none (small samples are expected there).
export function computeRBAboveExpectedForPlays(
  plays: RBPlay[],
  baselines: RBBaselines,
): number | null {
  const { lgFormation, lgBox } = baselines;
  const runPlays = plays.filter((pl) => RB_RUN_TYPES.includes(pl.run_type as RBRunType));
  const knownRuns = runPlays.filter((pl) => pl.success !== null);
  if (knownRuns.length === 0) return null;

  const actual = knownRuns.filter((pl) => pl.success).length / knownRuns.length;

  let expFm = 0, fmW = 0;
  for (const fm of RB_FORMATIONS) {
    const fmN = runPlays.filter((pl) => pl.formation === fm && pl.success !== null).length;
    const lg = lgFormation[fm];
    if (fmN > 0 && lg.n > 0) { expFm += (fmN / knownRuns.length) * (lg.s / lg.n); fmW += fmN / knownRuns.length; }
  }
  const loadedN = runPlays.filter((pl) => pl.loaded_box && pl.success !== null).length;
  const unloadedN = runPlays.filter((pl) => !pl.loaded_box && pl.success !== null).length;
  let expBox = 0, boxW = 0;
  if (loadedN > 0 && lgBox.loaded.n > 0) { expBox += (loadedN / knownRuns.length) * (lgBox.loaded.s / lgBox.loaded.n); boxW += loadedN / knownRuns.length; }
  if (unloadedN > 0 && lgBox.unloaded.n > 0) { expBox += (unloadedN / knownRuns.length) * (lgBox.unloaded.s / lgBox.unloaded.n); boxW += unloadedN / knownRuns.length; }
  const normFm = fmW > 0 ? expFm / fmW : null;
  const normBox = boxW > 0 ? expBox / boxW : null;
  const combined = combine(normFm, normBox);
  return combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null;
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
    const runPlays = pPlays.filter((pl) => RB_RUN_TYPES.includes(pl.run_type as RBRunType));
    const knownRuns = runPlays.filter((pl) => pl.success !== null);
    if (knownRuns.length < MIN_SAMPLE) { out.set(p.id, null); continue; }
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
// The difficulty model is a ridge-regularized fractional logistic regression of
// throw value on one-hot buckets of all seven dimensions, fit once on every
// league throw (fitDifficultyModel). Each bucket learns how much it adds to or
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
// (league average) as if backed by RIDGE_LAMBDA throws of no information. It
// plays the role SHRINK_K plays for the marginal rows — a bucket seen a handful
// of times (comeback, corner, cross-body) can't swing the model. Chosen 2026-09
// by 5-fold held-out-QB validation over 1–100: error is flat across 10–30, and
// 10 is the most even between the hardest and easiest fifths of throws (each
// ~2 pts off). Below ~5 it overfits hard throws; above ~30 it flattens back
// toward average. Re-validate as the dataset grows.
const RIDGE_LAMBDA = 10;
// Target clamp: keeps a league of all-perfect throws (y ≡ 1) from sending the
// intercept to +∞. Invisible at real data.
const MODEL_Y_EPS = 1e-6;

const QB_HANDLING_BUCKETS: QBPressureHandling[] = ["step_up", "bail_front_side", "bail_backside"];
// One one-hot column per bucket of every dimension; column 0 is the intercept.
// Fixed from the bucket lists (not from the data) so a bucket the league has
// never seen gets an all-zero column, which the ridge pins at 0.
const QB_MODEL_DIMS: ReadonlyArray<readonly [readonly string[], (pl: QBPlay) => string | null]> = [
  [QB_DEPTH_ZONES,      (pl) => pl.depth_zone],
  [["man", "zone"],     (pl) => pl.coverage],
  [QB_TIMING_BUCKETS,   (pl) => pl.timing],
  [QB_PRESSURE_BUCKETS, (pl) => pl.pressure],
  [QB_PLATFORM_KEYS,    platformKey],
  [QB_HANDLING_BUCKETS, (pl) => pl.pressure_handling],
  [ROUTE_TYPES,         (pl) => pl.route_type],
];
const QB_MODEL_COLS: Map<string, number>[] = (() => {
  let col = 1;
  return QB_MODEL_DIMS.map(([buckets]) => new Map(buckets.map((b) => [b, col++] as const)));
})();
const QB_MODEL_SIZE = 1 + QB_MODEL_DIMS.reduce((s, [buckets]) => s + buckets.length, 0);

// The play's value-1 columns — at most one per dimension, intercept excluded.
function modelCols(pl: QBPlay): number[] {
  const cols: number[] = [];
  QB_MODEL_DIMS.forEach(([, bucketOf], d) => {
    const b = bucketOf(pl);
    const c = b == null ? undefined : QB_MODEL_COLS[d].get(b);
    if (c != null) cols.push(c);
  });
  return cols;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
// log(1 + e^z) without overflow.
const softplus = (z: number) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

interface ModelRow { cols: number[]; y: number }

// Solve A·x = b by Gaussian elimination with partial pivoting. A is the model's
// small, dense Hessian (positive definite thanks to the ridge). Null if singular.
function solveLinear(A: Float64Array[], b: Float64Array): Float64Array | null {
  const n = b.length;
  const M = A.map((row, i) => { const r = new Float64Array(n + 1); r.set(row); r[n] = b[i]; return r; });
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (!M[piv][c]) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Fit the difficulty model: ridge-penalized fractional-logit by Newton's method
// with step halving. Returns the coefficient vector (index 0 = intercept), or
// null when the league has no graded throws. ~40 columns and each row touches
// at most 8 of them, so a full league fit is milliseconds.
function fitDifficultyModel(rows: ModelRow[]): Float64Array | null {
  if (!rows.length) return null;
  const P = QB_MODEL_SIZE;
  const logit = (b: Float64Array, cols: number[]) => { let s = b[0]; for (const c of cols) s += b[c]; return s; };
  // Penalized negative log-likelihood — every accepted step must lower it.
  const objective = (b: Float64Array) => {
    let f = 0;
    for (const r of rows) { const z = logit(b, r.cols); f += softplus(z) - r.y * z; }
    for (let j = 1; j < P; j++) f += 0.5 * RIDGE_LAMBDA * b[j] * b[j];
    return f;
  };

  let beta = new Float64Array(P);
  const ybar = rows.reduce((s, r) => s + r.y, 0) / rows.length;
  beta[0] = Math.log(ybar / (1 - ybar));
  let f = objective(beta);
  for (let iter = 0; iter < 50; iter++) {
    const g = new Float64Array(P);
    const H = Array.from({ length: P }, () => new Float64Array(P));
    for (const r of rows) {
      const p = sigmoid(logit(beta, r.cols));
      const resid = p - r.y;
      const w = p * (1 - p);
      g[0] += resid; H[0][0] += w;
      for (const a of r.cols) {
        g[a] += resid; H[0][a] += w; H[a][0] += w;
        for (const c of r.cols) H[a][c] += w;
      }
    }
    for (let j = 1; j < P; j++) { g[j] += RIDGE_LAMBDA * beta[j]; H[j][j] += RIDGE_LAMBDA; }
    const step = solveLinear(H, g);
    if (!step) break;
    let t = 1;
    let next = beta;
    let fNext = Infinity;
    for (; t > 1e-6; t /= 2) {
      next = beta.map((v, j) => v - t * step[j]);
      fNext = objective(next);
      if (fNext <= f) break;
    }
    if (!(fNext <= f)) break;
    let moved = 0;
    for (let j = 0; j < P; j++) moved = Math.max(moved, Math.abs(t * step[j]));
    beta = next;
    f = fNext;
    if (moved < 1e-10) break;
  }
  return beta;
}

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
    b.rows.push({ cols: modelCols(pl), y: Math.min(Math.max(v, MODEL_Y_EPS), 1 - MODEL_Y_EPS) });
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
    model:    fitDifficultyModel(b.rows),
  };
}

// Per-play expected throw value from the difficulty model: the league's odds
// for a throw carrying exactly this play's situation tags, every filled
// dimension's effect stacked. Null only when there is no model (no league
// throws).
function expectedForPlay(pl: QBPlay, R: ResolvedBaselines): number | null {
  if (!R.model) return null;
  let z = R.model[0];
  for (const c of modelCols(pl)) z += R.model[c];
  return sigmoid(z);
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

// ── TE TE-SAER (route running) ───────────────────────────────────────────
// Open Rate Above Expected. Adjusts a TE's open% on rated routes for the
// situation mix across two dimensions: positioning (6 buckets) and coverage
// (3 buckets — press folds into man).
export interface TERouteBaselines {
  lgPos: Partial<Record<TEPositioning, { open: number; n: number }>>;
  lgCvg: Partial<Record<TECoverage, { open: number; n: number }>>;
}

export function buildTERouteBaselines(tePlays: TEPlay[]): TERouteBaselines {
  const lgPos: Partial<Record<TEPositioning, { open: number; n: number }>> = {};
  const lgCvg: Partial<Record<TECoverage, { open: number; n: number }>> = {};
  for (const pl of tePlays) {
    if (pl.play_type !== "route_run" || pl.was_open === null) continue;
    if (!lgPos[pl.positioning]) lgPos[pl.positioning] = { open: 0, n: 0 };
    lgPos[pl.positioning]!.n++;
    if (pl.was_open) lgPos[pl.positioning]!.open++;
    if (pl.coverage) {
      // Press folds into Man for TE-SAER bucketing.
      const cvgKey: TECoverage = pl.coverage === "press" ? "man" : pl.coverage;
      if (!lgCvg[cvgKey]) lgCvg[cvgKey] = { open: 0, n: 0 };
      lgCvg[cvgKey]!.n++;
      if (pl.was_open) lgCvg[cvgKey]!.open++;
    }
  }
  return { lgPos, lgCvg };
}

// Actual-vs-expected open rate for an arbitrary TE route-run play subset. No
// minimum-sample gate — see computeRBAboveExpectedForPlays for why.
export function computeTERouteAboveExpectedForPlays(
  plays: TEPlay[],
  baselines: TERouteBaselines,
): number | null {
  const { lgPos, lgCvg } = baselines;
  const routePlays = plays.filter((pl) => pl.play_type === "route_run");
  const ratedRoutes = routePlays.filter((pl) => pl.was_open !== null);
  if (ratedRoutes.length === 0) return null;

  const actual = ratedRoutes.filter((pl) => pl.was_open).length / ratedRoutes.length;

  let expPos = 0, posW = 0;
  for (const pos of TE_POSITIONINGS) {
    const posN = ratedRoutes.filter((pl) => pl.positioning === pos).length;
    const lg = lgPos[pos];
    if (posN > 0 && lg && lg.n > 0) { expPos += (posN / ratedRoutes.length) * (lg.open / lg.n); posW += posN / ratedRoutes.length; }
  }
  let expCvg = 0, cvgW = 0;
  // Press folds into Man — three mutually exclusive buckets keep the weighted
  // average sound (no double-counting press routes).
  const TE_SAE_COVERAGES: TECoverage[] = ["man", "zone", "double"];
  for (const cvg of TE_SAE_COVERAGES) {
    const cN = cvg === "man"
      ? ratedRoutes.filter((pl) => pl.coverage === "man" || pl.coverage === "press").length
      : ratedRoutes.filter((pl) => pl.coverage === cvg).length;
    const lg = lgCvg[cvg];
    if (cN > 0 && lg && lg.n > 0) { expCvg += (cN / ratedRoutes.length) * (lg.open / lg.n); cvgW += cN / ratedRoutes.length; }
  }
  const normPos = posW > 0 ? expPos / posW : null;
  const normCvg = cvgW > 0 ? expCvg / cvgW : null;
  const combined = combine(normPos, normCvg);
  return combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null;
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
    const routePlays = pPlays.filter((pl) => pl.play_type === "route_run");
    const ratedRoutes = routePlays.filter((pl) => pl.was_open !== null);
    if (ratedRoutes.length < MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, computeTERouteAboveExpectedForPlays(pPlays, baselines));
  }

  return out;
}

// ── TE TE-SAEB (blocking) ────────────────────────────────────────────────
// Block Success Above Expected. Adjusts a TE's overall block success rate
// for the situation mix across two dimensions:
//   1. play_type — run_block vs pass_block
//   2. block_type — movement vs inline
// Both run and pass blocks are included; plays missing block_type or
// block_success are excluded from both the prospect's sample and the
// league baseline. 15-block minimum sample.
const TE_BLOCK_PLAY_TYPES = ["run_block", "pass_block"] as const;
const TE_BLOCK_TYPES = ["movement", "inline"] as const;
type TEBlockPlayType = (typeof TE_BLOCK_PLAY_TYPES)[number];
type TEBlockType = (typeof TE_BLOCK_TYPES)[number];

export interface TEBlockBaselines {
  lgPT: Record<TEBlockPlayType, { s: number; n: number }>;
  lgBT: Record<TEBlockType, { s: number; n: number }>;
}

export function buildTEBlockBaselines(tePlays: TEPlay[]): TEBlockBaselines {
  const lgPT: Record<TEBlockPlayType, { s: number; n: number }> = {
    run_block: { s: 0, n: 0 }, pass_block: { s: 0, n: 0 },
  };
  const lgBT: Record<TEBlockType, { s: number; n: number }> = {
    movement: { s: 0, n: 0 }, inline: { s: 0, n: 0 },
  };
  for (const pl of tePlays) {
    if (pl.play_type !== "run_block" && pl.play_type !== "pass_block") continue;
    if (pl.block_success === null) continue;
    if (pl.block_type === null) continue;
    const pt = pl.play_type;
    lgPT[pt].n++;
    if (pl.block_success) lgPT[pt].s++;
    lgBT[pl.block_type].n++;
    if (pl.block_success) lgBT[pl.block_type].s++;
  }
  return { lgPT, lgBT };
}

// Actual-vs-expected block success for an arbitrary TE block-play subset. No
// minimum-sample gate — see computeRBAboveExpectedForPlays for why.
export function computeTEBlockAboveExpectedForPlays(
  plays: TEPlay[],
  baselines: TEBlockBaselines,
): number | null {
  const { lgPT, lgBT } = baselines;
  const ratedBlocks = plays.filter(
    (pl) =>
      (pl.play_type === "run_block" || pl.play_type === "pass_block") &&
      pl.block_success !== null &&
      pl.block_type !== null,
  );
  if (ratedBlocks.length === 0) return null;

  const actual = ratedBlocks.filter((pl) => pl.block_success).length / ratedBlocks.length;

  let expPT = 0, ptW = 0;
  for (const pt of TE_BLOCK_PLAY_TYPES) {
    const ptN = ratedBlocks.filter((pl) => pl.play_type === pt).length;
    const lg = lgPT[pt];
    if (ptN > 0 && lg.n > 0) {
      expPT += (ptN / ratedBlocks.length) * (lg.s / lg.n);
      ptW += ptN / ratedBlocks.length;
    }
  }
  let expBT = 0, btW = 0;
  for (const bt of TE_BLOCK_TYPES) {
    const btN = ratedBlocks.filter((pl) => pl.block_type === bt).length;
    const lg = lgBT[bt];
    if (btN > 0 && lg.n > 0) {
      expBT += (btN / ratedBlocks.length) * (lg.s / lg.n);
      btW += btN / ratedBlocks.length;
    }
  }
  const normPT = ptW > 0 ? expPT / ptW : null;
  const normBT = btW > 0 ? expBT / btW : null;
  const combined = combine(normPT, normBT);
  return combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null;
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
    const ratedBlocks = pPlays.filter(
      (pl) =>
        (pl.play_type === "run_block" || pl.play_type === "pass_block") &&
        pl.block_success !== null &&
        pl.block_type !== null,
    );
    if (ratedBlocks.length < MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, computeTEBlockAboveExpectedForPlays(pPlays, baselines));
  }

  return out;
}
