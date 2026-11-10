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
// dimension had to clear (snap position failed it in 2026-10); TE-SAEB's tags
// are the user's exception (2026-10-21, see ENABLED_TAG_CORRECTIONS). Until
// there are enough tagged plays to run the test, tagReadiness says how far off
// it is.
import {
  makeDesign, fitDifficultyModel, logitFromModel, baseLogitFor, levelOffset,
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
  /** A bucket read from more than the column (TE-SAEB's 3rd/4th down, split
   *  by pass or run block). Absent: the column's own value. */
  bucketOf?: (row: object) => string | null;
  /** A sub-route spec (subRouteSpecs below): the route family it splits. Its
   *  effects are re-centered within the family's split routes, so they only
   *  move credit between that family's routes. */
  family?: string;
}

const ON = ["on"] as const;
const RED_ZONE: DifficultyTagSpec = { column: "red_zone", label: "Red zone", buckets: ON };
const THIRD_FOURTH: DifficultyTagSpec = { column: "third_fourth_down", label: "3rd/4th down", buckets: ON };
const SHORT_YARDAGE: DifficultyTagSpec = { column: "short_yardage", label: "Short yardage / goal line", buckets: ON };
const SITUATIONS = [RED_ZONE, THIRD_FOURTH, SHORT_YARDAGE] as const;
// Doubled on a route, on top of its coverage (migration 072, WR and TE).
const DOUBLE_COVERAGE: DifficultyTagSpec = { column: "double_coverage", label: "Double coverage", buckets: ON };

// A TE block on 3rd/4th down, as a pass or a run block (the user, 2026-10-21:
// a pass block on 3rd down, when the defense is more likely to bring pressure,
// isn't the same rep as one on 1st or 2nd). 1st/2nd down is the reference.
const TE_BLOCK_THIRD_FOURTH: DifficultyTagSpec = {
  column: "third_fourth_down",
  label: "3rd/4th down (pass / run block)",
  buckets: ["pass_block", "run_block"],
  bucketOf: (row) => {
    const r = row as { third_fourth_down?: unknown; play_type?: unknown };
    return r.third_fourth_down === true && (r.play_type === "pass_block" || r.play_type === "run_block") ? r.play_type : null;
  },
};

// The approved difficulty tags (plan, 2026-10-04), by the model they'd enter.
export const DIFFICULTY_TAGS: Record<CorrectionKey, readonly DifficultyTagSpec[]> = {
  qb_aae: [
    { column: "play_action", label: "Play action", buckets: ON },
    { column: "tight_window", label: "Tight window", buckets: ON },
    ...SITUATIONS,
  ],
  rb_srae: [{ column: "hit_behind_line", label: "Hit behind the line", buckets: ON }, ...SITUATIONS],
  wr_sae: [DOUBLE_COVERAGE, ...SITUATIONS],
  te_saer: [DOUBLE_COVERAGE, ...SITUATIONS],
  te_saeb: [{ column: "blocked_defender", label: "Blocked LB / DB (vs DL)", buckets: ["lb", "db"] }, RED_ZONE, TE_BLOCK_THIRD_FOURTH, SHORT_YARDAGE],
};

