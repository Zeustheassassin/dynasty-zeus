// Role buckets: which NFL role each prospect projects to, from his charting
// plus height and weight (the user's ask, 2026-10-02). WRs sort into Gadget,
// Slot, Y and X; RBs, TEs and QBs into their own buckets (ROLES below). Each
// position's features and recipes live in roleFitWR / roleFitRB / roleFitTE /
// roleFitQB; this file holds the scoring they share.
//
// How a prospect is scored, every bucket independently:
// - Each bucket is a recipe of features, built from the user's own definitions.
//   A feature reads 0–1. Skill features (his above-expected on some slice of
//   reps) sit at 0.5 for an average player; usage features (how often he lined
//   up somewhere or ran something) ramp from 0 to 1 over a fixed range.
// - Skill leads, usage breaks ties: skill carries about two thirds of the RB,
//   TE and QB recipes and 90% of WR's (the user: where a receiver lined up in
//   college says little about what he'll be best at as a pro). Where he wins
//   matters more than how his college used him.
// - A recipe can require evidence before its bucket is proven (WR X: in-app
//   press reps). An unproven bucket shows with a "?" and never wins a near
//   tie.
// - Small samples are pulled toward average before they're read: a skill
//   feature is his AE × n / (n + prior), so 12 press reps can't make an X.
// - Size slows a player down but never rules him out. Below a bucket's NFL
//   size floor the match drops, faster the further below; a prospect who is
//   elite at the bucket's core skills keeps most of it (ELITE_SIZE_SHARE).
// - Match % = 100 × the weighted feature average × (1 − size drop). Every
//   bucket gets its own %, so they don't add to 100: a player can be 86% X and
//   84% Y.
//
// The scale is fixed, never a rank within the pool: skill scales are in AE
// points, usage ramps in shares, size floors in inches and pounds. Adding or
// dropping other players never moves anyone's %. (The AE baselines underneath
// still come from all tape, like every Above-Expected metric.) The constants
// were calibrated once against the 2026-10-02 charting; see each position file.
//
// Buckets describe a player. They don't feed the AE Score or the Dynasty
// Scores (the user's call, 2026-10-02).

export type RolePos = "QB" | "RB" | "WR" | "TE";

export type WRRole = "x" | "y" | "slot" | "gadget";
export type RBRole = "three_down" | "zone" | "gap" | "receiving" | "two_down" | "third_down" | "big_play" | "goal_line" | "blocking_st";
export type TERole = "inline_y" | "move" | "h_back" | "blocking";
export type QBRole = "creator" | "distributor" | "vertical" | "dual_threat";
export type RoleKey = WRRole | RBRole | TERole | QBRole;

export interface RoleInfo {
  key: RoleKey;
  label: string;
  /** Short column header. */
  short: string;
  description: string;
  /** Ceiling tier, 0 = highest. On a near tie (NEAR_TIE) the lower tier
   *  leads; equal tiers go to the higher match. At a LEVELED position (RB) it's
   *  the role's level instead (see LEVELED). */
  tier: number;
  /** The catch-all: never competes, and leads only when every other bucket is
   *  under FALLBACK_LINE. */
  fallback?: true;
  /** A catch-all's stricter rule, in place of FALLBACK_LINE: named only with
   *  every other bucket under `under` and its own match at least `atLeast`.
   *  RB Blocking/ST (the user, 2026-10-08: only when he's truly terrible at
   *  everything but blocking). */
  fallbackRule?: { under: number; atLeast: number };
}

