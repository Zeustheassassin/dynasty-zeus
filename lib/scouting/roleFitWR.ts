// WR role buckets: X, Y, Slot and Gadget, from the user's definitions
// (2026-10-02). Scoring is shared (roleFit.ts); this file holds the WR
// features and recipes.
//
//   X:      excels vs press and man; slants, nines, comebacks, digs, corners,
//           posts. Press is what makes an X ("they face press all the time"),
//           so it's half the recipe, and an X isn't proven without
//           X_PRESS_REPS in-app press reps: until then he can still top out as
//           "X?", but X never wins a near tie.
//   Y:      good across most of the route tree; better vs man and zone than vs
//           press. That contrast is what splits a Y from an X. The same level
//           as X: an X / Y near tie goes to the higher match.
//   Slot:   a step below X and Y, more limited to the short game: strong vs
//           zone on slants, curls and flats; decent vs man; weak vs press is
//           fine (press isn't in the recipe).
//   Gadget: the catch-all for receivers not good enough for X, Y or Slot (all
//           under FALLBACK_LINE): "better off a special teamer or a one-touch-
//           a-game guy". It never competes; its % reads how much his game is
//           screens, flats and slants, better there than on the rest of the
//           tree, and better vs zone than man.
//
// Where he lined up in college barely counts (the user: playing on or off the
// ball doesn't say what he'll be best at as a pro). Alignment is a light
// tie-breaker, ALIGN_WEIGHT of each recipe; "Used as" still shows it.
//
// Skill comes from the WR difficulty model (aggregateMerge.ts): his open rate
// above expected on a slice of his routes, season-weighted like SAE. Imported
// games (before 2026-05-01) were entered as game totals, so their route counts
// and coverage counts are real but the pairing of a route with a coverage, and
// where he lined up, were filled in proportionally. So:
//   - route skill and zone / man skill use every game (each reads one real total);
//   - press uses in-app games only: before May 1 some press reps were charted
//     as man. With no in-app press rep, press reads as unknown: average at
//     best, and no better than his man (imported "man" hid some press);
//   - "man" is man as charted, so an imported man rep can hide some press;
//   - alignment and route mix use in-app games only, and need
//     WR_MIN_INAPP_SNAPS of them. Without that he's scored on skill alone and
//     flagged "skill only".
//
// X also reads his release vs press (tape-grading expansion, Stage 4): the
// share of tagged press reps where he won the release, once he has
// X_RELEASE_REPS of them. It's an extra ingredient on top of the others, so a
// receiver without the reps keeps exactly his old X%.
import type { LinedUp } from "../types";
import {
  aeOf, buildRoleFit, contrastFeature, mergeAESums, shrinkAE, skillFeature, usageFeature,
  type AESum, type BucketRecipe, type Feature, type FeatureSet, type RoleFit,
} from "./roleFit";

export interface WRRoleSkill {
  /** Every game's routes by route type. */
  byRoute: Partial<Record<string, AESum>>;
  /** Every game's routes vs zone. */
  zone: AESum;
  /** Every game's routes vs man, as charted. */
  man: AESum;
  /** In-app routes vs press. */
  press: AESum;
}

export interface WRRoleInputs {
  skill: WRRoleSkill;
  /** Tagged press reps and how many releases he won, and the pool's win rate (0–1). */
  release?: { won: number; n: number } | null;
  leagueRelease?: number | null;
  /** In-app snaps by where he lined up, runs included (migration 060). */
  linedUp: LinedUp | null;
  /** In-app routes by route type (for the route-mix usage features). */
  inAppRouteCounts: Partial<Record<string, number>>;
  heightIn: number | null;
  weightLb: number | null;
}

// Fewer routes than this: no bucket.
export const WR_MIN_ROUTES = 40;
// In-app snaps needed before alignment counts.
export const WR_MIN_INAPP_SNAPS = 40;
// In-app press reps an X needs to be proven.
export const X_PRESS_REPS = 10;
// Tagged press reps before release vs press counts toward X.
export const X_RELEASE_REPS = 10;
// Each recipe's share for where he lined up (and, for Gadget, what he ran).
export const ALIGN_WEIGHT = 0.1;

// Skill priors (pseudo-routes) and each feature's scale (pts). The scales were
// calibrated on the 2026-10-02 charting so the best tenth of charted WRs on
// each feature (among those with reps for it) read about 0.8; they're fixed
// from here on, so another player's charting never moves anyone's fit.
const GROUP_PRIOR = 40;
const ROUTE_PRIOR = 15;
const COVERAGE_PRIOR = 40;
const SCALE = {
  quick: 3,
  slotRoutes: 4,
  xRoutes: 4.2,
  tree: 2,
  zone: 4.5,
  man: 3.3,
  press: 4,
  zoneOverMan: 4.5,
  manZoneOverPress: 4.3,
  quickOverDownfield: 4,
  // Release win rate vs press, pts over the pool's. PROVISIONAL: no tagged
  // press reps existed when it was set; re-calibrate once 10 WRs have
  // X_RELEASE_REPS.
  release: 10,
} as const;

