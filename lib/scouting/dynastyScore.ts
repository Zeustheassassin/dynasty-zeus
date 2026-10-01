// Dynasty Score and Dynasty Score Plus: the AE Score (on-field skill, in
// true-talent SDs; aeComposite.ts) plus what a dynasty manager adds on top.
//
//   Dynasty Score      = AE Score + age weight × career window + size weight × size flags
//   Dynasty Score Plus = Dynasty Score + draft weight × draft capital (once a round is set)
//
// The weights are the Big Board sliders (age 1, size 1, draft 2 by default). The pieces below are
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

// ── Weights (the Big Board sliders) ────────────────────────────────────────
export interface DynastyWeights { age: number; size: number; draft: number }
// Draft defaults to 2 (the user's call, 2026-10-01): at 2× a 1st-rounder gets
// +2.0 and an undrafted rookie −2.0, so draft capital, the strongest single
// predictor of a fantasy hit, carries more than the AE Score's ±1.5 spread.
export const DEFAULT_DYNASTY_WEIGHTS: DynastyWeights = { age: 1, size: 1, draft: 2 };
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
