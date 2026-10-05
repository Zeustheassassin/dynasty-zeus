// The per-play difficulty tags in the Above-Expected models (tape-grading
// expansion, Stage 4). Pure.
//
// Plays charted since Stage 3 carry tags (playEra.ts): red zone, 3rd/4th down,
// short yardage, and per position play action and tight window (QB), hit
// behind the line (RB), who the TE blocked. Some make a rep harder or easier
// than its charted situation says. They're fit as a CORRECTION on top of
// today's model, never inside it:
//
//   - today's model (difficultyModel.ts) is fit exactly as before, on every
//     play, without the tags;
//   - a second, small model is fit on the TAGGED plays only, with today's
//     logit as a fixed offset, so it learns only what the tags add. Ridge pulls
//     each tag's effect toward 0, so a thin tag barely moves anything;
//   - an old play is judged by today's model alone, exactly as before (the
//     user won't re-chart old games, and a tag must never change how an old
//     play is judged). A tagged play is judged by today's model + the
//     correction.
//
// The correction's own level is anchored, not fit: it's set so the tagged
// plays' expected total matches today's model on them. So the tags only move
// credit between tagged plays (a red-zone miss costs less, a clean-field one
// more), and the tagged era's overall level stays where today's model puts it.
// Whether that level has drifted from the older eras is the era scale check's
// question (eraResiduals below), with RECENTER_TAGGED as the fix if it has.
// The same anchoring keeps WR's coverage eras level (aggregateMerge.ts).
//
// Every tag starts switched OFF (ENABLED_TAG_CORRECTIONS). A tag is switched
// on only after the held-out test (heldOutTagTest) shows it improves
// predictions for prospects the fit never saw, the same bar every other
// dimension had to clear (snap position failed it in 2026-10). Until there are
// enough tagged plays to run the test, tagReadiness says how far off it is.
import {
  makeDesign, fitDifficultyModel, logitFromModel, levelOffset,
  type DifficultyCorrection, type DifficultyDesign, type FittedDifficulty,
} from "./difficultyModel";
import type { PlayEra } from "./playEra";

/** Which Above-Expected model a correction belongs to. */
export type CorrectionKey = "qb_aae" | "rb_srae" | "wr_sae" | "te_saer" | "te_saeb";
export const CORRECTION_KEYS: readonly CorrectionKey[] = ["qb_aae", "rb_srae", "wr_sae", "te_saer", "te_saeb"];
export const CORRECTION_LABEL: Record<CorrectionKey, string> = {
  qb_aae: "QB AAE", rb_srae: "RB SRAE", wr_sae: "WR SAE / cSAE", te_saer: "TE-SAER", te_saeb: "TE-SAEB",
};

/** A difficulty tag: its column, and the values that get a model column.
 *  The reference value (off, or a TE's pre-selected DL) gets none, so a tagged
 *  play with every tag at its default is judged by today's model alone, up to
 *  the anchor. */
export interface DifficultyTagSpec {
  column: string;
  label: string;
  /** Boolean tags: ["on"]. Text tags: the non-reference values. */
  buckets: readonly string[];
}

const ON = ["on"] as const;
const RED_ZONE: DifficultyTagSpec = { column: "red_zone", label: "Red zone", buckets: ON };
const THIRD_FOURTH: DifficultyTagSpec = { column: "third_fourth_down", label: "3rd/4th down", buckets: ON };
const SHORT_YARDAGE: DifficultyTagSpec = { column: "short_yardage", label: "Short yardage / goal line", buckets: ON };
const SITUATIONS = [RED_ZONE, THIRD_FOURTH, SHORT_YARDAGE] as const;

// The approved difficulty tags (plan, 2026-10-04), by the model they'd enter.
export const DIFFICULTY_TAGS: Record<CorrectionKey, readonly DifficultyTagSpec[]> = {
  qb_aae: [
    { column: "play_action", label: "Play action", buckets: ON },
    { column: "tight_window", label: "Tight window", buckets: ON },
    ...SITUATIONS,
  ],
  rb_srae: [{ column: "hit_behind_line", label: "Hit behind the line", buckets: ON }, ...SITUATIONS],
  wr_sae: [...SITUATIONS],
  te_saer: [...SITUATIONS],
  te_saeb: [{ column: "blocked_defender", label: "Blocked LB / DB (vs DL)", buckets: ["lb", "db"] }, ...SITUATIONS],
};

