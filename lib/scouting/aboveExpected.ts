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
  TEPositioning,
  TECoverage,
} from "../types";

const RB_RUN_TYPES: RBRunType[] = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];
const RB_FORMATIONS: RBFormation[] = ["gun", "pistol", "under_center"];

const QB_DEPTH_ZONES: QBDepthZone[] = [
  "deep_left", "deep_center", "deep_right",
  "mid_left",  "mid_center",  "mid_right",
  "short_left","short_center","short_right",
];

const TE_POSITIONINGS: TEPositioning[] = ["wide", "slot", "inline", "full_back", "running_back", "wing_back"];

const MIN_SAMPLE = 15;

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
export function computeQBAboveExpected(
  prospects: Prospect[],
  games: ScoutingGame[],
  qbPlays: QBPlay[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  const gameToProspect = buildGameToProspect(games);
  const playsByProspect = buildPlaysByProspect(qbPlays, gameToProspect);

  const lgDepth: Partial<Record<QBDepthZone, { ot: number; n: number }>> = {};
  const lgCvg: Record<"man" | "zone", { ot: number; n: number }> = { man: { ot: 0, n: 0 }, zone: { ot: 0, n: 0 } };
  for (const pl of qbPlays) {
    // Include RPO throws — they're real pass attempts with accuracy ratings.
    // Excluding them mismatched the per-prospect detail view and undercounted
    // off-target throws that happened on RPO plays.
    if (pl.play_type === "run" || pl.accuracy == null) continue;
    if (pl.depth_zone) {
      if (!lgDepth[pl.depth_zone]) lgDepth[pl.depth_zone] = { ot: 0, n: 0 };
      lgDepth[pl.depth_zone]!.n++;
      if (pl.accuracy === "on_target") lgDepth[pl.depth_zone]!.ot++;
    }
    if (pl.coverage === "man" || pl.coverage === "zone") {
      lgCvg[pl.coverage].n++;
      if (pl.accuracy === "on_target") lgCvg[pl.coverage].ot++;
    }
  }

  for (const p of prospects) {
    if (p.position !== "QB") continue;
    const pPlays = playsByProspect.get(p.id) ?? [];
    const thrownPlays = pPlays.filter((pl) => pl.play_type !== "run");
    const ratedPasses = thrownPlays.filter((pl) => pl.accuracy != null);
    if (ratedPasses.length < MIN_SAMPLE) { out.set(p.id, null); continue; }

    const actual = ratedPasses.filter((pl) => pl.accuracy === "on_target").length / ratedPasses.length;

    let expDepth = 0, dW = 0;
    for (const dz of QB_DEPTH_ZONES) {
      const dzN = ratedPasses.filter((pl) => pl.depth_zone === dz).length;
      const lg = lgDepth[dz];
      if (dzN > 0 && lg && lg.n > 0) { expDepth += (dzN / ratedPasses.length) * (lg.ot / lg.n); dW += dzN / ratedPasses.length; }
    }
    let expCvg = 0, cW = 0;
    for (const cvg of ["man", "zone"] as const) {
      const cN = ratedPasses.filter((pl) => pl.coverage === cvg).length;
      const lg = lgCvg[cvg];
      if (cN > 0 && lg.n > 0) { expCvg += (cN / ratedPasses.length) * (lg.ot / lg.n); cW += cN / ratedPasses.length; }
    }
    const normDepth = dW > 0 ? expDepth / dW : null;
    const normCvg = cW > 0 ? expCvg / cW : null;
    const combined = combine(normDepth, normCvg);
    out.set(p.id, combined != null ? parseFloat(((actual - combined) * 100).toFixed(2)) : null);
  }

  return out;
}

// ── TE TE-SAE ────────────────────────────────────────────────────────────
export function computeTEAboveExpected(
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
      // Press folds into Man for TE-SAE bucketing.
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
