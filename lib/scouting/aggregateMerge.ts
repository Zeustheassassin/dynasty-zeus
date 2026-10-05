import type {
  AESample,
  LinedUp,
  Prospect,
  ProspectWithStats,
  RouteStat,
  CoverageStat,
  RouteType,
  RoutePlay,
  ScoutingGame,
} from "../types";
import { deriveChartingDecision } from "../../components/scouting/shared/chartingConstants";
import {
  makeDesign,
  fitDifficultyModel,
  expectedFromModel,
  expectedFor,
  levelOffset,
  type DifficultyCorrection,
  type DifficultyDim,
  toAbovePts,
  emptyResidualSums,
  residualVariancePts,
  addTierResidual,
  type ByTier,
  type FittedDifficulty,
  type ResidualSums,
} from "./difficultyModel";
import { seasonWeights } from "./seasonWeight";
import { addGameResidual, type ByGame } from "./contextEffects";
import { COVERAGE_ERAS, coverageEra, coverageEras, type CoverageEra } from "./coverageEra";
import { isTaggedPlay } from "./playEra";
import { correctionDesign, enabledSpecs, fitTagCorrection, GARBAGE_TIME_WEIGHT, RECENTER_TAGGED } from "./tagCorrection";
import { parseHeightInches } from "./prospectAge";
import type { AESum } from "./roleFit";
import { wrRoleFit, type WRRoleSkill } from "./roleFitWR";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

export interface ProspectRouteStatsRow {
  prospect_id: string;
  total_games: number;
  total_snaps: number;
  total_routes: number;
  /** Old typed yards (route_plays.yards). The view still returns them; nothing shows them. */
  total_yards: number;
  open_routes: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contested_catches: number;
  success_rate: number | null;
  target_rate: number | null;
  /** From the old typed yards, like total_yards; unused. */
  avg_ypc: number | null;
  pct_left: number | null;
  pct_right: number | null;
  pct_slot: number | null;
  pct_backfield: number | null;
  pct_on_line: number | null;
  depth_behind_los: number;
  depth_on_los: number;
  has_charted_open_data: boolean;
  route_stats_raw: Record<string, { count: number; open: number; targets: number; catches: number }>;
  route_type_counts: Record<string, number>;
  coverage_stats_raw: Record<string, { count: number; open: number; catches: number }>;
  coverage_counts: Record<string, number>;
  align_n_slot: number;
  align_n_slot_on_line: number;
  align_n_slot_off_line: number;
  align_n_right: number;
  align_n_right_on_line: number;
  align_n_right_off_line: number;
  align_n_left: number;
  align_n_left_on_line: number;
  align_n_left_off_line: number;
  align_n_backfield: number;
  open_pct_slot: number | null;
  open_pct_slot_on_line: number | null;
  open_pct_slot_off_line: number | null;
  open_pct_right: number | null;
  open_pct_right_on_line: number | null;
  open_pct_right_off_line: number | null;
  open_pct_left: number | null;
  open_pct_left_on_line: number | null;
  open_pct_left_off_line: number | null;
  open_pct_backfield: number | null;
}

// ── WR SAE (Success / Open Rate Above Expected) ──────────────────────────
// The WR's open rate on routes run minus the difficulty model's expected open
// rate for those same routes (difficultyModel.ts). Situation dimensions:
//   route type, coverage (press its own bucket — a harder look than off man),
//   alignment (outside / slot / backfield), on / off the line.
// A go route against press counts as the hard rep it is: not getting open
// there costs little, getting open earns a lot. Left and right are one
// "outside" bucket — which side of the field isn't a difficulty (TE-SAER
// leaves location out for the same reason). With route and coverage held
// fixed, the slot comes out ~3 pts HARDER than outside; its high raw open%
// comes from the easy routes slot receivers run, which the route dimension
// already prices.
//
// This replaced a 50/50 average of the route-type and coverage league rates,
// which halved the route effect: measured 2026-09 on 12,200 charted routes, a
// go is open 39% of the time league-wide but was expected at ~52%, so deep
// threats were marked down for running gos and screen/flat-heavy receivers
// marked up (go share correlated −0.21 with SAE; ~0 after).
//
// A WR's routes are season-weighted like every Above-Expected metric
// (seasonWeight.ts), so his cells come from the per-game view (migration 058),
// which knows each route's game and so its season. The league model is fit
// unweighted.
//
// Coverage is judged per definition era (coverageEra.ts): press was redefined
// after the 2026-04-30 import, so each coverage bucket is learned separately
// for old and new charting, and a rep is compared with reps charted under the
// same definition. Each era's overall level is then anchored to a model
// without coverage (buildWRModel), so the tags only move credit between
// receivers WITHIN an era. Measured 2026-10-01: in-app WRs averaged +2.90 vs
// expected, about 1 pt of it from the definitions (+1.94 without coverage);
// letting each era find its own level would have erased all of it, including
// whatever is real.
//
// Ridge strength 3, chosen by 5-fold held-out-WR validation over 1–30: every
// fifth of routes (by difficulty) lands within 1.3 pts of its actual open rate
// at 1–3, and it drifts to 2.5+ from 10 up. 3 over 1 for a little more
// protection on the thin buckets (double coverage, backfield alignment: a
// few dozen routes each).
const WR_RIDGE_LAMBDA = 3;