// Switched on per model, tag by tag, only after heldOutTagTest shows the tag
// improves held-out predictions. All off: 0 of 30,000 plays were tagged when
// Stage 4 was built (2026-10-05). The Grading checks tab (Analysis) reports
// when each tag has enough plays to test and what the test says.
export const ENABLED_TAG_CORRECTIONS: Record<CorrectionKey, readonly string[]> = {
  qb_aae: [], rb_srae: [], wr_sae: [], te_saer: [], te_saeb: [],
};

// Re-center a model's tagged era on its older eras (the era scale check's fix):
// the tagged plays' mean residual is set to the older plays' instead of being
// left where today's model puts it. Off until the check shows a drift.
export const RECENTER_TAGGED: Record<CorrectionKey, boolean> = {
  qb_aae: false, rb_srae: false, wr_sae: false, te_saer: false, te_saeb: false,
};

// How much a garbage-time play counts in a prospect's own sample (1 = in full,
// 0 = left out). garbageTimeTest picks between them on held-out games; until
// there's tagged data to test, they count in full. Untagged plays have no
// garbage-time flag, so this can only ever touch tagged plays.
export const GARBAGE_TIME_WEIGHT: Record<CorrectionKey, number> = {
  qb_aae: 1, rb_srae: 1, wr_sae: 1, te_saer: 1, te_saeb: 1,
};

// Ridge strength for the tag effects, in pseudo-plays: the most conservative
// of the base models' (QB / TE use 10), so a tag needs real volume to move.
export const TAG_CORRECTION_LAMBDA = 10;

// Readiness for the held-out test: enough prospects to hold out (5 folds),
// enough tagged plays, and enough of each tag's non-default value.
export const TEST_MIN_PROSPECTS = 5;
export const TEST_MIN_TAGGED_PLAYS = 200;
export const TEST_MIN_ON_PLAYS = 30;
const TEST_FOLDS = 5;

type Row = object;
const val = (row: Row, column: string): unknown => (row as Record<string, unknown>)[column];

/** The model bucket a row carries for a tag, or null (reference value or untagged). */
export function tagBucket(spec: DifficultyTagSpec, row: Row): string | null {
  const v = val(row, spec.column);
  if (v === true) return spec.buckets.includes("on") ? "on" : null;
  return typeof v === "string" && spec.buckets.includes(v) ? v : null;
}

export function correctionDesign<T extends Row>(specs: readonly DifficultyTagSpec[]): DifficultyDesign<T> {
  return makeDesign<T>(specs.map((s) => [s.buckets, (row: T) => tagBucket(s, row)] as const));
}

/** The enabled specs for a model (by column, in DIFFICULTY_TAGS order). */
export function enabledSpecs(key: CorrectionKey, enabled: readonly string[] = ENABLED_TAG_CORRECTIONS[key]): DifficultyTagSpec[] {
  return DIFFICULTY_TAGS[key].filter((s) => enabled.includes(s.column));
}

type WithModel<T> = FittedDifficulty<T> & { model: Float64Array };

export interface CorrectionInputs<T> {
  /** The base model's training rows (raw plays, or WR route cells). */
  rows: readonly T[];
  outcome: (row: T) => number;
  /** Whether a row is a tagged play (or a cell of tagged routes). */
  tagged: (row: T) => boolean;
  /** Plays a row stands for (1 for a raw play, n for a cell). */
  countOf?: (row: T) => number;
}

/**
 * Fit the correction on the tagged rows, today's logit as the offset. Null
 * with no specs and no re-centering, or no tagged rows.
 * `recenterTo`: the older eras' mean residual (a fraction); when given, the
 * level is set so the tagged rows' mean residual matches it. Otherwise the
 * tagged rows' expected total matches today's model on them.
 */
export function fitTagCorrection<T extends Row>(
  base: WithModel<T>,
  inp: CorrectionInputs<T>,
  specs: readonly DifficultyTagSpec[],
  { lambda = TAG_CORRECTION_LAMBDA, recenterTo }: { lambda?: number; recenterTo?: number } = {},
): DifficultyCorrection<T> | null {
  if (specs.length === 0 && recenterTo == null) return null;
  const tagged = inp.rows.filter(inp.tagged);
  if (tagged.length === 0) return null;
  const count = inp.countOf ?? (() => 1);
  const design = correctionDesign<T>(specs);
  const zBase = tagged.map((r) => logitFromModel(base.model, base.design.cols(r)));
  const fitted = fitDifficultyModel(
    tagged.map((r, i) => ({ cols: design.cols(r), y: inp.outcome(r), w: count(r), offset: zBase[i] })),
    design.size,
    lambda,
  );
  if (!fitted) return null;
  // The anchor: the level that makes the tagged rows' expected total what
  // today's model says (or, re-centered, what the older eras' level says).
  let target = 0;
  if (recenterTo != null) {
    for (const r of tagged) target += count(r) * (inp.outcome(r) - recenterTo);
  } else {
    tagged.forEach((r, i) => { target += count(r) / (1 + Math.exp(-zBase[i])); });
  }
  const effects = tagged.map((r, i) => ({ n: count(r), z: logitFromModel(fitted, design.cols(r), zBase[i]) - fitted[0] }));
  const model = Float64Array.from(fitted);
  model[0] = levelOffset(effects, target);
  return { design, model, applies: inp.tagged };
}