const QUICK_ROUTES = ["screen", "flat", "slant"];
const SLOT_ROUTES = ["slant", "curl", "flat"];
const X_ROUTES = ["slant", "nine", "comeback", "dig", "corner", "post"];
// "Most of the route tree": every route but screens and other.
const TREE_ROUTES = ["nine", "post", "dig", "curl", "slant", "flat", "comeback", "out", "corner"];
// The tree past the quick game, for Gadget's "limited to the quick game".
const DOWNFIELD_ROUTES = ["nine", "post", "dig", "curl", "comeback", "out", "corner"];

const ROUTE_NAMES: Record<string, string> = {
  nine: "go", post: "post", dig: "dig", curl: "curl", slant: "slant", screen: "screen",
  flat: "flat", comeback: "comeback", out: "out", corner: "corner",
};

const s = (sum: AESum) => ({ ae: aeOf(sum), n: sum.n });
const group = (skill: WRRoleSkill, routes: string[]) => mergeAESums(routes.map((r) => skill.byRoute[r]));

function groupFeature(label: string, skill: WRRoleSkill, routes: string[], scale: number): Feature {
  const sum = group(skill, routes);
  return skillFeature(label, aeOf(sum), sum.n, GROUP_PRIOR, scale, "routes");
}

// Breadth: his sample-discounted AE on each route of the tree, averaged, so a
// route he never runs counts as average and breadth needs reps across the tree.
// "Winning" in the display = at least +2 pts after the discount.
function treeFeature(skill: WRRoleSkill): Feature {
  const shrunk = TREE_ROUTES.map((r) => {
    const sum = skill.byRoute[r];
    return shrinkAE(aeOf(sum), sum?.n ?? 0, ROUTE_PRIOR);
  });
  const mean = shrunk.reduce((a, b) => a + b, 0) / shrunk.length;
  const winning = TREE_ROUTES.filter((_, i) => shrunk[i] >= 2).map((r) => ROUTE_NAMES[r]);
  return {
    label: "Route tree",
    kind: "skill",
    fit: 1 / (1 + Math.exp(-mean / SCALE.tree)),
    display: winning.length ? `winning on ${winning.length} of ${TREE_ROUTES.length} (${winning.join(", ")})` : `winning on none of ${TREE_ROUTES.length}`,
  };
}

export function wrFeatures(inp: WRRoleInputs): FeatureSet {
  const { skill } = inp;
  const man = skillFeature("vs man", aeOf(skill.man), skill.man.n, COVERAGE_PRIOR, SCALE.man, "routes");
  const f: FeatureSet = {
    quick: groupFeature("Screens/flats/slants", skill, QUICK_ROUTES, SCALE.quick),
    slotRoutes: groupFeature("Slants/curls/flats", skill, SLOT_ROUTES, SCALE.slotRoutes),
    xRoutes: groupFeature("X routes (slant/go/comeback/dig/corner/post)", skill, X_ROUTES, SCALE.xRoutes),
    tree: treeFeature(skill),
    zone: skillFeature("vs zone", aeOf(skill.zone), skill.zone.n, COVERAGE_PRIOR, SCALE.zone, "routes"),
    man,
    zoneOverMan: contrastFeature("Zone over man", s(skill.zone), s(skill.man), COVERAGE_PRIOR, SCALE.zoneOverMan),
    quickOverDownfield: contrastFeature("Quick game over the rest of the tree", s(group(skill, QUICK_ROUTES)), s(group(skill, DOWNFIELD_ROUTES)), GROUP_PRIOR, SCALE.quickOverDownfield),
  };
  if (skill.press.n > 0) {
    f.press = skillFeature("vs press (in-app)", aeOf(skill.press), skill.press.n, COVERAGE_PRIOR, SCALE.press, "in-app routes");
    f.manZoneOverPress = contrastFeature("Man/zone over press", s(mergeAESums([skill.man, skill.zone])), s(skill.press), COVERAGE_PRIOR, SCALE.manZoneOverPress);
  } else {
    // Unknown, not average: no better than average, and no better than his
    // man (an imported man rep can be a press rep). Y's press contrast is left
    // out: it can't be read either.
    f.press = { label: "vs press", kind: "skill", fit: Math.min(0.5, man.fit), display: "untested (no in-app press reps)", n: 0 };
  }
  const rel = inp.release;
  if (rel && rel.n >= X_RELEASE_REPS && inp.leagueRelease != null) {
    const rate = rel.won / rel.n;
    f.release = {
      ...skillFeature("Release vs press (tagged)", (rate - inp.leagueRelease) * 100, rel.n, COVERAGE_PRIOR, SCALE.release, "tagged press reps"),
      display: `won ${Math.round(rate * 100)}% vs ${Math.round(inp.leagueRelease * 100)}% pool on ${rel.n} tagged press reps`,
    };
  }
  const lu = inp.linedUp;
  if (lu && lu.snaps >= WR_MIN_INAPP_SNAPS) {
    // Outside receivers line up on the line most of the time (55–90% of snaps
    // in the 2026 in-app charting), so X vs Y reads the split of his OUTSIDE
    // snaps: on the line (X) or off it (Y), scaled by how outside he plays.
    const pct = (n: number) => `${Math.round((n / lu.snaps) * 100)}%`;
    const xSnaps = lu.left_on + lu.right_on, ySnaps = lu.left_off + lu.right_off, outside = xSnaps + ySnaps;
    const outsideness = Math.min(1, Math.max(0, (outside / lu.snaps - 0.5) / 0.3));
    const onFrac = outside > 0 ? xSnaps / outside : 0;
    const ramp = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    f.xShare = { label: "Lined up outside on the line", kind: "usage", fit: outsideness * ramp(onFrac, 0.6, 0.9), display: `${pct(xSnaps)} of ${lu.snaps} in-app snaps` };
    f.zShare = { label: "Lined up outside off the line", kind: "usage", fit: outsideness * ramp(1 - onFrac, 0.1, 0.4), display: `${pct(ySnaps)} of ${lu.snaps} in-app snaps` };
    f.slotShare = usageFeature("Lined up in the slot", (lu.slot_on + lu.slot_off) / lu.snaps, 0.15, 0.6, `${pct(lu.slot_on + lu.slot_off)} of ${lu.snaps} in-app snaps`);
    f.backfield = usageFeature("Lined up in the backfield", lu.backfield / lu.snaps, 0.02, 0.15, `${pct(lu.backfield)} of ${lu.snaps} in-app snaps`);
    const counts = inp.inAppRouteCounts;
    const routes = Object.values(counts).reduce<number>((a, b) => a + (b ?? 0), 0);
    if (routes > 0) {
      const quickMix = ((counts.screen ?? 0) + (counts.flat ?? 0)) / routes;
      f.quickShare = usageFeature("Screens + flats run", quickMix, 0.08, 0.3, `${Math.round(quickMix * 100)}% of in-app routes`);
    }
  }
  return f;
}