// One route situation — a raw RoutePlay, or one cell of the route-cell views —
// with the coverage definition it was charted under. A route charted with the
// per-play tags (062) carries them, for the tag correction (tagCorrection.ts);
// `tagged` is unset on every untagged route, so the correction never applies.
interface WRSituation {
  route_type: string;
  coverage: string;
  alignment: string;
  on_line: boolean;
  era: CoverageEra;
  tagged?: boolean;
  red_zone?: boolean;
  third_fourth_down?: boolean;
  short_yardage?: boolean;
  garbage_time?: boolean;
}
// `w` is the weight of each of the cell's routes in a prospect's sample: its
// season weight (1 = counts in full), times the garbage-time weight on a
// tagged garbage-time cell.
interface RouteCell extends WRSituation { n: number; open: number; w: number }

/** A tagged route cell (migration 064) as parsed: its situation, its tags, and
 *  the release-vs-press and broken-tackle-after-catch tags (null = n/a). */
export interface RouteTagCell extends RouteCell {
  tagged: true;
  press_release: "won" | "lost" | null;
  bt_after_catch: boolean | null;
}

const WR_COVERAGES = ["man", "press", "zone", "double"];
const routeDim: DifficultyDim<WRSituation> = [ROUTE_TYPES, (s) => s.route_type];
const alignDims: DifficultyDim<WRSituation>[] = [
  [["outside", "slot", "backfield"], (s) => (s.alignment === "left" || s.alignment === "right" ? "outside" : s.alignment || null)],
  [["on", "off"],                    (s) => (s.on_line ? "on" : "off")],
];
// The fitted dimensions: coverage gets one bucket per coverage per era.
const WR_FIT_DIMS: DifficultyDim<WRSituation>[] = [
  routeDim,
  [WR_COVERAGES.flatMap((c) => COVERAGE_ERAS.map((e) => `${c}@${e}`)), (s) => (s.coverage ? `${s.coverage}@${s.era}` : null)],  // "" = uncharted
  ...alignDims,
];
const WR_FIT_DESIGN = makeDesign(WR_FIT_DIMS);
// What the expectations use: the fitted columns plus one column per era that
// holds its level anchor (set by buildWRModel, not fit). makeDesign numbers
// columns in order, so the era columns follow the fitted ones.
const WR_DESIGN = makeDesign<WRSituation>([...WR_FIT_DIMS, [COVERAGE_ERAS, (s) => s.era]]);
const eraColumn = (era: CoverageEra) => WR_FIT_DESIGN.size + COVERAGE_ERAS.indexOf(era);
// The anchor: the same model without coverage.
const WR_LEVEL_DESIGN = makeDesign([routeDim, ...alignDims]);

export type WRDifficultyModel = FittedDifficulty<WRSituation>;
type WRModelWith = WRDifficultyModel & { model: Float64Array };

// One row of the prospect_route_cells view (migration 057): cell key
// "route_type|coverage|alignment|on_line" → [routes, open routes].
export interface ProspectRouteCellsRow {
  prospect_id: string;
  cells: Record<string, [number, number]> | null;
}

/** One row of prospect_game_route_tag_cells (migration 064): the game's TAGGED
 *  routes, keyed route|coverage|alignment|on_line|rz|34|sy|gt|press|bt. */
export interface ProspectGameRouteTagCellsRow {
  prospect_id: string;
  game_id: string;
  cells: Record<string, [number, number]> | null;
}

function parseCells(raw: Record<string, [number, number]> | null | undefined, w = 1, era: CoverageEra = "new"): RouteCell[] {
  const out: RouteCell[] = [];
  for (const [key, counts] of Object.entries(raw ?? {})) {
    const parts = key.split("|");
    if (parts.length !== 4 || !Array.isArray(counts)) continue;
    const [n, open] = counts;
    if (!(n > 0)) continue;
    out.push({ route_type: parts[0], coverage: parts[1], alignment: parts[2], on_line: parts[3] === "on", era, n, open, w });
  }
  return out;
}

/** A game's tagged route cells (migration 064's key format). */
export function parseTagCells(raw: Record<string, [number, number]> | null | undefined, w = 1, era: CoverageEra = "new"): RouteTagCell[] {
  const out: RouteTagCell[] = [];
  for (const [key, counts] of Object.entries(raw ?? {})) {
    const p = key.split("|");
    if (p.length !== 10 || !Array.isArray(counts)) continue;
    const [n, open] = counts;
    if (!(n > 0)) continue;
    out.push({
      route_type: p[0], coverage: p[1], alignment: p[2], on_line: p[3] === "on", era, n, open, w,
      tagged: true,
      red_zone: p[4] === "1", third_fourth_down: p[5] === "1", short_yardage: p[6] === "1", garbage_time: p[7] === "1",
      press_release: p[8] === "won" || p[8] === "lost" ? p[8] : null,
      bt_after_catch: p[9] === "-" ? null : p[9] === "1",
    });
  }
  return out;
}

const situationKey = (c: WRSituation) => `${c.route_type}|${c.coverage}|${c.alignment}|${c.on_line}`;

