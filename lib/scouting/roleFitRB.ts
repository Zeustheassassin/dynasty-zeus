// RB role buckets: Three-down, Zone, Gap/Power, Receiving and Big-play
// (approved by the user, 2026-10-02). Scoring is shared (roleFit.ts); this
// file holds the RB features and recipes.
//
// Every game counts. Unlike WR, the RB games charted before 2026-05-01 were
// charted play by play (each took 13+ minutes; the WR import went in under
// one), so nothing in them is filled in.
//
// Run skill comes from the SRAE models (aboveExpected.ts): overall and
// loaded-box runs from the headline model; zone and gap runs from the run-type
// model the SRAE breakdown columns use, so a back isn't credited for running
// the easier scheme. The rest are rates against the league's rate on the same
// kind of play (explosive, broken tackle and stuffed runs; pass-block wins;
// open rate on routes; drops per target).
//
// The Three-down pass-pro gate also reads PFF's pass blocking over the charted
// games (pressures allowed per pass-block snap; tape-grading expansion, Stage
// 4), blended with the charted pass-block wins by reps. Without PFF rows the
// gate reads the charting alone, as before.
import type { Prospect, RBPlay, RBRunType, ScoutingGame } from "../types";
import type { PffTotals } from "../pff/totals";
import { computeRBRoleSlices } from "./aboveExpected";
import { parseHeightInches } from "./prospectAge";
import {
  buildRoleFit, contrastFeature, skillFeature, usageFeature,
  type AESliceValue, type BucketRecipe, type Feature, type FeatureSet, type RoleFit,
} from "./roleFit";

// Fewer known runs than this: no bucket.
export const RB_MIN_RUNS = 25;

// Priors (pseudo-plays) and each feature's scale (pts), calibrated on the
// 2026-10-02 charting so the best tenth of charted backs on each feature
// (among those with reps for it) read about 0.8. Fixed from here on.
const RUN_PRIOR = 30;
const RATE_PRIOR = 40;
const REC_PRIOR = 25;
const SCALE = {
  srae: 5.7,
  loaded: 2.8,
  zoneAE: 5.5,
  gapAE: 4.6,
  zoneOverGap: 5.7,
  explosive: 3.6,
  btk: 5.2,
  stuffed: 4.3,
  passPro: 3.6,
  recOpen: 2.6,
  bigOpen: 3.5,
  hands: 2.2,
  // PFF pressures allowed per pass-block snap, pts under the pool's;
  // calibrated on the 2026-10-05 charting (prior REC_PRIOR snaps).
  pffPassPro: 2.2,
} as const;

const RUN_TYPES: readonly RBRunType[] = ["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"];
const isKnownRun = (pl: RBPlay) => RUN_TYPES.includes(pl.run_type) && pl.success !== null;
const isZone = (pl: RBPlay) => pl.run_type === "outside_zone" || pl.run_type === "inside_zone";
const isGap = (pl: RBPlay) => pl.run_type === "outside_man_gap" || pl.run_type === "inside_man_gap";

const RB_SLICES = {
  all:    { pred: () => true },
  loaded: { pred: (pl: RBPlay) => pl.loaded_box },
  zone:   { pred: isZone, byRunType: true },
  gap:    { pred: isGap, byRunType: true },
};
type RBSliceKey = keyof typeof RB_SLICES;

// A rate: hits over tries.
interface Rate { hits: number; n: number }
const rateOf = (plays: RBPlay[], pred: (pl: RBPlay) => boolean): Rate => ({ hits: plays.filter(pred).length, n: plays.length });
const pctOf = (r: Rate) => (r.n > 0 ? (r.hits / r.n) * 100 : null);

