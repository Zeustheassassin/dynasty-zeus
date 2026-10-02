// TE role buckets: Inline Y, Move/Big slot, H-back/Wing and Blocking TE
// (approved by the user, 2026-10-02). Scoring is shared (roleFit.ts); this
// file holds the TE features and recipes. Every TE game was charted in the
// app, play by play.
//
// Route skill comes from the TE-SAER model and block skill from TE-SAEB
// (aboveExpected.ts), each over a slice of his reps. Usage is where he lined
// up (positioning) and what he did (route, block) as shares of his snaps.
import type { Prospect, ScoutingGame, TEPlay } from "../types";
import { computeTERoleSlices } from "./aboveExpected";
import { parseHeightInches } from "./prospectAge";
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
    }) : null);
  }
  return out;
}