// Whether tagged routes need judging apart from untagged ones: only when the
// WR model has a tag correction or garbage time is weighted. Otherwise a
// tagged route counts exactly like any other, and the cells stay as 058 has
// them (so every number is bit-for-bit what it was before Stage 4).
const splitTagged = (model: WRDifficultyModel) => model.correction != null || GARBAGE_TIME_WEIGHT.wr_sae !== 1;

// One game's route cells at weight `w`. With `tagCells`, its tagged routes are
// split out of 058's cells into their own cells, carrying their tags and the
// garbage-time weight; 058's cells keep the untagged rest.
function gameCells(
  cells: Record<string, [number, number]> | null | undefined,
  tagCells: Record<string, [number, number]> | null | undefined,
  w: number,
  era: CoverageEra,
): RouteCell[] {
  const base = parseCells(cells, w, era);
  if (!tagCells) return base;
  const tags = parseTagCells(tagCells, w, era);
  const byKey = new Map(base.map((c) => [situationKey(c), c]));
  for (const t of tags) {
    const b = byKey.get(situationKey(t));
    if (!b) continue;
    b.n = Math.max(0, b.n - t.n);
    b.open = Math.min(b.n, Math.max(0, b.open - t.open));
  }
  const gt = GARBAGE_TIME_WEIGHT.wr_sae;
  return [...base.filter((c) => c.n > 0), ...tags.map((t) => (t.garbage_time && gt !== 1 ? { ...t, w: w * gt } : t))];
}

const tagCellsByGame = (rows: readonly ProspectGameRouteTagCellsRow[]) => new Map(rows.map((r) => [r.game_id, r.cells]));

// Each prospect's cells from the per-game rows, every game's routes carrying
// its season weight and coverage era. Games of the same season and era merge
// into one cell per situation. Tagged routes split out (gameCells) only when
// `tagRows` is given, and stay their own cells.
function weightedCellsByProspect(
  gameRows: ProspectGameRouteCellsRow[],
  weights: Map<string, number>,
  eras: Map<string, CoverageEra>,
  tagRows?: readonly ProspectGameRouteTagCellsRow[],
): Map<string, RouteCell[]> {
  const merged = new Map<string, Map<string, RouteCell>>();
  const tagged = new Map<string, RouteCell[]>();
  const tagsBy = tagRows ? tagCellsByGame(tagRows) : null;
  for (const row of gameRows) {
    const w = weights.get(row.game_id) ?? 1;
    const era = eras.get(row.game_id) ?? "new";
    const cells = merged.get(row.prospect_id) ?? new Map<string, RouteCell>();
    merged.set(row.prospect_id, cells);
    for (const c of gameCells(row.cells, tagsBy?.get(row.game_id), w, era)) {
      if (c.tagged) {
        const list = tagged.get(row.prospect_id);
        if (list) list.push(c); else tagged.set(row.prospect_id, [c]);
        continue;
      }
      const key = `${c.route_type}|${c.coverage}|${c.alignment}|${c.on_line}|${w}|${era}`;
      const acc = cells.get(key);
      if (acc) { acc.n += c.n; acc.open += c.open; } else cells.set(key, c);
    }
  }
  return new Map([...merged].map(([id, cells]) => [id, [...cells.values(), ...(tagged.get(id) ?? [])]]));
}

/** prospect_game_alignment (migration 060): one game's snaps by where he lined up. */
export interface ProspectGameAlignmentRow extends LinedUp {
  prospect_id: string;
  game_id: string;
}

const LINED_UP_KEYS = ["snaps", "slot_on", "slot_off", "left_on", "left_off", "right_on", "right_off", "backfield"] as const;

// Where each WR lined up on plays charted in the app, run plays included. The
// 2026-04-30 import entered whole games, not plays, so an imported snap's
// alignment and on/off line aren't a real per-play record; those games are
// left out. A game's import-vs-app split is the coverage era's cutoff
// ("new" = in-app).
export function linedUpByProspect(
  rows: readonly ProspectGameAlignmentRow[],
  eras: Map<string, CoverageEra>,
): Map<string, LinedUp> {
  const out = new Map<string, LinedUp>();
  for (const row of rows) {
    if ((eras.get(row.game_id) ?? "new") !== "new") continue;
    const lu = out.get(row.prospect_id)
      ?? { snaps: 0, slot_on: 0, slot_off: 0, left_on: 0, left_off: 0, right_on: 0, right_off: 0, backfield: 0 };
    for (const k of LINED_UP_KEYS) lu[k] += row[k] ?? 0;
    out.set(row.prospect_id, lu);
  }
  return out;
}