// Each position's buckets, highest ceiling first. The user wants the best case
// first, with a % for every other bucket. WR tiers are the user's (2026-10-02):
// X and Y are the same level, Slot a step below (more limited to the short
// game), and Gadget catches the receivers who aren't good enough for any of
// the three. The TE / QB orders are a proposal the user hasn't weighed in on.
// RB tiers are levels, all the user's (2026-10-08): A Three-down; B Zone or
// Gap/Power, whichever he fits better; C Receiving, 2-Down or 3rd-Down; D
// Big-play, Goal-line or Blocking/ST (LEVELED).
export const ROLES: Record<RolePos, readonly RoleInfo[]> = {
  WR: [
    { key: "x",      label: "X",      short: "X",      tier: 0, description: "Excels vs press and man on slants, nines, comebacks, digs, corners and posts. Needs 10+ in-app press reps to be proven (X? until then). Reads release vs press too once he has 10+ tagged press reps." },
    { key: "y",      label: "Y",      short: "Y",      tier: 0, description: "Good across most of the route tree; better vs man and zone than vs press. Same level as X." },
    { key: "slot",   label: "Slot",   short: "Slot",   tier: 1, description: "More limited to the short game: strong vs zone on slants, curls and flats; decent vs man; press doesn't count against him." },
    { key: "gadget", label: "Gadget", short: "Gadget", tier: 2, fallback: true, description: "The catch-all for a receiver who isn't good enough for X, Y or Slot (all under 50%): a special-teamer or one-touch-a-game role. Its % is how much his game is screens, flats and slants." },
  ],
  RB: [
    { key: "three_down",  label: "Three-down",  short: "3-Down",   tier: 0, description: "The workhorse: wins on zone and gap runs, reliable hands (no drops), holds up in pass protection, and the build to carry the load. Level A: when he reaches it, it's his whole label." },
    { key: "zone",        label: "Zone",        short: "Zone",     tier: 1, description: "One-cut runner: much better on zone runs than gap runs. Level B, with Gap/Power: whichever he fits better." },
    { key: "gap",         label: "Gap/Power",   short: "Gap",      tier: 1, description: "Wins on gap runs and against a stacked box, breaks tackles; heavier. Level B, with Zone: whichever he fits better." },
    { key: "receiving",   label: "Receiving",   short: "Recv",     tier: 2, description: "Runs a lot of routes, often split out wide, gets open on the harder routes (WR routes, wheels, angles, seams). Level C." },
    { key: "two_down",    label: "2-Down",      short: "2-Down",   tier: 2, description: "Early-down runner who comes off the field on passing downs: not good in pass protection and average at best as a receiver (40% of the match), with the Three-down back's running and build (60%). Holding up in pass pro or catching well cuts it. Level C." },
    { key: "third_down",  label: "3rd-Down",    short: "3rd-Down", tier: 2, description: "Passing-down back: excels in pass protection and as a receiver (open on routes, no drops), average at best as a runner. Falling short in pass pro or hands cuts it, and so does being a good runner. Level C." },
    { key: "big_play",    label: "Big-play",    short: "BigPlay",  tier: 3, description: "Change of pace: lots of explosive runs and lots of runs stopped at or behind the line. Level D." },
    { key: "goal_line",   label: "Goal-line",   short: "GL",       tier: 3, description: "Short-yardage and goal-line back: wins on inside runs and against a loaded box, runs through contact (PFF yards after contact and missed tackles), rarely stuffed; your Power grade and his tagged short-yardage runs (10+) count once he has them. Level D." },
    { key: "blocking_st", label: "Blocking/ST", short: "Blk/ST",   tier: 3, fallback: true, fallbackRule: { under: 40, atLeast: 55 }, description: "Blocking and special teams: named only when he's under 40% at every other role and this reads 55%+. Its % is how blocking-only he is: his pass protection, cut for being a good runner or a good receiver. Level D." },
  ],
  TE: [
    { key: "inline_y", label: "Inline Y",    short: "InlineY",  tier: 0, description: "Mostly tight to the line; blocks well on the line and on the move and still runs routes." },
    { key: "move",     label: "Move/Big slot", short: "Move",   tier: 1, description: "Mostly in the slot or split wide; wins on routes, especially vs man." },
    { key: "h_back",   label: "H-back/Wing", short: "H-back",   tier: 2, description: "Wing, fullback or backfield; blocks on the move and runs to the flat." },
    { key: "blocking", label: "Blocking TE", short: "Blocking", tier: 3, description: "Tight to the line and blocking most snaps; the receiving can be thin." },
  ],
  QB: [
    { key: "creator",     label: "Creator",     short: "Creator", tier: 0, description: "Extends plays; accurate off-platform and on the run; handles pressure." },
    { key: "distributor", label: "Distributor", short: "Distrib", tier: 1, description: "On time to the first read, accurate short and intermediate, rarely sacked, uses checkdowns." },
    { key: "vertical",    label: "Vertical",    short: "Vertical", tier: 2, description: "Throws deep a lot and accurately; takes more risky shots." },
    { key: "dual_threat", label: "Dual-threat", short: "Dual",    tier: 3, description: "Runs and scrambles a lot, and gains yards doing it (PFF yards per carry over the charted games; tagged run success once there are 10+ tagged runs)." },
  ],
};