// Switched on per model, tag by tag, only after the held-out test shows the tag
// improves held-out predictions, except TE-SAEB (below). The Grading checks
// tab (Analysis) reports when each tag has enough plays to test and what the
// test says.
//
// First run on real tagged data, 2026-10-21 (RB 733 tagged runs from 32 RBs,
// QB 360 throws from 10, TE 309 blocks from 9), held to the game-context bar
// (contextEffects.ts): lower held-out error, in most of the 5 folds, and
// better than 95% of runs with the tag shuffled across plays.
//   - RB hit behind the line: 6.2% better, 5/5 folds, p .005 (29% success vs
//     51% expected). Short yardage: 1.5%, p .005 (73% vs 53%). 3rd/4th down:
//     1.0%, p .005, and still adds with short yardage (46 of their 86 plays
//     overlap). All three: 9.0%.
//   - QB play action: 0.5%, 4/5 folds, p .045 (87% accurate vs 79% expected).
//   - Failed: QB tight window, red zone for every model, 3rd/4th down for QB /
//     WR / TE routes. Too few to test: short yardage for QB / WR / TE, and
//     garbage time everywhere (7 tagged plays in all).
// TE-SAEB takes every block tag by the user's call (2026-10-21: "I want to take
// tons into account"): who he blocked, red zone, short yardage and 3rd/4th
// down by pass / run block. Held out it's level with today's model (+0.1%),
// so it costs nothing, and the ridge keeps a thin tag (5 tagged 3rd/4th-down
// pass blocks on that date) near 0 until it has the reps.
// Double coverage (WR SAE / cSAE, TE-SAER) is on from its first tagged route,
// also the user's call (2026-10-21): it replaced the Double coverage button,
// and elite WRs are doubled more than one coverage pick let him chart. 0
// tagged doubles on that date, so it moves nothing until he charts some.
export const ENABLED_TAG_CORRECTIONS: Record<CorrectionKey, readonly string[]> = {
  qb_aae: ["play_action"],
  rb_srae: ["hit_behind_line", "short_yardage", "third_fourth_down"],
  wr_sae: ["double_coverage"],
  te_saer: ["double_coverage"],
  te_saeb: ["blocked_defender", "red_zone", "third_fourth_down", "short_yardage"],
};

// ── Sub-routes (routeVariants.ts) ────────────────────────────────────────
// A sub-route switched on judges its routes against their own expected rate
// instead of their route family's (the user, 2026-11-10: a WR who runs a lot
// of Love of the Game nines, clear-outs nobody wins, shouldn't pile up missed
// nines). It's a correction like a tag's, on top of today's model, with one
// more anchor: within each family, the split routes' expected total stays
// what today's model says. So switching Love of the Game on lowers its own
// expected open rate and raises the family's other split nines' to match:
// credit moves only between that family's routes. Unsplit routes (charted
// before sub-routes, 2026-10-23) and every other route are judged as before,
// and the user's raw win rates don't change.
//
// One sub-route at a time (the user's plan, 2026-11-10): the family's other
// sub-routes stay pooled as "rest" until each is switched on. Each is switched
// on only after its own held-out test (heldOutSubRouteTests) improves, the bar
// every tag clears.
//
// Love of the Game, WR SAE / cSAE and TE-SAER (the user's go, 2026-11-10):
// 0 open on 16 WR routes (6 WRs) and 6 TE routes (3 TEs), against 48% for
// the nines charted since the press redefinition. Held out by prospect on
// the real data that day, through this code: WR log loss per tagged route
// .56460 → .55880, better in 5 of 5 folds, and none of 200 shuffles of the
// label across the 88 split nines did as well (p .005). TE is under the test
// floor (6 routes, 3 TEs); run anyway it improves .60019 → .59711 in 4 of 5
// folds, and it's on with WR's, as the user asked. The ridge keeps a thin
// sub-route modest: WR Love of the Game's expected open rate went 38.5% →
// 20.7% and the other 72 split nines' 40.2% → 44.1% (TE 57.7% → 46.2% and
// 55.8% → 59.1%); both move toward the real rates as routes come in. cSAE
// leaves nines out, so for WRs it reaches SAE and the role buckets' route
// reads.
export type SubRouteId = `${string}:${string}`;
export const SUB_ROUTE_REST = "rest";

export const ENABLED_SUB_ROUTES: Record<CorrectionKey, readonly SubRouteId[]> = {
  qb_aae: [], rb_srae: [], te_saeb: [],
  wr_sae: ["nine:love_of_the_game"],
  te_saer: ["nine:love_of_the_game"],
};

/** A route or sub-route key as a label ("love_of_the_game" → "Love of the game"). */
const keyLabel = (k: string) => (k.charAt(0).toUpperCase() + k.slice(1)).replace(/_/g, " ");
export const subRouteLabel = (id: SubRouteId) => {
  const [route, variant] = id.split(":");
  return `${keyLabel(route)}: ${keyLabel(variant)}`;
};

/** The sub-route a row carries (route type + route_variant), or null when unsplit. */
export function subRouteOf(row: object): SubRouteId | null {
  const r = row as { route_type?: unknown; route_variant?: unknown };
  return typeof r.route_type === "string" && typeof r.route_variant === "string" && r.route_variant
    ? `${r.route_type}:${r.route_variant}` : null;
}