// The league model: every game's cells, summed and unweighted. `games`
// supplies each game's coverage era; rows without a game (the per-prospect
// 057 view) and unknown games count as the current definition. Null model
// (so SAE reads "—") when there are no cells, e.g. the view didn't load.
//
// Fit with era-specific coverage, then each era's level is anchored: an era
// column carries the offset that makes that era's expected opens match the
// no-coverage model's. With one era present the offset is 0 by construction
// (both fits' unpenalized intercepts already match the league's opens), so
// it's skipped and the fit is the plain one.
//
// `tagRows` (migration 064) carry the tagged routes, for the tag correction
// (tagCorrection.ts): fit on them alone, on top of this model, and only while
// a WR tag is switched on (or the tagged era is re-centered).
export function buildWRModel(
  cellRows: (ProspectRouteCellsRow & { game_id?: string })[],
  games: readonly Pick<ScoutingGame, "id" | "created_at">[] = [],
  tagRows: readonly ProspectGameRouteTagCellsRow[] = [],
): WRDifficultyModel {
  const base = buildWRBaseModel(cellRows, games);
  if (!base.model) return base;
  const correction = wrCorrection({ ...base, model: base.model }, cellRows, games, tagRows);
  return correction ? { ...base, correction } : base;
}

// Every tagged route cell in the league, unweighted, with its game's era.
function leagueTagCells(tagRows: readonly ProspectGameRouteTagCellsRow[], eras: Map<string, CoverageEra>): RouteTagCell[] {
  return tagRows.flatMap((r) => parseTagCells(r.cells, 1, eras.get(r.game_id) ?? "new"));
}

function wrCorrection(
  base: WRModelWith,
  cellRows: (ProspectRouteCellsRow & { game_id?: string })[],
  games: readonly Pick<ScoutingGame, "id" | "created_at">[],
  tagRows: readonly ProspectGameRouteTagCellsRow[],
): DifficultyCorrection<WRSituation> | null {
  const specs = enabledSpecs("wr_sae");
  const recenter = RECENTER_TAGGED.wr_sae;
  if ((!specs.length && !recenter) || !tagRows.length) return null;
  const eras = coverageEras(games);
  const tags = leagueTagCells(tagRows, eras);
  const resid = (c: RouteCell) => c.open - c.n * expectedFromModel(base.model, WR_DESIGN.cols(c));
  // Re-centered: the untagged routes' mean residual (every route's, minus the tagged ones').
  let recenterTo: number | undefined;
  if (recenter) {
    let n = 0, r = 0;
    for (const row of cellRows) for (const c of parseCells(row.cells, 1, (row.game_id != null ? eras.get(row.game_id) : undefined) ?? "new")) { n += c.n; r += resid(c); }
    for (const c of tags) { n -= c.n; r -= resid(c); }
    if (n > 0) recenterTo = r / n;
  }
  const fitted = fitTagCorrection<RouteTagCell>(
    base,
    { rows: tags, outcome: (c) => c.open / c.n, tagged: () => true, countOf: (c) => c.n },
    specs,
    { recenterTo },
  );
  // The same columns, read off any route (a cell, or a raw route's playCell).
  return fitted ? { design: correctionDesign<WRSituation>(specs), model: fitted.model, applies: (c) => c.tagged === true } : null;
}

// The WR difficulty model without any tag correction.
function buildWRBaseModel(
  cellRows: (ProspectRouteCellsRow & { game_id?: string })[],
  games: readonly Pick<ScoutingGame, "id" | "created_at">[],
): WRDifficultyModel {
  const eras = coverageEras(games);
  const league = new Map<string, RouteCell>();
  for (const row of cellRows) {
    const era = (row.game_id != null ? eras.get(row.game_id) : undefined) ?? "new";
    for (const c of parseCells(row.cells, 1, era)) {
      const key = `${c.route_type}|${c.coverage}|${c.alignment}|${c.on_line}|${era}`;
      const acc = league.get(key);
      if (acc) { acc.n += c.n; acc.open += c.open; } else league.set(key, { ...c });
    }
  }
  return fitWRCells([...league.values()]);
}

// The WR model fit on route cells (any grouping: the league's merged cells, or
// per-game cells for a held-out fold), with each coverage era anchored.
function fitWRCells(cells: readonly RouteCell[]): WRDifficultyModel {
  const rowsFor = (d: typeof WR_FIT_DESIGN) => cells.map((c) => ({ cols: d.cols(c), y: c.open / c.n, w: c.n }));
  const fitted = fitDifficultyModel(rowsFor(WR_FIT_DESIGN), WR_FIT_DESIGN.size, WR_RIDGE_LAMBDA);
  if (!fitted) return { design: WR_DESIGN, model: null };
  const model = new Float64Array(WR_DESIGN.size);
  model.set(fitted);
  const present = COVERAGE_ERAS.filter((e) => cells.some((c) => c.era === e));
  if (present.length > 1) {
    const level = fitDifficultyModel(rowsFor(WR_LEVEL_DESIGN), WR_LEVEL_DESIGN.size, WR_RIDGE_LAMBDA)!;
    for (const era of present) {
      const own = cells.filter((c) => c.era === era);
      const target = own.reduce((t, c) => t + c.n * expectedFromModel(level, WR_LEVEL_DESIGN.cols(c)), 0);
      const z = own.map((c) => ({ n: c.n, z: WR_FIT_DESIGN.cols(c).reduce((acc, col) => acc + fitted[col], fitted[0]) }));
      model[eraColumn(era)] = levelOffset(z, target);
    }
  }
  return { design: WR_DESIGN, model };
}