const ROLE_INFO = new Map<RoleKey, RoleInfo>(Object.values(ROLES).flat().map((r) => [r.key, r]));
export const roleInfo = (key: RoleKey): RoleInfo => ROLE_INFO.get(key)!;

// Two buckets within this many points are a near tie: the higher-ceiling one
// leads and the other shows as the hybrid ("X / Y"). Not at a LEVELED
// position.
export const NEAR_TIE = 5;
// The catch-all bucket (WR Gadget) leads when every other bucket is under
// this: he isn't at least average at any real role.
export const FALLBACK_LINE = 50;
// Positions labeled by level rather than by near tie, with the match each
// level's best role has to reach, top level first: RB (the user, 2026-10-08).
// Its tiers are levels, A (0) to D (3). He's named for the top level his best
// role there reaches (Zone or Gap/Power, whichever he fits better). The top
// level stands alone ("If you hit Three Down it can be assumed you excel
// basically all over the place"). Below it, his best role at each lower level
// follows when it reaches its line too ("Zone / 2-Down / Goal-line").
// Reaching no level, he gets his best role from a middle level at
// NO_LEVEL_LINE+, the higher level first; failing that, his best role at the
// bottom one.
// The lines are mine, set on the 2026-10-08 data: Three-down 65 (Baugh, LJ
// Martin, Darius Taylor; at 60 Marcellous Hawkins' Zone / Goal-line read just
// Three-down). The rest 55: at 60, 10 of 31 backs reached no level, among
// them backs at 56–57% in a real role; at 50, a 190 lb back read Gap/Power.
export const LEVELED: Partial<Record<RolePos, readonly number[]>> = { RB: [65, 55, 55, 55] };
// The user (2026-10-08): a back who reaches no level is marked with his B or
// C role "as long as they have a B or C ranked role above 50%", not a D role.
// (A 50 counts, as at FALLBACK_LINE: average.)
export const NO_LEVEL_LINE = 50;

/** A leveled position's line for a role's level. */
const lineFor = (pos: RolePos, role: RoleKey) => LEVELED[pos]![roleInfo(role).tier];

