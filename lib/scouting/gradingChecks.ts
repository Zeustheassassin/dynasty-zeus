// The Grading checks (Analysis → Grading): where every Stage 4 piece that
// waits on data stands. Pure. Run it whenever; it's meant to be read after a
// few weeks of tagged charting.
//
//   - Tag corrections (tagCorrection.ts): per model, each difficulty tag's
//     tagged and "on" plays, whether it's switched on, and — once there's
//     enough to test — the held-out result (switch a tag on in
//     ENABLED_TAG_CORRECTIONS only when it improves).
//   - Garbage time: the held-out-by-game weight test, per model.
//   - Era scale: the mean residual of imported, in-app and tagged plays under
//     each model, and whether the tagged era has drifted from the in-app one
//     (the fix is RECENTER_TAGGED).
//   - AE Score components (aeComponents.ts): weight, pool, spread, trust and
//     opponent effect of each per-player component.
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../types";
import {
  QB_MODEL_SPEC, RB_MODEL_SPEC, TE_ROUTE_MODEL_SPEC, TE_BLOCK_MODEL_SPEC, fitSpec,
  type AEModelSpec,
} from "./aboveExpected";
import { expectedFor, fitFromPlays, type FittedDifficulty } from "./difficultyModel";
import {
  CORRECTION_LABEL, GARBAGE_TIME_WEIGHT, RECENTER_TAGGED,
  eraDrift, eraResiduals, garbageTimeTest, heldOutTagTest, tagReadiness,
  type CorrectionKey, type CorrectionInputs, type EraDrift, type EraResiduals, type GarbageTimeTest,
  type TagReadiness, type TagTestResult,
} from "./tagCorrection";
import { isTaggedPlay, playEra, gameSource } from "./playEra";
import {
  buildWRModel, fitWRGradingModel, wrGradingCells,
  type ProspectGameRouteCellsRow, type WRGradingCell,
} from "./aggregateMerge";
import { buildAEComposite, type CompositePos, type MetricSpread } from "./aeComposite";
import { buildComponents, type GradingData } from "./aeComponents";
import { tagStatReps } from "./tagStats";
import { tierGames } from "./opponentTier";
import type { CountStatResult } from "./countComponents";

export interface ModelCheck {
  key: CorrectionKey;
  label: string;
  readiness: TagReadiness[];
  /** Held-out results for the testable tags (empty until any is). */
  tests: TagTestResult[];
  garbage: GarbageTimeTest;
  garbageWeight: number;
  eras: EraResiduals;
  drift: EraDrift;
  recentered: boolean;
}

export interface ComponentCheck {
  result: CountStatResult;
  spread: MetricSpread | undefined;
  /** Median trust τ² / (τ² + v) over the qualified prospects (null = not ready). */
  medianTrust: number | null;
}

export interface GradingReport {
  models: ModelCheck[];
  components: Record<CompositePos, ComponentCheck[]>;
}

export interface GradingInputs {
  prospects: readonly Pick<Prospect, "id" | "position">[];
  games: readonly ScoutingGame[];
  qbPlays: QBPlay[];
  rbPlays: RBPlay[];
  tePlays: TEPlay[];
  /** prospect_game_route_cells (058); null when it didn't load. */
  gameRouteCells: readonly ProspectGameRouteCellsRow[] | null;
  gradingData: GradingData;
}

// One model's checks from its training rows (plays or WR cells).
function modelCheck<T extends object>(
  key: CorrectionKey,
  rows: readonly T[],
  inp: CorrectionInputs<T>,
  fitted: FittedDifficulty<T>,
  buildBase: (rows: readonly T[]) => FittedDifficulty<T>,
  prospectOf: (row: T) => string | undefined,
  gameOf: (row: T) => string,
  eraOf: (row: T) => ReturnType<typeof playEra>,
): ModelCheck {
  const count = inp.countOf ?? (() => 1);
  const model = fitted.model;
  // Each row's summed residual (pts) and squared residual under the model as
  // the metric uses it (with any correction on).
  const e = (row: T) => (model ? expectedFor({ ...fitted, model }, row) : 0);
  const resid = (row: T) => 100 * count(row) * (inp.outcome(row) - e(row));
  const sq = (row: T) => {
    const p = e(row), y = inp.outcome(row), n = count(row);
    // A cell of n plays with k = y·n successes: k(1−p)² + (n−k)p²; a single play: (y − p)².
    return 1e4 * (n === 1 ? (y - p) ** 2 : y * n * (1 - p) ** 2 + (n - y * n) * p * p);
  };
  const eras = model ? eraResiduals(rows, eraOf, resid, count, sq) : {};
  return {
    key,
    label: CORRECTION_LABEL[key],
    readiness: tagReadiness(key, { ...inp, rows }, prospectOf),
    tests: heldOutTagTest(key, { ...inp, rows }, prospectOf, buildBase),
    garbage: garbageTimeTest(rows, inp.tagged, prospectOf, gameOf, resid, count),
    garbageWeight: GARBAGE_TIME_WEIGHT[key],
    eras,
    drift: eraDrift(eras),
    recentered: RECENTER_TAGGED[key],
  };
}