// Open / expected / squared-residual sums over a set of route cells. A cell of
// n routes with k open adds k residuals of (1 − e) and n − k of −e, each at
// the cell's weight (a cell weighted 0, garbage time left out, isn't counted).
// A tagged cell's expected includes the tag correction (expectedFor).
function cellSums(cells: RouteCell[], model: WRModelWith): ResidualSums {
  const s = emptyResidualSums();
  for (const c of cells) {
    if (!(c.w > 0)) continue;
    const e = expectedFor(model, c);
    s.n += c.n;
    s.w += c.w * c.n;
    s.w2 += c.w * c.w * c.n;
    s.actual += c.w * c.open;
    s.expected += c.w * c.n * e;
    s.sq += c.w * (c.open * (1 - e) * (1 - e) + (c.n - c.open) * e * e);
  }
  return s;
}

// Actual open rate vs the model's expected over a set of route cells. No
// minimum-sample gate here — callers that need the reliability floor
// (season/career) apply it themselves before calling in.
function saeFromCells(cells: RouteCell[], model: WRDifficultyModel): number | null {
  if (!model.model) return null;
  const s = cellSums(cells, { ...model, model: model.model });
  return s.n > 0 ? toAbovePts(s.actual / s.w, s.expected / s.w) : null;
}

// A charted route as a one-route cell. A tagged route carries its tags, so the
// tag correction (when one is on) judges it like the season numbers do.
const playCell = (era: CoverageEra) => (p: RoutePlay): RouteCell => ({
  route_type: p.route_type, coverage: p.coverage, alignment: p.alignment, on_line: p.on_line, era,
  n: 1, open: p.was_open ? 1 : 0, w: 1,
  ...(isTaggedPlay(p, "WR")
    ? { tagged: true, red_zone: p.red_zone === true, third_fourth_down: p.third_fourth_down === true, short_yardage: p.short_yardage === true, garbage_time: p.garbage_time === true }
    : {}),
});

// "Core-route" SAE — the same math as SAE, but Go (nine) and Screen routes
// are dropped from the sample entirely. Both are scheme-driven outliers rather
// than a receiver "beating" anything: screens are usually blocked open by
// design, gos are all-or-nothing deep shots. The difficulty model already
// prices both correctly; cSAE is the "won leverage vs coverage" view without
// them.
const SAE_EX_ROUTE_TYPES = new Set<string>(["nine", "screen"]);

// Season/career SAE, gated on 15 routes with charted open data.
function computeSAE(
  v: ProspectRouteStatsRow,
  cells: RouteCell[],
  model: WRDifficultyModel,
): number | null {
  if (!v.has_charted_open_data || v.total_routes < 15) return null;
  return saeFromCells(cells, model);
}

// saeFromCells plus the sample behind it (play count, sampling variance).
function sampleFromCells(cells: RouteCell[], model: WRModelWith): AESample | null {
  const s = cellSums(cells, model);
  const variance = residualVariancePts(s);
  if (variance == null) return null;
  return { ae: toAbovePts(s.actual / s.w, s.expected / s.w), n: s.n, w: s.w, variance };
}

// One row of prospect_game_route_cells (migration 058): 057's cells, per game.
export interface ProspectGameRouteCellsRow extends ProspectRouteCellsRow { game_id: string }

export interface WRTierSplits {
  /** Every route (SAE). */
  all: Map<string, ByTier>;
  /** Core routes, no nines or screens (cSAE). */
  core: Map<string, ByTier>;
}

// Each WR's residuals (open − expected) by the opponent tier of the game, for
// the AE Score's opponent adjustment. The league model is refit from the
// per-game cells (and `tagRows`, migration 064), the same model the SAE
// columns use. `games` supplies the seasons and coverage eras, so each tier's
// share of a WR's routes is weighted like his SAE; the residuals themselves
// stay unweighted for the tier measurement.
export function buildWRTierSplits(
  gameRows: ProspectGameRouteCellsRow[],
  tierOf: (gameId: string) => "P4" | "G5" | "FCS" | null | undefined,
  games: readonly ScoutingGame[] = [],
  tagRows: readonly ProspectGameRouteTagCellsRow[] = [],
): WRTierSplits {
  const out: WRTierSplits = { all: new Map(), core: new Map() };
  visitWRGameResiduals(gameRows, games, tagRows, (row) => {
    const tier = tierOf(row.game_id);
    if (!tier) return null;
    const all = out.all.get(row.prospect_id) ?? {};
    const core = out.core.get(row.prospect_id) ?? {};
    out.all.set(row.prospect_id, all);
    out.core.set(row.prospect_id, core);
    return (c, resid) => {
      addTierResidual(all, tier, c.n, resid, c.w * c.n);
      if (!SAE_EX_ROUTE_TYPES.has(c.route_type)) addTierResidual(core, tier, c.n, resid, c.w * c.n);
    };
  });
  return out;
}

/** Each prospect's WR residuals by charted game (all routes and core routes),
 *  for the game-context effects (contextEffects.ts). Same model and cells as
 *  the tier splits. */
export interface WRGameSplits {
  all: Map<string, ByGame>;
  core: Map<string, ByGame>;
}

