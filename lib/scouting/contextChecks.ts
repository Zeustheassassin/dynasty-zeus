// The Game context part of the Grading checks (Analysis → Grading checks,
// tape-grading expansion Stage 5). Pure.
//
// For every headline AE and every AE Score component: the held-out tests the
// switches in contextGrading.ts rest on, rerun on the current data:
//   - opponent: today's P4/G5/FCS tiers vs opponent defense SP+ (+ FCS flag);
//   - weather (wind, rain, cold) on top of the opponent model;
//   - supporting cast on top of that (display only, the user's call).
// The held-out improvements are cheap and shown at once; the chance check
// (contextVerdict's permutations) is slow, so the screen runs it on a button
// through contextPValues. Also: the left-early / played-hurt weight tests per
// headline AE. (Trait-grade counts were here until the user removed trait
// grades on 2026-11-09.)
//
// Season units (line season grades plan, Stage 2, migration 103): PFF's
// FULL-SEASON grades for that game's season, each tested on top of what its
// metric is judged against now (SEASON_UNIT_TESTS: an RB's line matchup, his
// line vs the opponent's front seven, the opponent's missed-tackle rate, a WR / TE's
// opponent coverage at the spots he ran routes from, TE-SAEB vs the front
// seven). For SP+ metrics, coverage is also tested in SP+'s place. Nothing is
// switched on here (Stage 3, the user OKs each).
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../types";
import {
  computeQBAboveExpectedSamples, computeRBAboveExpectedSamples,
  computeTEBlockAboveExpectedSamples, computeTERouteAboveExpectedSamples,
} from "./aboveExpected";
import { buildWRGameSplits, type ProspectGameRouteCellsRow } from "./aggregateMerge";
import { buildComponents, type GradingData } from "./aeComponents";
import type { CompositePos } from "./aeComposite";
import {
  beats, contextVerdict, fitContext, heldOutContextTest, improvement,
  type ByGame, type ContextFit, type CovariateSpec,
} from "./contextEffects";
import {
  castSpecsFor, contextSpecs, HEADLINE_KEYS, HEADLINE_LABEL, HEADLINE_POS, metricContext, type OpponentMode,
} from "./contextGrading";
import { alignmentMixByGame, teRoutesBySpot, wrRoutesBySpot, type AlignmentMix } from "./alignmentMix";
import {
  gameCovariates, OPPONENT_SP_SPECS, OPPONENT_TIER_SPECS, resolveGameContexts, SEASON_UNIT_INPUTS, SEASON_UNIT_SPECS, WEATHER_SPECS,
  type ContextCovariates, type SeasonUnitInput,
} from "./gameContext";
import { flaggedGameTest, LEFT_EARLY_WEIGHT, PLAYED_HURT_WEIGHT, type FlagWeightTest } from "./gameFlags";
import { learnOpponents, tierGames } from "./opponentTier";
import { tagStatReps } from "./tagStats";

export interface ContextMetric {
  key: string;
  label: string;
  pos: CompositePos;
  /** Display units per outcome fraction (100 = points / percentage points). */
  scale: number;
  samples: (readonly [string, ByGame | undefined])[];
}

export interface ContextCheck {
  key: string;
  label: string;
  pos: CompositePos;
  /** Prospects / games / reps with every opponent covariate known. */
  prospects: number;
  games: number;
  testable: boolean;
  /** Held-out improvement over no context: today's tiers, and opponent defense SP+. */
  tier: number | null;
  sp: number | null;
  spBeatsTier: boolean;
  /** Held-out improvement of weather over the opponent model in use, and of cast over that. */
  weather: number | null;
  cast: number | null;
  castLabel: string;
  /** What the score uses now (contextGrading.ts). */
  opponent: OpponentMode;
  weatherOn: boolean;
  /** The fit applied now (SP+ and / or weather), effects in display units per covariate unit. */
  applied: { label: string; unit: string; effect: number }[];
}

/**
 * The season unit tests (line season grades plan, 2026-11-19): which input
 * each metric is tested against. Coverage only for WR / TE (the user: an RB's
 * routes are mostly open releases from the backfield).
 */
