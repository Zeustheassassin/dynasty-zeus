// ============================================================
// Every prospect's scores, the one place they're computed. The Big Board and a
// prospect's Overview page both read these (through useProspectScores), so the
// two always show the same AE Score, Dynasty, Dynasty+ and AE columns.
// ============================================================
// Pure: no React. The pieces mirror the Big Board's memo chain so the hook
// can keep the same memo granularity:
//   games → tierGames → resolveGameContexts → gameCovariates
//   → computeAEScores (AE columns, composite, opponent / context info)
//   → liveScoresFrom → scoreViewsFrom (live or as of draft) → dynastyScores.
// ============================================================

import type { AESample, ProspectWithStats, QBPlay, RBPlay, ScoreComponent, ScoutingGame, TEPlay } from "../types";
import {
  computeRBAboveExpectedSamples,
  computeQBAboveExpectedSamples,
  computeTERouteAboveExpectedSamples,
  computeTEBlockAboveExpectedSamples,
  computeQBThrowSliceAAE,
  computeRBRunSliceSRAE,
  aeValues,
  type AESlice,
} from "./aboveExpected";
import { buildAEComposite, MIN_POOL, type AEComposite, type CompositePos } from "./aeComposite";
import { scoreDynasty, type DynastyBreakdown, type DynastyWeights } from "./dynastyScore";
import { rookieSeasonAge, parseHeightInches } from "./prospectAge";
import type { OpponentTier } from "./opponentTier";
import { applyOpponentStrength, type OpponentAdjusted } from "./opponentAdjust";
import { activeLock } from "./scoreLock";
import { alignmentPenalty } from "./alignmentPenalty";
import { buildWRGameSplits, buildWRTierSplits, type ProspectGameRouteCellsRow } from "./aggregateMerge";
import type { ContextCovariates, GameContext } from "./gameContext";
import { contextAdjust, type HeadlineKey, type MetricContext } from "./contextGrading";
import { buildComponents, type GradingData } from "./aeComponents";
import { tagStatReps } from "./tagStats";

export const COMPOSITE_POS: CompositePos[] = ["QB", "RB", "WR", "TE"];
export const isCompositePos = (pos: string): pos is CompositePos => (COMPOSITE_POS as string[]).includes(pos);

// The composite's headline metric keys → the context policy's (contextGrading.ts).
export const COMPOSITE_HEADLINE: Record<string, HeadlineKey | undefined> = {
  aae: "qb_aae", srae: "rb_srae", sae: "wr_sae", csae: "wr_csae", te_saer: "te_saer", te_saeb: "te_saeb",
};

/** One column per Above-Expected metric: the six headlines plus the QB / RB breakdown slices. */
export type AEKey =
  | "aae" | "srae" | "sae" | "csae" | "te_saer" | "te_saeb"
  | "aae_out" | "aae_in" | "aae_deep" | "aae_mid" | "aae_short"
  | "srae_out" | "srae_in" | "srae_zone" | "srae_mg";
/** Per AE column, each prospect's value (null = under that metric's sample floor). */
export type AEMaps = Record<AEKey, Map<string, number | null>>;

export type CompositeInputs = Parameters<typeof buildAEComposite>[0];

/** The plays, games and per-game data every score is built from (all from ScoutingHub). */
export interface ProspectScoresInput {
  prospects: ProspectWithStats[];
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  /** Per-game WR route cells (migration 058); null when the view didn't load. */
  gameRouteCells: ProspectGameRouteCellsRow[] | null;
  gradingData: GradingData;
}

export interface AEScores {
  aeMaps: AEMaps;
  composite: AEComposite;
  compositeInputs: CompositeInputs;
  opponent: OpponentAdjusted["effects"];
  contextInfo: Record<HeadlineKey, MetricContext>;
}

