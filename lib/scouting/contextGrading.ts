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
//   borrowing WR's tier effect. QB AAE isn't opponent-adjusted (SP+ +0.5%,
//   p .15).
// - Weather (wind, rain, cold) on top of the opponent model: WR contested
//   catch % (+3.4%, p .005: rain costs ~18 pts) and RB PFF YPRR (+3.0%,
//   p .035: wind). No headline AE passed then.
// - Supporting cast passed for 7 stats (6 of them his QB's grade in that game,
//   for receiving stats), but it stays OUT of every score by the user's call
//   (2026-10-05): a same-game grade rises with the whole offense's good day,
//   partly because of him, so taking it out would mark down players who make
//   their QB look good. It's filled in and shown, and tested in Grading checks.
// - Rerun 2026-10-21 (689 charted games); five more passed and are switched on
//   (user OK): QB AAE weather (+6.7% held out, p .03: wind and rain cost
//   accuracy, the first headline AE with a context input), PFF BTT% weather
//   (+13.7%, p .005), WR SAE against SP+ (+1.0%, p .025, joining cSAE), PFF
//   QB Fum% against SP+ (+5.2%, p .04) and WR charted Drop% weather (+0.5%,
//   p .045).
// - 2026-11-10: the WR board stopped charting contested catches (the user);
//   the AE Score's CC% is now PFF's (pff_wr_cc), and the charted CC%'s
//   weather switch went with it. PFF's CC% hasn't had its own weather test
//   yet: it's off until Grading checks shows it passing (activation list).
// - 2026-11-19, season units (line season grades plan; PFF FULL-season grades
//   with the game itself left out, migration 103; the user: "OK to switch
//   everything on you recomend"). Held out on top of what each metric used:
//   RB line matchup on SRAE (+4.5%, p .020) and
//   PFF 10+% (+5.9%, p .010): their front seven vs his line, the effect
//   measured on the front seven and applied to the whole gap, so his line
//   weighs the same as the D-line (the user's call, untested); PFF YCO/A vs the
//   opponent's missed-tackle rate (+4.5%, p .005); WR PFF CC% vs the
//   opponent's coverage at his spots (+3.2%, p .005); WR SAE (+0.6%, p .015)
//   and PFF YPRR (+0.4%, p .035) vs coverage on top of SP+. Held: RB PFF
//   MTF/A vs missed-tackle rate (+1.5%, p .035, borderline). PFF YCO/A takes
//   the missed-tackle rate only: on top of it the matchup adds +0.4% (p .085,
//   fails), while the rate adds +1.8% (p .030) on top of the matchup. Read-only
//   run on 790 games; Grading checks reruns them on the stored data.
// - Same evening, after the fill (the user, on the RB board): the matchup
//   counts at half (gameContext.ts LINE_MATCHUP_WEIGHT), and a metric's
//   spread is measured before its season units (contextAdjust's
//   spreadSamples), so the credit moves each player's own number, never the
//   yardstick every player is divided by. The held RB PFF MTF/A vs the
//   opponent's missed-tackle rate passed on the stored data (+1.59% held out,
//   p .025; moves RB AE by 0.03 at most) and is switched on (the user: "yes go
//   on with MTF/A if thats recomended").
import type { AESample } from "../types";
import type { CompositePos } from "./aeComposite";
import { adjustForContext, CONTEXT_TEST_MIN_PROSPECTS, fitContext, type ByGame, type ContextFit, type CovariateSpec } from "./contextEffects";
import {
  CAST_SPECS, OPPONENT_SP_SPECS, OPPONENT_TIER_SPECS, SEASON_UNIT_INPUTS, WEATHER_SPECS, type ContextCovariates, type SeasonUnitInput,
} from "./gameContext";

/** Metrics (headline AE keys and component keys) judged against opponent defense SP+ instead of tiers. */
export const OPPONENT_SP: ReadonlySet<string> = new Set(["wr_csae", "ch_qb_p2s", "pff_wr_yprr", "wr_sae", "pff_qb_fum"]);
/** Metrics whose weather effect counts. */
export const WEATHER_ON: ReadonlySet<string> = new Set(["pff_rb_yprr", "qb_aae", "pff_btt", "ch_wr_drop"]);
/** Supporting cast never counts in a score (the user's call); kept for the checks. */
export const CAST_ON: ReadonlySet<string> = new Set();
/** Season unit inputs that count, per metric (2026-11-19). */
export const SEASON_UNITS_ON: ReadonlyMap<string, readonly SeasonUnitInput[]> = new Map<string, readonly SeasonUnitInput[]>([
  ["rb_srae", ["matchup"]],
  ["pff_rb_yco", ["mt"]],
  ["pff_rb_mtf", ["mt"]],
  ["pff_rb_10p", ["matchup"]],
  ["pff_wr_cc", ["coverage"]],
  ["wr_sae", ["coverage"]],
  ["pff_wr_yprr", ["coverage"]],
]);

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
  /** Season unit inputs switched on for it. */
  units?: readonly SeasonUnitInput[];
  /** The fit applied (SP+ and/or weather); null when only today's tiers apply. */
  fit: ContextFit | null;
}