export const SEASON_UNIT_TESTS: readonly { key: string; input: SeasonUnitInput }[] = [
  ...["rb_srae", "pff_rb_yco", "pff_rb_mtf", "pff_rb_10p", "pff_rb_15of10"].map((key) => ({ key, input: "matchup" as const })),
  { key: "pff_rb_mtf", input: "mt" }, { key: "pff_rb_yco", input: "mt" },
  ...["wr_csae", "wr_sae", "pff_wr_yprr", "pff_wr_cc"].map((key) => ({ key, input: "coverage" as const })),
  { key: "pff_wr_yac", input: "mt" }, { key: "pff_wr_mtf", input: "mt" },
  ...["te_saer", "pff_te_yprr", "pff_te_cc"].map((key) => ({ key, input: "coverage" as const })),
  { key: "pff_te_mtf", input: "mt" }, { key: "te_saeb", input: "front7" },
];

export interface UnitCheck {
  /** `${metric key}|${input}` */
  id: string;
  key: string;
  label: string;
  pos: CompositePos;
  input: SeasonUnitInput;
  inputLabel: string;
  /** The model it's tested on top of: what the metric is judged against now. */
  base: string;
  prospects: number;
  games: number;
  testable: boolean;
  /** Held-out improvement on top of the base, and lower error overall and in most folds. */
  improvement: number | null;
  beatsBase: boolean;
  /**
   * SP+ metrics: the input INSTEAD of SP+ (plus weather where on): its
   * held-out improvement over no opponent model, SP+'s, and whether it beats SP+.
   */
  replace: { improvement: number | null; sp: number | null; beatsSp: boolean } | null;
  /** The input's effects, fit with the base on all the data, in display units per covariate unit. */
  effects: { label: string; unit: string; effect: number }[];
}

export interface ContextReport {
  metrics: ContextCheck[];
  units: UnitCheck[];
  /** Per headline AE: should left-early / played-hurt games count less? */
  flags: { key: string; label: string; leftEarly: FlagWeightTest; playedHurt: FlagWeightTest }[];
  leftEarlyWeight: number;
  playedHurtWeight: number;
  /** Games with each piece of context; `seasonUnits` = RB / WR / TE games with full-season reports for the opponent. */
  coverage: { games: number; opponent: number; weather: number; cast: number; seasonUnits: number };
}

export interface ContextInputs {
  prospects: readonly Pick<Prospect, "id" | "position">[];
  games: readonly ScoutingGame[];
  qbPlays: QBPlay[];
  rbPlays: RBPlay[];
  tePlays: TEPlay[];
  gameRouteCells: readonly ProspectGameRouteCellsRow[] | null;
  gradingData: GradingData;
}

const WR_FLOOR = 15;
const list = (m: Map<string, { byGame?: ByGame } | null>) => [...m].map(([id, s]) => [id, s?.byGame] as const);

/** Where each WR / TE game's routes were run (for the opponent's coverage blend). */
export function routeAlignmentMix(inp: Pick<ContextInputs, "games" | "gameRouteCells" | "gradingData" | "tePlays">): Map<string, AlignmentMix> {
  const routes = new Map([
    ...wrRoutesBySpot(inp.gameRouteCells ?? [], inp.gradingData.routeTagCells),
    ...teRoutesBySpot(inp.tePlays),
  ]);
  return alignmentMixByGame(inp.games, routes);
}

/** Every metric's per-game residuals, and the games' covariates. */
export function contextMetrics(inp: ContextInputs): { metrics: ContextMetric[]; cc: ContextCovariates } {
  const prospects = inp.prospects as Prospect[];
  const games = inp.games as ScoutingGame[];
  const tiers = tierGames(games, learnOpponents(games, inp.gradingData.context.rows)).byGame;
  const cc = gameCovariates(games, resolveGameContexts(games, inp.gradingData.context), tiers, routeAlignmentMix(inp));
  const metrics: ContextMetric[] = [];
  const head = (key: (typeof HEADLINE_KEYS)[number], samples: ContextMetric["samples"]) =>
    metrics.push({ key, label: HEADLINE_LABEL[key], pos: HEADLINE_POS[key], scale: 100, samples });
  head("qb_aae", list(computeQBAboveExpectedSamples(prospects, games, inp.qbPlays, { byGame: true })));
  head("rb_srae", list(computeRBAboveExpectedSamples(prospects, games, inp.rbPlays, undefined, { byGame: true })));
  if (inp.gameRouteCells) {
    const wr = buildWRGameSplits([...inp.gameRouteCells], games, inp.gradingData.routeTagCells);
    const floor = (m: Map<string, ByGame>) => [...m].filter(([, bg]) => Object.values(bg).reduce((s, g) => s + g.n, 0) >= WR_FLOOR);
    head("wr_sae", floor(wr.all));
    head("wr_csae", floor(wr.core));
  }
  head("te_saer", list(computeTERouteAboveExpectedSamples(prospects, games, inp.tePlays, undefined, { byGame: true })));
  head("te_saeb", list(computeTEBlockAboveExpectedSamples(prospects, games, inp.tePlays, undefined, { byGame: true })));
  const built = buildComponents({
    prospects: inp.prospects, games, tierByGame: tiers, qbPlays: inp.qbPlays, rbPlays: inp.rbPlays,
    pffGameRows: inp.gradingData.pffGameRows, wrRouteCounts: inp.gradingData.routeCounts,
    tagReps: tagStatReps({ games, qbPlays: inp.qbPlays, rbPlays: inp.rbPlays, tePlays: inp.tePlays, wrTagRows: inp.gradingData.routeTagCells }),
    byGame: true,
  });
  for (const r of built.results) {
    metrics.push({ key: r.def.key, label: `${r.def.source === "pff" ? "PFF " : r.def.source === "tag" ? "Tag " : ""}${r.def.label}`, pos: r.def.pos, scale: r.def.scale, samples: list(r.samples) });
  }
  return { metrics, cc };
}

