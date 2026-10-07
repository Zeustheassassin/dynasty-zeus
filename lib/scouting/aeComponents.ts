// The AE Score's per-player components, assembled (tape-grading expansion,
// Stage 4). Pure. The user's own charting that no AE reads yet
// (chartedComponents.ts), PFF's results over the charted games where the user
// doesn't chart (pffComponents.ts) and the tag-only stats (tagStats.ts), each
// run through countComponents.ts into
// a pool-relative, opponent-adjusted sample, become `perPlayer` metrics of
// their position (aeComposite.ts). Every one is built, counted or not, so the
// Grading checks can show where each stands; a weight of 0 (not yet approved
// by the user) keeps it out of the score.
import type { AESample, Prospect, ScoutingGame } from "../types";
import type { PffGameRow } from "../pff/stats";
import type { CompositeMetric, CompositePos } from "./aeComposite";
import { countStat, formatRate, type CountSample, type CountStatDef, type CountStatResult } from "./countComponents";
import { PFF_COMPONENTS, PFF_COMPONENT_WEIGHTS, pffGameCounts } from "./pffComponents";
import { CHARTED_COMPONENTS, CHARTED_COMPONENT_WEIGHTS, chartedGameCounts, type ProspectGameRouteCountsRow } from "./chartedComponents";
import type { QBPlay, RBPlay } from "../types";
import { TAG_COMPONENTS, TAG_COMPONENT_WEIGHTS, tagGameCounts, type tagStatReps } from "./tagStats";
import type { OpponentTier } from "./opponentTier";
import type { ProspectGameRouteTagCellsRow } from "./aggregateMerge";
import { EMPTY_CONTEXT_DATA, type ContextCovariates, type GameContextData } from "./gameContext";

/** What the screens need beyond plays and games to build the components and
 *  tag stats: ScoutingHub's PFF game rows, the two migration-064 views and the
 *  game context (migration 065). */
export interface GradingData {
  pffGameRows: readonly PffGameRow[];
  /** prospect_game_route_counts: a WR game's charted receiving counts. */
  routeCounts: readonly ProspectGameRouteCountsRow[];
  /** prospect_game_route_tag_cells: a WR game's tagged routes. */
  routeTagCells: readonly ProspectGameRouteTagCellsRow[];
  /** Each charted game's CFD game, weather, SP+ and supporting cast (gameContext.ts). */
  context: GameContextData;
}
export const EMPTY_GRADING_DATA: GradingData = { pffGameRows: [], routeCounts: [], routeTagCells: [], context: EMPTY_CONTEXT_DATA };

export interface ComponentInputs {
  prospects: readonly Pick<Prospect, "id" | "position">[];
  games: readonly ScoutingGame[];
  /** prospect_game_pff rows (ScoutingHub). */
  pffGameRows: readonly PffGameRow[];
  tierByGame: ReadonlyMap<string, OpponentTier>;
  /** tagStatReps(...) over the loaded plays and WR tag cells. */
  tagReps: ReturnType<typeof tagStatReps>;
  qbPlays: readonly QBPlay[];
  rbPlays: readonly RBPlay[];
  /** prospect_game_route_counts (migration 064); empty before it's applied. */
  wrRouteCounts: readonly ProspectGameRouteCountsRow[];
  /** Override the approved weights (the Grading checks' what-if). */
  weights?: Readonly<Record<string, number>>;
  /** Floor on each component's true spread, as a share of its observed spread (aeComposite.ts). */
  spreadFloor?: number;
  /** Each game's context covariates (gameContext.ts), for the stats whose SP+ / weather test passed. */
  context?: ContextCovariates;
  /** Keep every sample's per-game residuals (the Grading checks' context tests). */
  byGame?: boolean;
}

// The floor on each component's true spread, as a share of its observed
// spread (the user's call, 2026-10-05: count the thin stats now rather than
// wait). At 4–5 charted games Paule–Mandel can't yet separate WR YPRR, RB YCO/A
// and YPRR, QB BTT% or WR contested catches from noise and puts their spread at
// 0. The floor assumes at least a quarter of the observed differences are real
// (0.5² = 25% of the variance), at or below a split-half test on WR YPRR for
// players with 4+ charted games. Each then counts at low trust (~8–25% today)
// that grows with more charting. Components whose measured spread is larger
// than the floor are unaffected.
export const COMPONENT_SPREAD_FLOOR = 0.5;

export interface ComponentBuild {
  /** Per position, every component as a perPlayer composite metric. */
  extra: Record<CompositePos, CompositeMetric[]>;
  /** Every component's pool, dispersion and opponent effect. */
  results: CountStatResult[];
}

/** The weight a component counts at: the override, else the approved weight. */
export function componentWeight(key: string, weights?: Readonly<Record<string, number>>): number {
  return weights?.[key] ?? CHARTED_COMPONENT_WEIGHTS[key] ?? PFF_COMPONENT_WEIGHTS[key] ?? TAG_COMPONENT_WEIGHTS[key] ?? 0;
}

function describe(def: CountStatDef, res: CountStatResult) {
  return (_id: string, s: AESample): string => {
    const rate = (s as CountSample).rate;
    const parts = [`${formatRate(def, rate)} on ${s.n} ${def.unit}`];
    if (res.poolRate != null) parts.push(`(pool ${formatRate(def, res.poolRate)})`);
    if (s.rawAe != null) {
      const shift = def.dir * (s.ae - s.rawAe);
      const what = res.context?.weather ? "opponents and weather" : res.context?.opponent === "sp" ? "opponent defenses" : "opponents";
      parts.push(`(${shift >= 0 ? "+" : "−"}${formatRate(def, Math.abs(shift))} for ${what})`);
    }
    return parts.join(" ");
  };
}

export function buildComponents(inp: ComponentInputs): ComponentBuild {
  const posOf = new Map(inp.prospects.map((p) => [p.id, p.position]));
  const extra: Record<CompositePos, CompositeMetric[]> = { QB: [], RB: [], WR: [], TE: [] };
  const results: CountStatResult[] = [];
  const add = (def: CountStatDef, res: CountStatResult) => {
    results.push(res);
    extra[def.pos].push({
      key: def.key,
      label: def.source === "pff" ? `PFF ${def.label}` : def.source === "tag" ? `Tag ${def.label}` : def.label,
      weight: componentWeight(def.key, inp.weights),
      samples: res.samples,
      perPlayer: true,
      ...(def.additive ? { additive: true as const } : {}),
      describe: describe(def, res),
      spreadFloor: inp.spreadFloor ?? COMPONENT_SPREAD_FLOOR,
      // Count components carry their own units (yards per route, %), so the
      // AE-points variance guard doesn't apply; the pooled dispersion keeps
      // their variances honest.
      minVariance: 1e-12,
    });
  };
  for (const def of CHARTED_COMPONENTS) {
    add(def, countStat(def, chartedGameCounts(def.key, { games: inp.games, qbPlays: inp.qbPlays, rbPlays: inp.rbPlays, wrRouteCounts: inp.wrRouteCounts }), inp.games, inp.tierByGame, { context: inp.context, byGame: inp.byGame }));
  }
  for (const def of PFF_COMPONENTS) {
    add(def, countStat(def, pffGameCounts(def, inp.games, inp.pffGameRows, (id) => posOf.get(id)), inp.games, inp.tierByGame, { context: inp.context, byGame: inp.byGame }));
  }
  for (const def of TAG_COMPONENTS) {
    add(def, countStat(def, tagGameCounts(def.key, inp.tagReps), inp.games, inp.tierByGame, { context: inp.context, byGame: inp.byGame }));
  }
  return { extra, results };
}
