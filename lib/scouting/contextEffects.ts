// How much a game's context (opponent defense, weather, supporting cast) moves
// a prospect's Above-Expected numbers, measured within players, held out by
// prospect, and taken back out of the AE Score (tape-grading expansion,
// Stage 5). Pure.
//
// The same logic as the opponent tiers (opponentAdjust.ts), for any per-game
// number: a context effect is measured WITHIN players, from how each player's
// own games move with the context, never from comparing players (players
// facing weak defenses are mostly weaker players; a pooled comparison read
// G5 reps as HARDER for QBs and RBs on 2026-10-01). Concretely, a ridge
// regression of each game's mean residual (actual − expected, under the
// unchanged difficulty model) on the game's covariates, after removing each
// player's own average (a fixed effect per player), weighted by the game's
// reps. Ridge pulls each effect toward 0; an effect pointing the "wrong" way
// (a worse defense making reps harder) is dropped rather than kept.
//
// Applying it: a prospect's AE loses the lift his contexts gave him relative
// to the charted pool's average context (or relative to 0 for a yes/no flag
// like "FCS opponent"): lift = Σ_games w·β·(x − ref) / Σ_games w, with the
// same season weights as the AE. Games whose context is unknown count as the
// reference (no lift). The variance is unchanged.
//
// Nothing is applied until its held-out test passes (heldOutContextTest):
// 5 folds by prospect; each fold's prospects are left out of the fit, and the
// fit then predicts how their games scatter around their own average. A model
// passes against a simpler one when its held-out error is lower overall AND in
// a majority of the folds (so one lucky fold can't carry it).
import type { AESample } from "../types";

/** One prospect's reps in one game: unweighted reps and residual sum, and the season-weighted reps. */
export interface GameResid {
  n: number;
  /** Σ (actual − expected) over the game's reps, in the outcome's units (fraction). */
  resid: number;
  /** Season-weighted reps (the prospect's share of reps in the game). */
  w: number;
}
export type ByGame = Record<string, GameResid>;

/** Adds one rep's (or one cell's) residual to its game's running sum. */
export function addGameResidual(byGame: ByGame, gameId: string, n: number, resid: number, w = n): void {
  const g = (byGame[gameId] ??= { n: 0, resid: 0, w: 0 });
  g.n += n;
  g.resid += resid;
  g.w += w;
}

export interface CovariateSpec {
  key: string;
  label: string;
  /** +1: a higher value makes reps easier (residuals rise); -1: harder. */
  sign: 1 | -1;
  /** Lift measured from the pool's average ("mean"), from 0 for a yes/no flag
   *  ("zero"), or from a set level (a number). */
  ref: "mean" | "zero" | number;
  /** Units for display, e.g. "pts of defensive SP+". */
  unit: string;
}

/** game id → its covariate values; a missing key = unknown for that game. */
export type GameCovariates = ReadonlyMap<string, Readonly<Record<string, number>>>;

/** Ridge strength, in reps at one pool standard deviation of the covariate
 *  (the opponent tiers shrink by 200 pseudo-reps the same way). */
export const CONTEXT_RIDGE = 200;
export const CONTEXT_TEST_FOLDS = 5;
/** Prospects with 2+ games of known context needed before a test runs. */
export const CONTEXT_TEST_MIN_PROSPECTS = 10;

export interface ContextFit {
  /** The covariates kept (an effect pointing the wrong way is dropped). */
  specs: CovariateSpec[];
  /** Effect per unit of each kept covariate, in the outcome's units (fraction). */
  beta: Record<string, number>;
  /** The level each covariate is measured from. */
  ref: Record<string, number>;
  prospects: number;
  games: number;
  reps: number;
}

type Row = { pid: string; n: number; y: number; x: number[] };

const known = (vals: Readonly<Record<string, number>> | undefined, specs: readonly CovariateSpec[]) =>
  !!vals && specs.every((s) => Number.isFinite(vals[s.key]));

/** Games with every covariate known, grouped by prospect (2+ games each). */
function gameRows(
  samples: Iterable<readonly [string, ByGame | undefined]>, cov: GameCovariates, specs: readonly CovariateSpec[],
): Map<string, Row[]> {
  const out = new Map<string, Row[]>();
  for (const [pid, byGame] of samples) {
    if (!byGame) continue;
    const rows: Row[] = [];
    for (const [gid, g] of Object.entries(byGame)) {
      const vals = cov.get(gid);
      if (!(g.n > 0) || !known(vals, specs)) continue;
      rows.push({ pid, n: g.n, y: g.resid / g.n, x: specs.map((s) => vals![s.key]) });
    }
    if (rows.length >= 2) out.set(pid, rows);
  }
  return out;
}