const opponentBase = (key: string, cc: ContextCovariates): CovariateSpec[] =>
  metricContext(key).opponent === "sp" ? OPPONENT_SP_SPECS(cc.spRef) : OPPONENT_TIER_SPECS;

/** What a metric is judged against now: its opponent model, plus weather where it's on. */
function inUseBase(key: string, cc: ContextCovariates): { specs: CovariateSpec[]; label: string } {
  const mc = metricContext(key);
  const opp = opponentBase(key, cc);
  return {
    specs: mc.weather ? [...opp, ...WEATHER_SPECS] : opp,
    label: `${mc.opponent === "sp" ? "Opp. D SP+" : "Tiers"}${mc.weather ? " + weather" : ""}`,
  };
}

/** One season unit test (held out; the chance check is unitPValue). */
export function seasonUnitCheck(m: ContextMetric, input: SeasonUnitInput, cc: ContextCovariates): UnitCheck {
  const { specs: base, label } = inUseBase(m.key, cc);
  const added = SEASON_UNIT_INPUTS[input].specs;
  const t = heldOutContextTest(m.samples, cc.cov, [base, [...base, ...added]]);
  let replace: UnitCheck["replace"] = null;
  if (metricContext(m.key).opponent === "sp") {
    const weather = metricContext(m.key).weather ? WEATHER_SPECS : [];
    const sp = [...OPPONENT_SP_SPECS(cc.spRef), ...weather];
    const r = heldOutContextTest(m.samples, cc.cov, [sp, [...added, ...weather]]);
    replace = { improvement: improvement(r.models[1], r.none), sp: improvement(r.models[0], r.none), beatsSp: beats(r.models[1], r.models[0]) };
  }
  const fit = fitContext(m.samples, cc.cov, [...base, ...added]);
  const keys = new Set(added.map((s) => s.key));
  const effects = fit ? fit.specs.filter((s) => keys.has(s.key)).map((s) => ({ label: s.label, unit: s.unit, effect: fit.beta[s.key] * m.scale })) : [];
  // The matchup's one effect, read per grade point of each side.
  const step = effects.find((e) => e.label === SEASON_UNIT_SPECS.lineMatchup.label);
  if (step && cc.lineRef) {
    effects.push(
      { label: "= their front 7", unit: "front-7 grade pt", effect: step.effect / cc.lineRef.front7Sd },
      { label: "= his OL (equal weight, your call)", unit: "OL grade pt", effect: -step.effect / cc.lineRef.olSd },
    );
  }
  return {
    id: `${m.key}|${input}`, key: m.key, label: m.label, pos: m.pos,
    input, inputLabel: SEASON_UNIT_INPUTS[input].label, base: label,
    prospects: t.prospects, games: t.games, testable: t.testable,
    improvement: improvement(t.models[1], t.models[0]),
    beatsBase: beats(t.models[1], t.models[0]),
    replace,
    effects,
  };
}

/** The chance check for one season unit test: does the input beat shuffles of itself, on top of the base? */
export function unitPValue(m: ContextMetric, input: SeasonUnitInput, cc: ContextCovariates): number | null {
  return contextVerdict(m.samples, cc.cov, inUseBase(m.key, cc).specs, SEASON_UNIT_INPUTS[input].specs).p;
}