/** What `key` is judged against. */
export function metricContext(key: string): { opponent: OpponentMode; weather: boolean; cast: boolean; units: readonly SeasonUnitInput[] } {
  return { opponent: OPPONENT_SP.has(key) ? "sp" : "tier", weather: WEATHER_ON.has(key), cast: CAST_ON.has(key), units: SEASON_UNITS_ON.get(key) ?? [] };
}

/** The season unit inputs on for `key`, as covariates (`except` one, for testing it on top of the rest). */
export function seasonUnitSpecs(key: string, except?: SeasonUnitInput): CovariateSpec[] {
  return metricContext(key).units.filter((u) => u !== except).flatMap((u) => SEASON_UNIT_INPUTS[u].specs);
}

const UNIT_WORDS: Record<SeasonUnitInput, string> = {
  matchup: "the line matchup", front7: "front sevens", coverage: "opponent coverage", mt: "missed tackles",
};

/**
 * What a metric's context adjustment was for, for the AE tooltips:
 * "opponents", "opponent defenses", "opponents and weather" (QB AAE:
 * "weather"), then any season units the fit kept ("opponents, the line
 * matchup"). `headline` false = a composite piece without its own context.
 */
export function contextWhat(
  info: { key: string; opponent: OpponentMode; weather: boolean; units?: readonly SeasonUnitInput[]; fit: ContextFit | null } | null | undefined,
  headline = true,
): string {
  if (!info || !headline) return "opponents";
  const base = info.weather ? (info.key === "qb_aae" ? "weather" : "opponents and weather") : info.opponent === "sp" && info.fit ? "opponent defenses" : "opponents";
  const kept = new Set(info.fit?.specs.map((s) => s.key) ?? []);
  const units = (info.units ?? []).filter((u) => SEASON_UNIT_INPUTS[u].specs.some((s) => kept.has(s.key))).map((u) => UNIT_WORDS[u]);
  return units.length ? `${base}, ${units.join(", ")}` : base;
}

/** The covariates fit for `key` (empty when only today's tiers apply). */
export function contextSpecs(key: string, cc: ContextCovariates, pos: CompositePos): CovariateSpec[] {
  const m = metricContext(key);
  const extra = [...(m.weather ? WEATHER_SPECS : []), ...(m.cast ? castSpecsFor(pos, key) : []), ...seasonUnitSpecs(key)];
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
 *
 * `spreadSamples` (only when the fit kept a season unit input): the same
 * samples adjusted by the same fit with the season units left out. The AE
 * Score measures the metric's spread on these (CompositeMetric.spreadSamples):
 * the season units move each player's own number, never the yardstick. On the
 * real data (2026-11-19) the line matchup took RB SRAE's spread from 3.81 to
 * 3.21 (lines and backs are both better at the strong programs, so the credit
 * pulls backs together), which stretched every far-from-average back:
 * Keyjuan Brown went 2.09 → 2.52 Dynasty with only ~+0.6 SRAE of his own
 * credit. The user: Keyjuan "far too elite ... i need him to fall under that
 * 2.25 line".
 */
export function contextAdjust<S extends AESample>(
  key: string,
  pos: CompositePos,
  raw: ReadonlyMap<string, S | null>,
  tierAdjusted: ReadonlyMap<string, S | null>,
  cc: ContextCovariates,
  scale = 100,
): { samples: Map<string, S | null>; spreadSamples?: Map<string, S | null>; info: MetricContext } {
  const m = metricContext(key);
  const specs = contextSpecs(key, cc, pos);
  if (specs.length === 0) return { samples: new Map(tierAdjusted), info: { key, ...m, fit: null } };
  const byGame = [...raw].map(([id, s]) => [id, s?.byGame as ByGame | undefined] as const);
  const fitted = fitContext(byGame, cc.cov, specs);
  // Too few prospects with context (before migration 065's backfill, say):
  // keep today's adjustment rather than fit on a handful.
  const fit = fitted && fitted.prospects >= CONTEXT_TEST_MIN_PROSPECTS ? fitted : null;
  if (!fit) return { samples: new Map(tierAdjusted), info: { key, ...m, fit: null } };
  const unitKeys = new Set(seasonUnitSpecs(key).map((s) => s.key));
  const hasUnits = fit.specs.some((s) => unitKeys.has(s.key));
  const withoutUnits = (f: ContextFit): ContextFit => ({ ...f, specs: f.specs.filter((s) => !unitKeys.has(s.key)) });
  if (m.opponent === "sp") {
    const apply = (f: ContextFit) => new Map([...raw].map(([id, s]) => [id, adjustForContext(s, cc.cov, f, scale)]));
    return { samples: apply(fit), ...(hasUnits ? { spreadSamples: apply(withoutUnits(fit)) } : {}), info: { key, ...m, fit } };
  }
  const tierKeys = new Set(OPPONENT_TIER_SPECS.map((s) => s.key));
  const extraOnly = { ...fit, specs: fit.specs.filter((s) => !tierKeys.has(s.key)) };
  const apply = (f: ContextFit) =>
    new Map([...tierAdjusted].map(([id, s]) => [id, s && raw.get(id)?.byGame ? adjustForContext({ ...s, byGame: raw.get(id)!.byGame }, cc.cov, f, scale) : s]));
  return {
    samples: apply(extraOnly),
    ...(hasUnits ? { spreadSamples: apply(withoutUnits(extraOnly)) } : {}),
    info: { key, ...m, fit: extraOnly },
  };
}
