// TE role buckets: Inline Y, Move/Big slot, H-back/Wing and Blocking TE
// (approved by the user, 2026-10-02), and All-Around (the user, 2026-10-20).
// Scoring is shared (roleFit.ts); this file holds the TE features and
// recipes. Every TE game was charted in the app, play by play.
//
// Route skill comes from the TE-SAER model and block skill from TE-SAEB
// (aboveExpected.ts), each over a slice of his reps. Usage is where he lined
// up (positioning) and what he did (route, block) as shares of his snaps.
// All-Around also reads the user's Hands trait grade: charted drops can't say
// who catches (2 drops on 81 TE targets on 2026-10-20), and nothing else
// measures hands.
import type { Prospect, ScoutingGame, TEPlay } from "../types";
import { computeTERoleSlices, MIN_SAMPLE } from "./aboveExpected";
import { parseHeightInches } from "./prospectAge";
import { traitAverages, type TraitAverage } from "./traits";
import {
  buildRoleFit, skillFeature, usageFeature,
  type AESliceValue, type BucketRecipe, type FeatureSet, type RoleFit,
} from "./roleFit";

// Fewer snaps than this: no bucket.
export const TE_MIN_SNAPS = 40;

// Prior (pseudo-reps) and scales (pts). Only four TEs are charted, too few to
// calibrate on, so these borrow the middle of WR's route-skill scales (3–4.5)
// and RB's pass-pro scale. Re-calibrate once ~10 TEs are charted.
const PRIOR = 30;
const ROUTE_SCALE = 4;
const BLOCK_SCALE = 3.6;
// Hands grades: pseudo-games pulling his average toward the 1–10 scale's
// midpoint, and the grade points over it that read like the best tenth.
// PROVISIONAL, as RB Power's: 7 TEs have a Hands grade on 2026-10-20.
const HANDS_PRIOR = 2;
const HANDS_MID = 5.5;
const HANDS_SCALE = 1.8;
// All-Around: "Can Catch, Can Block". The weaker side's fit has to clear
// average; no cut from BOTH_FULL up (about 2 pts above expected after the
// sample discount), the full GATE_MAX_CUT at or under average, in proportion
// between. RB Scheme Versatile's rule.
const BOTH_FULL = 0.6;
const GATE_MAX_CUT = 0.5;
// "Can Catch" needs a route sample: All-Around isn't proven (so never named)
// under TE-SAER's own floor. A blocker's +16 on 13 routes (Alex Honig,
// 2026-10-20) mustn't make him an all-round TE.
export const ALL_AROUND_MIN_ROUTES = MIN_SAMPLE;

const ROUTE_SLICES = {
  all:  () => true,
  man:  (pl: TEPlay) => pl.coverage === "man" || pl.coverage === "press",
  flat: (pl: TEPlay) => pl.route_type === "flat",
};
const BLOCK_SLICES = {
  all:      () => true,
  inline:   (pl: TEPlay) => pl.block_type === "inline",
  movement: (pl: TEPlay) => pl.block_type === "movement",
};

export interface TERoleInputs {
  plays: TEPlay[];
  route: Record<keyof typeof ROUTE_SLICES, AESliceValue>;
  block: Record<keyof typeof BLOCK_SLICES, AESliceValue>;
  heightIn: number | null;
  weightLb: number | null;
  /** His Hands trait average over graded games (traits.ts). */
  hands?: TraitAverage | null;
}

export function teFeatures(inp: TERoleInputs): FeatureSet {
  const { plays, route, block } = inp;
  const f: FeatureSet = {
    routeAE: skillFeature("TE-SAER, all routes", route.all.ae, route.all.n, PRIOR, ROUTE_SCALE, "routes"),
    manAE: skillFeature("Routes vs man/press", route.man.ae, route.man.n, PRIOR, ROUTE_SCALE, "routes"),
    flatAE: skillFeature("Flat routes", route.flat.ae, route.flat.n, PRIOR, ROUTE_SCALE, "routes"),
    blockAE: skillFeature("TE-SAEB, all blocks", block.all.ae, block.all.n, PRIOR, BLOCK_SCALE, "blocks"),
    inlineBlockAE: skillFeature("Inline blocks", block.inline.ae, block.inline.n, PRIOR, BLOCK_SCALE, "blocks"),
    moveBlockAE: skillFeature("Movement blocks", block.movement.ae, block.movement.n, PRIOR, BLOCK_SCALE, "blocks"),
  };
  // All-Around reads the weaker of routes and blocking, and gates on it clearing average.
  const routeWeaker = f.routeAE!.fit <= f.blockAE!.fit;
  const weaker = routeWeaker ? f.routeAE! : f.blockAE!;
  f.bothMin = { ...weaker, label: `Weaker side (${routeWeaker ? "routes" : "blocking"})` };
  f.bothGood = {
    ...weaker,
    label: "Above average on both routes and blocking",
    fit: Math.min(1, Math.max(0, (weaker.fit - 0.5) / (BOTH_FULL - 0.5))),
  };
  // Left out (weights renormalize) until he has a graded game.
  const h = inp.hands;
  if (h && h.games > 0) {
    f.hands = {
      ...skillFeature("Hands (your grade)", h.avg - HANDS_MID, h.games, HANDS_PRIOR, HANDS_SCALE, "graded games"),
      display: `${h.avg.toFixed(1)} / 10 over ${h.games} graded game${h.games === 1 ? "" : "s"}`,
    };
  }
  const snaps = plays.length;
  if (snaps > 0) {
    const share = (pred: (pl: TEPlay) => boolean) => plays.filter(pred).length / snaps;
    const pctOf = (x: number) => `${Math.round(x * 100)}% of snaps`;
    const inline = share((pl) => pl.positioning === "inline");
    const detached = share((pl) => pl.positioning === "slot" || pl.positioning === "wide");
    const back = share((pl) => pl.positioning === "wing_back" || pl.positioning === "full_back" || pl.positioning === "running_back");
    const routes = share((pl) => pl.play_type === "route_run");
    const blocks = share((pl) => pl.play_type === "run_block" || pl.play_type === "pass_block");
    f.inlineShare = usageFeature("Lined up inline", inline, 0.2, 0.7, pctOf(inline));
    f.detachedShare = usageFeature("Lined up in the slot or wide", detached, 0.15, 0.6, pctOf(detached));
    f.backShare = usageFeature("Lined up at wing/fullback/backfield", back, 0.08, 0.4, pctOf(back));
    f.routeShare = usageFeature("Routes run", routes, 0.3, 0.7, pctOf(routes));
    f.blockShare = usageFeature("Blocking snaps", blocks, 0.3, 0.7, pctOf(blocks));
  }
  return f;
}

