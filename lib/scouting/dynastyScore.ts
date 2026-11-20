// Dynasty Score and Dynasty Score Plus: the AE Score (on-field skill, in
// true-talent SDs; aeComposite.ts) plus what a dynasty manager adds on top.
//
//   Dynasty Score      = AE Score + age weight × career window + size weight × size flags
//                        + speed weight × an RB's speed floor (speedFloor.ts; off once his class is drafted)
//                        + light inside weight × an RB's light-inside-runner flag (lightInsideFlag.ts; halved once drafted)
//                        + rushing weight × a QB's rushing bonus (qbRushing.ts)
//                        + a QB's pre-draft discount (QB_PREDRAFT_SCALE; off once his class is drafted)
//   Dynasty Score Plus = Dynasty Score, less the QB pre-draft discount (his pick prices that in)
//                        + draft weight × draft capital (once a round is set)
//                        + landing weight × (rookie competition + vets ahead + path by year 2)
//                        + role weight × role standing
//                        + offense weight × (QB + pass/run offense)
//                          (the landing spot, 2027 classes on)
//
// The weights are the Big Board sliders (age 1, size 1, speed 1, light inside 1, rushing 1, draft 2, landing 1, role 1, offense 1 by default). The pieces below are
// from published research (the speed floor from past combine classes' NFL
// results), not fit on the user's charting: there are no NFL outcomes for
// these prospects to fit against. Each is scaled to sit alongside an AE Score
// that runs about ±1.5.
//
// Age is counted once, as career window. The "older players' college numbers
// are inflated" effect is real for volume stats (breakout age), but checked
// 2026-10-01 it doesn't show in AE: older prospects scored no higher (QB
// +0.07, WR −0.66, RB −3.1 pts per year, none clearly off 0), since AE already
// judges each rep against reps like it.

import { UNDRAFTED_ROUND } from "../draftRound";
import type { CompositePos } from "./aeComposite";
import type { RoleStanding } from "./roleStanding";
import { speedFlag, type FortyRun, type SpeedFlag } from "./speedFloor";
import { lightInsideFlag, type LightInsideFlag } from "./lightInsideFlag";
import type { RoleTag } from "./roleFit";
import type { TeamLanding } from "./teamLanding";

// ── Career window ──────────────────────────────────────────────────────────
// The age production starts to fall off, by position:
//   RB 28: peak 26, decline from 27-28 (Football Perspective, 723 RBs; 4for4
//          "prime through 28"; ESPN −8.4% at 27→28, −25% at 28→29).
//   WR 30: falloff begins at 29, steep at 32-33 (4for4).
//   TE 31: no regression until about 31 (4for4; ESPN "around 30").
//   QB 34: none of the sources measured QB aging. This is a judgment call that
//          reflects long QB primes.
// A rookie season at REFERENCE_ROOKIE_AGE has (prime end − 22) prime seasons
// ahead. The component is the share of that gained or lost: a 21-year-old RB
// (7 prime seasons vs a typical 6) gets +0.17, and a 25-year-old (3) gets −0.5.
export const PRIME_END_AGE: Record<CompositePos, number> = { RB: 28, WR: 30, TE: 31, QB: 34 };
export const REFERENCE_ROOKIE_AGE = 22;

export function careerWindowAdjustment(pos: CompositePos, rookieAge: number): number {
  const typical = PRIME_END_AGE[pos] - REFERENCE_ROOKIE_AGE;
  const left = Math.max(0, PRIME_END_AGE[pos] - rookieAge);
  return left / typical - 1;
}

