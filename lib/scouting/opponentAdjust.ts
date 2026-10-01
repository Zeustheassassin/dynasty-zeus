// Opponent strength for the AE Score, Dynasty Score and Dynasty Score Plus
// (never the AE columns, by the user's call 2026-10-01). A rep against a G5 or
// FCS opponent is easier than one against a P4 opponent, so a prospect whose
// charted games came against weaker competition has the expected lift taken
// back out of the AE before it's shrunk and standardized.
//
// How much easier is measured within players, not across them: for each
// prospect charted against both P4 and a lower tier, compare that player's
// residuals (actual − expected) by tier, then average over those prospects.
// A pooled comparison would mostly compare G5 players with P4 players. Measured
// that way on 2026-10-01 data, QB and RB came out the wrong way round, with
// weaker opponents looking HARDER, because the reps against them mostly came
// from weaker players.
//
// Guards, since few charted games are against weaker opponents:
//   - a tier's effect is only measured once MIN_PROSPECTS prospects have
//     MIN_P4_REPS P4 reps and MIN_TIER_REPS reps against it;
//   - it's shrunk toward 0 by SHRINK_REPS pseudo-reps;
//   - it's never negative (weaker competition is never harder), and FCS is at
//     least as easy as G5.
// On 2026-10-01: WR G5 measured +2.8 pts within players (19 prospects, 803
// reps), about +2.4 after shrinking. WR FCS was 5 prospects and noise, so it
// takes G5's value. QB had 1 prospect, RB 2.
//
// Per position, by the user's judgment where the data is thin:
//   - QB: none. Accuracy isn't expected to depend on the opponent's level.
//   - WR (cSAE, SAE): its own measurement.
//   - TE (TE-SAER, TE-SAEB): its own once measurable, else WR's (cSAE).
//   - RB (SRAE): its own once measurable, else half of WR's. The user expects
//     a minor effect next to WR and TE.

import type { AESample } from "../types";
import type { OpponentTier } from "./opponentTier";

export const MIN_PROSPECTS = 5;
export const MIN_P4_REPS = 10;
export const MIN_TIER_REPS = 5;
export const SHRINK_REPS = 200;
export const RB_SHARE_OF_WR = 0.5;

type LowerTier = Exclude<OpponentTier, "P4">;
const LOWER_TIERS: readonly LowerTier[] = ["G5", "FCS"];

/** How much easier a rep is against each lower tier than against P4, as a fraction. */
export type TierEffects = Record<LowerTier, number>;
export const NO_EFFECT: TierEffects = { G5: 0, FCS: 0 };

export interface TierMeasurement {
  /** Shrunk, non-negative; null when too few prospects to measure. */
  effect: number | null;
  prospects: number;
  reps: number;
}

/** Within-player effect of each lower tier, from samples carrying byTier. */
export function measureTierEffects(samples: Iterable<AESample | null>): Record<LowerTier, TierMeasurement> {
  const list = [...samples].filter((s): s is AESample => !!s?.byTier);
  const out = {} as Record<LowerTier, TierMeasurement>;
  for (const tier of LOWER_TIERS) {
    let sw = 0, swd = 0, prospects = 0, reps = 0;
    for (const s of list) {
      const p4 = s.byTier!.P4, t = s.byTier![tier];
      if (!p4 || !t || p4.n < MIN_P4_REPS || t.n < MIN_TIER_REPS) continue;
      const d = t.resid / t.n - p4.resid / p4.n;
      const w = (p4.n * t.n) / (p4.n + t.n);
      sw += w; swd += w * d; prospects++; reps += t.n;
    }
    out[tier] = { effect: prospects >= MIN_PROSPECTS ? Math.max(0, swd / (sw + SHRINK_REPS)) : null, prospects, reps };
  }
  return out;
}

/** Fill unmeasured tiers and keep FCS at least as easy as G5. */
export function resolveEffects(m: Record<LowerTier, TierMeasurement>, fallback: TierEffects = NO_EFFECT): TierEffects {
  const g5 = m.G5.effect ?? fallback.G5;
  const fcs = m.FCS.effect ?? fallback.FCS;
  return { G5: g5, FCS: Math.max(fcs, g5) };
}

/** The AE minus the opponent lift, over all the prospect's plays (unrecognized opponents count as 0). */
export function adjustSample(s: AESample | null, effects: TierEffects): AESample | null {
  if (!s || !s.byTier) return s;
  let lift = 0;
  for (const tier of LOWER_TIERS) lift += (s.byTier[tier]?.n ?? 0) * effects[tier];
  const adj = (lift / s.n) * 100;
  if (adj === 0) return s;
  return { ...s, ae: s.ae - adj, rawAe: s.ae };
}

export function adjustAll(samples: Map<string, AESample | null>, effects: TierEffects): Map<string, AESample | null> {
  return new Map([...samples].map(([id, s]) => [id, adjustSample(s, effects)]));
}

const scaled = (e: TierEffects, k: number): TierEffects => ({ G5: e.G5 * k, FCS: e.FCS * k });

export interface OpponentInputs {
  rb: Map<string, AESample | null>;
  wr: Map<string, AESample | null>;
  wrCore: Map<string, AESample | null>;
  teRoute: Map<string, AESample | null>;
  teBlock: Map<string, AESample | null>;
}

export type EffectSource = "measured" | "from WR" | "half of WR" | "none";
export interface PositionEffect {
  effects: TierEffects;
  source: EffectSource;
  /** Prospects behind the G5 measurement (charted against both P4 and G5). */
  prospects: number;
}

export interface OpponentAdjusted extends OpponentInputs {
  effects: { RB: PositionEffect; WR: PositionEffect; TE: PositionEffect };
}

const sourceOf = (m: Record<LowerTier, TierMeasurement>, borrowed: EffectSource): EffectSource =>
  m.G5.effect != null || m.FCS.effect != null ? "measured" : borrowed;

/** Applies the per-position policy above. QB isn't passed in: it's never adjusted. */
export function applyOpponentStrength(inp: OpponentInputs): OpponentAdjusted {
  const wrCoreM = measureTierEffects(inp.wrCore.values());
  const wrCoreE = resolveEffects(wrCoreM);
  const wrAllE = resolveEffects(measureTierEffects(inp.wr.values()));
  const teRouteM = measureTierEffects(inp.teRoute.values());
  const teBlockM = measureTierEffects(inp.teBlock.values());
  const rbM = measureTierEffects(inp.rb.values());
  const teRouteE = resolveEffects(teRouteM, wrCoreE);
  const teBlockE = resolveEffects(teBlockM, wrCoreE);
  const rbE = resolveEffects(rbM, scaled(wrCoreE, RB_SHARE_OF_WR));
  const wrMeasured = sourceOf(wrCoreM, "none");
  return {
    wrCore: adjustAll(inp.wrCore, wrCoreE),
    wr: adjustAll(inp.wr, wrAllE),
    teRoute: adjustAll(inp.teRoute, teRouteE),
    teBlock: adjustAll(inp.teBlock, teBlockE),
    rb: adjustAll(inp.rb, rbE),
    effects: {
      WR: { effects: wrCoreE, source: wrMeasured, prospects: wrCoreM.G5.prospects },
      TE: { effects: teRouteE, source: sourceOf(teRouteM, wrMeasured === "measured" ? "from WR" : "none"), prospects: teRouteM.G5.prospects },
      RB: { effects: rbE, source: sourceOf(rbM, wrMeasured === "measured" ? "half of WR" : "none"), prospects: rbM.G5.prospects },
    },
  };
}