export const TE_RECIPES: readonly BucketRecipe[] = [
  {
    // The user (2026-10-20): "TE's who can do it all. Have Size Can Catch Can
    // Block are just all around freaks" (Patrick Overmyer). Mostly the weaker
    // side, so being great at one can't carry it; then both sides and his
    // hands, cut for average or worse at either. No usage: where his college
    // lined him up isn't the point. Size floor mine: Overmyer's 6'5" 240 is the
    // user's idea of size, so 6'4" 240.
    role: "all_around",
    ingredients: [
      { feature: "bothMin", weight: 0.4, core: true },
      { feature: "routeAE", weight: 0.2, core: true },
      { feature: "blockAE", weight: 0.2, core: true },
      { feature: "hands", weight: 0.2 },
    ],
    gates: [{ feature: "bothGood", maxCut: GATE_MAX_CUT }],
    requires: { feature: "routeAE", minN: ALL_AROUND_MIN_ROUTES, why: `needs ${ALL_AROUND_MIN_ROUTES}+ rated routes` },
    size: { minHeightIn: 76, minWeightLb: 240 },
  },
  {
    role: "inline_y",
    ingredients: [
      { feature: "routeAE", weight: 0.35, core: true },
      { feature: "blockAE", weight: 0.3, core: true },
      { feature: "inlineShare", weight: 0.25 },
      { feature: "routeShare", weight: 0.1 },
    ],
    size: { minHeightIn: 75, minWeightLb: 245 },
  },
  {
    role: "move",
    ingredients: [
      { feature: "routeAE", weight: 0.4, core: true },
      { feature: "manAE", weight: 0.25, core: true },
      { feature: "detachedShare", weight: 0.35 },
    ],
    size: { minHeightIn: 74, minWeightLb: 230 },
  },
  {
    role: "h_back",
    ingredients: [
      { feature: "moveBlockAE", weight: 0.35, core: true },
      { feature: "flatAE", weight: 0.15 },
      { feature: "routeAE", weight: 0.15 },
      { feature: "backShare", weight: 0.35 },
    ],
    size: { minWeightLb: 235 },
  },
  {
    role: "blocking",
    ingredients: [
      { feature: "blockAE", weight: 0.45, core: true },
      { feature: "inlineBlockAE", weight: 0.2 },
      { feature: "inlineShare", weight: 0.15 },
      { feature: "blockShare", weight: 0.2 },
    ],
    size: { minHeightIn: 75, minWeightLb: 245 },
  },
];

/** Null under TE_MIN_SNAPS. */
export function teRoleFit(inp: TERoleInputs): RoleFit | null {
  const snaps = inp.plays.length;
  if (snaps < TE_MIN_SNAPS) return null;
  return buildRoleFit({
    pos: "TE",
    recipes: TE_RECIPES,
    features: teFeatures(inp),
    heightIn: inp.heightIn,
    weightLb: inp.weightLb,
    sample: { n: snaps, unit: "snaps" },
    confidenceAt: { medium: 100, high: 200 },
  });
}

/** Every TE's buckets from the league's plays. */
export function computeTERoleFits(prospects: Prospect[], games: ScoutingGame[], tePlays: TEPlay[]): Map<string, RoleFit | null> {
  const out = new Map<string, RoleFit | null>();
  const tes = prospects.filter((p) => p.position === "TE");
  if (tes.length === 0) return out;
  const slices = computeTERoleSlices(prospects, games, tePlays, ROUTE_SLICES, BLOCK_SLICES);
  const traits = traitAverages(tes, games);
  const gameToProspect = new Map(games.map((g) => [g.id, g.prospect_id]));
  const playsBy = new Map<string, TEPlay[]>();
  for (const pl of tePlays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    const arr = playsBy.get(pid);
    if (arr) arr.push(pl); else playsBy.set(pid, [pl]);
  }
  for (const p of tes) {
    const s = slices.get(p.id);
    out.set(p.id, s ? teRoleFit({
      plays: playsBy.get(p.id) ?? [],
      route: s.route,
      block: s.block,
      heightIn: parseHeightInches(p.height),
      weightLb: p.weight,
      hands: traits.get(p.id)?.hands ?? null,
    }) : null);
  }
  return out;
}