/**
 * One spec per route family with a sub-route switched on: a bucket per
 * switched-on sub-route, and "rest" for the family's other split routes.
 * Unsplit routes and other families carry no bucket.
 */
export function subRouteSpecs(ids: readonly SubRouteId[]): DifficultyTagSpec[] {
  const byFamily = new Map<string, string[]>();
  for (const id of ids) {
    const [route, variant] = id.split(":");
    const list = byFamily.get(route) ?? [];
    if (!list.includes(variant)) list.push(variant);
    byFamily.set(route, list);
  }
  return [...byFamily].map(([route, variants]) => ({
    column: `sub_route:${route}`,
    label: `${keyLabel(route)} sub-routes (${variants.map(keyLabel).join(", ")})`,
    buckets: [...variants, SUB_ROUTE_REST],
    family: route,
    bucketOf: (row: object) => {
      const r = row as { route_type?: unknown; route_variant?: unknown };
      if (r.route_type !== route || typeof r.route_variant !== "string" || !r.route_variant) return null;
      return variants.includes(r.route_variant) ? r.route_variant : SUB_ROUTE_REST;
    },
  }));
}

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
  if (spec.bucketOf) {
    const b = spec.bucketOf(row);
    return b != null && spec.buckets.includes(b) ? b : null;
  }
  const v = val(row, spec.column);
  if (v === true) return spec.buckets.includes("on") ? "on" : null;
  return typeof v === "string" && spec.buckets.includes(v) ? v : null;
}

export function correctionDesign<T extends Row>(specs: readonly DifficultyTagSpec[]): DifficultyDesign<T> {
  return makeDesign<T>(specs.map((s) => [s.buckets, (row: T) => tagBucket(s, row)] as const));
}

/** The enabled specs for a model: its tags (by column, in DIFFICULTY_TAGS
 *  order), then its switched-on sub-routes (one spec per route family). */
export function enabledSpecs(
  key: CorrectionKey,
  enabled: readonly string[] = ENABLED_TAG_CORRECTIONS[key],
  subRoutes: readonly SubRouteId[] = ENABLED_SUB_ROUTES[key],
): DifficultyTagSpec[] {
  return [...DIFFICULTY_TAGS[key].filter((s) => enabled.includes(s.column)), ...subRouteSpecs(subRoutes)];
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
  const zBase = tagged.map((r) => baseLogitFor(base, r));
  const fitted = fitDifficultyModel(
    tagged.map((r, i) => ({ cols: design.cols(r), y: inp.outcome(r), w: count(r), offset: zBase[i] })),
    design.size,
    lambda,
  );
  if (!fitted) return null;
  // Sub-route specs' columns (each family's buckets), kept out of the level:
  // their own anchor below holds each family's total where the rest of the
  // correction puts it.
  const families: { from: number; to: number }[] = [];
  let col = 1;
  for (const s of specs) {
    if (s.family) families.push({ from: col, to: col + s.buckets.length });
    col += s.buckets.length;
  }
  const isFamilyCol = (c: number) => families.some((f) => c >= f.from && c < f.to);
  const colsOf = tagged.map((r) => design.cols(r));
  // Each row's logit without the level and without any sub-route column.
  const zTags = tagged.map((_, i) => colsOf[i].reduce((z, c) => (isFamilyCol(c) ? z : z + fitted[c]), zBase[i]));
  // The anchor: the level that makes the tagged rows' expected total what
  // today's model says (or, re-centered, what the older eras' level says).
  let target = 0;
  if (recenterTo != null) {
    for (const r of tagged) target += count(r) * (inp.outcome(r) - recenterTo);
  } else {
    tagged.forEach((r, i) => { target += count(r) / (1 + Math.exp(-zBase[i])); });
  }
  const model = Float64Array.from(fitted);
  model[0] = levelOffset(tagged.map((r, i) => ({ n: count(r), z: zTags[i] })), target);
  // Each family's anchor: one shift on all its buckets, so its split routes'
  // expected total is what it'd be without them. The level above is then
  // still exact, since no family's total moved.
  for (const f of families) {
    const rows: { n: number; z: number }[] = [];
    let familyTarget = 0;
    tagged.forEach((r, i) => {
      const c = colsOf[i].find((x) => x >= f.from && x < f.to);
      if (c == null) return;
      const n = count(r), z = zTags[i] + model[0];
      familyTarget += n / (1 + Math.exp(-z));
      rows.push({ n, z: z + fitted[c] });
    });
    const shift = rows.length ? levelOffset(rows, familyTarget) : 0;
    for (let c = f.from; c < f.to; c++) model[c] = fitted[c] + shift;
  }
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
    r += c * (inp.outcome(row) - 1 / (1 + Math.exp(-baseLogitFor(base, row))));
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
  /** Folds where it lowered the held-out loss, of the folds with test plays it touches. */
  foldsBetter: number;
  foldsRun: number;
}

