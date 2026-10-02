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
// open and catch rates on routes).
import type { Prospect, RBPlay, RBRunType, ScoutingGame } from "../types";
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
  catch: 3.8,
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
  catch:     (plays: RBPlay[]) => rateOf(routesOf(plays).filter((pl) => pl.targeted), (pl) => pl.success === true),
};
type RateKey = keyof typeof RATES;

/** His rate minus the league's, as a skill feature. */
function rateFeature(label: string, his: Rate, league: Rate, prior: number, scale: number, unit: string): Feature {
  const h = pctOf(his), l = pctOf(league);
  const f = skillFeature(label, h != null && l != null ? h - l : null, his.n, prior, scale, unit);
  return h != null && l != null ? { ...f, display: `${h.toFixed(0)}% vs ${l.toFixed(0)}% league on ${his.n} ${unit}` } : f;
}

export interface RBRoleInputs {
  plays: RBPlay[];
  slices: Record<RBSliceKey, AESliceValue>;
  league: Record<RateKey, Rate>;
  heightIn: number | null;
  weightLb: number | null;
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
    catch: rateFeature("Catches", mine.catch, league.catch, REC_PRIOR, SCALE.catch, "targets"),
  };
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

export const RB_RECIPES: readonly BucketRecipe[] = [
  {
    role: "three_down",
    ingredients: [
      { feature: "srae", weight: 0.2, core: true },
      { feature: "zoneAE", weight: 0.1 },
      { feature: "gapAE", weight: 0.1 },
      { feature: "passPro", weight: 0.15, core: true },
      { feature: "recOpen", weight: 0.1 },
      { feature: "passGame", weight: 0.35 },
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
      { feature: "catch", weight: 0.2 },
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

/** Every RB's buckets from the league's plays. */
export function computeRBRoleFits(prospects: Prospect[], games: ScoutingGame[], rbPlays: RBPlay[]): Map<string, RoleFit | null> {
  const out = new Map<string, RoleFit | null>();
  const rbs = prospects.filter((p) => p.position === "RB");
  if (rbs.length === 0) return out;
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
    }) : null);
  }
  return out;
}