// ── Size ───────────────────────────────────────────────────────────────────
// The Size slider reads "bigger counts for more": sliding it right lifts players
// carrying more weight on their frame and drops the lean, fragile ones. All of
// it is the user's call (2026-10-01).
//
// Frame (RB and WR): pounds per inch of height against the position's typical
// value (the charted pool's median on 2026-10-01): ±SIZE_PER_SD per pool SD,
// capped at ±SIZE_CAP. A back with more weight on the frame takes a bigger
// workload and lasts longer. The same 200 lb is sturdy on a 5'9" back and
// fragile on a 6'5" one, and a 6'3" 170 receiver breaks before a 5'10" 170.
// Pounds per inch sits between plain weight, which ignores frame, and BMI. BMI
// divides by height twice, so a big tall back like 6'1" 231 would read as
// average (~30.5); pounds per inch makes him 4th of 55. With no height on file,
// the position's typical height is assumed.
//
// Light WRs (under 175 lb) also lose WR_LIGHT_PENALTY on any frame. A 170-lb
// receiver is fragile either way, and more so on a tall frame, which the frame
// piece adds.
//
// The research is thinner than the intuition. RB weight correlates only weakly
// with carries and TDs (NBC Sports, RBs since 2000). A 103-RB study found no
// size difference between durable and non-durable backs (PMC5405788). WR size
// showed no significant effect on fantasy output across 360+ NFL seasons
// (Reception Perception, 2014-21). Speed for a given weight (Speed Score) is
// its own piece, an RB floor behind the Speed slider (speedFloor.ts).
export interface FrameNorm { lbPerIn: number; sd: number; heightIn: number }
export const FRAME_NORMS: Partial<Record<CompositePos, FrameNorm>> = {
  RB: { lbPerIn: 2.97, sd: 0.135, heightIn: 71 }, // ~210 lb at 5'11"
  WR: { lbPerIn: 2.71, sd: 0.142, heightIn: 73 }, // ~198 lb at 6'1"
};
export const SIZE_PER_SD = 0.1;
export const SIZE_CAP = 0.3;
export const WR_LIGHT_WEIGHT = 175;
export const WR_LIGHT_PENALTY = -0.2;

export interface SizeFlag { label: string; value: number }

const feetInches = (inches: number) => `${Math.floor(inches / 12)}'${inches % 12}"`;

export function sizeFlags(pos: CompositePos, heightIn: number | null, weightLb: number | null): SizeFlag[] {
  if (weightLb == null) return [];
  const flags: SizeFlag[] = [];
  const norm = FRAME_NORMS[pos];
  if (norm) {
    const lbPerIn = weightLb / (heightIn ?? norm.heightIn);
    const value = Math.max(-SIZE_CAP, Math.min(SIZE_CAP, ((lbPerIn - norm.lbPerIn) / norm.sd) * SIZE_PER_SD));
    if (Math.abs(value) >= 0.005) {
      const frame = heightIn != null ? `${feetInches(heightIn)} ${weightLb}` : `${weightLb} lb, height unknown`;
      const vs = `${frame}: ${lbPerIn.toFixed(2)} lb per inch vs a typical ${pos}'s ${norm.lbPerIn.toFixed(2)}`;
      flags.push({ label: value > 0 ? `heavy for the frame (${vs})` : `light for the frame (${vs})`, value });
    }
  }
  if (pos === "WR" && weightLb < WR_LIGHT_WEIGHT) {
    flags.push({ label: `under ${WR_LIGHT_WEIGHT} lb (${weightLb}): fragile on any frame`, value: WR_LIGHT_PENALTY });
  }
  return flags;
}

// ── Draft capital (Dynasty Score Plus) ─────────────────────────────────────
// Draft round = initial opportunity, and it's the strongest single predictor
// of a fantasy hit. Hit rates fall from 75% (RB round 1) and 55% (WR round 1,
// top-24) to under 5% by round 7 (Last Word on Sports RBs 2011-21; Dynasty
// Football Factory WRs 2011-24; Dynasty Nerds all positions 2015-25). A smooth
// RB+WR curve (65 / 42 / 25 / 12 / 8 / 5 / 4%, undrafted ~2%) taken to
// log-odds and mapped onto +1 (round 1) … −1 (undrafted). QB and TE first
// rounders hit even more often than this curve credits. WRs and TEs use it;
// RBs and QBs have their own (RB_DRAFT_CAPITAL, QB_DRAFT_CAPITAL below).
export const DRAFT_CAPITAL: Record<number, number> = {
  1: 1.0, 2: 0.6, 3: 0.25, 4: -0.15, 5: -0.35, 6: -0.6, 7: -0.7, [UNDRAFTED_ROUND]: -1.0,
};

// By pick, not just round (the user, 2026-11-10): pick 33 and pick 64 aren't the
// same investment. The research gives hit rates by round, so each round's value
// above sits at that round's middle pick, and in between the value runs in a
// straight line from one round's middle to the next. Each round still averages
// within about 0.02 of its table value (round 1 exactly), about what the table
// was rounded by. Middles are from recent drafts: rounds 1 and 2 are 32 picks,
// and comp picks stretch rounds 3 to 7 (2024: R3 65–100, R7 221–257; 2025: R3
// 65–102, R7 217–257). Before the 1st round's middle and after the 7th's, the
// end segments carry on: pick 1 ≈ +1.19, pick 32 ≈ +0.81, pick 257 = −0.75.
export const ROUND_MIDDLE_PICK: Record<number, number> = {
  1: 16.5, 2: 48.5, 3: 83, 4: 120, 5: 157, 6: 197, 7: 237,
};