// The plays each rate counts over, and what counts as a hit.
const routesOf = (plays: RBPlay[]) => plays.filter((pl) => pl.run_type === "route");
const RATES = {
  explosive: (plays: RBPlay[]) => rateOf(plays.filter(isKnownRun), (pl) => pl.explosive_play),
  btk:       (plays: RBPlay[]) => rateOf(plays.filter(isKnownRun), (pl) => pl.broken_tackle),
  stuff:     (plays: RBPlay[]) => rateOf(plays.filter(isKnownRun), (pl) => pl.run_stuff),
  passPro:   (plays: RBPlay[]) => rateOf(plays.filter((pl) => pl.run_type === "pass_block" && pl.success !== null), (pl) => pl.success === true),
  open:      (plays: RBPlay[]) => rateOf(routesOf(plays).filter((pl) => pl.was_open !== null), (pl) => pl.was_open === true),
  bigOpen:   (plays: RBPlay[]) => rateOf(routesOf(plays).filter((pl) => pl.route_type === "big_boy_route" && pl.was_open !== null), (pl) => pl.was_open === true),
  // Drops per target (success false = dropped; null = not caught but not a
  // drop, e.g. an uncatchable ball, so it doesn't count against his hands).
  drops:     (plays: RBPlay[]) => rateOf(routesOf(plays).filter((pl) => pl.targeted), (pl) => pl.success === false),
};
type RateKey = keyof typeof RATES;

/** His rate minus the league's, as a skill feature. */
function rateFeature(label: string, his: Rate, league: Rate, prior: number, scale: number, unit: string, lowerIsBetter = false): Feature {
  const h = pctOf(his), l = pctOf(league);
  const diff = h != null && l != null ? (lowerIsBetter ? l - h : h - l) : null;
  const f = skillFeature(label, diff, his.n, prior, scale, unit);
  return h != null && l != null ? { ...f, display: `${h.toFixed(0)}% vs ${l.toFixed(0)}% league on ${his.n} ${unit}` } : f;
}

// A bell-cow's build: weight ramped from BUILD_LB[0] (0) to BUILD_LB[1] (1).
// The user's call (2026-10-02): good size is part of what makes a workhorse,
// not just a floor to clear.
const BUILD_LB = [205, 225] as const;

// For a workhorse, hands and pass protection are bars to clear, not skills to
// max out (the user: "no drops" and "decently good at blocking"). A fit at or
// above the bar reads 1; below it, in proportion. They gate Three-down rather
// than add to it, so clearing them doesn't make an average runner a workhorse.
// With no reps (no targets, no pass blocks) there's no bar reading, so no cut.
const HANDS_BAR = 0.6;
const PASS_PRO_BAR = 0.55;
const GATE_MAX_CUT = 0.5;
const meetsBar = (f: Feature | undefined, bar: number, label: string): Feature | undefined =>
  f && (f.n ?? 0) > 0 ? { ...f, label, fit: Math.min(1, f.fit / bar) } : undefined;

export interface RBRoleInputs {
  plays: RBPlay[];
  slices: Record<RBSliceKey, AESliceValue>;
  league: Record<RateKey, Rate>;
  heightIn: number | null;
  weightLb: number | null;
  /** PFF pass blocking over his charted games, and the pool's. */
  pffPassPro?: Rate | null;
  leaguePffPassPro?: Rate | null;
}