/** The correction a model uses: its enabled tags, re-centered if switched on. */
export function correctionFor<T extends Row>(
  key: CorrectionKey,
  base: FittedDifficulty<T>,
  inp: CorrectionInputs<T>,
  { enabled = ENABLED_TAG_CORRECTIONS[key], recenter = RECENTER_TAGGED[key] }: { enabled?: readonly string[]; recenter?: boolean } = {},
): DifficultyCorrection<T> | null {
  if (!base.model) return null;
  const withModel = { ...base, model: base.model };
  const specs = enabledSpecs(key, enabled);
  const recenterTo = recenter ? olderMeanResidual(withModel, inp) : undefined;
  return fitTagCorrection(withModel, inp, specs, { recenterTo: recenterTo ?? undefined });
}

/** The untagged rows' mean residual under today's model (a fraction), or null. */
function olderMeanResidual<T extends Row>(base: WithModel<T>, inp: CorrectionInputs<T>): number | null {
  const count = inp.countOf ?? (() => 1);
  let n = 0, r = 0;
  for (const row of inp.rows) {
    if (inp.tagged(row)) continue;
    const c = count(row);
    n += c;
    r += c * (inp.outcome(row) - 1 / (1 + Math.exp(-logitFromModel(base.model, base.design.cols(row)))));
  }
  return n > 0 ? r / n : null;
}

/** A prospect's sample weight for a play: its season weight, times the
 *  garbage-time weight on a play tagged garbage time. */
export function withGarbageWeight<T extends Row>(key: CorrectionKey, weightOf: (row: T) => number, gtWeight = GARBAGE_TIME_WEIGHT[key]): (row: T) => number {
  if (gtWeight === 1) return weightOf;
  return (row) => weightOf(row) * (val(row, "garbage_time") === true ? gtWeight : 1);
}

// ── Readiness and the held-out test ──────────────────────────────────────

export interface TagReadiness {
  column: string;
  label: string;
  /** Tagged rows (plays) in the model's training set. */
  taggedPlays: number;
  /** Tagged plays carrying each non-reference value, e.g. { on: 41 }. */
  onPlays: Record<string, number>;
  /** Prospects with tagged plays. */
  prospects: number;
  /** Enough to run the held-out test. */
  testable: boolean;
  /** What's missing, when not testable. */
  short: string | null;
  enabled: boolean;
}

export function tagReadiness<T extends Row>(
  key: CorrectionKey,
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
): TagReadiness[] {
  const count = inp.countOf ?? (() => 1);
  const tagged = inp.rows.filter(inp.tagged);
  const taggedPlays = tagged.reduce((s, r) => s + count(r), 0);
  const prospects = new Set(tagged.map(prospectOf).filter(Boolean)).size;
  return DIFFICULTY_TAGS[key].map((spec) => {
    const onPlays: Record<string, number> = {};
    for (const b of spec.buckets) onPlays[b] = 0;
    for (const r of tagged) { const b = tagBucket(spec, r); if (b) onPlays[b] += count(r); }
    const thinnest = Math.min(...Object.values(onPlays));
    const gaps = [
      prospects < TEST_MIN_PROSPECTS ? `${prospects}/${TEST_MIN_PROSPECTS} prospects` : null,
      taggedPlays < TEST_MIN_TAGGED_PLAYS ? `${taggedPlays}/${TEST_MIN_TAGGED_PLAYS} tagged plays` : null,
      thinnest < TEST_MIN_ON_PLAYS ? `${thinnest}/${TEST_MIN_ON_PLAYS} ${spec.label.toLowerCase()} plays` : null,
    ].filter((g): g is string => g != null);
    return {
      column: spec.column, label: spec.label, taggedPlays, onPlays, prospects,
      testable: gaps.length === 0,
      short: gaps.length ? gaps.join(" · ") : null,
      enabled: ENABLED_TAG_CORRECTIONS[key].includes(spec.column),
    };
  });
}

