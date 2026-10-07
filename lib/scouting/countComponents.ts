// Count-ratio components for the AE Score (tape-grading expansion, Stage 4).
// Pure. Two kinds of number join the user's own Above-Expected metrics inside
// the score, each as one more component of its position:
//
//   - PFF's results over exactly the charted games (pffComponents.ts): BTT%,
//     TWP%, YCO per carry, YPRR, ... Backfilled on every linked game, old ones
//     included, so they can move old players' scores.
//   - The tag-only stats (tagStats.ts): rushing success for QBs, release vs
//     press for WRs and TEs, ... Tagged plays only, so they can't touch an old
//     game or an old-only player.
//
// Every one is a ratio of per-game counts (yards ÷ routes, hits ÷ tries), and
// gets the same treatment as an AE before it's scored:
//
//   - Season-weighted like every AE (seasonWeight.ts): a game's counts carry
//     its season weight, so older tape counts a little less.
//   - Relative to the charted pool: the composite (aeComposite.ts) standardizes
//     each one against the prospects at the position (Paule–Mandel mean and
//     true spread), exactly as it does an AE.
//   - Weighted by reliability: each prospect's sampling variance comes from a
//     pooled dispersion, Var(count in a game) = φ × its denominator, with φ
//     measured from how much every prospect's games scatter around his own rate
//     (within-player, so it's noise rather than talent). A 40-route sample is
//     trusted less than a 300-route one by the same rule as the AEs.
//   - Opponent-adjusted the way the AE Score is (opponentAdjust.ts): the lift a
//     G5 or FCS opponent gives is measured within players (his rate vs weaker
//     opponents minus his rate vs P4), on the same guards (5 prospects, shrunk,
//     never "weaker is harder"), and taken back out. No borrowing between stats:
//     a stat that can't be measured yet isn't adjusted.
//
// A component is oriented so higher is better (a lower-is-better rate like TWP%
// is negated); `rate` keeps the number as PFF or the charting shows it.
import type { AESample, ScoutingGame } from "../types";
import { seasonWeights } from "./seasonWeight";
import { measureTierEffects, resolveEffects, type TierEffects, type TierMeasurement } from "./opponentAdjust";
import type { OpponentTier } from "./opponentTier";
import type { CompositePos } from "./aeComposite";
import { addGameResidual, type ByGame } from "./contextEffects";
import { contextAdjust, contextSpecs, type MetricContext } from "./contextGrading";
import type { ContextCovariates } from "./gameContext";

/** One prospect-game's counts for a stat. */
export interface GameCount {
  prospectId: string;
  gameId: string;
  num: number;
  den: number;
}

export interface CountStatDef {
  /** Composite metric key, e.g. "pff_btt". */
  key: string;
  /** Short label, e.g. "BTT%". */
  label: string;
  source: "pff" | "tag" | "charted";
  pos: CompositePos;
  /** 1 = higher is better, -1 = lower is better. */
  dir: 1 | -1;
  /** Display multiplier: 100 for a percentage, 1 for a per-unit rate. */
  scale: number;
  /** What the denominator counts, e.g. "attempts". */
  unit: string;
  /** Denominator (unweighted) needed before the stat has a sample. */
  floor: number;
  /** Shown after the rate in tooltips, e.g. "%" or " yds/route". */
  suffix: string;
  /** What it measures, for the header tooltip and the Grading checks. */
  description: string;
  /** Added on top of the AE Score rather than averaged in (aeComposite.ts CompositeMetric.additive). */
  additive?: true;
}

/** A component sample: an AESample (oriented, display units) plus the rate as shown. */
export interface CountSample extends AESample {
  /** His rate in display units (scale applied), not oriented. */
  rate: number;
}

export interface CountStatResult {
  def: CountStatDef;
  /** Every prospect with counts for the stat; null = under the floor. */
  samples: Map<string, CountSample | null>;
  /** The pool's rate (all counted games, unweighted), display units. */
  poolRate: number | null;
  /** φ: per-denominator-unit variance of the counts, rate units² (null = can't be measured yet). */
  dispersion: number | null;
  /** The opponent lift taken out, oriented rate units per rep (G5 / FCS); none measured = 0s. */
  effects: TierEffects;
  /** Prospects behind the G5 measurement (charted against both P4 and G5). */
  tierProspects: number;
  measured: boolean;
  /** The game-context model applied on top (contextGrading.ts), when this stat has one. */
  context?: MetricContext;
}

const fmtNum = (v: number, dp: number) => (Number.isFinite(v) ? v.toFixed(dp) : "—");
/** "6.1%" / "2.43 yds/route": a rate in display units with its suffix. */
export function formatRate(def: CountStatDef, rate: number): string {
  return `${fmtNum(rate, def.scale === 100 ? 1 : 2)}${def.suffix}`;
}

/**
 * Per-prospect samples for one stat, opponent-adjusted.
 * `games` supplies each game's season (weights); `tierByGame` its opponent tier.
 * With `byGame`, each sample also carries its oriented per-game residuals
 * (dir × (count − denominator × pool rate)) for the game-context effects.
 */