export function buildWRGameSplits(
  gameRows: ProspectGameRouteCellsRow[],
  games: readonly ScoutingGame[] = [],
  tagRows: readonly ProspectGameRouteTagCellsRow[] = [],
): WRGameSplits {
  const out: WRGameSplits = { all: new Map(), core: new Map() };
  visitWRGameResiduals(gameRows, games, tagRows, (row) => {
    const all = out.all.get(row.prospect_id) ?? {};
    const core = out.core.get(row.prospect_id) ?? {};
    out.all.set(row.prospect_id, all);
    out.core.set(row.prospect_id, core);
    return (c, resid) => {
      addGameResidual(all, row.game_id, c.n, resid, c.w * c.n);
      if (!SAE_EX_ROUTE_TYPES.has(c.route_type)) addGameResidual(core, row.game_id, c.n, resid, c.w * c.n);
    };
  });
  return out;
}

// Every WR game cell's residual (open − n × expected) under the WR model, with
// its season weight. `onRow` is called once per game row and returns the
// visitor for that row's cells, or null to skip the row.
type WRCellVisitor = (c: { n: number; w: number; route_type: string }, resid: number) => void;
function visitWRGameResiduals(
  gameRows: ProspectGameRouteCellsRow[],
  games: readonly ScoutingGame[],
  tagRows: readonly ProspectGameRouteTagCellsRow[],
  onRow: (row: ProspectGameRouteCellsRow) => WRCellVisitor | null,
): void {
  const fitted = buildWRModel(gameRows, games, tagRows);
  if (!fitted.model) return;
  const model = { ...fitted, model: fitted.model };
  const weights = seasonWeights(games);
  const eras = coverageEras(games);
  const tagsBy = splitTagged(fitted) ? tagCellsByGame(tagRows) : null;
  for (const row of gameRows) {
    const visit = onRow(row);
    if (!visit) continue;
    const w = weights.get(row.game_id) ?? 1;
    for (const c of gameCells(row.cells, tagsBy?.get(row.game_id), w, eras.get(row.game_id) ?? "new")) {
      if (!(c.w > 0)) continue;
      visit(c, c.open - c.n * expectedFor(model, c));
    }
  }
}

// computeSAE / computeCoreSAE plus the sample behind each, for the
// cross-position composite (aeComposite.ts). Same gates, same sums, so `ae`
// equals the column's value.
function computeSAESample(
  v: ProspectRouteStatsRow,
  cells: RouteCell[],
  model: WRDifficultyModel,
): AESample | null {
  if (!v.has_charted_open_data || v.total_routes < 15 || !model.model) return null;
  return sampleFromCells(cells, { ...model, model: model.model });
}

function computeCoreSAESample(
  v: ProspectRouteStatsRow,
  cells: RouteCell[],
  model: WRDifficultyModel,
): AESample | null {
  if (!v.has_charted_open_data || !model.model) return null;
  const core = cells.filter((c) => !SAE_EX_ROUTE_TYPES.has(c.route_type));
  if (core.reduce((s, c) => s + c.n, 0) < 15) return null;
  return sampleFromCells(core, { ...model, model: model.model });
}

// Season/career cSAE, gated on 15 core routes. Exact: each cell carries its
// own route type and coverage, so dropping gos/screens drops their coverage
// snaps too.
function computeCoreSAE(
  v: ProspectRouteStatsRow,
  cells: RouteCell[],
  model: WRDifficultyModel,
): number | null {
  if (!v.has_charted_open_data) return null;
  const core = cells.filter((c) => !SAE_EX_ROUTE_TYPES.has(c.route_type));
  if (core.reduce((s, c) => s + c.n, 0) < 15) return null;
  return saeFromCells(core, model);
}

// The WR role buckets' skill sums (roleFitWR.ts): his routes by route type and
// by coverage, every game season-weighted like SAE. Press counts in-app games
// only: before the 2026-05-01 redefinition some press reps were charted as man.
function wrRoleSkill(cells: RouteCell[], model: WRModelWith): WRRoleSkill {
  const sum = (pred: (c: RouteCell) => boolean): AESum => {
    const r = cellSums(cells.filter(pred), model);
    return { n: r.n, w: r.w, actual: r.actual, expected: r.expected };
  };
  const byRoute: Partial<Record<string, AESum>> = {};
  for (const rt of ROUTE_TYPES) if (cells.some((c) => c.route_type === rt)) byRoute[rt] = sum((c) => c.route_type === rt);
  return {
    byRoute,
    zone: sum((c) => c.coverage === "zone"),
    man: sum((c) => c.coverage === "man"),
    press: sum((c) => c.coverage === "press" && c.era === "new"),
  };
}

// Each WR's tagged press reps and releases won (migration 064), and the pool's
// win rate, for the X bucket (roleFitWR.ts).
function releaseByProspect(tagRows: readonly ProspectGameRouteTagCellsRow[]): { byProspect: Map<string, { won: number; n: number }>; league: number | null } {
  const byProspect = new Map<string, { won: number; n: number }>();
  let won = 0, n = 0;
  for (const row of tagRows) {
    for (const c of parseTagCells(row.cells)) {
      if (c.press_release == null) continue;
      const r = byProspect.get(row.prospect_id) ?? { won: 0, n: 0 };
      r.n += c.n; n += c.n;
      if (c.press_release === "won") { r.won += c.n; won += c.n; }
      byProspect.set(row.prospect_id, r);
    }
  }
  return { byProspect, league: n > 0 ? won / n : null };
}

