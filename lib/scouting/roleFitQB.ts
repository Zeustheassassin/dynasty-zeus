// QB role buckets: Creator, Distributor, Vertical and Dual-threat (approved by
// the user, 2026-10-02). Scoring is shared (roleFit.ts); this file holds the QB
// features and recipes.
//
// Every game counts: the four QB games charted before 2026-05-01 were charted
// play by play, like the rest.
//
// Skill is AAE (aboveExpected.ts) over a slice of his graded throws: short and
// intermediate, deep, off-platform or on the run, under pressure. Usage is his
// tendencies: how often he throws to his first read, checks down, takes sacks,
// throws deep, extends plays, scrambles and runs. Dual-threat is usage alone:
// designed QB runs record no result, so only how often he runs can count.
import type { Prospect, QBPlay, ScoutingGame } from "../types";
import { computeQBRoleSlices } from "./aboveExpected";
import { parseHeightInches } from "./prospectAge";
import {
  buildRoleFit, inverseUsageFeature, skillFeature, usageFeature,
  type AESliceValue, type BucketRecipe, type FeatureSet, type RoleFit,
} from "./roleFit";

// Fewer graded throws than this: no bucket.
export const QB_MIN_THROWS = 30;

// Prior (pseudo-throws) and each slice's scale (pts), calibrated on the
// 2026-10-02 charting so the best tenth of charted QBs on each slice read about
// 0.8. Fixed from here on. QB accuracy is noisy at today's volume (a median
// QB's AAE is ~19% signal), so the prior is heavy.
const PRIOR = 60;
const SCALE = {
  aae: 2.4,
  shortMid: 2.7,
  deep: 1.7,
  offPlatform: 2.3,
  pressured: 1.5,
} as const;

const isDeep = (pl: QBPlay) => pl.depth_zone?.startsWith("deep_") ?? false;
const QB_SLICES = {
  all:         () => true,
  shortMid:    (pl: QBPlay) => pl.depth_zone != null && !isDeep(pl),
  deep:        isDeep,
  offPlatform: (pl: QBPlay) => pl.platform === "off_platform" || pl.platform === "on_the_run",
  pressured:   (pl: QBPlay) => pl.pressure != null && pl.pressure !== "clean",
};
type QBSliceKey = keyof typeof QB_SLICES;

const isGraded = (pl: QBPlay) => pl.play_type !== "run" && pl.accuracy != null && pl.accuracy !== "tipped_ball";

export interface QBRoleInputs {
  plays: QBPlay[];
  slices: Record<QBSliceKey, AESliceValue>;
  heightIn: number | null;
  weightLb: number | null;
}

export function qbFeatures(inp: QBRoleInputs): FeatureSet {
  const { plays, slices } = inp;
  const f: FeatureSet = {
    aae: skillFeature("AAE, all throws", slices.all.ae, slices.all.n, PRIOR, SCALE.aae, "throws"),
    shortMid: skillFeature("Short + intermediate throws", slices.shortMid.ae, slices.shortMid.n, PRIOR, SCALE.shortMid, "throws"),
    deep: skillFeature("Deep throws", slices.deep.ae, slices.deep.n, PRIOR, SCALE.deep, "throws"),
    offPlatform: skillFeature("Off-platform / on the run", slices.offPlatform.ae, slices.offPlatform.n, PRIOR, SCALE.offPlatform, "throws"),
    pressured: skillFeature("Under pressure", slices.pressured.ae, slices.pressured.n, PRIOR, SCALE.pressured, "throws"),
  };
  const snaps = plays.length;
  const pass = plays.filter((pl) => pl.play_type !== "run");
  const timed = pass.filter((pl) => pl.timing != null);
  const graded = plays.filter(isGraded);
  const of = (sub: QBPlay[], pred: (pl: QBPlay) => boolean) => sub.filter(pred).length / sub.length;
  const pct = (x: number, what: string) => `${Math.round(x * 100)}% of ${what}`;
  if (timed.length > 0) {
    const first = of(timed, (pl) => pl.timing === "first_option");
    const check = of(timed, (pl) => pl.timing === "checkdown");
    const ext = of(timed, (pl) => pl.timing === "extended_play");
    f.firstRead = usageFeature("To his first read", first, 0.38, 0.58, pct(first, "dropbacks"));
    f.checkdown = usageFeature("Checkdowns", check, 0.04, 0.12, pct(check, "dropbacks"));
    f.extended = usageFeature("Extended plays", ext, 0.02, 0.1, pct(ext, "dropbacks"));
  }
  if (pass.length > 0) {
    const sack = of(pass, (pl) => pl.timing === "sack");
    const scramble = of(pass, (pl) => pl.timing === "scramble");
    f.fewSacks = inverseUsageFeature("Sacks taken (fewer is better)", sack, 0.01, 0.07, pct(sack, "dropbacks"));
    f.scramble = usageFeature("Scrambles", scramble, 0.03, 0.1, pct(scramble, "dropbacks"));
  }
  if (graded.length > 0) {
    const deep = of(graded, isDeep);
    const off = of(graded.filter((pl) => pl.platform != null), (pl) => pl.platform !== "on_platform");
    f.deepShare = usageFeature("Deep throws", deep, 0.1, 0.24, pct(deep, "throws"));
    if (graded.some((pl) => pl.platform != null)) f.offShare = usageFeature("Throws off-platform / on the run", off, 0.15, 0.4, pct(off, "platform-charted throws"));
  }
  if (snaps > 0) {
    const run = of(plays, (pl) => pl.play_type === "run");
    f.runShare = usageFeature("Designed runs", run, 0.05, 0.2, pct(run, "snaps"));
  }
  return f;
}