// Weights sum to 1 in each recipe; alignment is ALIGN_WEIGHT of each.
export const WR_RECIPES: readonly BucketRecipe[] = [
  {
    role: "x",
    ingredients: [
      { feature: "press", weight: 0.5, core: true },
      { feature: "man", weight: 0.2, core: true },
      { feature: "xRoutes", weight: 0.2 },
      { feature: "xShare", weight: ALIGN_WEIGHT },
      // Only with X_RELEASE_REPS tagged press reps (see the header).
      { feature: "release", weight: 0.2, core: true },
    ],
    size: { minHeightIn: 72, minWeightLb: 195 },
    requires: { feature: "press", minN: X_PRESS_REPS, why: `an X needs ${X_PRESS_REPS}+ in-app press reps` },
  },
  {
    role: "y",
    ingredients: [
      { feature: "tree", weight: 0.35, core: true },
      { feature: "man", weight: 0.15, core: true },
      { feature: "zone", weight: 0.15 },
      { feature: "manZoneOverPress", weight: 0.25 },
      { feature: "zShare", weight: ALIGN_WEIGHT },
    ],
    size: { minHeightIn: 70, minWeightLb: 180 },
  },
  {
    role: "slot",
    ingredients: [
      { feature: "slotRoutes", weight: 0.4, core: true },
      { feature: "zone", weight: 0.35, core: true },
      { feature: "man", weight: 0.15 },
      { feature: "slotShare", weight: ALIGN_WEIGHT },
    ],
  },
  {
    role: "gadget",
    ingredients: [
      { feature: "quick", weight: 0.3, core: true },
      { feature: "quickOverDownfield", weight: 0.35, core: true },
      { feature: "zoneOverMan", weight: 0.25 },
      { feature: "quickShare", weight: ALIGN_WEIGHT / 2 },
      { feature: "backfield", weight: ALIGN_WEIGHT / 2 },
    ],
  },
];

/** Null under WR_MIN_ROUTES. */
export function wrRoleFit(inp: WRRoleInputs): RoleFit | null {
  const routes = Object.values(inp.skill.byRoute).reduce((a, sum) => a + (sum?.n ?? 0), 0);
  if (routes < WR_MIN_ROUTES) return null;
  return buildRoleFit({
    pos: "WR",
    recipes: WR_RECIPES,
    features: wrFeatures(inp),
    heightIn: inp.heightIn,
    weightLb: inp.weightLb,
    sample: { n: routes, unit: "routes" },
    confidenceAt: { medium: 100, high: 200 },
  });
}