// Routes run per route type in in-app games, for the role buckets' route mix.
function inAppRouteCounts(cells: RouteCell[]): Partial<Record<string, number>> {
  const out: Partial<Record<string, number>> = {};
  for (const c of cells) if (c.era === "new") out[c.route_type] = (out[c.route_type] ?? 0) + c.n;
  return out;
}

// Per-game SAE (no minimum-sample gate — a single game's worth of routes is
// expected to be noisy; this is a quick "did this game look good/bad" read,
// not the reliability-gated season/career metric). `game` sets the coverage
// era its routes were charted under.
export function computeSAEForPlays(
  routePlays: RoutePlay[],
  model: WRDifficultyModel,
  game?: Pick<ScoutingGame, "created_at">,
): number | null {
  return saeFromCells(routePlays.filter((p) => !p.no_route_run).map(playCell(coverageEra(game))), model);
}

// Per-game core-route SAE — ungated, mirrors computeSAEForPlays.
export function computeCoreSAEForPlays(
  routePlays: RoutePlay[],
  model: WRDifficultyModel,
  game?: Pick<ScoutingGame, "created_at">,
): number | null {
  return saeFromCells(
    routePlays.filter((p) => !p.no_route_run && !SAE_EX_ROUTE_TYPES.has(p.route_type)).map(playCell(coverageEra(game))),
    model,
  );
}

function buildRouteStats(
  raw: Record<string, { count: number; open: number; targets: number; catches: number }>,
  has_charted_open_data: boolean,
): Partial<Record<RouteType, RouteStat>> {
  const out: Partial<Record<RouteType, RouteStat>> = {};
  for (const rt of ROUTE_TYPES) {
    const r = raw[rt];
    if (r && r.count > 0) {
      out[rt] = {
        count: r.count,
        open: has_charted_open_data ? r.open : 0,
        targets: r.targets,
        catches: has_charted_open_data ? r.catches : -1,
      };
    }
  }
  return out;
}

function buildCoverageStats(
  raw: Record<string, { count: number; open: number; catches: number }>,
  has_charted_open_data: boolean,
): Record<"man" | "zone" | "double" | "press", CoverageStat> {
  const make = (type: "man" | "zone" | "double" | "press"): CoverageStat => {
    const r = raw[type];
    const count = r?.count ?? 0;
    return {
      count,
      open: has_charted_open_data ? (r?.open ?? 0) : 0,
      catches: has_charted_open_data ? (r?.catches ?? 0) : -1,
    };
  };
  return { man: make("man"), zone: make("zone"), double: make("double"), press: make("press") };
}

function avgExternalRank(p: Prospect): number | null {
  const ranks = [p.pff_rank, p.mock_draft_rank, p.drafttek_rank, p.pfn_rank].filter(
    (r): r is number => r !== null && r !== undefined,
  );
  if (ranks.length === 0) return null;
  return parseFloat((ranks.reduce((s, r) => s + r, 0) / ranks.length).toFixed(1));
}

export interface ProspectThresholdCounts {
  /** Per-prospect QB throw count (from prospect_qb_stats.total_throws) */
  qbThrowsByProspect?: Map<string, number>;
  /** Per-prospect TE route count (from prospect_te_stats.total_routes) */
  teRoutesByProspect?: Map<string, number>;
}