const CAPITAL_ANCHORS: readonly [number, number][] = [1, 2, 3, 4, 5, 6, 7].map((r) => [ROUND_MIDDLE_PICK[r], DRAFT_CAPITAL[r]]);

// RBs fall off less after round 1 (the user, 2026-11-20: "While Round 1 running
// backs are just as strong as a Round 1 WR or TE they fall off less. Round
// 5-6-7 Running backs find starting roles all the time"). The user's numbers,
// not a fit: round 1 stays everyone's +1.0 and undrafted stays −1.0, while rounds
// 2–7 sit higher than the WR/TE table, most of all late (a 5th-round RB −0.2 vs
// −0.35, a 7th −0.4 vs −0.7). Published RB hit rates do run above WR's in every
// round, so the direction matches the research. WRs and TEs keep DRAFT_CAPITAL.
// The same straight lines between round middles apply, so pick 1 ≈ +1.16, pick
// 32 ≈ +0.84 (round 1 still averages +1.0) and pick 257 ≈ −0.45; going undrafted
// is a bigger drop from round 7 for an RB (−0.4 → −1.0) than for a WR (−0.7 → −1.0).
export const RB_DRAFT_CAPITAL: Record<number, number> = {
  1: 1.0, 2: 0.66, 3: 0.33, 4: 0, 5: -0.2, 6: -0.3, 7: -0.4, [UNDRAFTED_ROUND]: -1.0,
};

const RB_CAPITAL_ANCHORS: readonly [number, number][] = [1, 2, 3, 4, 5, 6, 7].map((r) => [ROUND_MIDDLE_PICK[r], RB_DRAFT_CAPITAL[r]]);

// QBs fall off faster after round 1 (the user, 2026-11-10: "QB's drafted after
// round 1 rarely" hit). The user's QB hit rates (multi-year starter, a second
// contract as a starter, or star level; 2016–22 classes): round 1 ~40–50%,
// round 2 ~15–20%, round 3 ~10–15%, rounds 4–7 ~3–5%. Taken to log-odds on the
// same scale as the RB/WR curve above, at each range's middle (17.5%, 12.5%,
// then 5 / 4 / 3.5 / 3% across rounds 4–7): round 2 +0.04, round 3 −0.14,
// round 4 −0.58, round 5 −0.68, round 6 −0.75, round 7 −0.82, rounded to the
// table's 0.05. So a 2nd-round QB hits about as often as a 3rd/4th-round RB or
// WR, and a 4th-rounder about as often as a 7th.
//
// The user's check: a 4th-round QB they like (Drake Lindsey at pick 109 in the
// 2027 mock) belongs in the middle to late 3rd round of a rookie draft, not the
// 2nd; this puts him about 31st. Round 1 isn't in this table: it goes by slot
// (QB_SLOT_RATES below).
export const QB_DRAFT_CAPITAL: Record<number, number> = {
  2: 0.05, 3: -0.15, 4: -0.6, 5: -0.7, 6: -0.75, 7: -0.8, [UNDRAFTED_ROUND]: -1.0,
};