/** Solves A x = b (small, symmetric positive definite) by Gaussian elimination. */
function solve(A: number[][], b: number[]): number[] | null {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < k; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j];
    }
  }
  return M.map((row, i) => row[k] / M[i][i]);
}

/** Within-player weighted ridge on the given columns; null when there's nothing to fit. */
function ridgeWithin(groups: Iterable<Row[]>, cols: readonly number[], scale: readonly number[], lambda: number): number[] | null {
  const k = cols.length;
  if (k === 0) return [];
  const A = Array.from({ length: k }, () => Array(k).fill(0));
  const b = Array(k).fill(0);
  for (const rows of groups) {
    let sn = 0, sy = 0;
    const sx = Array(k).fill(0);
    for (const r of rows) { sn += r.n; sy += r.n * r.y; cols.forEach((c, i) => { sx[i] += r.n * r.x[c] / scale[c]; }); }
    const my = sy / sn, mx = sx.map((v) => v / sn);
    for (const r of rows) {
      const dx = cols.map((c, i) => r.x[c] / scale[c] - mx[i]);
      const dy = r.y - my;
      for (let i = 0; i < k; i++) {
        b[i] += r.n * dx[i] * dy;
        for (let j = 0; j < k; j++) A[i][j] += r.n * dx[i] * dx[j];
      }
    }
  }
  for (let i = 0; i < k; i++) A[i][i] += lambda;
  return solve(A, b);
}

/** Pool SD (rep-weighted) of each covariate; 1 when it doesn't vary. */
function poolScale(groups: Iterable<Row[]>, k: number): number[] {
  let sn = 0;
  const s1 = Array(k).fill(0), s2 = Array(k).fill(0);
  for (const rows of groups) for (const r of rows) {
    sn += r.n;
    for (let i = 0; i < k; i++) { s1[i] += r.n * r.x[i]; s2[i] += r.n * r.x[i] * r.x[i]; }
  }
  return s1.map((v, i) => {
    if (!(sn > 0)) return 1;
    const m = v / sn, sd = Math.sqrt(Math.max(0, s2[i] / sn - m * m));
    return sd > 1e-9 ? sd : 1;
  });
}

/** Sign-constrained fit: refit without any covariate whose effect points the wrong way. */
function constrainedFit(groups: Row[][], specs: readonly CovariateSpec[], lambda: number): Map<number, number> {
  const scale = poolScale(groups, specs.length);
  let active = specs.map((_, i) => i);
  for (;;) {
    const z = ridgeWithin(groups, active, scale, lambda);
    if (!z) return new Map();
    const wrong = active.filter((c, i) => specs[c].sign * z[i] < 0);
    if (wrong.length === 0) return new Map(active.map((c, i) => [c, z[i] / scale[c]]));
    active = active.filter((c) => !wrong.includes(c));
  }
}

/** Fits the context model on every prospect with 2+ games of known context. */
export function fitContext(
  samples: Iterable<readonly [string, ByGame | undefined]>,
  cov: GameCovariates,
  specs: readonly CovariateSpec[],
  lambda = CONTEXT_RIDGE,
): ContextFit | null {
  const groups = [...gameRows(samples, cov, specs).values()];
  if (groups.length === 0 || specs.length === 0) return null;
  const beta = constrainedFit(groups, specs, lambda);
  const kept = specs.filter((_, i) => beta.has(i));
  const ref: Record<string, number> = {};
  let sn = 0;
  const s1 = Array(specs.length).fill(0);
  for (const rows of groups) for (const r of rows) { sn += r.n; r.x.forEach((v, i) => { s1[i] += r.n * v; }); }
  specs.forEach((s, i) => { ref[s.key] = typeof s.ref === "number" ? s.ref : s.ref === "zero" ? 0 : s1[i] / sn; });
  const out: Record<string, number> = {};
  specs.forEach((s, i) => { if (beta.has(i)) out[s.key] = beta.get(i)!; });
  return {
    specs: kept, beta: out, ref,
    prospects: groups.length,
    games: groups.reduce((s, g) => s + g.length, 0),
    reps: groups.reduce((s, g) => s + g.reduce((t, r) => t + r.n, 0), 0),
  };
}

