// Dynasty Score and Dynasty Score Plus: the AE Score (on-field skill, in
// true-talent SDs; aeComposite.ts) plus what a dynasty manager adds on top.
//
//   Dynasty Score      = AE Score + age weight × career window + size weight × size flags
//   Dynasty Score Plus = Dynasty Score + draft weight × draft capital (once a round is set)
//
// The weights are the Big Board sliders (default 1 each). The pieces below are
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

// ── Size flags ─────────────────────────────────────────────────────────────
// Penalties only at the extremes, since the research doesn't support a linear
// "bigger is better":
//   - RBs: weight correlates only weakly with carries and TDs, and heavier
//     backs are clearly LESS efficient per carry. The tallest quarter (6'1"+)
//     averaged under 4.0 YPC (NBC Sports, RBs since 2000). A 103-RB study found
//     no height, weight or BMI difference between durable and non-durable
//     backs (PMC5405788).
//   - WRs: no significant size effect on fantasy output across 360+ NFL seasons
//     (Reception Perception, 2014-21). Very light receivers remain rare hits.
// What does matter is speed for a given weight (Speed Score), and there are no
// 40 times to compute it.
export const SIZE_FLAG_PENALTY = -0.2;

export interface SizeFlag { label: string; value: number }

export function sizeFlags(pos: CompositePos, heightIn: number | null, weightLb: number | null): SizeFlag[] {
  const flags: SizeFlag[] = [];
  if (pos === "RB") {
    if (weightLb != null && weightLb < 200) flags.push({ label: `light for an RB (${weightLb} lb, under 200): workload risk`, value: SIZE_FLAG_PENALTY });
    if (heightIn != null && heightIn >= 73) flags.push({ label: `tall for an RB (6'1"+): the least efficient group per carry`, value: SIZE_FLAG_PENALTY });
  } else if (pos === "WR") {
    if (weightLb != null && weightLb < 175) flags.push({ label: `very light for a WR (${weightLb} lb, under 175)`, value: SIZE_FLAG_PENALTY });
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

// ── Weights (the Big Board sliders) ────────────────────────────────────────
export interface DynastyWeights { age: number; size: number; draft: number }
export const DEFAULT_DYNASTY_WEIGHTS: DynastyWeights = { age: 1, size: 1, draft: 1 };
export const WEIGHT_MIN = 0;
export const WEIGHT_MAX = 2;
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
}

export interface DynastyBreakdown {
  aeScore: number;
  rookieAge: { years: number; estimated: boolean } | null;
  /** Career-window share before the age weight; null when the age is unknown. */
  window: number | null;
  flags: SizeFlag[];
  dynasty: number;
  /** Before the draft weight; null when no round is set. */
  draftCapital: number | null;
  /** Null until a round is set. */
  plus: number | null;
}

export function scoreDynasty(inp: DynastyInputs, w: DynastyWeights): DynastyBreakdown {
  const window = inp.rookieAge ? careerWindowAdjustment(inp.pos, inp.rookieAge.years) : null;
  const flags = sizeFlags(inp.pos, inp.heightIn, inp.weightLb);
  const size = flags.reduce((s, f) => s + f.value, 0);
  const dynasty = inp.aeScore + w.age * (window ?? 0) + w.size * size;
  const draftCapital = inp.draftRound != null ? DRAFT_CAPITAL[inp.draftRound] ?? null : null;
  return {
    aeScore: inp.aeScore,
    rookieAge: inp.rookieAge,
    window,
    flags,
    dynasty,
    draftCapital,
    plus: draftCapital != null ? dynasty + w.draft * draftCapital : null,
  };
}
