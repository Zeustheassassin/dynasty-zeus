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
  QBPlatform,
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
const QB_PLATFORM_BUCKETS: QBPlatform[] = ["on_platform", "off_platform", "on_the_run"];
const QB_HANDLING_BUCKETS: QBPressureHandling[] = ["step_up", "bail_front_side", "bail_backside"];

const TE_POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back", "wing_back"];

const MIN_SAMPLE = 15;
// QB AAE samples 7 dimensions so each dimension's expected estimate is noisier
// than the 2-dimension RB/TE versions — raise the minimum to compensate.
const QB_MIN_SAMPLE = 25;

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
export function computeRBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(rbPlays, gameToProspect);

  // League baselines: per-formation success rate and loaded-vs-unloaded box
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

  for (const p of prospects) {
    if (p.position !== "RB") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    const runPlays = pPlays.filter((pl) => RB_RUN_TYPES.includes(pl.run_type as RBRunType));
    const knownRuns = runPlays.filter((pl) => pl.success !== null);
    if (knownRuns.length < MIN_SAMPLE) { out.set(p.id, null); continue; }

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
    out.set(p.id, combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null);
  }

  return out;
}

// ── QB AAE ───────────────────────────────────────────────────────────────
// "Accuracy Above Expected" — actual on-target% minus an expected on-target%
// computed from league baselines across seven situational dimensions:
//   depth zone, coverage, timing, pressure, platform, pressure handling, route type.
//
// Per dimension, we compute a weighted-average expected on-target% using the
// QB's distribution across that dimension's buckets and the league's on-target%
// in each bucket. Dimensions whose values are NULL on a play don't contribute
// for that play (older plays charted before Pressure / Platform / Handling
// existed simply don't pull the metric toward 0). The seven per-dimension
// estimates are then mean-averaged, ignoring nulls.
//
// Excluded from both numerator and denominator:
//   - Run plays (no throw)
//   - Plays with accuracy == null (sack / scramble / throw_away)
//   - Tipped balls (consistent with the on-target% denominator in QBStatsTable —
//     the intended trajectory is unknowable after a deflection)
const isQBGradedThrow = (pl: QBPlay) =>
  // Include RPO throws — they're real pass attempts with accuracy ratings.
  pl.play_type !== "run" && pl.accuracy != null && pl.accuracy !== "tipped_ball";

type Bucketed<K extends string> = Partial<Record<K, { ot: number; n: number }>>;

interface QBBaselines {
  depth:    Bucketed<QBDepthZone>;
  cvg:      Record<"man" | "zone", { ot: number; n: number }>;
  timing:   Bucketed<QBTiming>;
  pressure: Bucketed<QBPressure>;
  platform: Bucketed<QBPlatform>;
  handling: Bucketed<QBPressureHandling>;
  route:    Bucketed<RouteType>;
}

function buildQBBaselines(leaguePlays: QBPlay[]): QBBaselines {
  const b: QBBaselines = {
    depth: {}, cvg: { man: { ot: 0, n: 0 }, zone: { ot: 0, n: 0 } },
    timing: {}, pressure: {}, platform: {}, handling: {}, route: {},
  };
  for (const pl of leaguePlays) {
    if (!isQBGradedThrow(pl)) continue;
    const ot = pl.accuracy === "on_target";
    if (pl.depth_zone)        { (b.depth[pl.depth_zone]   ??= { ot: 0, n: 0 }).n++; if (ot) b.depth[pl.depth_zone]!.ot++; }
    if (pl.coverage === "man" || pl.coverage === "zone") { b.cvg[pl.coverage].n++; if (ot) b.cvg[pl.coverage].ot++; }
    if (pl.timing)            { (b.timing[pl.timing]      ??= { ot: 0, n: 0 }).n++; if (ot) b.timing[pl.timing]!.ot++; }
    if (pl.pressure)          { (b.pressure[pl.pressure]  ??= { ot: 0, n: 0 }).n++; if (ot) b.pressure[pl.pressure]!.ot++; }
    if (pl.platform)          { (b.platform[pl.platform]  ??= { ot: 0, n: 0 }).n++; if (ot) b.platform[pl.platform]!.ot++; }
    if (pl.pressure_handling) { (b.handling[pl.pressure_handling] ??= { ot: 0, n: 0 }).n++; if (ot) b.handling[pl.pressure_handling]!.ot++; }
    if (pl.route_type)        { (b.route[pl.route_type]   ??= { ot: 0, n: 0 }).n++; if (ot) b.route[pl.route_type]!.ot++; }
  }
  return b;
}