const logLoss = (y: number, p: number) => {
  const q = Math.min(Math.max(p, 1e-9), 1 - 1e-9);
  return -(y * Math.log(q) + (1 - y) * Math.log(1 - q));
};

/**
 * K-fold held out by prospect: for each fold, today's model is refit without
 * the fold's prospects (`buildBase`, once per fold for every spec), the
 * correction with just this spec is fit on the other prospects' tagged plays,
 * and both are scored on the fold's tagged plays. A spec improves when its
 * held-out log loss is lower.
 */
function heldOutSpecTests<T extends Row>(
  specs: readonly DifficultyTagSpec[],
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
  buildBase: (rows: readonly T[]) => FittedDifficulty<T>,
): TagTestResult[] {
  if (!specs.length) return [];
  const count = inp.countOf ?? (() => 1);
  const ids = [...new Set(inp.rows.filter(inp.tagged).map(prospectOf).filter((x): x is string => !!x))].sort();
  const foldOf = new Map(ids.map((id, i) => [id, i % TEST_FOLDS]));
  const folds: { test: T[]; train: T[]; base: WithModel<T> }[] = [];
  for (let fold = 0; fold < TEST_FOLDS; fold++) {
    const inFold = (row: T) => foldOf.get(prospectOf(row) ?? "") === fold;
    const test = inp.rows.filter((row) => inp.tagged(row) && inFold(row));
    if (!test.length) continue;
    const train = inp.rows.filter((row) => !inFold(row));
    const base = buildBase(train);
    if (base.model) folds.push({ test, train, base: { ...base, model: base.model } });
  }
  const full = buildBase(inp.rows);
  const out: TagTestResult[] = [];
  for (const spec of specs) {
    let baseLoss = 0, withLoss = 0, n = 0, foldsBetter = 0, foldsRun = 0;
    for (const { test, train, base } of folds) {
      const corr = fitTagCorrection(base, { ...inp, rows: train }, [spec]);
      let b = 0, w = 0, touched = false;
      for (const row of test) {
        const y = inp.outcome(row), c = count(row);
        const z = baseLogitFor(base, row);
        const zc = corr ? logitFromModel(corr.model, corr.design.cols(row), z) : z;
        b += c * logLoss(y, 1 / (1 + Math.exp(-z)));
        w += c * logLoss(y, 1 / (1 + Math.exp(-zc)));
        n += c;
        if (tagBucket(spec, row) != null) touched = true;
      }
      baseLoss += b; withLoss += w;
      if (touched) { foldsRun++; if (w < b) foldsBetter++; }
    }
    if (n === 0) continue;
    const corr = full.model ? fitTagCorrection({ ...full, model: full.model }, inp, [spec]) : null;
    const effects: Record<string, number> = {};
    spec.buckets.forEach((b, i) => { effects[b] = corr ? corr.model[i + 1] : 0; });
    out.push({ column: spec.column, label: spec.label, baseLoss: baseLoss / n, withLoss: withLoss / n, effects, improves: withLoss < baseLoss, foldsBetter, foldsRun });
  }
  return out;
}

/** The held-out test for a model's testable tags (tagReadiness). */
export function heldOutTagTest<T extends Row>(
  key: CorrectionKey,
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
  buildBase: (rows: readonly T[]) => FittedDifficulty<T>,
): TagTestResult[] {
  const ready = new Set(tagReadiness(key, inp, prospectOf).filter((r) => r.testable).map((r) => r.column));
  return heldOutSpecTests(DIFFICULTY_TAGS[key].filter((s) => ready.has(s.column)), inp, prospectOf, buildBase);
}