/** A prospect's lift from his games' context, in the outcome's units (fraction). */
export function contextLift(byGame: ByGame | undefined, cov: GameCovariates, fit: ContextFit | null): number {
  if (!byGame || !fit || fit.specs.length === 0) return 0;
  let lift = 0, w = 0;
  for (const [gid, g] of Object.entries(byGame)) {
    w += g.w;
    const vals = cov.get(gid);
    if (!known(vals, fit.specs)) continue;
    for (const s of fit.specs) lift += g.w * fit.beta[s.key] * (vals![s.key] - fit.ref[s.key]);
  }
  return w > 0 ? lift / w : 0;
}

/** The sample with its context lift taken out (`scale` = 100 for AE points). Keeps the first raw value. */
export function adjustForContext<S extends AESample>(s: S | null, cov: GameCovariates, fit: ContextFit | null, scale = 100): S | null {
  if (!s || !fit) return s;
  const adj = contextLift(s.byGame, cov, fit) * scale;
  if (adj === 0) return s;
  return { ...s, ae: s.ae - adj, rawAe: s.rawAe ?? s.ae };
}

// ── The held-out test ────────────────────────────────────────────────────

export interface ModelLoss {
  /** Held-out squared error of each game's deviation from the player's own average (rep-weighted). */
  loss: number;
  /** Per fold, for the fold-majority rule. */
  foldLoss: number[];
}

export interface ContextTest {
  testable: boolean;
  /** Prospects / games / reps the test ran on (games with every covariate of every model known). */
  prospects: number;
  games: number;
  reps: number;
  /** Error with no context at all. */
  none: ModelLoss | null;
  /** Error per model, in the order given. */
  models: (ModelLoss | null)[];
}

/**
 * Held-out comparison of context models, 5 folds by prospect: each fold's
 * prospects are left out of the fit, and the fit predicts how each of their
 * games deviates from that player's own average. All models are scored on the
 * same games (every covariate of every model known), so they compare fairly.
 */
export function heldOutContextTest(
  samples: Iterable<readonly [string, ByGame | undefined]>,
  cov: GameCovariates,
  models: readonly (readonly CovariateSpec[])[],
  lambda = CONTEXT_RIDGE,
): ContextTest {
  const all: CovariateSpec[] = [];
  for (const m of models) for (const s of m) if (!all.some((a) => a.key === s.key)) all.push(s);
  const groups = gameRows(samples, cov, all);
  const ids = [...groups.keys()].sort();
  const base = { prospects: ids.length, games: 0, reps: 0 };
  for (const rows of groups.values()) { base.games += rows.length; base.reps += rows.reduce((s, r) => s + r.n, 0); }
  if (ids.length < CONTEXT_TEST_MIN_PROSPECTS) return { testable: false, ...base, none: null, models: models.map(() => null) };

  const foldOf = new Map(ids.map((id, i) => [id, i % CONTEXT_TEST_FOLDS]));
  const colsOf = (m: readonly CovariateSpec[]) => m.map((s) => all.findIndex((a) => a.key === s.key));
  const none: ModelLoss = { loss: 0, foldLoss: Array(CONTEXT_TEST_FOLDS).fill(0) };
  const out: ModelLoss[] = models.map(() => ({ loss: 0, foldLoss: Array(CONTEXT_TEST_FOLDS).fill(0) }));

  for (let fold = 0; fold < CONTEXT_TEST_FOLDS; fold++) {
    const train = ids.filter((id) => foldOf.get(id) !== fold).map((id) => groups.get(id)!);
    const test = ids.filter((id) => foldOf.get(id) === fold).map((id) => groups.get(id)!);
    const betas = models.map((m) => {
      const cols = colsOf(m);
      const sub = train.map((rows) => rows.map((r) => ({ ...r, x: cols.map((c) => r.x[c]) })));
      const fit = constrainedFit(sub, m, lambda);
      return cols.map((_, i) => fit.get(i) ?? 0);
    });
    for (const rows of test) {
      let sn = 0, sy = 0;
      for (const r of rows) { sn += r.n; sy += r.n * r.y; }
      const my = sy / sn;
      models.forEach((m, mi) => {
        const cols = colsOf(m);
        const pred = rows.map((r) => cols.reduce((s, c, i) => s + betas[mi][i] * r.x[c], 0));
        const mp = rows.reduce((s, r, j) => s + r.n * pred[j], 0) / sn;
        rows.forEach((r, j) => {
          const e = r.n * (r.y - my - (pred[j] - mp)) ** 2;
          out[mi].loss += e; out[mi].foldLoss[fold] += e;
        });
      });
      for (const r of rows) { const e = r.n * (r.y - my) ** 2; none.loss += e; none.foldLoss[fold] += e; }
    }
  }
  return { testable: true, ...base, none, models: out };
}

