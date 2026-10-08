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
// headline AE, and how many games carry trait grades.
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
import {
  gameCovariates, OPPONENT_SP_SPECS, OPPONENT_TIER_SPECS, resolveGameContexts, WEATHER_SPECS, type ContextCovariates,
} from "./gameContext";
import { flaggedGameTest, LEFT_EARLY_WEIGHT, PLAYED_HURT_WEIGHT, type FlagWeightTest } from "./gameFlags";
import { learnOpponents, tierGames } from "./opponentTier";
import { tagStatReps } from "./tagStats";
import { isTraitGame, traitsFor } from "./traits";

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

export interface ContextReport {
  metrics: ContextCheck[];
  /** Per headline AE: should left-early / played-hurt games count less? */
  flags: { key: string; label: string; leftEarly: FlagWeightTest; playedHurt: FlagWeightTest }[];
  leftEarlyWeight: number;
  playedHurtWeight: number;
  /** Graded new games and prospects with any trait, per position. */
  traits: Record<CompositePos, { games: number; prospects: number; traits: number }>;
  /** Games with each piece of context. */
  coverage: { games: number; opponent: number; weather: number; cast: number };
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

/** Every metric's per-game residuals, and the games' covariates. */
export function contextMetrics(inp: ContextInputs): { metrics: ContextMetric[]; cc: ContextCovariates } {
  const prospects = inp.prospects as Prospect[];
  const games = inp.games as ScoutingGame[];
  const tiers = tierGames(games, learnOpponents(games, inp.gradingData.context.rows)).byGame;
  const cc = gameCovariates(games, resolveGameContexts(games, inp.gradingData.context), tiers);
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

  const posOf = new Map(inp.prospects.map((p) => [p.id, p.position]));
  const traits = { QB: { games: 0, prospects: 0, traits: 6 }, RB: { games: 0, prospects: 0, traits: 6 }, WR: { games: 0, prospects: 0, traits: 6 }, TE: { games: 0, prospects: 0, traits: 6 } } as ContextReport["traits"];
  const graded = new Map<string, Set<string>>();
  for (const g of inp.games) {
    const pos = posOf.get(g.prospect_id) as CompositePos | undefined;
    if (!pos || !traits[pos] || !isTraitGame(g) || !g.trait_grades) continue;
    if (!traitsFor(pos).some((t) => g.trait_grades![t.key] != null)) continue;
    traits[pos].games++;
    (graded.get(pos) ?? graded.set(pos, new Set()).get(pos)!).add(g.prospect_id);
  }
  for (const [pos, ids] of graded) traits[pos as CompositePos].prospects = ids.size;

  const contexts = resolveGameContexts(inp.games, inp.gradingData.context);
  const cs = [...contexts.values()];
  return {
    metrics: checks, flags,
    leftEarlyWeight: LEFT_EARLY_WEIGHT, playedHurtWeight: PLAYED_HURT_WEIGHT,
    traits,
    coverage: {
      games: inp.games.length,
      opponent: cs.filter((c) => c.matched).length,
      weather: cs.filter((c) => c.weather?.status === "ok" || c.weather?.status === "dome").length,
      cast: cs.filter((c) => c.cast != null).length,
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