// Inside round 1 a QB's value tapers by slot (the user, 2026-11-18, with a table
// of QBs who started 8+ years, 2000s drafts): picks 1–5 ~35–40%, 6–10 ~25–30%,
// 11–15 ~20–25%, 16–32 ~10–15%, round 2 ~8–12%. Until then round 1 was
// everyone's through pick 32. Starting 8+ years is a stricter bar than the
// RB/WR curve's (a top-24 season), so only the table's shape is used, not its
// level: picks 1–5 keep everyone's value, round 2's middle keeps
// QB_DRAFT_CAPITAL's, and each slot in between sits at its middle pick where
// its rate falls between those two on log-odds: 6–10 ≈ +0.87 (pick 8), 11–15
// ≈ +0.69 (pick 13), 16–32 ≈ +0.22 (pick 24). So a late first-round QB is
// valued near a 2nd-rounder: NFL teams pay a premium to take QBs early, so
// pick 24 says less about a QB than about a WR. On the user's 2027 test board
// (consensus big board as the draft, 2026-11-18) the Dynasty+ top 12 went from
// 5 QBs to 4 and the top 24 from 8 to 6, and Carr at pick 6 kept most of his
// first-round value (−0.16 at the Draft slider's 2×), as the user wanted.
/** The last pick through which a QB's capital is everyone's. */
export const QB_FULL_CAPITAL_LAST = 5;
/** The user's 8+ year starter rates by round-1 slot (each range's middle), first slot = picks 1–5. */
export const QB_SLOT_RATES: readonly { first: number; last: number; rate: number }[] = [
  { first: 1, last: 5, rate: 0.375 },
  { first: 6, last: 10, rate: 0.275 },
  { first: 11, last: 15, rate: 0.225 },
  { first: 16, last: 32, rate: 0.125 },
];
/** Round 2's rate on the same table, the bottom of the taper. */
export const QB_ROUND2_RATE = 0.1;

function anchorValue(a: readonly [number, number][], pick: number): number {
  let i = 0;
  while (i < a.length - 2 && pick > a[i + 1][0]) i++;
  const [x0, y0] = a[i];
  const [x1, y1] = a[i + 1];
  return y0 + ((pick - x0) * (y1 - y0)) / (x1 - x0);
}

const logit = (p: number) => Math.log(p / (1 - p));
const slotMiddle = (s: { first: number; last: number }) => (s.first + s.last) / 2;

/** A round-1 QB slot's value: where its rate falls between picks 1–5 (everyone's) and round 2 (QB table), on log-odds. */
export function qbSlotValue(rate: number): number {
  const topSlot = QB_SLOT_RATES[0];
  const top = anchorValue(CAPITAL_ANCHORS, slotMiddle(topSlot));
  const share = (logit(topSlot.rate) - logit(rate)) / (logit(topSlot.rate) - logit(QB_ROUND2_RATE));
  return top - share * (top - QB_DRAFT_CAPITAL[2]);
}

const QB_CAPITAL_ANCHORS: readonly [number, number][] = [
  [1, anchorValue(CAPITAL_ANCHORS, 1)],
  [QB_FULL_CAPITAL_LAST, anchorValue(CAPITAL_ANCHORS, QB_FULL_CAPITAL_LAST)],
  ...QB_SLOT_RATES.slice(1).map((s): [number, number] => [slotMiddle(s), qbSlotValue(s.rate)]),
  ...[2, 3, 4, 5, 6, 7].map((r): [number, number] => [ROUND_MIDDLE_PICK[r], QB_DRAFT_CAPITAL[r]]),
];

/**
 * Draft capital at an overall pick (1 = first pick), on the round table's scale;
 * a QB's falls faster from pick 6 (QB_SLOT_RATES), an RB's slower after round 1
 * (RB_DRAFT_CAPITAL).
 */
export function draftCapitalForPick(pick: number, pos?: string | null): number {
  const anchors = pos === "QB" ? QB_CAPITAL_ANCHORS : pos === "RB" ? RB_CAPITAL_ANCHORS : CAPITAL_ANCHORS;
  const v = anchorValue(anchors, pick);
  // Never below going undrafted.
  return Math.max(DRAFT_CAPITAL[UNDRAFTED_ROUND], v);
}

/** 2025's round lines (comp picks stretch rounds 3 to 7), for a QB's round average. */
export const ROUND_PICKS: Record<number, readonly [number, number]> = {
  1: [1, 32], 2: [33, 64], 3: [65, 102], 4: [103, 138], 5: [139, 176], 6: [177, 216], 7: [217, 257],
};

/**
 * A QB's average capital over a round, for a round with no pick set. (The
 * RB/WR table's values are their rounds' averages already, within 0.025; a
 * QB's rounds 1 and 2 aren't: round 1 tapers by slot, and the taper's last
 * stretch runs into round 2.)
 */
export function qbRoundAverage(round: number): number | null {
  const range = ROUND_PICKS[round];
  if (!range) return null;
  let s = 0;
  for (let p = range[0]; p <= range[1]; p++) s += draftCapitalForPick(p, "QB");
  return s / (range[1] - range[0] + 1);
}