/** Does `a` beat `b`: lower held-out error overall and in a majority of folds? */
export function beats(a: ModelLoss | null, b: ModelLoss | null): boolean {
  if (!a || !b) return false;
  const wins = a.foldLoss.filter((l, i) => l < b.foldLoss[i]).length;
  return a.loss < b.loss && wins > a.foldLoss.length / 2;
}

/** Held-out improvement of `a` over `b`, as a share of b's error (0.01 = 1%). */
export function improvement(a: ModelLoss | null, b: ModelLoss | null): number | null {
  return a && b && b.loss > 0 ? 1 - a.loss / b.loss : null;
}

// ── The permutation check ────────────────────────────────────────────────
// A held-out win alone isn't enough: on the 2026-10-05 data, covariates
// shuffled at random across games (so they carry no information) still
// "won" 10–22% of the time, and with ~60 context tests that's several false
// passes. So a context also has to beat chance: its held-out improvement must
// exceed what the same test gives with the added covariates shuffled across
// games, in at least 95% of shuffles (p ≤ 0.05). Seeded, so the same data
// always gives the same answer.

export const PERMUTATIONS = 200;
export const PERMUTATION_P = 0.05;

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** The covariates with `keys` shuffled together across the games that have them all. */
export function shuffleCovariates(cov: GameCovariates, keys: readonly string[], rand: () => number): GameCovariates {
  const ids = [...cov.keys()].filter((id) => keys.every((k) => Number.isFinite(cov.get(id)![k])));
  const order = ids.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out = new Map<string, Readonly<Record<string, number>>>(cov);
  ids.forEach((id, i) => {
    const from = cov.get(ids[order[i]])!;
    const vals = { ...cov.get(id)! };
    for (const k of keys) vals[k] = from[k];
    out.set(id, vals);
  });
  return out;
}

export interface ContextVerdict {
  test: ContextTest;
  /** Held-out improvement of the candidate over the base, share of the base's error. */
  improvement: number | null;
  /** Share of shuffles that did at least as well (null when untestable). */
  p: number | null;
  /** Lower error overall, in most folds, and p ≤ PERMUTATION_P. */
  passes: boolean;
}

/**
 * Does adding `added` to `base` improve held-out predictions beyond chance?
 * Both are scored on the same games; the shuffles move only the added
 * covariates, so the base keeps its information.
 */
export function contextVerdict(
  samples: readonly (readonly [string, ByGame | undefined])[],
  cov: GameCovariates,
  base: readonly CovariateSpec[],
  added: readonly CovariateSpec[],
  { permutations = PERMUTATIONS, seed = 20261005, lambda = CONTEXT_RIDGE }: { permutations?: number; seed?: number; lambda?: number } = {},
): ContextVerdict {
  const candidate = [...base, ...added];
  const test = heldOutContextTest(samples, cov, [base, candidate], lambda);
  const baseLoss = base.length ? test.models[0] : test.none;
  const imp = improvement(test.models[1], baseLoss);
  if (!test.testable || imp == null) return { test, improvement: imp, p: null, passes: false };
  if (!beats(test.models[1], baseLoss)) return { test, improvement: imp, p: null, passes: false };
  const rand = seeded(seed);
  const keys = added.map((s) => s.key);
  let atLeast = 0;
  for (let i = 0; i < permutations; i++) {
    const t = heldOutContextTest(samples, shuffleCovariates(cov, keys, rand), [base, candidate], lambda);
    const pi = improvement(t.models[1], base.length ? t.models[0] : t.none);
    if (pi != null && pi >= imp) atLeast++;
  }
  const p = (1 + atLeast) / (1 + permutations);
  return { test, improvement: imp, p, passes: p <= PERMUTATION_P };
}