export function rbFeatures(inp: RBRoleInputs): FeatureSet {
  const { plays, slices, league } = inp;
  const mine = Object.fromEntries((Object.keys(RATES) as RateKey[]).map((k) => [k, RATES[k](plays)])) as Record<RateKey, Rate>;
  const runs = plays.filter(isKnownRun);
  const snaps = plays.length;
  const routes = routesOf(plays).length;
  const f: FeatureSet = {
    srae: skillFeature("SRAE, all runs", slices.all.ae, slices.all.n, RUN_PRIOR, SCALE.srae, "runs"),
    loaded: skillFeature("vs a loaded box", slices.loaded.ae, slices.loaded.n, RUN_PRIOR, SCALE.loaded, "runs"),
    zoneAE: skillFeature("Zone runs", slices.zone.ae, slices.zone.n, RUN_PRIOR, SCALE.zoneAE, "runs"),
    gapAE: skillFeature("Gap runs", slices.gap.ae, slices.gap.n, RUN_PRIOR, SCALE.gapAE, "runs"),
    zoneOverGap: contrastFeature("Zone over gap", slices.zone, slices.gap, RUN_PRIOR, SCALE.zoneOverGap),
    explosive: rateFeature("Explosive runs", mine.explosive, league.explosive, RATE_PRIOR, SCALE.explosive, "runs"),
    btk: rateFeature("Broken tackles", mine.btk, league.btk, RATE_PRIOR, SCALE.btk, "runs"),
    // More stuffs = more boom-bust: a style marker for the Big-play bucket only.
    stuffed: rateFeature("Stuffed (boom-bust)", mine.stuff, league.stuff, RATE_PRIOR, SCALE.stuffed, "runs"),
    passPro: rateFeature("Pass protection", mine.passPro, league.passPro, REC_PRIOR, SCALE.passPro, "pass blocks"),
    recOpen: rateFeature("Open on routes", mine.open, league.open, REC_PRIOR, SCALE.recOpen, "routes"),
    bigOpen: rateFeature("Open on longer routes", mine.bigOpen, league.bigOpen, REC_PRIOR, SCALE.bigOpen, "longer routes"),
    hands: rateFeature("Hands (drops)", mine.drops, league.drops, REC_PRIOR, SCALE.hands, "targets", true),
  };
  f.handsOk = meetsBar(f.hands, HANDS_BAR, "Hands (no drops)");
  // Pass protection for the gate: the charted wins, blended by reps with PFF's
  // pressures allowed when he has PFF pass-block snaps.
  const pp = inp.pffPassPro, lp = inp.leaguePffPassPro;
  if (pp && pp.n > 0 && lp && lp.n > 0) {
    f.pffPassPro = rateFeature("Pass protection (PFF pressures allowed)", pp, lp, REC_PRIOR, SCALE.pffPassPro, "pass-block snaps", true);
  }
  f.passProOk = meetsBar(blendByReps(f.passPro, f.pffPassPro, "Pass protection"), PASS_PRO_BAR, "Pass protection (decent is enough)");
  if (inp.weightLb != null) {
    const w = inp.weightLb;
    f.build = { label: "Build", kind: "body", fit: Math.min(1, Math.max(0, (w - BUILD_LB[0]) / (BUILD_LB[1] - BUILD_LB[0]))), display: `${w} lb` };
  }
  if (snaps > 0) {
    const pb = plays.filter((pl) => pl.run_type === "pass_block").length;
    f.passGame = usageFeature("Passing-down snaps (routes + pass pro)", (routes + pb) / snaps, 0.3, 0.55, `${Math.round(((routes + pb) / snaps) * 100)}% of snaps`);
    f.routeShare = usageFeature("Routes run", routes / snaps, 0.2, 0.4, `${Math.round((routes / snaps) * 100)}% of snaps`);
    const wide = plays.filter((pl) => pl.aligned_as_wr).length / snaps;
    f.wideShare = usageFeature("Split out wide", wide, 0.01, 0.08, `${Math.round(wide * 100)}% of snaps`);
  }
  if (runs.length > 0) {
    const z = runs.filter(isZone).length / runs.length;
    const g = runs.filter(isGap).length / runs.length;
    f.zoneShare = usageFeature("Zone runs", z, 0.4, 0.7, `${Math.round(z * 100)}% of runs`);
    f.gapShare = usageFeature("Gap runs", g, 0.4, 0.7, `${Math.round(g * 100)}% of runs`);
  }
  return f;
}

// Two readings of one skill as one, weighted by the reps behind each. With
// only one (no PFF snaps, or no charted pass blocks), that one unchanged.
function blendByReps(a: Feature | undefined, b: Feature | undefined, label: string): Feature | undefined {
  const na = a?.n ?? 0, nb = b?.n ?? 0;
  if (!(nb > 0)) return a;
  if (!(na > 0)) return b;
  return { label, kind: "skill", fit: (na * a!.fit + nb * b!.fit) / (na + nb), display: `${a!.display} · ${b!.display}`, n: na + nb };
}