export const QB_RECIPES: readonly BucketRecipe[] = [
  {
    role: "creator",
    ingredients: [
      { feature: "offPlatform", weight: 0.35, core: true },
      { feature: "pressured", weight: 0.3, core: true },
      { feature: "extended", weight: 0.15 },
      { feature: "offShare", weight: 0.1 },
      { feature: "scramble", weight: 0.1 },
    ],
  },
  {
    role: "distributor",
    ingredients: [
      { feature: "shortMid", weight: 0.4, core: true },
      { feature: "aae", weight: 0.25 },
      { feature: "firstRead", weight: 0.15 },
      { feature: "fewSacks", weight: 0.1 },
      { feature: "checkdown", weight: 0.1 },
    ],
    size: { minHeightIn: 72 },
  },
  {
    role: "vertical",
    ingredients: [
      { feature: "deep", weight: 0.5, core: true },
      { feature: "aae", weight: 0.15 },
      { feature: "deepShare", weight: 0.35 },
    ],
  },
  {
    // Usage alone (see the header).
    role: "dual_threat",
    ingredients: [
      { feature: "runShare", weight: 0.6 },
      { feature: "scramble", weight: 0.4 },
    ],
  },
];

/** Null under QB_MIN_THROWS. */
export function qbRoleFit(inp: QBRoleInputs): RoleFit | null {
  const throws = inp.plays.filter(isGraded).length;
  if (throws < QB_MIN_THROWS) return null;
  return buildRoleFit({
    pos: "QB",
    recipes: QB_RECIPES,
    features: qbFeatures(inp),
    heightIn: inp.heightIn,
    weightLb: inp.weightLb,
    sample: { n: throws, unit: "graded throws" },
    confidenceAt: { medium: 80, high: 160 },
  });
}

/** Every QB's buckets from the league's plays. */
export function computeQBRoleFits(prospects: Prospect[], games: ScoutingGame[], qbPlays: QBPlay[]): Map<string, RoleFit | null> {
  const out = new Map<string, RoleFit | null>();
  const qbs = prospects.filter((p) => p.position === "QB");
  if (qbs.length === 0) return out;
  const slices = computeQBRoleSlices(prospects, games, qbPlays, QB_SLICES);
  const gameToProspect = new Map(games.map((g) => [g.id, g.prospect_id]));
  const playsBy = new Map<string, QBPlay[]>();
  for (const pl of qbPlays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    const arr = playsBy.get(pid);
    if (arr) arr.push(pl); else playsBy.set(pid, [pl]);
  }
  for (const p of qbs) {
    const s = slices.get(p.id);
    out.set(p.id, s ? qbRoleFit({
      plays: playsBy.get(p.id) ?? [],
      slices: s,
      heightIn: parseHeightInches(p.height),
      weightLb: p.weight,
    }) : null);
  }
  return out;
}
