import type {
  AESample,
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
import { COVERAGE_ERAS, coverageEra, coverageEras, type CoverageEra } from "./coverageEra";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

export interface ProspectRouteStatsRow {
  prospect_id: string;
  total_games: number;
  total_snaps: number;
  total_routes: number;
  total_yards: number;
  open_routes: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contested_catches: number;
  success_rate: number | null;
  target_rate: number | null;
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
// with the coverage definition it was charted under.
interface WRSituation {
  route_type: string;
  coverage: string;
  alignment: string;
  on_line: boolean;
  era: CoverageEra;
}
// `w` is the season weight of each of the cell's routes (1 = counts in full).
interface RouteCell extends WRSituation { n: number; open: number; w: number }

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

// One row of the prospect_route_cells view (migration 057): cell key
// "route_type|coverage|alignment|on_line" → [routes, open routes].
export interface ProspectRouteCellsRow {
  prospect_id: string;
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

// Each prospect's cells from the per-game rows, every game's routes carrying
// its season weight and coverage era. Games of the same season and era merge
// into one cell per situation.
function weightedCellsByProspect(
  gameRows: ProspectGameRouteCellsRow[],
  weights: Map<string, number>,
  eras: Map<string, CoverageEra>,
): Map<string, RouteCell[]> {
  const merged = new Map<string, Map<string, RouteCell>>();
  for (const row of gameRows) {
    const w = weights.get(row.game_id) ?? 1;
    const era = eras.get(row.game_id) ?? "new";
    const cells = merged.get(row.prospect_id) ?? new Map<string, RouteCell>();
    merged.set(row.prospect_id, cells);
    for (const c of parseCells(row.cells, w, era)) {
      const key = `${c.route_type}|${c.coverage}|${c.alignment}|${c.on_line}|${w}|${era}`;
      const acc = cells.get(key);
      if (acc) { acc.n += c.n; acc.open += c.open; } else cells.set(key, c);
    }
  }
  return new Map([...merged].map(([id, cells]) => [id, [...cells.values()]]));
}

// The logit offset that makes a set of cells' expected opens sum to `target`
// (Newton's method; the sum rises steadily with the offset).
function levelOffset(cells: { n: number; z: number }[], target: number): number {
  let d = 0;
  for (let i = 0; i < 50; i++) {
    let f = -target, df = 0;
    for (const c of cells) { const p = 1 / (1 + Math.exp(-(c.z + d))); f += c.n * p; df += c.n * p * (1 - p); }
    if (!(df > 0)) break;
    const step = f / df;
    d = Math.min(5, Math.max(-5, d - step));
    if (Math.abs(step) < 1e-12) break;
  }
  return d;
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
export function buildWRModel(
  cellRows: (ProspectRouteCellsRow & { game_id?: string })[],
  games: readonly Pick<ScoutingGame, "id" | "created_at">[] = [],
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
  const cells = [...league.values()];
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
// the cell's season weight.
function cellSums(cells: RouteCell[], model: Float64Array): ResidualSums {
  const s = emptyResidualSums();
  for (const c of cells) {
    const e = expectedFromModel(model, WR_DESIGN.cols(c));
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
  const s = cellSums(cells, model.model);
  return s.n > 0 ? toAbovePts(s.actual / s.w, s.expected / s.w) : null;
}

const playCell = (era: CoverageEra) => (p: RoutePlay): RouteCell => ({
  route_type: p.route_type, coverage: p.coverage, alignment: p.alignment, on_line: p.on_line, era,
  n: 1, open: p.was_open ? 1 : 0, w: 1,
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
function sampleFromCells(cells: RouteCell[], model: Float64Array): AESample | null {
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
// per-game cells, the same model the SAE columns use. `games` supplies the
// seasons and coverage eras, so each tier's share of a WR's routes is
// season-weighted like his SAE; the residuals themselves stay unweighted for
// the tier measurement.
export function buildWRTierSplits(
  gameRows: ProspectGameRouteCellsRow[],
  tierOf: (gameId: string) => "P4" | "G5" | "FCS" | null | undefined,
  games: readonly ScoutingGame[] = [],
): WRTierSplits {
  const out: WRTierSplits = { all: new Map(), core: new Map() };
  const { model } = buildWRModel(gameRows, games);
  if (!model) return out;
  const weights = seasonWeights(games);
  const eras = coverageEras(games);
  for (const row of gameRows) {
    const tier = tierOf(row.game_id);
    if (!tier) continue;
    const w = weights.get(row.game_id) ?? 1;
    const all = out.all.get(row.prospect_id) ?? {};
    const core = out.core.get(row.prospect_id) ?? {};
    for (const c of parseCells(row.cells, 1, eras.get(row.game_id) ?? "new")) {
      const resid = c.open - c.n * expectedFromModel(model, WR_DESIGN.cols(c));
      addTierResidual(all, tier, c.n, resid, w * c.n);
      if (!SAE_EX_ROUTE_TYPES.has(c.route_type)) addTierResidual(core, tier, c.n, resid, w * c.n);
    }
    out.all.set(row.prospect_id, all);
    out.core.set(row.prospect_id, core);
  }
  return out;
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
  return sampleFromCells(cells, model.model);
}

function computeCoreSAESample(
  v: ProspectRouteStatsRow,
  cells: RouteCell[],
  model: WRDifficultyModel,
): AESample | null {
  if (!v.has_charted_open_data || !model.model) return null;
  const core = cells.filter((c) => !SAE_EX_ROUTE_TYPES.has(c.route_type));
  if (core.reduce((s, c) => s + c.n, 0) < 15) return null;
  return sampleFromCells(core, model.model);
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
// `wrModel` when the caller already built it from the same rows and games.
export function buildProspectsWithStats(
  prospects: Prospect[],
  viewRows: ProspectRouteStatsRow[],
  gameCellRows: ProspectGameRouteCellsRow[],
  games: readonly ScoutingGame[],
  thresholdCounts: ProspectThresholdCounts = {},
  wrModel: WRDifficultyModel = buildWRModel(gameCellRows, games),
): ProspectWithStats[] {
  const byProspect = new Map(viewRows.map((r) => [r.prospect_id, r]));
  const cellsByProspect = weightedCellsByProspect(gameCellRows, seasonWeights(games), coverageEras(games));
  const { qbThrowsByProspect, teRoutesByProspect } = thresholdCounts;

  return prospects.map((p) => {
    const v = byProspect.get(p.id);
    const cells = cellsByProspect.get(p.id) ?? [];

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
      total_yards: v?.total_yards ?? 0,
      success_rate: v?.success_rate ?? null,
      target_rate: v?.target_rate ?? null,
      avg_ypc: v?.avg_ypc ?? null,
      pct_left: v?.pct_left ?? null,
      pct_right: v?.pct_right ?? null,
      pct_slot: v?.pct_slot ?? null,
      pct_backfield: v?.pct_backfield ?? null,
      pct_on_line: v?.pct_on_line ?? null,
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

