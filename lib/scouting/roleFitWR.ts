// WR role buckets: X, Z, Slot, Gadget and Special Teams, from the user's
// definitions (2026-10-02; Gadget and Special Teams 2026-11-09). Scoring is shared (roleFit.ts); this file holds the WR
// features and recipes.
//
//   X:      excels vs press and man; slants, nines, comebacks, digs, corners,
//           posts. Press is what makes an X ("they face press all the time"),
//           so it's half the recipe, and an X isn't proven without
//           X_PRESS_REPS in-app press reps: until then he can still top out as
//           "X?", but X never wins a near tie.
//   Z:      the flanker (labeled Y until 2026-11-09). Good across most of the
//           route tree; better vs man and zone than vs press. That contrast
//           is what splits a Z from an X. The same level as X: an X / Z near
//           tie goes to the higher match.
//   Slot:   a step below X and Z, more limited to the short game: strong vs
//           zone on slants, curls and flats; decent vs man; weak vs press is
//           fine (press isn't in the recipe).
//   Gadget: the catch-all for receivers not good enough for X, Z or Slot (all
//           under 50%), but only with high YAC (the user, 2026-11-09): named
//           when his Gadget % is 50+. It never competes. Its % is yards after
//           the catch and missed tackles per catch (PFF over his charted
//           games), with a little for screens, flats and backfield snaps.
//           Until 2026-11-09 it read the quick game (screens / flats / slants
//           skill, quick game over the rest of the tree, zone over man) and
//           took every receiver under 50% at the other three.
//   Special Teams: the last resort, "the YOU SUCK AT EVERYTHING role" (the
//           user, 2026-11-09): under 50% at X, Z and Slot, and too little YAC
//           for Gadget. No recipe: its % is 100 minus his best other match
//           (roleFit.ts, `remainder`).
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
// YAC is PFF's: yards after the catch and missed tackles forced per catch,
// summed over his charted games linked to PFF, each against the pool of every
// charted WR's (pffYac / pffYacMtf). The user also tags a broken tackle after
// the catch on the board, but only 134 catches across 16 WRs carried it on
// 2026-11-09 (5 WRs with 10+), too few to read; it's on the activation list
// to take over the missed tackles once enough WRs have it. With no PFF catches
// both read as average ("no catches yet").
//
// X also reads his release vs press (tape-grading expansion, Stage 4): the
// share of tagged press reps where he won the release, once he has
// X_RELEASE_REPS of them. It's an extra ingredient on top of the others, so a
// receiver without the reps keeps exactly his old X%.
import type { LinedUp } from "../types";
import {
  aeOf, buildRoleFit, contrastFeature, mergeAESums, rateFeature, shrinkAE, skillFeature, usageFeature, NO_RATE,
  type AESum, type BucketRecipe, type Feature, type FeatureSet, type Rate, type RoleFit,
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
  /** PFF yards after the catch over catches, over his charted games, and the pool's. */
  pffYac?: Rate | null;
  leaguePffYac?: Rate | null;
  /** PFF missed tackles forced over catches, over his charted games, and the pool's. */
  pffYacMtf?: Rate | null;
  leaguePffYacMtf?: Rate | null;
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
// Each recipe's share for where he lined up (and, for Gadget, what he ran and
// backfield snaps).
export const ALIGN_WEIGHT = 0.1;

// Skill priors (pseudo-routes) and each feature's scale (pts). The scales were
// calibrated on the 2026-10-02 charting so the best tenth of charted WRs on
// each feature (among those with reps for it) read about 0.8; they're fixed
// from here on, so another player's charting never moves anyone's fit.
const GROUP_PRIOR = 40;
const ROUTE_PRIOR = 15;
const COVERAGE_PRIOR = 40;
// Pseudo-catches for the YAC features.
const CATCH_PRIOR = 20;
const SCALE = {
  slotRoutes: 4,
  xRoutes: 4.2,
  tree: 2,
  zone: 4.5,
  man: 3.3,
  press: 4,
  manZoneOverPress: 4.3,
  // YAC, set on the 2026-11-09 data (94 charted WRs with PFF catches, pool
  // 5.70 yds and 0.171 missed tackles per catch): yards after the catch per
  // catch over the pool's, in hundredths of a yard, and missed tackles per 100
  // catches over the pool's.
  yac: 96,
  yacMtf: 4.5,
  // Release win rate vs press, pts over the pool's. PROVISIONAL: no tagged
  // press reps existed when it was set; re-calibrate once 10 WRs have
  // X_RELEASE_REPS.
  release: 10,
} as const;

const SLOT_ROUTES = ["slant", "curl", "flat"];
const X_ROUTES = ["slant", "nine", "comeback", "dig", "corner", "post"];
// "Most of the route tree": every route but screens and other.
const TREE_ROUTES = ["nine", "post", "dig", "curl", "slant", "flat", "comeback", "out", "corner"];

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
    slotRoutes: groupFeature("Slants/curls/flats", skill, SLOT_ROUTES, SCALE.slotRoutes),
    xRoutes: groupFeature("X routes (slant/go/comeback/dig/corner/post)", skill, X_ROUTES, SCALE.xRoutes),
    tree: treeFeature(skill),
    zone: skillFeature("vs zone", aeOf(skill.zone), skill.zone.n, COVERAGE_PRIOR, SCALE.zone, "routes"),
    man,
    yac: rateFeature("Yards after the catch (PFF)", inp.pffYac ?? NO_RATE, inp.leaguePffYac ?? NO_RATE, CATCH_PRIOR, SCALE.yac, "catches", false, " yds after the catch per catch"),
    yacMtf: rateFeature("Missed tackles after the catch (PFF)", inp.pffYacMtf ?? NO_RATE, inp.leaguePffYacMtf ?? NO_RATE, CATCH_PRIOR, SCALE.yacMtf, "catches", false, " per catch"),
  };
  if (skill.press.n > 0) {
    f.press = skillFeature("vs press (in-app)", aeOf(skill.press), skill.press.n, COVERAGE_PRIOR, SCALE.press, "in-app routes");
    f.manZoneOverPress = contrastFeature("Man/zone over press", s(mergeAESums([skill.man, skill.zone])), s(skill.press), COVERAGE_PRIOR, SCALE.manZoneOverPress);
  } else {
    // Unknown, not average: no better than average, and no better than his
    // man (an imported man rep can be a press rep). Z's press contrast is left
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
    // in the 2026 in-app charting), so X vs Z reads the split of his OUTSIDE
    // snaps: on the line (X) or off it (Z), scaled by how outside he plays.
    const pct = (n: number) => `${Math.round((n / lu.snaps) * 100)}%`;
    const xSnaps = lu.left_on + lu.right_on, zSnaps = lu.left_off + lu.right_off, outside = xSnaps + zSnaps;
    const outsideness = Math.min(1, Math.max(0, (outside / lu.snaps - 0.5) / 0.3));
    const onFrac = outside > 0 ? xSnaps / outside : 0;
    const ramp = (v: number, lo: number, hi: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    f.xShare = { label: "Lined up outside on the line", kind: "usage", fit: outsideness * ramp(onFrac, 0.6, 0.9), display: `${pct(xSnaps)} of ${lu.snaps} in-app snaps` };
    f.zShare = { label: "Lined up outside off the line", kind: "usage", fit: outsideness * ramp(1 - onFrac, 0.1, 0.4), display: `${pct(zSnaps)} of ${lu.snaps} in-app snaps` };
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
    role: "z",
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
      { feature: "yac", weight: 0.45, core: true },
      { feature: "yacMtf", weight: 0.45, core: true },
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