function playModelCheck<T extends { game_id: string }>(
  spec: AEModelSpec<T>,
  plays: T[],
  gamesById: ReadonlyMap<string, ScoutingGame>,
): ModelCheck {
  const rows = spec.select(plays);
  const tagged = (pl: T) => isTaggedPlay(pl, spec.pos);
  return modelCheck(
    spec.key,
    rows,
    { rows, outcome: spec.outcome, tagged },
    fitSpec(spec, plays),
    (train) => fitFromPlays([...train], spec.design, spec.outcome, spec.lambda),
    (pl) => gamesById.get(pl.game_id)?.prospect_id,
    (pl) => pl.game_id,
    (pl) => playEra(pl, gamesById.get(pl.game_id), spec.pos),
  );
}

function wrModelCheck(inp: GradingInputs, gamesById: ReadonlyMap<string, ScoutingGame>): ModelCheck | null {
  if (!inp.gameRouteCells) return null;
  const cells = wrGradingCells(inp.gameRouteCells, inp.gradingData.routeTagCells, inp.games);
  const fitted = buildWRModel([...inp.gameRouteCells], inp.games, inp.gradingData.routeTagCells);
  return modelCheck<WRGradingCell>(
    "wr_sae",
    cells,
    { rows: cells, outcome: (c) => c.open / c.n, tagged: (c) => c.tagged === true, countOf: (c) => c.n },
    fitted,
    (train) => fitWRGradingModel(train),
    (c) => c.prospect_id,
    (c) => c.game_id,
    (c) => (c.tagged ? "tagged" : gameSource(gamesById.get(c.game_id))),
  );
}

const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);

export function buildGradingReport(inp: GradingInputs): GradingReport {
  const gamesById = new Map(inp.games.map((g) => [g.id, g]));
  const models: ModelCheck[] = [
    playModelCheck(QB_MODEL_SPEC, inp.qbPlays, gamesById),
    playModelCheck(RB_MODEL_SPEC, inp.rbPlays, gamesById),
    ...[wrModelCheck(inp, gamesById)].filter((m): m is ModelCheck => m != null),
    playModelCheck(TE_ROUTE_MODEL_SPEC, inp.tePlays, gamesById),
    playModelCheck(TE_BLOCK_MODEL_SPEC, inp.tePlays, gamesById),
  ];

  // Every component, and its spread as the composite would see it (the core
  // metrics are left out, so only the components' spreads are read).
  const built = buildComponents({
    prospects: inp.prospects, games: inp.games, tierByGame: tierGames(inp.games).byGame,
    qbPlays: inp.qbPlays, rbPlays: inp.rbPlays,
    pffGameRows: inp.gradingData.pffGameRows, wrRouteCounts: inp.gradingData.routeCounts,
    tagReps: tagStatReps({ games: inp.games, qbPlays: inp.qbPlays, rbPlays: inp.rbPlays, tePlays: inp.tePlays, wrTagRows: inp.gradingData.routeTagCells }),
  });
  const none = new Map();
  const composite = buildAEComposite({ qb: none, rb: none, wr: none, wrCore: none, teRoute: none, teBlock: none, extra: built.extra });
  const components = { QB: [], RB: [], WR: [], TE: [] } as Record<CompositePos, ComponentCheck[]>;
  for (const result of built.results) {
    const spread = composite.positions[result.def.pos].metrics.find((m) => m.key === result.def.key);
    const tau2 = spread?.tau != null ? spread.tau ** 2 : null;
    const trusts = tau2 != null
      ? [...result.samples.values()].filter((s) => s != null).map((s) => tau2 / (tau2 + Math.max(1e-12, s!.variance)))
      : [];
    components[result.def.pos].push({ result, spread, medianTrust: tau2 != null ? median(trusts) : null });
  }
  return { models, components };
}
