// Dynasty Score and Dynasty Score Plus: the AE Score (on-field skill, in
// true-talent SDs; aeComposite.ts) plus what a dynasty manager adds on top.
//
//   Dynasty Score      = AE Score + age weight × career window + size weight × size flags
//   Dynasty Score Plus = Dynasty Score + draft weight × draft capital (once a round is set)
//                        + landing weight × (rookie competition + vets ahead + path by year 2)
//                        + role weight × role standing
//                        + offense weight × (QB + pass/run offense)
//                          (the landing spot, 2027 classes on)
//
// The weights are the Big Board sliders (age 1, size 1, draft 2, landing 1, role 1, offense 1 by default). The pieces below are
// from published research, not fit on the user's charting: there are no NFL
// outcomes for these prospects to fit against. Each is scaled to sit
// alongside an AE Score that runs about ±1.5.
//
// Age is counted once, as career window. The "older players' college numbers
// are inflated" effect is real for volume stats (breakout age), but checked
// 2026-10-01 it doesn't show in AE: older prospects scored no higher (QB
// +0.07, WR −0.66, RB −3.1 pts per year, none clearly off 0), since AE already
// judges each rep against reps like it.

import { UNDRAFTED_ROUND } from "../draftRound";
import type { CompositePos } from "./aeComposite";
import type { RoleStanding } from "./roleStanding";
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
// (Reception Perception, 2014-21). Speed for a given weight (Speed Score) would
// matter more, but there are no 40 times.
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
// rounders hit even more often than this curve credits.
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
// Round 1 stays as it is for every position, through its last pick (the user:
// "I'd be more willing to gamble on Carr with the first round value"; a
// first-round QB hits at least as often as the RB/WR curve credits, top picks
// more). The cliff comes after it: from pick 32 down to the 2nd round's middle.
// The user's check: a 4th-round QB they like (Drake Lindsey at pick 109 in the
// 2027 mock) belongs in the middle to late 3rd round of a rookie draft, not the
// 2nd; this puts him about 31st.
export const QB_DRAFT_CAPITAL: Record<number, number> = {
  1: 1.0, 2: 0.05, 3: -0.15, 4: -0.6, 5: -0.7, 6: -0.75, 7: -0.8, [UNDRAFTED_ROUND]: -1.0,
};
/** Round 1's last pick, through which a QB's capital is everyone's. */
export const QB_ROUND1_LAST = 32;

function anchorValue(a: readonly [number, number][], pick: number): number {
  let i = 0;
  while (i < a.length - 2 && pick > a[i + 1][0]) i++;
  const [x0, y0] = a[i];
  const [x1, y1] = a[i + 1];
  return y0 + ((pick - x0) * (y1 - y0)) / (x1 - x0);
}

const QB_CAPITAL_ANCHORS: readonly [number, number][] = [
  [ROUND_MIDDLE_PICK[1], QB_DRAFT_CAPITAL[1]],
  [QB_ROUND1_LAST, anchorValue(CAPITAL_ANCHORS, QB_ROUND1_LAST)],
  ...[2, 3, 4, 5, 6, 7].map((r): [number, number] => [ROUND_MIDDLE_PICK[r], QB_DRAFT_CAPITAL[r]]),
];

/** Draft capital at an overall pick (1 = first pick), on the round table's scale; a QB's falls faster after round 1. */
export function draftCapitalForPick(pick: number, pos?: string | null): number {
  const v = anchorValue(pos === "QB" ? QB_CAPITAL_ANCHORS : CAPITAL_ANCHORS, pick);
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
 * QB's round 2 isn't, since the cliff after round 1 runs into it.)
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
 * faster after round 1 (QB_DRAFT_CAPITAL).
 */
export function draftCapitalAt(round: number | null, pick: number | null, pos?: string | null): number | null {
  if (round == null) return null;
  if (round === UNDRAFTED_ROUND) return DRAFT_CAPITAL[UNDRAFTED_ROUND];
  if (pick != null && pick >= 1) return draftCapitalForPick(pick, pos);
  if (pos === "QB") return qbRoundAverage(round);
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
export interface DynastyWeights { age: number; size: number; draft: number; landing: number; role: number; offense: number; rushing: number }
// Draft defaults to 2 (the user's call, 2026-10-01): at 2× a 1st-rounder gets
// +2.0 and an undrafted rookie −2.0, so draft capital, the strongest single
// predictor of a fantasy hit, carries more than the AE Score's ±1.5 spread.
// Landing defaults to 1: rookie competition reaches −0.4 at most, well under
// draft capital's swing, since teams make room for players they spent picks on.
// Role defaults to 1: role standing reaches ±0.25 at most, since it partly
// re-reads the skill the AE Score already counts.
// Offense defaults to 1: his QB and the pass/run lean reach ±0.3 together.
// Rushing defaults to 1: a QB's rushing bonus reaches +0.3, gated by his passing (qbRushing.ts).
export const DEFAULT_DYNASTY_WEIGHTS: DynastyWeights = { age: 1, size: 1, draft: 2, landing: 1, role: 1, offense: 1, rushing: 1 };
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
  /** A QB's rushing bonus before the Rushing slider; null without one. */
  rushing: { value: number; label: string } | null;
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
  const rushing = inp.pos === "QB" ? inp.rushing ?? null : null;
  const dynasty = inp.aeScore + w.age * (window ?? 0) + w.size * size + (w.rushing ?? 0) * (rushing?.value ?? 0);
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
    rushing,
    dynasty,
    draftCapital,
    plus: draftCapital != null ? dynasty + w.draft * draftCapital + landingTotal(landing, w) : null,
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