/** The level rule in words, for tooltips; null at a near-tie position. */
export function levelRuleText(pos: RolePos): string | null {
  const lines = LEVELED[pos];
  if (!lines) return null;
  const levels = [...new Set(ROLES[pos].map((r) => r.tier))].sort((a, b) => a - b);
  const names = levels.map((lv) => {
    const labels = ROLES[pos].filter((r) => r.tier === lv).map((r) => r.label);
    return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}` : labels[0];
  });
  const rest = [...new Set(lines.slice(1))];
  const letter = (i: number) => String.fromCharCode(65 + i);
  const middle = levels.slice(1, -1).map((_, i) => letter(i + 1));
  const rules = ROLES[pos].filter((r) => r.fallbackRule).map((r) => ` ${r.label} only under ${r.fallbackRule!.under}% at every other role and at ${r.fallbackRule!.atLeast}%+ itself.`).join("");
  return `Roles come in ${levels.length} levels: ${names.map((n, i) => `${letter(i)} ${n}`).join("; ")}. `
    + `He's named for the top level where his best role reaches its line (${names[0]} ${lines[0]}%, ${rest.length === 1 ? `the rest ${rest[0]}%` : lines.slice(1).map((l, i) => `${letter(i + 1)} ${l}%`).join(", ")}). `
    + `${names[0]} stands alone; below it, his best role at each lower level follows when it reaches its line too (e.g. "Zone / 2-Down / Goal-line"). `
    + `Reaching no level, he gets his best ${middle.join(" or ")} role at ${NO_LEVEL_LINE}%+ (${middle[0]} first), otherwise his best ${letter(levels.length - 1)} role; greyed either way.${rules}`;
}

/** At a leveled position, true when he reached no level (his label is under its level's line). */
export function noLevelReached(fit: RoleFit): boolean {
  return LEVELED[fit.pos] != null && matchFor(fit, fit.best)!.pct < lineFor(fit.pos, fit.best);
}
// A match this high counts toward Versatile, which takes two such buckets.
export const VERSATILE_PCT = 70;
// A position's own Versatile rule, where it has one: every listed bucket
// above `above`, and proven. null = no Versatile at the position. All the
// user's calls (2026-10-02): a WR is Versatile above 60% at both X and Y (an
// X? doesn't count). RB and QB have none: Three-down already is the all-round
// back, and Creator and Dual-threat are the all-round QBs. TE keeps the
// default, VERSATILE_PCT+ in two or more buckets.
export interface VersatileRule { roles: readonly RoleKey[]; above: number }
export const VERSATILE_RULES: Partial<Record<RolePos, VersatileRule | null>> = {
  WR: { roles: ["x", "y"], above: 60 },
  RB: null,
  QB: null,
};

/** Whether the position uses Versatile at all. */
export const hasVersatile = (pos: RolePos) => VERSATILE_RULES[pos] !== null;

/** What Versatile means at a position, for tooltips. */
export function versatileRuleText(pos: RolePos): string {
  const rule = VERSATILE_RULES[pos];
  if (rule === null) return "not used at this position";
  if (!rule) return `${VERSATILE_PCT}%+ in two or more roles`;
  const names = rule.roles.map((k) => roleInfo(k).label);
  return `above ${rule.above}% at both ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
// A core-skill fit this high is elite (about the top tenth of charted players
// on the 2026-10-02 data): the size drop shrinks to ELITE_SIZE_SHARE of itself.
export const ELITE_FIT = 0.8;
export const ELITE_SIZE_SHARE = 0.25;
// The size drop per inch and per pound under a bucket's floor, and its cap.
// 5'7" 170 as an X (floor 6'0" 195): 5 × 0.06 + 25 × 0.006 = 0.45, so even a
// perfect fit reads 55%.
export const SIZE_PER_INCH = 0.06;
export const SIZE_PER_LB = 0.006;
export const SIZE_MAX_DROP = 0.6;

// "body" = his build (e.g. a bell-cow's weight): neither skill nor usage.
export type FeatureKind = "skill" | "usage" | "body";

/** One feature's reading for one prospect. */
export interface Feature {
  label: string;
  kind: FeatureKind;
  /** 0–1. Skill: 0.5 = average. Usage: 0 = never, 1 = his main job. */
  fit: number;
  /** What the tooltip shows, e.g. "+6.2 pts on 48 routes" or "71% of snaps". */
  display: string;
  /** Skill features: the reps behind it. */
  n?: number;
}

/** A prospect's features by key. A missing usage feature (no data) is left out
 *  of every recipe and the weights renormalize; skill features are always
 *  present, at 0.5 with no reps. */
export type FeatureSet = Record<string, Feature | undefined>;

export interface Ingredient {
  feature: string;
  weight: number;
  /** One of the bucket's core skills: they decide whether he's elite enough to
   *  beat the size floor. */
  core?: boolean;
}

export interface SizeFloor {
  minHeightIn?: number;
  minWeightLb?: number;
}

export interface BucketRecipe {
  role: RoleKey;
  ingredients: readonly Ingredient[];
  size?: SizeFloor;
  /** The bucket isn't proven until this feature rests on `minN` reps: it can
   *  still be his top match, shown with a "?", but it never wins a near tie.
   *  WR X needs in-app press reps (the user: press is what makes an X). */
  requires?: { feature: string; minN: number; why: string };
  /** Bars he has to clear. Each gate cuts the match by up to `maxCut` (at a
   *  fit of 0), in proportion to how far short he falls; a gate feature that's
   *  missing cuts nothing. RB Three-down gates on hands and pass protection. */
  gates?: readonly { feature: string; maxCut: number }[];
}

export interface RoleMatch {
  role: RoleKey;
  /** 0–100. */
  pct: number;
  /** The share of the % lost to size (0 = none). */
  sizeDrop: number;
  /** Why size cost him, e.g. "5'9" 182 under 6'0" 195 (elite: kept most)". */
  sizeNote: string | null;
  /** The two or three features that moved this bucket most, signed. */
  drivers: string[];
  /** False while the recipe's `requires` isn't met; `pendingWhy` says why. */
  proven: boolean;
  pendingWhy?: string;
}

export type RoleConfidence = "high" | "medium" | "low";

export interface RoleFit {
  pos: RolePos;
  /** The headline: the best case. */
  best: RoleKey;
  /** The roles named after it, "best / also…": a bucket within NEAR_TIE of
   *  the best (at most one), or at a LEVELED position (RB) his best role at
   *  each lower level that reaches its line. */
  also: RoleKey[];
  /** One per bucket, in ROLES order. */
  matches: RoleMatch[];
  /** The position's VERSATILE_RULES entry (always false at RB and QB), else VERSATILE_PCT+ in two or more buckets. */
  versatile: boolean;
  /** The bucket his usage alone points to; null without usage data. */
  usedAs: RoleKey | null;
  confidence: RoleConfidence;
  /** The reps behind it, e.g. { n: 212, unit: "routes" }. */
  sample: { n: number; unit: string };
  /** No usage data at all (a WR charted only in the import): skill alone. */
  skillOnly: boolean;
  /** Every feature behind the matches, for the "why" lines. */
  features: FeatureSet;
}

/** Running above-expected sums over some reps (weights = season weights). */
export interface AESum { n: number; w: number; actual: number; expected: number }
export const emptyAESum = (): AESum => ({ n: 0, w: 0, actual: 0, expected: 0 });

/** The sum's above-expected in pts; null with no reps. */
export function aeOf(s: AESum | undefined): number | null {
  return s && s.n > 0 && s.w > 0 ? ((s.actual - s.expected) / s.w) * 100 : null;
}

export function mergeAESums(sums: readonly (AESum | undefined)[]): AESum {
  const out = emptyAESum();
  for (const s of sums) {
    if (!s) continue;
    out.n += s.n; out.w += s.w; out.actual += s.actual; out.expected += s.expected;
  }
  return out;
}

/** Above-expected over one slice of a prospect's reps, and how many reps. */
export interface AESliceValue { ae: number | null; n: number }

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const signed = (v: number, dp = 1) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;

/** His AE pulled toward 0 by `prior` pseudo-reps. */
export function shrinkAE(ae: number | null | undefined, n: number, prior: number): number {
  if (ae == null || !(n > 0)) return 0;
  return (ae * n) / (n + prior);
}

/** A skill feature: the shrunk AE through a logistic with a fixed `scale` (pts). */
export function skillFeature(label: string, ae: number | null | undefined, n: number, prior: number, scale: number, unit: string): Feature {
  const shrunk = shrinkAE(ae, n, prior);
  return {
    label,
    kind: "skill",
    fit: logistic(shrunk / scale),
    display: ae == null || !(n > 0) ? `no ${unit} yet` : `${signed(ae)} pts on ${n} ${unit}`,
    n,
  };
}

/** A skill contrast: how much better he is at A than B (both shrunk first). */
export function contrastFeature(
  label: string,
  a: { ae: number | null | undefined; n: number },
  b: { ae: number | null | undefined; n: number },
  prior: number,
  scale: number,
): Feature {
  const diff = shrinkAE(a.ae, a.n, prior) - shrinkAE(b.ae, b.n, prior);
  return { label, kind: "skill", fit: logistic(diff / scale), display: `${signed(diff)} pts apart (after sample discount)` };
}

/** A usage feature: `share` (0–1) ramped from `lo` (0) to `hi` (1). */
export function usageFeature(label: string, share: number, lo: number, hi: number, display?: string): Feature {
  return {
    label,
    kind: "usage",
    fit: hi > lo ? clamp01((share - lo) / (hi - lo)) : share >= hi ? 1 : 0,
    display: display ?? `${Math.round(share * 100)}%`,
  };
}

/** A usage feature where less is better (e.g. sack rate for a Distributor). */
export function inverseUsageFeature(label: string, share: number, lo: number, hi: number, display?: string): Feature {
  const f = usageFeature(label, share, lo, hi, display);
  return { ...f, fit: 1 - f.fit };
}

const feetInches = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

function sizeDrop(floor: SizeFloor | undefined, heightIn: number | null, weightLb: number | null): { drop: number; short: string | null } {
  if (!floor) return { drop: 0, short: null };
  const inches = floor.minHeightIn != null && heightIn != null ? Math.max(0, floor.minHeightIn - heightIn) : 0;
  const lbs = floor.minWeightLb != null && weightLb != null ? Math.max(0, floor.minWeightLb - weightLb) : 0;
  const drop = Math.min(SIZE_MAX_DROP, inches * SIZE_PER_INCH + lbs * SIZE_PER_LB);
  if (!(drop > 0)) return { drop: 0, short: null };
  const his = [heightIn != null ? feetInches(heightIn) : null, weightLb != null ? `${weightLb}` : null].filter(Boolean).join(" ");
  const need = [floor.minHeightIn != null ? feetInches(floor.minHeightIn) : null, floor.minWeightLb != null ? `${floor.minWeightLb}` : null].filter(Boolean).join(" ");
  return { drop, short: `${his} under ${need}` };
}

export function scoreBucket(recipe: BucketRecipe, features: FeatureSet, heightIn: number | null, weightLb: number | null): RoleMatch {
  let sum = 0, wsum = 0, coreSum = 0, coreW = 0;
  const parts: { f: Feature; weight: number }[] = [];
  for (const ing of recipe.ingredients) {
    const f = features[ing.feature];
    if (!f) continue;
    sum += ing.weight * f.fit;
    wsum += ing.weight;
    if (ing.core) { coreSum += ing.weight * f.fit; coreW += ing.weight; }
    parts.push({ f, weight: ing.weight });
  }
  const raw = wsum > 0 ? sum / wsum : 0.5;
  const elite = coreW > 0 && coreSum / coreW >= ELITE_FIT;
  const size = sizeDrop(recipe.size, heightIn, weightLb);
  const drop = size.drop * (elite ? ELITE_SIZE_SHARE : 1);
  const top = parts
    .map(({ f, weight }) => ({ f, pull: (weight / (wsum || 1)) * (f.fit - 0.5) }))
    .filter((d) => Math.abs(d.pull) >= 0.01)
    .sort((a, b) => Math.abs(b.pull) - Math.abs(a.pull))
    .slice(0, 3);
  const drivers = top.map(({ f, pull }) => `${pull > 0 ? "+" : "−"} ${f.label}: ${f.display}`);
  // A gate that reads the same thing as an ingredient listed above (RB 2-Down)
  // shows just its cut.
  const listed = new Set(top.map(({ f }) => f.display));
  let gate = 1;
  for (const g of recipe.gates ?? []) {
    const f = features[g.feature];
    if (!f) continue;
    const cut = g.maxCut * (1 - f.fit);
    gate *= 1 - cut;
    if (cut >= 0.03) drivers.push(`− ${f.label}${listed.has(f.display) ? "" : `: ${f.display}`} (−${Math.round(cut * 100)}%)`);
  }
  const req = recipe.requires;
  const proven = !req || (features[req.feature]?.n ?? 0) >= req.minN;
  return {
    role: recipe.role,
    pct: Math.round(100 * raw * gate * (1 - drop)),
    sizeDrop: drop,
    sizeNote: size.short ? `${size.short}${elite ? " (elite at the core skills: kept most)" : ""}` : null,
    drivers,
    proven,
    ...(proven ? {} : { pendingWhy: `${req!.why} (has ${features[req!.feature]?.n ?? 0})` }),
  };
}

// The bucket his usage alone points to: each recipe's usage features averaged,
// highest wins. Null when he has no usage data or no recipe has any.
function usedAsRole(recipes: readonly BucketRecipe[], features: FeatureSet, order: readonly RoleInfo[]): RoleKey | null {
  let best: RoleKey | null = null, bestScore = -1;
  for (const info of order) {
    const recipe = recipes.find((r) => r.role === info.key);
    if (!recipe) continue;
    let sum = 0, wsum = 0;
    for (const ing of recipe.ingredients) {
      const f = features[ing.feature];
      if (!f || f.kind !== "usage") continue;
      sum += ing.weight * f.fit;
      wsum += ing.weight;
    }
    if (wsum === 0) continue;
    const score = sum / wsum;
    if (score > bestScore + 1e-9) { best = info.key; bestScore = score; }
  }
  return best;
}

export interface FitInputs {
  pos: RolePos;
  recipes: readonly BucketRecipe[];
  features: FeatureSet;
  heightIn: number | null;
  weightLb: number | null;
  sample: { n: number; unit: string };
  /** Sample sizes at which confidence turns medium and high. */
  confidenceAt: { medium: number; high: number };
}

function isVersatile(pos: RolePos, matches: readonly RoleMatch[]): boolean {
  const rule = VERSATILE_RULES[pos];
  if (rule === null) return false;
  if (!rule) return matches.filter((m) => m.pct >= VERSATILE_PCT).length >= 2;
  return rule.roles.every((k) => {
    const m = matches.find((x) => x.role === k);
    return m != null && m.proven && m.pct > rule.above;
  });
}

const byPctIn = (order: readonly RoleInfo[]) => {
  const rank = (k: RoleKey) => order.findIndex((r) => r.key === k);
  return (a: RoleMatch, b: RoleMatch) => b.pct - a.pct || rank(a.role) - rank(b.role);
};

// Whether a catch-all may be named: under its fallbackRule, every other
// bucket under the rule's line and itself at the rule's match; without one,
// every other bucket under FALLBACK_LINE.
function catchAllNamed(m: RoleMatch, matches: readonly RoleMatch[]): boolean {
  const rule = roleInfo(m.role).fallbackRule;
  const top = Math.max(...matches.filter((x) => x.role !== m.role).map((x) => x.pct));
  return rule ? top < rule.under && m.pct >= rule.atLeast : top < FALLBACK_LINE;
}

// The headline and its hybrid, by near tie: of the buckets within NEAR_TIE of
// the top, the highest ceiling tier (equal tiers: the higher match), but only
// a proven bucket wins a tie. An unproven one leads only when no proven bucket
// is within NEAR_TIE (shown "X?"): an untested X isn't demoted to a worse
// role, and isn't promoted over a better-supported one either. The catch-all
// doesn't compete; it leads only when catchAllNamed.
function pickByNearTie(order: readonly RoleInfo[], matches: readonly RoleMatch[]): RoleMatch[] {
  const byPct = byPctIn(order);
  const tierOf = (k: RoleKey) => roleInfo(k).tier;
  const fallback = matches.find((m) => roleInfo(m.role).fallback);
  if (fallback && catchAllNamed(fallback, matches)) return [fallback];
  const pool = matches.filter((m) => !roleInfo(m.role).fallback);
  const top = Math.max(...pool.map((m) => m.pct));
  const contenders = pool.filter((m) => top - m.pct <= NEAR_TIE);
  const proven = contenders.filter((m) => m.proven);
  const best = proven.length
    ? [...proven].sort((a, b) => tierOf(a.role) - tierOf(b.role) || byPct(a, b))[0]
    : [...contenders].sort(byPct)[0];
  const hybrid = contenders.filter((m) => m.role !== best.role).sort(byPct)[0];
  return hybrid ? [best, hybrid] : [best];
}

// One role per level (LEVELED): the top level he reaches stands alone if it's
// the first, otherwise lower levels add their best role at their line.
// Reaching none, his best middle-level role at NO_LEVEL_LINE+ (higher level
// first), else his best role at the last level. A catch-all counts only when
// catchAllNamed.
function pickByLevel(order: readonly RoleInfo[], matches: readonly RoleMatch[], lines: readonly number[]): RoleMatch[] {
  const byPct = byPctIn(order);
  const levels = [...new Set(order.map((r) => r.tier))].sort((a, b) => a - b);
  const bestAt = (lv: number) => matches
    .filter((m) => roleInfo(m.role).tier === lv && (!roleInfo(m.role).fallback || catchAllNamed(m, matches)))
    .sort(byPct)[0] as RoleMatch | undefined;
  const reaches = (m: RoleMatch | undefined): m is RoleMatch => m != null && m.pct >= lines[roleInfo(m.role).tier];
  const top = levels.findIndex((lv) => reaches(bestAt(lv)));
  if (top < 0) {
    const middle = levels.slice(1, -1).map(bestAt).find((m) => m != null && m.pct >= NO_LEVEL_LINE);
    return [middle ?? bestAt(levels[levels.length - 1]) ?? matches.filter((m) => !roleInfo(m.role).fallback).sort(byPct)[0]];
  }
  if (top === 0) return [bestAt(levels[0])!];
  return levels.slice(top).map(bestAt).filter(reaches);
}

export function buildRoleFit(inp: FitInputs): RoleFit {
  const order = ROLES[inp.pos];
  const matches = order.map((info) => {
    const recipe = inp.recipes.find((r) => r.role === info.key);
    return recipe
      ? scoreBucket(recipe, inp.features, inp.heightIn, inp.weightLb)
      : { role: info.key, pct: 0, sizeDrop: 0, sizeNote: null, drivers: [], proven: true };
  });
  const lines = LEVELED[inp.pos];
  const [best, ...also] = lines ? pickByLevel(order, matches, lines) : pickByNearTie(order, matches);
  const skillOnly = !Object.values(inp.features).some((f) => f?.kind === "usage");
  const n = inp.sample.n;
  return {
    pos: inp.pos,
    best: best.role,
    also: also.map((m) => m.role),
    matches,
    versatile: isVersatile(inp.pos, matches),
    usedAs: skillOnly ? null : usedAsRole(inp.recipes, inp.features, order),
    confidence: n >= inp.confidenceAt.high ? "high" : n >= inp.confidenceAt.medium ? "medium" : "low",
    sample: inp.sample,
    skillOnly,
    features: inp.features,
  };
}

// ── Display helpers ──────────────────────────────────────────────────────

export function matchFor(fit: RoleFit, role: RoleKey): RoleMatch | undefined {
  return fit.matches.find((m) => m.role === role);
}

// A role's name, with "?" while it's unproven (e.g. an X without press tape).
const named = (fit: RoleFit, role: RoleKey) => `${roleInfo(role).label}${matchFor(fit, role)?.proven === false ? "?" : ""}`;

/** "X", "X / Y", "Zone / 2-Down / Goal-line", or "X?" for an unproven role. */
export function roleLabel(fit: RoleFit): string {
  return [fit.best, ...fit.also].map((r) => named(fit, r)).join(" / ");
}

const listOf = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0]);

/** One bucket's tooltip: what it means, its drivers, any size drop. */
export function matchTooltip(fit: RoleFit, role: RoleKey): string {
  const info = roleInfo(role);
  const m = matchFor(fit, role);
  if (!m) return info.description;
  const lines = [`${info.label} ${m.pct}%: ${info.description}`, ...m.drivers];
  if (m.sizeNote) lines.push(`Size: ${m.sizeNote} → −${Math.round(m.sizeDrop * 100)}%`);
  if (m.pendingWhy) lines.push(`Unproven: ${m.pendingWhy}`);
  return lines.join("\n");
}

const CONFIDENCE_LABEL: Record<RoleConfidence, string> = { high: "High", medium: "Medium", low: "Low" };
export const confidenceLabel = (c: RoleConfidence) => CONFIDENCE_LABEL[c];

/** The full tooltip: headline, every bucket's %, the headline's drivers. */
export function roleFitTooltip(fit: RoleFit): string {
  const best = matchFor(fit, fit.best)!;
  const also = fit.also.map((r) => named(fit, r));
  const head = LEVELED[fit.pos]
    ? noLevelReached(fit)
      ? `Best case: ${named(fit, fit.best)} (no role reaches its level's line${roleInfo(fit.best).tier < Math.max(...ROLES[fit.pos].map((r) => r.tier)) ? `; his best ${NO_LEVEL_LINE}%+ role above the last level` : ""})`
      : `Best case: ${named(fit, fit.best)}${also.length ? `, plus ${listOf(also)}` : ""}`
    : also.length
      ? `Best case: ${named(fit, fit.best)}, equally a ${also[0]}`
      : `Best case: ${named(fit, fit.best)}`;
  const all = [...fit.matches].sort((a, b) => b.pct - a.pct).map((m) => `${named(fit, m.role)} ${m.pct}%`).join(" · ");
  const lines = [head, all, ...best.drivers];
  if (best.sizeNote) lines.push(`Size: ${best.sizeNote} → −${Math.round(best.sizeDrop * 100)}%`);
  for (const m of fit.matches) if (m.pendingWhy && (m.role === fit.best || fit.also.includes(m.role))) lines.push(`${roleInfo(m.role).label}?: ${m.pendingWhy}`);
  if (fit.usedAs && fit.usedAs !== fit.best) lines.push(`Used as: ${roleInfo(fit.usedAs).label}`);
  if (fit.versatile) lines.push(`Versatile: ${versatileRuleText(fit.pos)}`);
  lines.push(`Confidence: ${confidenceLabel(fit.confidence)} (${fit.sample.n} ${fit.sample.unit})${fit.skillOnly ? " · skill only, no in-app alignment" : ""}`);
  return lines.join("\n");
}