/**
 * Draft capital for Dynasty+: by overall pick when one is set, else the round's
 * average. Undrafted is −1 whatever the pick (the Rookie Draft Hub writes an
 * undrafted rookie as pick 300). Null before a round is set. A QB's falls
 * faster from pick 6 (QB_SLOT_RATES, QB_DRAFT_CAPITAL), an RB's slower after
 * round 1 (RB_DRAFT_CAPITAL; its values are its rounds' averages, within 0.015).
 */
export function draftCapitalAt(round: number | null, pick: number | null, pos?: string | null): number | null {
  if (round == null) return null;
  if (round === UNDRAFTED_ROUND) return DRAFT_CAPITAL[UNDRAFTED_ROUND];
  if (pick != null && pick >= 1) return draftCapitalForPick(pick, pos);
  if (pos === "QB") return qbRoundAverage(round);
  if (pos === "RB") return RB_DRAFT_CAPITAL[round] ?? null;
  return DRAFT_CAPITAL[round] ?? null;
}

// ── Landing spot (Dynasty Score Plus) ──────────────────────────────────────
// What his NFL team's room does to his early opportunity, on top of draft
// capital (the user's plan, 2026-11-10). Only classes from LANDING_FIRST_CLASS:
// the 2026 class was charted differently (mostly imports) and its draft is
// past, so it's left out (the user's call). It never fades: a class locks at
// its draft.
//
// Rookie competition is its first piece: players at his position his team
// drafted AHEAD of him; for a WR, Move TEs too ("Move TE's should definitly
// count against WR's", the user), and for a Move TE, WRs (the user: yes, both
// ways). A teammate taken after him costs
// nothing, since the team invested more in him. Each one ahead costs up to
// COMPETITION_PER_PLAYER, scaled by how much more draft capital he got (the
// full cost at a gap of COMPETITION_FULL_GAP, about two rounds), and the total
// is capped at COMPETITION_CAP. A 6th-rounder whose team also took his position
// in rounds 2 and 3 (picks 50 and 85, him at 190) loses about 0.36.
export const LANDING_FIRST_CLASS = 2027;
export const COMPETITION_PER_PLAYER = 0.2;
export const COMPETITION_FULL_GAP = 1.0;
export const COMPETITION_CAP = 0.4;

export interface Competitor {
  name: string;
  position: CompositePos;
  overall: number;
  round: number;
  /** A TE counted against a WR as a Move TE. (A WR counted against a Move TE is plain "WR".) */
  moveTe: boolean;
}
export interface CompetitionResult {
  /** ≤ 0. */
  value: number;
  competitors: (Competitor & { cost: number })[];
}

/** The rookie-competition piece for a player with `myCapital`, from the teammates drafted ahead of him. */
export function rookieCompetition(myCapital: number, competitors: readonly Competitor[]): CompetitionResult {
  let sum = 0;
  const out = competitors.map((c) => {
    // Each on his own position's curve (a QB behind a QB: both on the QB curve).
    const gap = Math.max(0, draftCapitalForPick(c.overall, c.position) - myCapital);
    const cost = COMPETITION_PER_PLAYER * Math.min(1, gap / COMPETITION_FULL_GAP);
    sum += cost;
    return { ...c, cost };
  });
  return { value: -Math.min(COMPETITION_CAP, sum), competitors: out };
}

// Role standing is its second piece (roleStanding.ts): where he ranks at the
// role he'll play among his class's players at that role, ±ROLE_STANDING_MAX,
// behind its own Role slider.
//
// The team inputs are the rest (teamLanding.ts): the established veterans
// ahead of him and his path by year 2 go with rookie competition behind the
// Landing slider; his QB and the pass/run offense behind the Offense slider.
// Each is the user's entry, else a suggestion from his saved PFF room.

/** Landing-spot inputs for one drafted prospect (lib/scouting/landingSpot.ts). */
export interface LandingInputs {
  /** His team's same-position picks (and Move TEs, for a WR) ahead of him; null when they can't be known yet. */
  competitors: Competitor[] | null;
  /** Why competitors is null ("load the 2027 draft results…"). */
  note?: string;
  /** His role standing; null without a role (no role fit yet). */
  standing?: RoleStanding | null;
  /** His team inputs (vets ahead, path, QB, offense); null off QB/RB/WR/TE. */
  team?: TeamLanding | null;
}

export interface LandingBreakdown {
  /** Rookie competition, before the Landing weight; null when it can't be known yet. */
  competition: CompetitionResult | null;
  note?: string;
  /** Role standing, before the Role weight; null without a role. */
  standing: RoleStanding | null;
  /** The team inputs, each value before its slider; null off QB/RB/WR/TE. */
  team: TeamLanding | null;
}

