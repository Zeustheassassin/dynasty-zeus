"use client";
import { useEffect, useMemo } from "react";
import type { ProspectWithStats } from "../../../lib/types";
import type { PffTotals } from "../../../lib/pff/totals";
import { pffPos } from "../../../lib/pff/stats";
import type { CompositePos } from "../../../lib/scouting/aeComposite";
import type { DynastyWeights } from "../../../lib/scouting/dynastyScore";
import { isCompositePos, scoreViewsFrom, type ProspectScoresInput, type ScoreView } from "../../../lib/scouting/prospectScores";
import { overviewPagesFor, percentileRanks, type OverviewPage } from "../../../lib/scouting/overviewStats";
import { useDynastyWeights, useProspectScores, type UseProspectScoresReturn } from "../shared/hooks/useProspectScores";
import { productionPage } from "./production";

/** Everything the report pages read, all from ScoutingHub (the Big Board's inputs). */
export interface OverviewData extends ProspectScoresInput {
  pffTotals?: Map<string, PffTotals>;
  loadPositionPlays: (pos: "RB" | "QB" | "TE") => void;
  /** Every position's plays have loaded, so the scores are final. */
  scoresReady: boolean;
}

export interface UseProspectReportReturn {
  /** The prospect, once the hub's list has him. */
  p: ProspectWithStats | null;
  /** His position, when it's one the report covers. */
  pos: CompositePos | null;
  /** Every score, from the same hook as the Big Board. */
  scores: UseProspectScoresReturn;
  /** Live AE Scores (with the draft-day snapshot alongside for drafted classes). */
  views: Map<string, ScoreView>;
  /** The Dynasty weights saved on the Big Board. */
  weights: DynastyWeights;
  /** Overview page per prospect at his position, and their percentiles. */
  pages: Map<string, OverviewPage>;
  ranks: Map<string, Map<string, number>>;
  /** Production page (PFF numbers) per prospect at his position, and their percentiles. */
  production: Map<string, OverviewPage>;
  productionRanks: Map<string, Map<string, number>>;
  /** The hub's data, every position's plays included, has loaded. */
  ready: boolean;
  /** The hub's list of every prospect. */
  prospects: ProspectWithStats[];
}

/**
 * A prospect's report data: his scores (useProspectScores, so they match the
 * Big Board), his Overview and Production numbers, and the pools their
 * percentile chips rank against. Loads every position's plays on mount, since
 * the AE Score pools every position.
 */
export function useProspectReport(prospectId: string, data: OverviewData): UseProspectReportReturn {
  const { prospects, games, rbPlays, qbPlays, tePlays, pffTotals, loadPositionPlays, scoresReady } = data;

  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);

  const scores = useProspectScores(data);
  const { weights } = useDynastyWeights();
  const p = useMemo(() => prospects.find((x) => x.id === prospectId) ?? null, [prospects, prospectId]);
  const pos = p && isCompositePos(p.position) ? p.position : null;

  const views = useMemo(
    () => scoreViewsFrom(prospects, scores.liveScores, "live", new Date()),
    [prospects, scores.liveScores],
  );

  const pffVals = scores.pffVals;
  const pffGames = useMemo(
    () => new Map([...(pffTotals ?? new Map<string, PffTotals>())].map(([id, t]) => [id, t.games])),
    [pffTotals],
  );
  const pages = useMemo(
    () => overviewPagesFor({ prospectId, prospects, games, qbPlays, rbPlays, tePlays, pffVals, pffGames }),
    [prospectId, prospects, games, qbPlays, rbPlays, tePlays, pffVals, pffGames],
  );
  const ranks = useMemo(() => percentileRanks(pages), [pages]);

  const position = p?.position ?? null;
  const production = useMemo(() => {
    const out = new Map<string, OverviewPage>();
    const pp = position ? pffPos(position) : null;
    if (!pp) return out;
    for (const x of prospects) if (x.position === position) out.set(x.id, productionPage(pp, pffVals.get(x.id) ?? {}));
    return out;
  }, [position, prospects, pffVals]);
  const productionRanks = useMemo(() => percentileRanks(production), [production]);

  return { p, pos, scores, views, weights, pages, ranks, production, productionRanks, ready: scoresReady, prospects };
}