function appliedEffects(m: ContextMetric, fit: ContextFit | null): ContextCheck["applied"] {
  return fit ? fit.specs.map((s) => ({ label: s.label, unit: s.unit, effect: fit.beta[s.key] * m.scale })) : [];
}

export function buildContextReport(inp: ContextInputs): ContextReport {
  const { metrics, cc } = contextMetrics(inp);
  const checks: ContextCheck[] = metrics.map((m) => {
    const sp = OPPONENT_SP_SPECS(cc.spRef);
    const opp = heldOutContextTest(m.samples, cc.cov, [OPPONENT_TIER_SPECS, sp]);
    const base = opponentBase(m.key, cc);
    const mc = metricContext(m.key);
    const wt = heldOutContextTest(m.samples, cc.cov, [base, [...base, ...WEATHER_SPECS]]);
    const castBase = mc.weather ? [...base, ...WEATHER_SPECS] : base;
    const cast = castSpecsFor(m.pos, m.key);
    const ct = heldOutContextTest(m.samples, cc.cov, [castBase, [...castBase, ...cast]]);
    const specs = contextSpecs(m.key, cc, m.pos);
    const fit = specs.length ? fitContext(m.samples, cc.cov, specs) : null;
    const tierKeys = new Set(OPPONENT_TIER_SPECS.map((s) => s.key));
    const shown = fit && mc.opponent === "tier" ? { ...fit, specs: fit.specs.filter((s) => !tierKeys.has(s.key)) } : fit;
    return {
      key: m.key, label: m.label, pos: m.pos,
      prospects: opp.prospects, games: opp.games, testable: opp.testable,
      tier: improvement(opp.models[0], opp.none),
      sp: improvement(opp.models[1], opp.none),
      spBeatsTier: beats(opp.models[1], opp.models[0]),
      weather: improvement(wt.models[1], wt.models[0]),
      cast: improvement(ct.models[1], ct.models[0]),
      castLabel: cast.map((c) => c.label).join(" + "),
      opponent: mc.opponent,
      weatherOn: mc.weather,
      applied: appliedEffects(m, shown),
    };
  });

  const leftEarly = new Set(inp.games.filter((g) => g.left_early === true).map((g) => g.id));
  const hurt = new Set(inp.games.filter((g) => g.played_hurt === true).map((g) => g.id));
  const flags = metrics.filter((m) => (HEADLINE_KEYS as readonly string[]).includes(m.key)).map((m) => ({
    key: m.key, label: m.label,
    leftEarly: flaggedGameTest(m.samples, leftEarly),
    playedHurt: flaggedGameTest(m.samples, hurt),
  }));

  const byKey = new Map(metrics.map((m) => [m.key, m]));
  const units = SEASON_UNIT_TESTS.flatMap(({ key, input }) => {
    const m = byKey.get(key);
    return m ? [seasonUnitCheck(m, input, cc)] : [];
  });

  const contexts = resolveGameContexts(inp.games, inp.gradingData.context);
  const cs = [...contexts.values()];
  return {
    metrics: checks, units, flags,
    leftEarlyWeight: LEFT_EARLY_WEIGHT, playedHurtWeight: PLAYED_HURT_WEIGHT,
    coverage: {
      games: inp.games.length,
      opponent: cs.filter((c) => c.matched).length,
      weather: cs.filter((c) => c.weather?.status === "ok" || c.weather?.status === "dome").length,
      cast: cs.filter((c) => c.cast != null).length,
      seasonUnits: cs.filter((c) => c.units?.oppFull).length,
    },
  };
}

export interface ContextPValues { sp: number | null; weather: number | null; cast: number | null }

/** The chance check for one metric (slow: PERMUTATIONS shuffles per input). */
export function contextPValues(m: ContextMetric, cc: ContextCovariates): ContextPValues {
  const base = opponentBase(m.key, cc);
  const mc = metricContext(m.key);
  const castBase = mc.weather ? [...base, ...WEATHER_SPECS] : base;
  return {
    sp: contextVerdict(m.samples, cc.cov, [], OPPONENT_SP_SPECS(cc.spRef)).p,
    weather: contextVerdict(m.samples, cc.cov, base, WEATHER_SPECS).p,
    cast: contextVerdict(m.samples, cc.cov, castBase, castSpecsFor(m.pos, m.key)).p,
  };
}