// ── Weights (the Big Board sliders) ────────────────────────────────────────
export interface DynastyWeights { age: number; size: number; speed: number; lightInside: number; draft: number; landing: number; role: number; offense: number; rushing: number }
// Draft defaults to 2 (the user's call, 2026-10-01): at 2× a 1st-rounder gets
// +2.0 and an undrafted rookie −2.0, so draft capital, the strongest single
// predictor of a fantasy hit, carries more than the AE Score's ±1.5 spread.
// Landing defaults to 1: rookie competition reaches −0.4 at most, well under
// draft capital's swing, since teams make room for players they spent picks on.
// Role defaults to 1: role standing reaches ±0.25 at most, since it partly
// re-reads the skill the AE Score already counts.
// Offense defaults to 1: his QB and the pass/run lean reach ±0.3 together.
// Rushing defaults to 1: a QB's rushing bonus reaches +0.3, gated by his passing (qbRushing.ts).
// Speed defaults to 1: an RB under the Speed Score floor loses up to 0.7, about
// a round of draft capital at the Draft slider's 2× (speedFloor.ts), until his
// class is drafted.
// Light Inside defaults to 1: an RB with the Inside tag on a light frame loses
// up to 0.5, 0.25 once his class is drafted (lightInsideFlag.ts).
export const DEFAULT_DYNASTY_WEIGHTS: DynastyWeights = { age: 1, size: 1, speed: 1, lightInside: 1, draft: 2, landing: 1, role: 1, offense: 1, rushing: 1 };

// ── QB pre-draft discount ──────────────────────────────────────────────────
// Before the draft a QB's Dynasty Score counts 80% of his AE Score (the user,
// 2026-11-18). The AE Score puts every position on its own footing, so the
// board read the kth-best QB as worth the kth-best WR, and the 2027 top 12
// carried 4 QBs. A QB's dynasty value swings far more on where he's picked:
// inside round 1 his capital falls from everyone's at pick 5 to near a
// 2nd-rounder's by pick 24 (QB_SLOT_RATES). Before the pick is known, trusting
// his college edge 20% less stands in for that: the top QBs lose 0.20–0.33,
// middling ones barely move, and below-average ones come up a little toward 0.
// On the 2027 board the top 12 went from 4 QBs to 3 and the top 36 kept 7.
// Off once his class is drafted (like the RB speed floor), and never in
// Dynasty+, where his pick takes over, so it can't stack with the QB curve.
// No slider: a fixed call, not a weight.
export const QB_PREDRAFT_SCALE = 0.8;

/** A QB's pre-draft discount, (scale − 1) × his AE Score; null off QB, once his class is drafted, or at 0. */
export function qbPredraftDiscount(pos: CompositePos, aeScore: number, classDrafted: boolean): { value: number; label: string } | null {
  if (pos !== "QB" || classDrafted) return null;
  const value = (QB_PREDRAFT_SCALE - 1) * aeScore;
  if (value === 0) return null;
  return {
    value,
    label: `before the draft ${Math.round(QB_PREDRAFT_SCALE * 100)}% of a QB's AE Score counts (his value swings most on his pick; Dynasty+ uses the pick instead)`,
  };
}
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 3;
export const WEIGHT_STEP = 0.25;

export interface DynastyInputs {
  pos: CompositePos;
  aeScore: number;
  /** Rookie-season age, and whether it's estimated from the HS class. Null if unknown. */
  rookieAge: { years: number; estimated: boolean } | null;
  heightIn: number | null;
  weightLb: number | null;
  /** His 40, where he ran it and his weigh-in there; null or absent without one. Only an RB's counts (speedFloor.ts). */
  forty?: FortyRun | null;
  /** His class has been drafted (scoreLock.ts classDraftedBy): the speed floor is off from then, the light-inside flag halved. */
  classDrafted?: boolean;
  /** An RB's Inside / Outside tag (roleFitRB.ts runSideTag), for the light-inside flag; absent without one. */
  runSideTag?: RoleTag | null;
  /** His weigh-in (prospects.forty_weight), over `weightLb` for the light-inside flag; absent without one. */
  weighInLb?: number | null;
  /** 1–7, UNDRAFTED_ROUND, or null before the draft. */
  draftRound: number | null;
  /** Overall pick (1 = first), or null when only the round is known. */
  draftPick: number | null;
  /** Landing-spot inputs; absent for classes before LANDING_FIRST_CLASS and before the draft. */
  landing?: LandingInputs | null;
  /** A QB's rushing bonus before the Rushing slider (qbRushing.ts); absent off QB or under the median. */
  rushing?: { value: number; label: string } | null;
}

