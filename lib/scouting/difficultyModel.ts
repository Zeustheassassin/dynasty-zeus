// The league difficulty model behind every "Above Expected" metric — QB AAE,
// WR SAE / cSAE, RB SRAE, TE-SAER and TE-SAEB.
//
// Each play's expected outcome comes from a ridge-regularized (fractional)
// logistic regression of the outcome on one-hot buckets of the play's charted
// situation (route type, coverage, box, pressure, ...), fit once on the whole
// league. Each bucket learns how much it adds to or takes from a play's odds,
// and those effects STACK: a play that is hard on two dimensions is expected
// to be harder than either alone, so a failure there costs little and a
// success earns a lot. A play is judged against plays like it. Fitting every
// dimension jointly also lets correlated tags (a go route and press coverage,
// say) share credit instead of double-counting.
//
// This replaced a flat average of single-dimension league rates, which could
// not stack difficulty and let a weak dimension water the strong one down by
// half — measured 2026-09 on real charting, WR routes in the hardest fifth
// were expected to be open 54% of the time when the league managed 39%.
//
// The intercept is unpenalized, so the league's expected sum equals its actual
// sum: league-wide above-expected is 0 by construction.

// A situation dimension: the fixed bucket list and how to read a row's bucket.
// Buckets come from the lists, not the data, so a bucket the league has never
// seen gets an all-zero column, which the ridge pins at 0.
export type DifficultyDim<T> = readonly [
  buckets: readonly string[],
  bucketOf: (row: T) => string | null | undefined,
];

export interface DifficultyDesign<T> {
  /** Coefficient count, intercept (column 0) included. */
  readonly size: number;
  /** The row's value-1 columns — at most one per dimension, intercept excluded.
   *  A dimension that is null on the row adds no column, so that dimension
   *  pulls the row neither way. */
  cols(row: T): number[];
}

export function makeDesign<T>(dims: ReadonlyArray<DifficultyDim<T>>): DifficultyDesign<T> {
  let col = 1;
  const maps = dims.map(([buckets]) => new Map(buckets.map((b) => [b, col++] as const)));
  return {
    size: col,
    cols(row: T): number[] {
      const out: number[] = [];
      dims.forEach(([, bucketOf], d) => {
        const b = bucketOf(row);
        const c = b == null ? undefined : maps[d].get(b);
        if (c != null) out.push(c);
      });
      return out;
    },
  };
}

// One training row. `y` is the outcome in [0, 1] (a binary result, or a graded
// value like QB throw value); `w` is how many identical plays the row stands
// for — 1 for a raw play, the cell count when fitting from pre-aggregated
// counts (WR). A cell of n plays with k successes is exactly n rows, so
// {y: k/n, w: n} gives the same fit.
export interface ModelRow { cols: number[]; y: number; w?: number }

// Target clamp: keeps a league of all-success rows (y ≡ 1) from sending the
// unpenalized intercept to +∞. Invisible at real data.
const MODEL_Y_EPS = 1e-6;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
// log(1 + e^z) without overflow.
const softplus = (z: number) => (z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z)));

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

// Fit the model by Newton's method with step halving. `lambda` is the ridge
// strength: each bucket's effect is pulled toward 0 (league average) as if
// backed by `lambda` plays of no information, so a bucket seen a handful of
// times can't swing the model. Each position validates its own lambda on
// held-out prospects (see the constants beside each metric). Returns the
// coefficient vector (index 0 = intercept), or null when there are no rows.
export function fitDifficultyModel(rawRows: ModelRow[], size: number, lambda: number): Float64Array | null {
  const rows = rawRows
    .filter((r) => (r.w ?? 1) > 0)
    .map((r) => ({ cols: r.cols, w: r.w ?? 1, y: Math.min(Math.max(r.y, MODEL_Y_EPS), 1 - MODEL_Y_EPS) }));
  if (!rows.length) return null;
  const P = size;
  const logit = (b: Float64Array, cols: number[]) => { let s = b[0]; for (const c of cols) s += b[c]; return s; };
  // Penalized negative log-likelihood — every accepted step must lower it.
  const objective = (b: Float64Array) => {
    let f = 0;
    for (const r of rows) { const z = logit(b, r.cols); f += r.w * (softplus(z) - r.y * z); }
    for (let j = 1; j < P; j++) f += 0.5 * lambda * b[j] * b[j];
    return f;
  };

  let beta = new Float64Array(P);
  let wSum = 0, ySum = 0;
  for (const r of rows) { wSum += r.w; ySum += r.w * r.y; }
  const ybar = ySum / wSum;
  beta[0] = Math.log(ybar / (1 - ybar));
  let f = objective(beta);
  for (let iter = 0; iter < 50; iter++) {
    const g = new Float64Array(P);
    const H = Array.from({ length: P }, () => new Float64Array(P));
    for (const r of rows) {
      const p = sigmoid(logit(beta, r.cols));
      const resid = r.w * (p - r.y);
      const w = r.w * p * (1 - p);
      g[0] += resid; H[0][0] += w;
      for (const a of r.cols) {
        g[a] += resid; H[0][a] += w; H[a][0] += w;
        for (const c of r.cols) H[a][c] += w;
      }
    }
    for (let j = 1; j < P; j++) { g[j] += lambda * beta[j]; H[j][j] += lambda; }
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

// The league's expected outcome for a play carrying exactly these columns —
// every filled dimension's effect stacked.
export function expectedFromModel(model: Float64Array, cols: number[]): number {
  let z = model[0];
  for (const c of cols) z += model[c];
  return sigmoid(z);
}

// Actual minus expected, in percentage points rounded to 2 dp. -0 is folded to
// 0 so a prospect who IS the league reads a clean 0.
export function toAbovePts(actual: number, expected: number): number {
  return parseFloat(((actual - expected) * 100).toFixed(2)) || 0;
}

// A fitted model bundled with its design, so callers can't pair a model with
// the wrong column layout.
export interface FittedDifficulty<T> {
  design: DifficultyDesign<T>;
  model: Float64Array | null;
}

export function fitFromPlays<T>(
  plays: T[],
  design: DifficultyDesign<T>,
  outcome: (row: T) => number,
  lambda: number,
): FittedDifficulty<T> {
  return {
    design,
    model: fitDifficultyModel(plays.map((pl) => ({ cols: design.cols(pl), y: outcome(pl) })), design.size, lambda),
  };
}

// Mean actual outcome minus mean model-expected outcome over `plays`, in pts.
// Null when there are no plays or no league model.
export function aboveExpectedForPlays<T>(
  plays: T[],
  fitted: FittedDifficulty<T>,
  outcome: (row: T) => number,
): number | null {
  const { design, model } = fitted;
  if (!model || plays.length === 0) return null;
  let sumActual = 0;
  let sumExpected = 0;
  for (const pl of plays) {
    sumActual += outcome(pl);
    sumExpected += expectedFromModel(model, design.cols(pl));
  }
  return toAbovePts(sumActual / plays.length, sumExpected / plays.length);
}
