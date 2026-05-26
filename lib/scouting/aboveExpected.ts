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

// Average across an arbitrary list of per-dimension expecteds, skipping nulls.
// Returns null only if every dimension is null (no comparable league data).
function combineMany(values: (number | null)[]): number | null {
  const real = values.filter((v): v is number => v != null);
  if (!real.length) return null;
  return real.reduce((a, b) => a + b, 0) / real.length;
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
export function computeQBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(qbPlays, gameToProspect);

  const isGradedThrow = (pl: QBPlay) =>
    // Include RPO throws — they're real pass attempts with accuracy ratings.
    pl.play_type !== "run" && pl.accuracy != null && pl.accuracy !== "tipped_ball";

  // ── League baselines (per bucket, per dimension) ──
  const lgDepth:    Partial<Record<QBDepthZone,         { ot: number; n: number }>> = {};
  const lgCvg:      Record<"man" | "zone",              { ot: number; n: number }>  = { man: { ot: 0, n: 0 }, zone: { ot: 0, n: 0 } };
  const lgTiming:   Partial<Record<QBTiming,            { ot: number; n: number }>> = {};
  const lgPressure: Partial<Record<QBPressure,          { ot: number; n: number }>> = {};
  const lgPlatform: Partial<Record<QBPlatform,          { ot: number; n: number }>> = {};
  const lgHandling: Partial<Record<QBPressureHandling,  { ot: number; n: number }>> = {};
  const lgRoute:    Partial<Record<RouteType,           { ot: number; n: number }>> = {};

  for (const pl of qbPlays) {
    if (!isGradedThrow(pl)) continue;
    const isOT = pl.accuracy === "on_target";
    if (pl.depth_zone)                      { (lgDepth[pl.depth_zone]    ??= { ot: 0, n: 0 }).n++; if (isOT) lgDepth[pl.depth_zone]!.ot++; }
    if (pl.coverage === "man" || pl.coverage === "zone") { lgCvg[pl.coverage].n++; if (isOT) lgCvg[pl.coverage].ot++; }
    if (pl.timing)                          { (lgTiming[pl.timing]       ??= { ot: 0, n: 0 }).n++; if (isOT) lgTiming[pl.timing]!.ot++; }
    if (pl.pressure)                        { (lgPressure[pl.pressure]   ??= { ot: 0, n: 0 }).n++; if (isOT) lgPressure[pl.pressure]!.ot++; }
    if (pl.platform)                        { (lgPlatform[pl.platform]   ??= { ot: 0, n: 0 }).n++; if (isOT) lgPlatform[pl.platform]!.ot++; }
    if (pl.pressure_handling)               { (lgHandling[pl.pressure_handling] ??= { ot: 0, n: 0 }).n++; if (isOT) lgHandling[pl.pressure_handling]!.ot++; }
    if (pl.route_type)                      { (lgRoute[pl.route_type]    ??= { ot: 0, n: 0 }).n++; if (isOT) lgRoute[pl.route_type]!.ot++; }
  }

  // Weighted expected on-target% for one dimension. Weights are share of
  // the QB's rated passes whose dimension value falls in each bucket; plays
  // missing the dimension entirely have zero weight and don't contribute.
  function expectedFor<K extends string>(
    ratedPasses: QBPlay[],
    bucketFn: (pl: QBPlay) => K | null | undefined,
    league: Partial<Record<K, { ot: number; n: number }>>,
    buckets: readonly K[],
  ): number | null {
    const total = ratedPasses.length;
    if (!total) return null;
    let exp = 0;
    let weight = 0;
    for (const b of buckets) {
      const n = ratedPasses.filter((pl) => bucketFn(pl) === b).length;
      const lg = league[b];
      if (n > 0 && lg && lg.n > 0) {
        const share = n / total;
        exp += share * (lg.ot / lg.n);
        weight += share;
      }
    }
    return weight > 0 ? exp / weight : null;
  }

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    const ratedPasses = pPlays.filter(isGradedThrow);
    if (ratedPasses.length < QB_MIN_SAMPLE) { out.set(p.id, null); continue; }

    const actual = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / ratedPasses.length;

    const expDepth    = expectedFor(ratedPasses, (pl) => pl.depth_zone,        lgDepth,    QB_DEPTH_ZONES);
    const expCvg      = expectedFor(ratedPasses, (pl) => pl.coverage === "man" || pl.coverage === "zone" ? pl.coverage : null, lgCvg, ["man", "zone"] as const);
    const expTiming   = expectedFor(ratedPasses, (pl) => pl.timing,            lgTiming,   QB_TIMING_BUCKETS);
    const expPressure = expectedFor(ratedPasses, (pl) => pl.pressure,          lgPressure, QB_PRESSURE_BUCKETS);
    const expPlatform = expectedFor(ratedPasses, (pl) => pl.platform,          lgPlatform, QB_PLATFORM_BUCKETS);
    const expHandling = expectedFor(ratedPasses, (pl) => pl.pressure_handling, lgHandling, QB_HANDLING_BUCKETS);
    const expRoute    = expectedFor(ratedPasses, (pl) => pl.route_type,        lgRoute,    ROUTE_TYPES);

    const combined = combineMany([expDepth, expCvg, expTiming, expPressure, expPlatform, expHandling, expRoute]);
    out.set(p.id, combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null);
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