export interface DynastyBreakdown {
  aeScore: number;
  rookieAge: { years: number; estimated: boolean } | null;
  /** Career-window share before the age weight; null when the age is unknown. */
  window: number | null;
  flags: SizeFlag[];
  /** An RB's speed floor before the Speed slider; null off RB or without a 40. */
  speed: SpeedFlag | null;
  /** An RB's light-inside-runner red flag before the Light Inside slider; null when it doesn't apply. */
  lightInside: LightInsideFlag | null;
  /** A QB's rushing bonus before the Rushing slider; null without one. */
  rushing: { value: number; label: string } | null;
  /** A QB's pre-draft discount, already in `dynasty` and backed out of `plus` (no slider); null when it doesn't apply. */
  qbDiscount: { value: number; label: string } | null;
  dynasty: number;
  /** Before the draft weight; null when no round is set. */
  draftCapital: number | null;
  /** Null until a round is set. */
  plus: number | null;
  /** The landing-spot piece of Plus, before its weight; absent when it doesn't apply. */
  landing?: LandingBreakdown | null;
}

export function scoreDynasty(inp: DynastyInputs, w: DynastyWeights): DynastyBreakdown {
  const window = inp.rookieAge ? careerWindowAdjustment(inp.pos, inp.rookieAge.years) : null;
  const flags = sizeFlags(inp.pos, inp.heightIn, inp.weightLb);
  const size = flags.reduce((s, f) => s + f.value, 0);
  const speed = speedFlag(inp.pos, inp.forty, inp.weightLb, inp.classDrafted ?? false);
  const lightInside = lightInsideFlag({
    pos: inp.pos, runSideTag: inp.runSideTag, heightIn: inp.heightIn, bioWeightLb: inp.weightLb,
    weighInLb: inp.weighInLb, classDrafted: inp.classDrafted ?? false,
  });
  const rushing = inp.pos === "QB" ? inp.rushing ?? null : null;
  const qbDiscount = qbPredraftDiscount(inp.pos, inp.aeScore, inp.classDrafted ?? false);
  const dynasty = inp.aeScore + w.age * (window ?? 0) + w.size * size + (w.speed ?? 0) * (speed?.value ?? 0)
    + (w.lightInside ?? 0) * (lightInside?.value ?? 0)
    + (w.rushing ?? 0) * (rushing?.value ?? 0) + (qbDiscount?.value ?? 0);
  const draftCapital = draftCapitalAt(inp.draftRound, inp.draftPick, inp.pos);
  let landing: LandingBreakdown | null = null;
  if (inp.landing && draftCapital != null) {
    const competition = inp.landing.competitors ? rookieCompetition(draftCapital, inp.landing.competitors) : null;
    landing = {
      competition, standing: inp.landing.standing ?? null, team: inp.landing.team ?? null,
      ...(inp.landing.note ? { note: inp.landing.note } : {}),
    };
  }
  return {
    aeScore: inp.aeScore,
    rookieAge: inp.rookieAge,
    window,
    flags,
    speed,
    lightInside,
    rushing,
    qbDiscount,
    dynasty,
    draftCapital,
    // The QB discount stands in for an unknown pick, so Dynasty+ (which has the pick) backs it out.
    plus: draftCapital != null ? dynasty - (qbDiscount?.value ?? 0) + w.draft * draftCapital + landingTotal(landing, w) : null,
    landing,
  };
}

/** The landing spot's share of Dynasty+ at the slider weights: rookie competition, role standing and the team inputs. */
export function landingTotal(landing: LandingBreakdown | null | undefined, w: Pick<DynastyWeights, "landing" | "role" | "offense">): number {
  if (!landing) return 0;
  const t = landing.team?.values;
  return w.landing * ((landing.competition?.value ?? 0) + (t?.pecking ?? 0) + (t?.path ?? 0))
    + w.role * (landing.standing?.value ?? 0)
    + w.offense * ((t?.qb ?? 0) + (t?.offense ?? 0));
}