// ── Sub-route readiness and test ─────────────────────────────────────────
// Every sub-route charted on a model's tagged routes, how far it is from a
// test, and the test once it's there. The test can run early (15 routes from
// 5 prospects, with 15 of the family's other split routes to compare): a big
// gap like Love of the Game's passes on that; a gap of ~8 pts needs ~100
// routes from ~15 prospects (SUB_ROUTE_FULL_REPS, the 2026-11-10 estimate),
// shown as the progress bar to watch.
export const SUB_ROUTE_TEST_MIN_REPS = 15;
export const SUB_ROUTE_TEST_MIN_PROSPECTS = 5;
export const SUB_ROUTE_FULL_REPS = 100;
export const SUB_ROUTE_FULL_PROSPECTS = 15;

export interface SubRouteReadiness {
  id: SubRouteId;
  label: string;
  /** Its tagged routes, and how many were won (open / block success). */
  reps: number;
  wins: number;
  prospects: number;
  /** The family's other split routes. */
  restReps: number;
  restWins: number;
  testable: boolean;
  short: string | null;
  enabled: boolean;
}

export function subRouteReadiness<T extends Row>(
  key: CorrectionKey,
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
): SubRouteReadiness[] {
  const count = inp.countOf ?? (() => 1);
  const own = new Map<SubRouteId, { reps: number; wins: number; prospects: Set<string> }>();
  const family = new Map<string, { reps: number; wins: number }>();
  for (const row of inp.rows) {
    if (!inp.tagged(row)) continue;
    const id = subRouteOf(row);
    if (!id) continue;
    const c = count(row), won = c * inp.outcome(row);
    const a = own.get(id) ?? { reps: 0, wins: 0, prospects: new Set<string>() };
    a.reps += c; a.wins += won;
    const pid = prospectOf(row);
    if (pid) a.prospects.add(pid);
    own.set(id, a);
    const route = id.split(":")[0];
    const f = family.get(route) ?? { reps: 0, wins: 0 };
    f.reps += c; f.wins += won;
    family.set(route, f);
  }
  return [...own].map(([id, a]) => {
    const f = family.get(id.split(":")[0])!;
    const restReps = f.reps - a.reps, restWins = f.wins - a.wins;
    const gaps = [
      a.reps < SUB_ROUTE_TEST_MIN_REPS ? `${Math.round(a.reps)}/${SUB_ROUTE_TEST_MIN_REPS} routes` : null,
      a.prospects.size < SUB_ROUTE_TEST_MIN_PROSPECTS ? `${a.prospects.size}/${SUB_ROUTE_TEST_MIN_PROSPECTS} prospects` : null,
      restReps < SUB_ROUTE_TEST_MIN_REPS ? `${Math.round(restReps)}/${SUB_ROUTE_TEST_MIN_REPS} other split routes to compare` : null,
    ].filter((g): g is string => g != null);
    return {
      id, label: subRouteLabel(id), reps: a.reps, wins: a.wins, prospects: a.prospects.size, restReps, restWins,
      testable: gaps.length === 0, short: gaps.length ? gaps.join(" · ") : null,
      enabled: ENABLED_SUB_ROUTES[key].includes(id),
    };
  }).sort((x, y) => y.reps - x.reps || x.id.localeCompare(y.id));
}

/** Each testable sub-route's held-out test, alone against the rest of its family. `column` is its id. */
export function heldOutSubRouteTests<T extends Row>(
  key: CorrectionKey,
  inp: CorrectionInputs<T>,
  prospectOf: (row: T) => string | undefined,
  buildBase: (rows: readonly T[]) => FittedDifficulty<T>,
  ready: readonly SubRouteReadiness[] = subRouteReadiness(key, inp, prospectOf),
): TagTestResult[] {
  const specs = ready.filter((r) => r.testable).map((r) => ({ ...subRouteSpecs([r.id])[0], column: r.id, label: r.label }));
  return heldOutSpecTests(specs, inp, prospectOf, buildBase);
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