export function countStat(
  def: CountStatDef,
  counts: readonly GameCount[],
  games: readonly Pick<ScoutingGame, "id" | "prospect_id" | "season_year">[],
  tierByGame?: ReadonlyMap<string, OpponentTier>,
  { byGame: wantByGame = false, context }: { byGame?: boolean; context?: ContextCovariates } = {},
): CountStatResult {
  const contextOn = !!context && contextSpecs(def.key, context, def.pos).length > 0;
  const byGame = wantByGame || contextOn;
  const weights = seasonWeights(games);
  type Acc = { num: number; den: number; nw: number; dw: number; d2w: number; byGame: { num: number; den: number; gameId: string }[] };
  const by = new Map<string, Acc>();
  let poolNum = 0, poolDen = 0;
  for (const c of counts) {
    if (!(c.den > 0)) continue;
    const a = by.get(c.prospectId) ?? { num: 0, den: 0, nw: 0, dw: 0, d2w: 0, byGame: [] };
    by.set(c.prospectId, a);
    const w = weights.get(c.gameId) ?? 1;
    a.num += c.num; a.den += c.den;
    a.nw += w * c.num; a.dw += w * c.den; a.d2w += w * w * c.den;
    a.byGame.push({ num: c.num, den: c.den, gameId: c.gameId });
    poolNum += c.num; poolDen += c.den;
  }
  const poolRate = poolDen > 0 ? poolNum / poolDen : null;

  // φ from within-player scatter: Σ (num − R·den)² / Σ (D − Σden²/D).
  let ssr = 0, dof = 0;
  for (const a of by.values()) {
    if (a.byGame.length < 2) continue;
    const r = a.num / a.den;
    let d2 = 0;
    for (const g of a.byGame) { ssr += (g.num - r * g.den) ** 2; d2 += g.den * g.den; }
    dof += a.den - d2 / a.den;
  }
  const dispersion = dof > 0 ? ssr / dof : null;

  const samples = new Map<string, CountSample | null>();
  for (const [id, a] of by) {
    if (a.den < def.floor || dispersion == null || poolRate == null || !(a.dw > 0)) { samples.set(id, null); continue; }
    const rate = a.nw / a.dw;
    const variance = dispersion * (a.d2w / (a.dw * a.dw)) * def.scale * def.scale;
    const s: CountSample = { ae: def.dir * rate * def.scale, n: Math.round(a.den), w: a.dw, variance, rate: rate * def.scale };
    if (tierByGame) {
      const byTier: NonNullable<AESample["byTier"]> = {};
      for (const g of a.byGame) {
        const tier = tierByGame.get(g.gameId);
        if (!tier) continue;
        const t = (byTier[tier] ??= { n: 0, resid: 0, w: 0 });
        t.n += g.den;
        t.resid += def.dir * (g.num - g.den * poolRate);
        t.w = (t.w ?? 0) + (weights.get(g.gameId) ?? 1) * g.den;
      }
      s.byTier = byTier;
    }
    if (byGame) {
      const perGame: ByGame = {};
      for (const g of a.byGame) addGameResidual(perGame, g.gameId, g.den, def.dir * (g.num - g.den * poolRate), (weights.get(g.gameId) ?? 1) * g.den);
      s.byGame = perGame;
    }
    samples.set(id, s);
  }

  // Opponent strength: measured within players, never borrowed.
  const m = measureTierEffects(samples.values());
  const effects = resolveEffects(m);
  const measured = m.G5.effect != null || m.FCS.effect != null;
  const tierAdjusted = measured ? adjustCountSamples(samples, effects, def.scale) : samples;
  // Opponent defense SP+ and weather where their held-out tests passed (contextGrading.ts).
  const ctx = contextOn ? contextAdjust(def.key, def.pos, samples, tierAdjusted, context!, def.scale) : null;
  return {
    def, samples: ctx?.samples ?? tierAdjusted, poolRate: poolRate != null ? poolRate * def.scale : null, dispersion,
    effects, tierProspects: m.G5.prospects, measured, ...(ctx ? { context: ctx.info } : {}),
  };
}

/** Each sample minus its opponent lift (share of reps vs each tier × effect), in display units. */
function adjustCountSamples(samples: Map<string, CountSample | null>, effects: TierEffects, scale: number): Map<string, CountSample | null> {
  const out = new Map<string, CountSample | null>();
  for (const [id, s] of samples) {
    if (!s?.byTier) { out.set(id, s); continue; }
    let lift = 0;
    for (const tier of ["G5", "FCS"] as const) {
      const t = s.byTier[tier];
      if (t) lift += (t.w ?? t.n) * effects[tier];
    }
    const adj = (lift / (s.w ?? s.n)) * scale;
    out.set(id, adj === 0 ? s : { ...s, ae: s.ae - adj, rawAe: s.ae });
  }
  return out;
}

export type { TierMeasurement };