/**
 * The AE columns and the cross-position AE Score. Each league model is fit once:
 * the headline samples feed both. The AE Score (and the Dynasty scores built on
 * it) take the samples after the opponent-strength adjustment (opponentAdjust.ts)
 * and the context effects whose held-out tests passed (contextGrading.ts); the
 * AE columns keep the unadjusted values, by the user's call.
 */
export function computeAEScores(
  input: ProspectScoresInput,
  tiers: ReadonlyMap<string, OpponentTier>,
  contextCov: ContextCovariates,
): AEScores {
  const { prospects, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData } = input;
  const sae = new Map<string, number | null>();
  const csae = new Map<string, number | null>();
  const wr = new Map<string, AESample | null>();
  const wrCore = new Map<string, AESample | null>();
  for (const p of prospects) {
    if (p.position !== "WR") continue;
    sae.set(p.id, p.adj_success_above_exp);
    csae.set(p.id, p.core_sae);
    wr.set(p.id, p.sae_sample);
    wrCore.set(p.id, p.core_sae_sample);
  }
  const qb = computeQBAboveExpectedSamples(prospects, games, qbPlays, { byGame: true });
  const rb = computeRBAboveExpectedSamples(prospects, games, rbPlays, tiers, { byGame: true });
  const teRoute = computeTERouteAboveExpectedSamples(prospects, games, tePlays, tiers, { byGame: true });
  const teBlock = computeTEBlockAboveExpectedSamples(prospects, games, tePlays, tiers, { byGame: true });
  // WR's tier splits come from the per-game cells; without them WR (and so
  // RB and TE, which borrow WR's effect) stays unadjusted.
  const splits = gameRouteCells ? buildWRTierSplits(gameRouteCells, (id) => tiers.get(id), games, gradingData.routeTagCells) : null;
  const withSplits = (m: Map<string, AESample | null>, by: Map<string, NonNullable<AESample["byTier"]>> | undefined) =>
    by ? new Map([...m].map(([id, smp]) => [id, smp ? { ...smp, byTier: by.get(id) ?? {} } : smp])) : m;
  // And by game, for the context effects.
  const gameSplits = gameRouteCells ? buildWRGameSplits(gameRouteCells, games, gradingData.routeTagCells) : null;
  const withGames = (m: Map<string, AESample | null>, by: Map<string, NonNullable<AESample["byGame"]>> | undefined) =>
    by ? new Map([...m].map(([id, smp]) => [id, smp ? { ...smp, byGame: by.get(id) ?? {} } : smp])) : m;
  const wrRaw = withGames(withSplits(wr, splits?.all), gameSplits?.all);
  const wrCoreRaw = withGames(withSplits(wrCore, splits?.core), gameSplits?.core);
  const opp = applyOpponentStrength({ rb, wr: wrRaw, wrCore: wrCoreRaw, teRoute, teBlock });
  // Opponent defense SP+ / weather where their tests passed; everything else
  // keeps today's tier adjustment untouched.
  const qbC = contextAdjust("qb_aae", "QB", qb, qb, contextCov);
  const rbC = contextAdjust("rb_srae", "RB", rb, opp.rb, contextCov);
  const wrC = contextAdjust("wr_sae", "WR", wrRaw, opp.wr, contextCov);
  const wrCoreC = contextAdjust("wr_csae", "WR", wrCoreRaw, opp.wrCore, contextCov);
  const teRouteC = contextAdjust("te_saer", "TE", teRoute, opp.teRoute, contextCov);
  const teBlockC = contextAdjust("te_saeb", "TE", teBlock, opp.teBlock, contextCov);
  // Breakdown slices come back as one record per prospect; split each slice
  // out into its own column map.
  const sliceCol = <K extends string>(m: Map<string, Record<K, AESlice>>, k: K) =>
    new Map([...m].map(([id, s]) => [id, s[k].ae]));
  const qbSlices = computeQBThrowSliceAAE(prospects, games, qbPlays);
  const rbSlices = computeRBRunSliceSRAE(prospects, games, rbPlays);
  const compositeInputs: CompositeInputs = {
    qb: qbC.samples, rb: rbC.samples, wr: wrC.samples, wrCore: wrCoreC.samples, teRoute: teRouteC.samples, teBlock: teBlockC.samples,
    // The per-player components: the user's charting no AE reads yet, PFF's
    // results where the user doesn't chart, and the tag-only stats.
    extra: buildComponents({
      prospects, games, tierByGame: tiers, qbPlays, rbPlays,
      pffGameRows: gradingData.pffGameRows,
      wrRouteCounts: gradingData.routeCounts,
      tagReps: tagStatReps({ games, qbPlays, rbPlays, tePlays, wrTagRows: gradingData.routeTagCells }),
      context: contextCov,
    }).extra,
  };
  return {
    aeMaps: {
      aae: aeValues(qb),
      srae: aeValues(rb),
      sae,
      csae,
      te_saer: aeValues(teRoute),
      te_saeb: aeValues(teBlock),
      aae_out: sliceCol(qbSlices, "outside"),
      aae_in: sliceCol(qbSlices, "inside"),
      aae_deep: sliceCol(qbSlices, "deep"),
      aae_mid: sliceCol(qbSlices, "intermediate"),
      aae_short: sliceCol(qbSlices, "short"),
      srae_out: sliceCol(rbSlices, "outside"),
      srae_in: sliceCol(rbSlices, "inside"),
      srae_zone: sliceCol(rbSlices, "zone"),
      srae_mg: sliceCol(rbSlices, "man_gap"),
    },
    composite: buildAEComposite(compositeInputs),
    compositeInputs,
    opponent: opp.effects,
    contextInfo: {
      qb_aae: qbC.info, rb_srae: rbC.info, wr_sae: wrC.info, wr_csae: wrCoreC.info, te_saer: teRouteC.info, te_saeb: teBlockC.info,
    },
  };
}