export interface TagTestResult {
  column: string;
  label: string;
  /** Held-out log loss per tagged play: today's model, and with this tag. */
  baseLoss: number;
  withLoss: number;
  /** The tag's fitted effect on all the data (log-odds per bucket). */
  effects: Record<string, number>;
  improves: boolean;
}

const logLoss = (y: number, p: number) => {
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

/**
 * K-fold held out by prospect: for each fold, today's model is refit without
 * the fold's prospects (`buildBase`), the correction with just this tag is fit
 * on the other prospects' tagged plays, and both are scored on the fold's
 * tagged plays. A tag improves when its held-out log loss is lower. Only the
 * testable tags (tagReadiness) are run.
 */
export function heldOutTagTest<T extends Row>(
  key: CorrectionKey,
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
  buildBase: (rows: readonly T[]) => FittedDifficulty<T>,
): TagTestResult[] {
  const count = inp.countOf ?? (() => 1);
  const ready = tagReadiness(key, inp, prospectOf).filter((r) => r.testable);
  if (!ready.length) return [];
  const ids = [...new Set(inp.rows.filter(inp.tagged).map(prospectOf).filter((x): x is string => !!x))].sort();
  const foldOf = new Map(ids.map((id, i) => [id, i % TEST_FOLDS]));
  const out: TagTestResult[] = [];
  for (const r of ready) {
    const spec = DIFFICULTY_TAGS[key].find((s) => s.column === r.column)!;
    let baseLoss = 0, withLoss = 0, n = 0;
    for (let fold = 0; fold < TEST_FOLDS; fold++) {
      const inFold = (row: T) => foldOf.get(prospectOf(row) ?? "") === fold;
      const test = inp.rows.filter((row) => inp.tagged(row) && inFold(row));
      if (!test.length) continue;
      const train = inp.rows.filter((row) => !inFold(row));
      const base = buildBase(train);
      if (!base.model) continue;
      const withModel = { ...base, model: base.model };
      const corr = fitTagCorrection(withModel, { ...inp, rows: train }, [spec]);
      for (const row of test) {
        const y = inp.outcome(row), c = count(row);
        const z = logitFromModel(withModel.model, withModel.design.cols(row));
        const zc = corr ? logitFromModel(corr.model, corr.design.cols(row), z) : z;
        baseLoss += c * logLoss(y, 1 / (1 + Math.exp(-z)));
        withLoss += c * logLoss(y, 1 / (1 + Math.exp(-zc)));
        n += c;
      }
    }
    if (n === 0) continue;
    const full = buildBase(inp.rows);
    const corr = full.model ? fitTagCorrection({ ...full, model: full.model }, inp, [spec]) : null;
    const effects: Record<string, number> = {};
    spec.buckets.forEach((b, i) => { effects[b] = corr ? corr.model[i + 1] : 0; });
    out.push({ column: r.column, label: r.label, baseLoss: baseLoss / n, withLoss: withLoss / n, effects, improves: withLoss < baseLoss });
  }
  return out;
}

// ── Garbage time ─────────────────────────────────────────────────────────

export const GT_TEST_WEIGHTS = [0, 0.25, 0.5, 0.75, 1] as const;
export const GT_MIN_PROSPECTS = 5;
export const GT_MIN_GARBAGE_PLAYS = 10;

export interface GarbageTimeTest {
  /** Prospects with tagged garbage-time plays and 2+ tagged games. */
  prospects: number;
  garbagePlays: number;
  testable: boolean;
  /** Held-out squared error (pts²) at each GT_TEST_WEIGHTS weight; null untested. */
  errors: Record<string, number> | null;
  /** The weight with the lowest error (1 = count in full, 0 = leave out). */
  best: number | null;
}

/**
 * Should garbage-time plays count less in a prospect's sample? Held out by
 * game: each of a prospect's tagged games is predicted (its non-garbage mean
 * residual) from his other tagged games, with their garbage-time plays at
 * weight w. If garbage-time reps say as much about a player as the rest, w = 1
 * predicts best; if they say nothing, or something different, a lower w does.
 * `residual` is the row's summed actual − expected under the model (one
 * play's, or a WR cell's total over its `countOf` routes).
 */
export function garbageTimeTest<T extends Row>(
  rows: readonly T[],
  tagged: (row: T) => boolean,
  prospectOf: (row: T) => string | undefined,
  gameOf: (row: T) => string,
  residual: (row: T) => number,
  countOf: (row: T) => number = () => 1,
): GarbageTimeTest {
  type Acc = { gn: number; gr: number; nn: number; nr: number };
  const byProspect = new Map<string, Map<string, Acc>>();
  let garbagePlays = 0;
  for (const row of rows) {
    if (!tagged(row)) continue;
    const pid = prospectOf(row);
    if (!pid) continue;
    const games = byProspect.get(pid) ?? new Map<string, Acc>();
    byProspect.set(pid, games);
    const g = games.get(gameOf(row)) ?? { gn: 0, gr: 0, nn: 0, nr: 0 };
    games.set(gameOf(row), g);
    const c = countOf(row), r = residual(row);
    if (val(row, "garbage_time") === true) { g.gn += c; g.gr += r; garbagePlays += c; } else { g.nn += c; g.nr += r; }
  }
  const usable = [...byProspect.values()].filter((gs) =>
    gs.size >= 2 && [...gs.values()].reduce((s, g) => s + g.gn, 0) >= GT_MIN_GARBAGE_PLAYS);
  const testable = usable.length >= GT_MIN_PROSPECTS;
  if (!testable) return { prospects: usable.length, garbagePlays, testable, errors: null, best: null };
  const errors: Record<string, number> = {};
  for (const w of GT_TEST_WEIGHTS) {
    let err = 0;
    for (const games of usable) {
      const list = [...games.values()];
      for (const held of list) {
        if (held.nn === 0) continue;
        let n = 0, r = 0;
        for (const g of list) if (g !== held) { n += g.nn + w * g.gn; r += g.nr + w * g.gr; }
        if (n === 0) continue;
        const target = held.nr / held.nn, pred = r / n;
        err += held.nn * (target - pred) ** 2;
      }
    }
    errors[String(w)] = err;
  }
  const best = GT_TEST_WEIGHTS.reduce((a, b) => (errors[String(b)] < errors[String(a)] ? b : a), 1 as number);
  return { prospects: usable.length, garbagePlays, testable, errors, best };
}

// ── Era scale check ──────────────────────────────────────────────────────

export interface EraResidual { n: number; mean: number; se: number | null }
export type EraResiduals = Partial<Record<PlayEra, EraResidual>>;

/** Mean residual (actual − expected) of each era's plays under the model, in
 *  the residual's units. `residual` is the row's sum over its `countOf` plays. */
export function eraResiduals<T extends Row>(
  rows: readonly T[],
  eraOf: (row: T) => PlayEra,
  residual: (row: T) => number,
  countOf: (row: T) => number = () => 1,
  /** Per-row sum of squared residuals (a cell's), for the SE; default r². */
  sqOf?: (row: T) => number,
): EraResiduals {
  const acc: Partial<Record<PlayEra, { n: number; s: number; sq: number }>> = {};
  for (const row of rows) {
    const e = eraOf(row);
    const a = (acc[e] ??= { n: 0, s: 0, sq: 0 });
    const r = residual(row);
    a.n += countOf(row);
    a.s += r;
    a.sq += sqOf ? sqOf(row) : r * r;
  }
  const out: EraResiduals = {};
  for (const [era, a] of Object.entries(acc) as [PlayEra, { n: number; s: number; sq: number }][]) {
    const mean = a.s / a.n;
    const variance = a.n > 1 ? Math.max(0, (a.sq - a.n * mean * mean) / (a.n - 1)) : null;
    out[era] = { n: a.n, mean, se: variance != null ? Math.sqrt(variance / a.n) : null };
  }
  return out;
}

// The tagged era needs this many plays before a drift is called.
export const ERA_CHECK_MIN_TAGGED = 300;

export interface EraDrift {
  /** Tagged minus in-app untagged, pts (null without both). */
  drift: number | null;
  se: number | null;
  /** Enough tagged plays, and the drift is beyond 2 SE. */
  flagged: boolean;
  enough: boolean;
}

export function eraDrift(r: EraResiduals): EraDrift {
  const t = r.tagged, o = r.in_app;
  const enough = (t?.n ?? 0) >= ERA_CHECK_MIN_TAGGED;
  if (!t || !o || t.se == null || o.se == null) return { drift: null, se: null, flagged: false, enough };
  const drift = t.mean - o.mean;
  const se = Math.sqrt(t.se ** 2 + o.se ** 2);
  return { drift, se, flagged: enough && Math.abs(drift) > 2 * se, enough };
}