// Per-play expected on-target% — the mean of league bucket rates across every
// dimension that's filled on the play. Skips a dim when its bucket is null on
// this play or the league has no data for that bucket. Returns null only if
// none of the seven dims yield a comparable league rate (essentially never on
// a graded throw, since depth_zone is filled on every charted throw).
//
// This is the engine of the overall AAE calculation: comparing the QB's actual
// on-target% against the mean of these per-play expecteds avoids the double-
// counting that arises from averaging seven correlated per-dimension AAEs. A
// broken-pocket throw, for example, gets one low expected (the mean of the
// pressure / platform / handling / timing bucket rates, plus depth / coverage /
// route) instead of being penalized four separate times.
function expectedForPlay(pl: QBPlay, baselines: QBBaselines): number | null {
  const rates: number[] = [];
  const push = (lg: { ot: number; n: number } | undefined) => {
    if (lg && lg.n > 0) rates.push(lg.ot / lg.n);
  };
  if (pl.depth_zone) push(baselines.depth[pl.depth_zone]);
  if (pl.coverage === "man" || pl.coverage === "zone") push(baselines.cvg[pl.coverage]);
  if (pl.timing) push(baselines.timing[pl.timing]);
  if (pl.pressure) push(baselines.pressure[pl.pressure]);
  if (pl.platform) push(baselines.platform[pl.platform]);
  if (pl.pressure_handling) push(baselines.handling[pl.pressure_handling]);
  if (pl.route_type) push(baselines.route[pl.route_type]);
  if (!rates.length) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

// Weighted expected on-target% for one dimension AND the QB's actual on-target%
// over the same subset of plays (those where the dimension is filled and the
// league has a matching bucket). Comparing actual to expected on the same
// subset keeps AAE Hd / Pr / Pl honest — pressure_handling is only logged on
// pressured throws, so comparing all-throw accuracy against a pressured-only
// baseline biases AAE positive league-wide.
function expectedFor<K extends string>(
  ratedPasses: QBPlay[],
  bucketFn: (pl: QBPlay) => K | null | undefined,
  league: Bucketed<K>,
  buckets: readonly K[],
): { expected: number | null; actual: number | null; n: number } {
  const total = ratedPasses.length;
  if (!total) return { expected: null, actual: null, n: 0 };
  let exp = 0;
  let weight = 0;
  let filled = 0;
  let filledOnTgt = 0;
  for (const b of buckets) {
    const inBucket = ratedPasses.filter((pl) => bucketFn(pl) === b);
    const n = inBucket.length;
    const lg = league[b];
    if (n > 0 && lg && lg.n > 0) {
      const share = n / total;
      exp += share * (lg.ot / lg.n);
      weight += share;
      filled += n;
      filledOnTgt += inBucket.filter((pl) => pl.accuracy === "on_target").length;
    }
  }
  return {
    expected: weight > 0 ? exp / weight : null,
    actual: filled > 0 ? filledOnTgt / filled : null,
    n: filled,
  };
}

// Per-dimension AAE row: actual on-target% minus the dimension's expected,
// in percentage points. `n` is how many of the QB's rated passes had this
// dimension filled (a sample-size signal for the UI).
export interface QBAAEDimRow {
  key: "depth" | "coverage" | "timing" | "pressure" | "platform" | "handling" | "route";
  label: string;
  aae: number | null;
  n: number;
}

export interface QBAAEBreakdown {
  ratedPasses: number;        // total graded throws (denominator of actual on-target%)
  actualOnTgtPct: number | null;
  total: number | null;       // overall AAE — actual on-target% minus mean per-play expected
  dims: QBAAEDimRow[];
}

function breakdownFor(ratedPasses: QBPlay[], baselines: QBBaselines): QBAAEBreakdown {
  const denom = ratedPasses.length;
  if (!denom) {
    return { ratedPasses: 0, actualOnTgtPct: null, total: null, dims: [] };
  }
  const actual = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / denom;

  const rows: QBAAEDimRow[] = [
    { key: "depth",    label: "Depth Zone",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.depth_zone,        baselines.depth,    QB_DEPTH_ZONES)) },
    { key: "coverage", label: "Coverage",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.coverage === "man" || pl.coverage === "zone" ? pl.coverage : null, baselines.cvg, ["man", "zone"] as const)) },
    { key: "timing",   label: "Timing",            ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.timing,            baselines.timing,   QB_TIMING_BUCKETS)) },
    { key: "pressure", label: "Pressure",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.pressure,          baselines.pressure, QB_PRESSURE_BUCKETS)) },
    { key: "platform", label: "Platform",          ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.platform,          baselines.platform, QB_PLATFORM_BUCKETS)) },
    { key: "handling", label: "Pressure Handling", ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.pressure_handling, baselines.handling, QB_HANDLING_BUCKETS)) },
    { key: "route",    label: "Route Type",        ...toAaeRow(expectedFor(ratedPasses, (pl) => pl.route_type,        baselines.route,    ROUTE_TYPES)) },
  ];

  // Overall AAE: per-play expected vs. actual on-target% on the same play
  // subset. This is intentionally NOT the mean of the per-dim AAEs above —
  // averaging correlated dim AAEs double-counts skill (e.g. broken-pocket
  // throws penalize all four pressure-cluster dims). See expectedForPlay.
  let sumExpected = 0;
  let sumOnTgt = 0;
  let nContrib = 0;
  for (const pl of ratedPasses) {
    const exp = expectedForPlay(pl, baselines);
    if (exp == null) continue;
    sumExpected += exp;
    if (pl.accuracy === "on_target") sumOnTgt++;
    nContrib++;
  }
  const total = nContrib > 0
    ? parseFloat((((sumOnTgt - sumExpected) / nContrib) * 100).toFixed(2))
    : null;

  return {
    ratedPasses: denom,
    actualOnTgtPct: parseFloat((actual * 100).toFixed(2)),
    total,
    dims: rows,
  };
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
  const baselines = buildQBBaselines(qbPlays);

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    if (ratedPasses.length < QB_MIN_SAMPLE) { out.set(p.id, null); continue; }
    out.set(p.id, breakdownFor(ratedPasses, baselines).total);
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
  const baselines = buildQBBaselines(leaguePlays);
  const ratedPasses = prospectPlays.filter(isQBGradedThrow);
  return breakdownFor(ratedPasses, baselines);
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
  const baselines = buildQBBaselines(qbPlays);

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const ratedPasses = (playsByProspect.get(p.id) ?? []).filter(isQBGradedThrow);
    if (ratedPasses.length < QB_MIN_SAMPLE) continue;
    out.set(p.id, breakdownFor(ratedPasses, baselines));
  }

  return out;
}

