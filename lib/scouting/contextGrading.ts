// Which game-context inputs count in the AE Score, per metric, and applying
// them (tape-grading expansion, Stage 5). Pure.
//
// The user's rule: a context input goes into the score only after a held-out
// test passes. The bar (contextEffects.ts contextVerdict): lower held-out
// error than without it, in a majority of the 5 prospect folds, and better
// than 95% of runs with the input shuffled across games (p ≤ 0.05). Run on the
// real data 2026-10-05 (603 charted games); the passes are switched on below.
// Grading checks reruns every test on the current data.
//
// - Opponent defense SP+ replaces the P4/G5/FCS tiers where it predicts
//   better than both nothing and the tiers: WR cSAE (+1.3% held out, p .03),
//   QB charted sacks per pressured dropback (+4.6%, p .03), WR PFF YPRR
//   (+2.0%, p .005). Everywhere else today's tier adjustment stays exactly as
//   it was (opponentAdjust.ts / countComponents.ts), including RB and TE
//   borrowing WR's tier effect. QB AAE still isn't adjusted (SP+ +0.5%, p .15).
// - Weather (wind, rain, cold) on top of the opponent model: WR contested
//   catch % (+3.4%, p .005: rain costs ~18 pts) and RB PFF YPRR (+3.0%,
//   p .035: wind). No headline AE passed.
// - Supporting cast passed for 7 stats (6 of them his QB's grade in that game,
//   for receiving stats), but it stays OUT of every score by the user's call
//   (2026-10-05): a same-game grade rises with the whole offense's good day,
//   partly because of him, so taking it out would mark down players who make
//   their QB look good. It's filled in and shown, and tested in Grading checks.
import type { AESample } from "../types";
import type { CompositePos } from "./aeComposite";
import { adjustForContext, CONTEXT_TEST_MIN_PROSPECTS, fitContext, type ByGame, type ContextFit, type CovariateSpec } from "./contextEffects";
import {
  CAST_SPECS, OPPONENT_SP_SPECS, OPPONENT_TIER_SPECS, WEATHER_SPECS, type ContextCovariates,
} from "./gameContext";

/** Metrics (headline AE keys and component keys) judged against opponent defense SP+ instead of tiers. */
export const OPPONENT_SP: ReadonlySet<string> = new Set(["wr_csae", "ch_qb_p2s", "pff_wr_yprr"]);
/** Metrics whose weather effect counts. */
export const WEATHER_ON: ReadonlySet<string> = new Set(["ch_wr_cc", "pff_rb_yprr"]);
/** Supporting cast never counts in a score (the user's call); kept for the checks. */
export const CAST_ON: ReadonlySet<string> = new Set();

/** The headline AE metrics, keyed like the components. */
export const HEADLINE_KEYS = ["qb_aae", "rb_srae", "wr_sae", "wr_csae", "te_saer", "te_saeb"] as const;
export type HeadlineKey = (typeof HEADLINE_KEYS)[number];
export const HEADLINE_POS: Record<HeadlineKey, CompositePos> = {
  qb_aae: "QB", rb_srae: "RB", wr_sae: "WR", wr_csae: "WR", te_saer: "TE", te_saeb: "TE",
};
export const HEADLINE_LABEL: Record<HeadlineKey, string> = {
  qb_aae: "QB AAE", rb_srae: "RB SRAE", wr_sae: "WR SAE", wr_csae: "WR cSAE", te_saer: "TE-SAER", te_saeb: "TE-SAEB",
};

/** The cast measure that goes with a stat: line grades for QB and RB rushing, his QB's grade for receiving. */
export function castSpecsFor(pos: CompositePos, key: string): CovariateSpec[] {
  if (pos === "QB") return [CAST_SPECS.olPassBlock];
  if (pos === "RB") return /open|drop|yprr/.test(key) ? [CAST_SPECS.qbGrade] : [CAST_SPECS.olRunBlock];
  if (pos === "TE") return key === "te_saeb" ? [CAST_SPECS.olRunBlock] : [CAST_SPECS.qbGrade];
  return [CAST_SPECS.qbGrade];
}

export type OpponentMode = "sp" | "tier";

export interface MetricContext {
  key: string;
  opponent: OpponentMode;
  weather: boolean;
  /** The fit applied (SP+ and/or weather); null when only today's tiers apply. */
  fit: ContextFit | null;
}

/** What `key` is judged against. */
export function metricContext(key: string): { opponent: OpponentMode; weather: boolean; cast: boolean } {
  return { opponent: OPPONENT_SP.has(key) ? "sp" : "tier", weather: WEATHER_ON.has(key), cast: CAST_ON.has(key) };
}

/** The covariates fit for `key` (empty when only today's tiers apply). */
export function contextSpecs(key: string, cc: ContextCovariates, pos: CompositePos): CovariateSpec[] {
  const m = metricContext(key);
  const extra = [...(m.weather ? WEATHER_SPECS : []), ...(m.cast ? castSpecsFor(pos, key) : [])];
  if (m.opponent === "sp") return [...OPPONENT_SP_SPECS(cc.spRef), ...extra];
  return extra.length ? [...OPPONENT_TIER_SPECS, ...extra] : [];
}

/**
 * One metric's samples with its context taken out.
 *   `raw` — the samples before any opponent adjustment, carrying byGame;
 *   `tierAdjusted` — today's tier-adjusted samples (opponentAdjust.ts).
 * SP+ metrics: the SP+ fit (with weather / cast when on) applied to `raw`.
 * Tier metrics with weather or cast on: fit together with the tiers (as
 * tested), and only the extra inputs' effects applied on top of today's tier
 * adjustment. Anything else: `tierAdjusted`, untouched.
 */
export function contextAdjust<S extends AESample>(
  key: string,
  pos: CompositePos,
  raw: ReadonlyMap<string, S | null>,
  tierAdjusted: ReadonlyMap<string, S | null>,
  cc: ContextCovariates,
  scale = 100,
): { samples: Map<string, S | null>; info: MetricContext } {
  const m = metricContext(key);
  const specs = contextSpecs(key, cc, pos);
  if (specs.length === 0) return { samples: new Map(tierAdjusted), info: { key, ...m, fit: null } };
  const byGame = [...raw].map(([id, s]) => [id, s?.byGame as ByGame | undefined] as const);
  const fitted = fitContext(byGame, cc.cov, specs);
  // Too few prospects with context (before migration 065's backfill, say):
  // keep today's adjustment rather than fit on a handful.
  const fit = fitted && fitted.prospects >= CONTEXT_TEST_MIN_PROSPECTS ? fitted : null;
  if (!fit) return { samples: new Map(tierAdjusted), info: { key, ...m, fit: null } };
  if (m.opponent === "sp") {
    return { samples: new Map([...raw].map(([id, s]) => [id, adjustForContext(s, cc.cov, fit, scale)])), info: { key, ...m, fit } };
  }
  const tierKeys = new Set(OPPONENT_TIER_SPECS.map((s) => s.key));
  const extraOnly = { ...fit, specs: fit.specs.filter((s) => !tierKeys.has(s.key)) };
  return {
    samples: new Map([...tierAdjusted].map(([id, s]) => [id, s && raw.get(id)?.byGame ? adjustForContext({ ...s, byGame: raw.get(id)!.byGame }, cc.cov, extraOnly, scale) : s])),
    info: { key, ...m, fit: extraOnly },
  };
}