// The AE Score a screen shows: live, or in the "As of draft" view a drafted
// class's saved snapshot. Each part carries the position spread it was scored
// against.
export interface ScoreView {
  score: number;
  components: (ScoreComponent & { tau: number })[];
  /** A WR's alignment penalty, already in `score`. */
  alignment?: { label: string; value: number };
  /** The position's baseline shift (aeComposite POSITION_BASELINE), already in `score`. */
  baseline?: number;
  /** Set when the value shown IS the draft-day snapshot. */
  lockedAt?: string;
  /** In the live view, the draft-day snapshot for reference. */
  atDraft?: { score: number; lockedAt: string };
}

/**
 * Why a prospect at this position has no AE Score: under the sample floor, or
 * the position isn't in the score yet (too few charted, or no spread beyond
 * noise).
 */
export function aeScoreMissingReason(composite: AEComposite, pos: CompositePos): string {
  const pc = composite.positions[pos];
  const primary = pc.metrics[0];
  return pc.ready
    ? `Under the ${primary.label} sample floor`
    : primary.qualified >= MIN_POOL
      ? `${pos}s are out of the AE Score: their ${primary.label}s don't spread more than sample noise yet`
      : `${pos}s join the AE Score once ${MIN_POOL} clear the ${primary.label} sample floor (${primary.qualified} now)`;
}

/** Live scores, or a drafted class's scores as they stood at the draft (scoreLock.ts). */
export type ScoreViewMode = "live" | "draft";

/** Live AE Scores from a composite: its score plus a WR's alignment penalty. */
export function liveScoresFrom(prospects: readonly ProspectWithStats[], composite: AEComposite): Map<string, ScoreView> {
  const m = new Map<string, ScoreView>();
  for (const p of prospects) {
    const sc = composite.scores.get(p.id);
    if (!sc || !isCompositePos(p.position)) continue;
    const pc = composite.positions[p.position];
    const alignment = p.position === "WR" ? alignmentPenalty(p) : null;
    m.set(p.id, {
      score: sc.score + (alignment?.value ?? 0),
      components: sc.components.map((c) => ({ ...c, tau: pc.metrics.find((x) => x.key === c.key)?.tau ?? 0 })),
      ...(alignment ? { alignment } : {}),
      ...(sc.baseline ? { baseline: sc.baseline } : {}),
    });
  }
  return m;
}