// ── TE TE-SAER (route running) ───────────────────────────────────────────
// Open Rate Above Expected. Adjusts a TE's open% on rated routes for the
// situation mix across two dimensions: positioning (6 buckets) and coverage
// (3 buckets — press folds into man).
export function computeTERouteAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);

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

  for (const p of prospects) {
    if (p.position !== "TE") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    const routePlays = pPlays.filter((pl) => pl.play_type === "route_run");
    const ratedRoutes = routePlays.filter((pl) => pl.was_open !== null);
    if (ratedRoutes.length < MIN_SAMPLE) { out.set(p.id, null); continue; }

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
    out.set(p.id, combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null);
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
export function computeTEBlockAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  tePlays: TEPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(tePlays, gameToProspect);

  const PLAY_TYPES = ["run_block", "pass_block"] as const;
  const BLOCK_TYPES = ["movement", "inline"] as const;
  type PT = (typeof PLAY_TYPES)[number];
  type BT = (typeof BLOCK_TYPES)[number];

  const lgPT: Record<PT, { s: number; n: number }> = {
    run_block: { s: 0, n: 0 }, pass_block: { s: 0, n: 0 },
  };
  const lgBT: Record<BT, { s: number; n: number }> = {
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

    const actual = ratedBlocks.filter((pl) => pl.block_success).length / ratedBlocks.length;

    let expPT = 0, ptW = 0;
    for (const pt of PLAY_TYPES) {
      const ptN = ratedBlocks.filter((pl) => pl.play_type === pt).length;
      const lg = lgPT[pt];
      if (ptN > 0 && lg.n > 0) {
        expPT += (ptN / ratedBlocks.length) * (lg.s / lg.n);
        ptW += ptN / ratedBlocks.length;
      }
    }
    let expBT = 0, btW = 0;
    for (const bt of BLOCK_TYPES) {
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
    out.set(p.id, combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null);
  }

  return out;
}