export const RB_RECIPES: readonly BucketRecipe[] = [
  {
    // The user's definition (2026-10-02): a good runner in both schemes with
    // no drops, decent pass protection and good size is a workhorse. The
    // match is his rushing and build, cut up to half each for falling short
    // on hands or pass pro. How much his college used him on passing downs
    // doesn't count ("Used as" still shows it), nor does route open rate.
    role: "three_down",
    ingredients: [
      { feature: "srae", weight: 0.5, core: true },
      { feature: "zoneAE", weight: 0.15 },
      { feature: "gapAE", weight: 0.15 },
      { feature: "build", weight: 0.2 },
    ],
    gates: [
      { feature: "handsOk", maxCut: GATE_MAX_CUT },
      { feature: "passProOk", maxCut: GATE_MAX_CUT },
    ],
    size: { minHeightIn: 69, minWeightLb: 205 },
  },
  {
    role: "zone",
    ingredients: [
      { feature: "zoneAE", weight: 0.4, core: true },
      { feature: "zoneOverGap", weight: 0.15 },
      { feature: "srae", weight: 0.1 },
      { feature: "zoneShare", weight: 0.35 },
    ],
    size: { minWeightLb: 195 },
  },
  {
    role: "gap",
    ingredients: [
      { feature: "gapAE", weight: 0.3, core: true },
      { feature: "loaded", weight: 0.15 },
      { feature: "btk", weight: 0.2, core: true },
      { feature: "gapShare", weight: 0.35 },
    ],
    size: { minWeightLb: 210 },
  },
  {
    role: "receiving",
    ingredients: [
      { feature: "recOpen", weight: 0.3, core: true },
      { feature: "bigOpen", weight: 0.15 },
      { feature: "hands", weight: 0.2 },
      { feature: "routeShare", weight: 0.25 },
      { feature: "wideShare", weight: 0.1 },
    ],
  },
  {
    // No usage features: big plays are the whole job description.
    role: "big_play",
    ingredients: [
      { feature: "explosive", weight: 0.45, core: true },
      { feature: "btk", weight: 0.1 },
      { feature: "stuffed", weight: 0.1 },
    ],
  },
];

/** Null under RB_MIN_RUNS. */
export function rbRoleFit(inp: RBRoleInputs): RoleFit | null {
  const runs = inp.plays.filter(isKnownRun).length;
  if (runs < RB_MIN_RUNS) return null;
  return buildRoleFit({
    pos: "RB",
    recipes: RB_RECIPES,
    features: rbFeatures(inp),
    heightIn: inp.heightIn,
    weightLb: inp.weightLb,
    sample: { n: runs, unit: "runs" },
    confidenceAt: { medium: 60, high: 120 },
  });
}

/** Every RB's buckets from the league's plays (and PFF over his charted games). */
export function computeRBRoleFits(
  prospects: Prospect[], games: ScoutingGame[], rbPlays: RBPlay[], pff?: ReadonlyMap<string, PffTotals>,
): Map<string, RoleFit | null> {
  const out = new Map<string, RoleFit | null>();
  const rbs = prospects.filter((p) => p.position === "RB");
  if (rbs.length === 0) return out;
  // PFF pass blocking: pressures allowed ("hits") per pass-block snap.
  const pffPP = new Map<string, Rate>();
  const leaguePP: Rate = { hits: 0, n: 0 };
  for (const p of rbs) {
    const s = pff?.get(p.id)?.sum;
    if (s?.pressures_allowed == null || !s.pass_block_snaps) continue;
    pffPP.set(p.id, { hits: s.pressures_allowed, n: s.pass_block_snaps });
    leaguePP.hits += s.pressures_allowed; leaguePP.n += s.pass_block_snaps;
  }
  const slices = computeRBRoleSlices(prospects, games, rbPlays, RB_SLICES);
  const league = Object.fromEntries((Object.keys(RATES) as RateKey[]).map((k) => [k, RATES[k](rbPlays)])) as Record<RateKey, Rate>;
  const gameToProspect = new Map(games.map((g) => [g.id, g.prospect_id]));
  const playsBy = new Map<string, RBPlay[]>();
  for (const pl of rbPlays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    const arr = playsBy.get(pid);
    if (arr) arr.push(pl); else playsBy.set(pid, [pl]);
  }
  for (const p of rbs) {
    const s = slices.get(p.id);
    out.set(p.id, s ? rbRoleFit({
      plays: playsBy.get(p.id) ?? [],
      slices: s,
      league,
      heightIn: parseHeightInches(p.height),
      weightLb: p.weight,
      pffPassPro: pffPP.get(p.id) ?? null,
      leaguePffPassPro: leaguePP.n > 0 ? leaguePP : null,
    }) : null);
  }
  return out;
}