/**
 * AE Score per prospect. Live by default: more charting sharpens the models and
 * spreads, and that should reach every class. "As of draft" swaps in a drafted
 * class's draft-day snapshot (scoreLock.ts). Live keeps the snapshot alongside
 * for the tooltip. A prospect with a snapshot but no live score falls back to
 * the snapshot.
 */
export function scoreViewsFrom(
  prospects: readonly ProspectWithStats[], live: ReadonlyMap<string, ScoreView>, mode: ScoreViewMode, now: Date,
): Map<string, ScoreView> {
  const m = new Map<string, ScoreView>();
  for (const p of prospects) {
    const lock = activeLock(p, now);
    const snapshot: ScoreView | null = lock
      ? { score: lock.score, components: lock.components, alignment: lock.alignment, baseline: lock.baseline, lockedAt: lock.locked_at }
      : null;
    const sc = live.get(p.id);
    if (snapshot && (mode === "draft" || !sc)) { m.set(p.id, snapshot); continue; }
    if (!sc) continue;
    m.set(p.id, lock ? { ...sc, atDraft: { score: lock.score, lockedAt: lock.locked_at } } : sc);
  }
  return m;
}

/** Dynasty Score (+ Plus) for every prospect with an AE Score (dynastyScore.ts). */
export function dynastyScores(
  prospects: readonly ProspectWithStats[],
  scoreViews: ReadonlyMap<string, ScoreView>,
  hsClass: ReadonlyMap<string, number | null>,
  weights: DynastyWeights,
): Map<string, DynastyBreakdown> {
  const m = new Map<string, DynastyBreakdown>();
  for (const p of prospects) {
    const sc = scoreViews.get(p.id);
    if (!sc || !isCompositePos(p.position)) continue;
    m.set(p.id, scoreDynasty({
      pos: p.position,
      aeScore: sc.score,
      rookieAge: rookieSeasonAge(p.draft_class_year, p.birthday, hsClass.get(p.id)),
      heightIn: parseHeightInches(p.height),
      weightLb: p.weight,
      draftRound: p.draft_round,
    }, weights));
  }
  return m;
}

/** Each prospect's charted games by opponent tier, for the AE Score tooltip. */
export function gamesByTierFrom(
  games: readonly ScoutingGame[], tiers: ReadonlyMap<string, OpponentTier>,
): Map<string, Record<OpponentTier, number>> {
  const m = new Map<string, Record<OpponentTier, number>>();
  for (const g of games) {
    const t = tiers.get(g.id);
    if (!t) continue;
    const r = m.get(g.prospect_id) ?? { P4: 0, G5: 0, FCS: 0 };
    r[t]++;
    m.set(g.prospect_id, r);
  }
  return m;
}

/** Each prospect's charted opponents' average defensive SP+ (FBS opponents), for the tooltip. */
export function defenseFacedFrom(
  games: readonly ScoutingGame[], contexts: ReadonlyMap<string, GameContext>,
): Map<string, { avg: number; games: number }> {
  const acc = new Map<string, { sum: number; games: number }>();
  for (const g of games) {
    const sp = contexts.get(g.id)?.oppDefSp;
    if (sp == null) continue;
    const a = acc.get(g.prospect_id) ?? { sum: 0, games: 0 };
    a.sum += sp; a.games++;
    acc.set(g.prospect_id, a);
  }
  return new Map([...acc].map(([id, a]) => [id, { avg: a.sum / a.games, games: a.games }]));
}