// `gameCellRows` is prospect_game_route_cells (migration 058) and `games` the
// scouting games, for each route's season weight and coverage era. Pass
// `wrModel` when the caller already built it from the same rows and games
// (and `tagRows`). `alignmentRows` is prospect_game_alignment (migration 060),
// for lined_up. `tagRows` is prospect_game_route_tag_cells (migration 064):
// the tagged routes, judged apart only while the WR model has a tag
// correction or garbage time is weighted.
export function buildProspectsWithStats(
  prospects: Prospect[],
  viewRows: ProspectRouteStatsRow[],
  gameCellRows: ProspectGameRouteCellsRow[],
  games: readonly ScoutingGame[],
  thresholdCounts: ProspectThresholdCounts = {},
  wrModel: WRDifficultyModel = buildWRModel(gameCellRows, games),
  alignmentRows: readonly ProspectGameAlignmentRow[] = [],
  tagRows: readonly ProspectGameRouteTagCellsRow[] = [],
): ProspectWithStats[] {
  const byProspect = new Map(viewRows.map((r) => [r.prospect_id, r]));
  const eras = coverageEras(games);
  const cellsByProspect = weightedCellsByProspect(gameCellRows, seasonWeights(games), eras, splitTagged(wrModel) ? tagRows : undefined);
  const linedUp = linedUpByProspect(alignmentRows, eras);
  const { qbThrowsByProspect, teRoutesByProspect } = thresholdCounts;
  const release = releaseByProspect(tagRows);

  return prospects.map((p) => {
    const v = byProspect.get(p.id);
    const cells = cellsByProspect.get(p.id) ?? [];
    const lined_up = linedUp.get(p.id) ?? null;

    const total_games = v?.total_games ?? 0;
    const has_charted_open_data = v?.has_charted_open_data ?? false;

    // Per-position threshold count for the "fully charted" auto-promote:
    //   WR → routes from prospect_route_stats, TE → routes from te_plays,
    //   QB → throws from qb_plays. RB falls through to the games-based path.
    const wrRoutes = v?.total_routes ?? 0;
    const teRoutes = teRoutesByProspect?.get(p.id) ?? 0;
    const qbThrows = qbThrowsByProspect?.get(p.id) ?? 0;

    return {
      ...p,
      charting_decision: deriveChartingDecision(
        p.charting_decision,
        total_games,
        p.position,
        p.position === "TE" ? teRoutes : wrRoutes,
        qbThrows,
      ),
      total_snaps: v?.total_snaps ?? 0,
      total_routes: v?.total_routes ?? 0,
      total_games,
      targets: v?.targets ?? 0,
      catches: v?.catches ?? 0,
      drops: v?.drops ?? 0,
      contested: v?.contested ?? 0,
      contested_catches: v?.contested_catches ?? 0,
      success_rate: v?.success_rate ?? null,
      target_rate: v?.target_rate ?? null,
      pct_left: v?.pct_left ?? null,
      pct_right: v?.pct_right ?? null,
      pct_slot: v?.pct_slot ?? null,
      pct_backfield: v?.pct_backfield ?? null,
      pct_on_line: v?.pct_on_line ?? null,
      lined_up,
      role_fit: p.position === "WR" && wrModel.model
        ? wrRoleFit({
            skill: wrRoleSkill(cells, { ...wrModel, model: wrModel.model }),
            release: release.byProspect.get(p.id) ?? null,
            leagueRelease: release.league,
            linedUp: lined_up,
            inAppRouteCounts: inAppRouteCounts(cells),
            heightIn: parseHeightInches(p.height),
            weightLb: p.weight,
          })
        : null,
      adj_success_above_exp: v ? computeSAE(v, cells, wrModel) : null,
      core_sae: v ? computeCoreSAE(v, cells, wrModel) : null,
      sae_sample: v ? computeSAESample(v, cells, wrModel) : null,
      core_sae_sample: v ? computeCoreSAESample(v, cells, wrModel) : null,
      avg_external_rank: avgExternalRank(p),
      depth_behind_los: v?.depth_behind_los ?? 0,
      depth_on_los: v?.depth_on_los ?? 0,
      has_charted_open_data,
      route_stats: buildRouteStats(v?.route_stats_raw ?? {}, has_charted_open_data),
      coverage_stats: buildCoverageStats(v?.coverage_stats_raw ?? {}, has_charted_open_data),
      open_pct_slot: v?.open_pct_slot ?? null,
      open_pct_slot_on_line: v?.open_pct_slot_on_line ?? null,
      open_pct_slot_off_line: v?.open_pct_slot_off_line ?? null,
      open_pct_right: v?.open_pct_right ?? null,
      open_pct_right_on_line: v?.open_pct_right_on_line ?? null,
      open_pct_right_off_line: v?.open_pct_right_off_line ?? null,
      open_pct_left: v?.open_pct_left ?? null,
      open_pct_left_on_line: v?.open_pct_left_on_line ?? null,
      open_pct_left_off_line: v?.open_pct_left_off_line ?? null,
      open_pct_backfield: v?.open_pct_backfield ?? null,
      align_n_slot: v?.align_n_slot ?? 0,
      align_n_slot_on_line: v?.align_n_slot_on_line ?? 0,
      align_n_slot_off_line: v?.align_n_slot_off_line ?? 0,
      align_n_right: v?.align_n_right ?? 0,
      align_n_right_on_line: v?.align_n_right_on_line ?? 0,
      align_n_right_off_line: v?.align_n_right_off_line ?? 0,
      align_n_left: v?.align_n_left ?? 0,
      align_n_left_on_line: v?.align_n_left_on_line ?? 0,
      align_n_left_off_line: v?.align_n_left_off_line ?? 0,
      align_n_backfield: v?.align_n_backfield ?? 0,
    };
  });
}


// ── The Grading checks (tag readiness and tests, garbage time, era scale) ──
/** One game's WR route cell with its prospect and game: 058's cells with the
 *  game's tagged routes split out as their own cells (gameCells), unweighted. */
export interface WRGradingCell extends RouteCell { prospect_id: string; game_id: string }

export function wrGradingCells(
  gameRows: readonly ProspectGameRouteCellsRow[],
  tagRows: readonly ProspectGameRouteTagCellsRow[],
  games: readonly Pick<ScoutingGame, "id" | "created_at">[],
): WRGradingCell[] {
  const eras = coverageEras(games);
  const tagsBy = tagCellsByGame(tagRows);
  return gameRows.flatMap((row) =>
    gameCells(row.cells, tagsBy.get(row.game_id), 1, eras.get(row.game_id) ?? "new")
      .map((c) => ({ ...c, w: 1, prospect_id: row.prospect_id, game_id: row.game_id })));
}

/** The WR model (no tag correction) fit on these cells, for a held-out fold. */
export function fitWRGradingModel(cells: readonly WRGradingCell[]): WRDifficultyModel {
  return fitWRCells(cells);
}
