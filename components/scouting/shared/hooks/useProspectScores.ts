"use client";
import { useMemo, useState } from "react";
import type { ProspectAge } from "../../../../lib/scouting/prospectAge";
import { prospectAgeAt } from "../../../../lib/scouting/prospectAge";
import { tierGames, type GameTiers, type OpponentTier } from "../../../../lib/scouting/opponentTier";
import { gameCovariates, resolveGameContexts, type ContextCovariates, type GameContext } from "../../../../lib/scouting/gameContext";
import { computeRoleFits } from "../../../../lib/scouting/roleFits";
import type { RoleFit } from "../../../../lib/scouting/roleFit";
import { pffValues, type PffTotals, type PffValues } from "../../../../lib/pff/totals";
import {
  DEFAULT_DYNASTY_WEIGHTS, type DynastyWeights,
} from "../../../../lib/scouting/dynastyScore";
import {
  computeAEScores, defenseFacedFrom, gamesByTierFrom, liveScoresFrom,
  type AEScores, type ProspectScoresInput, type ScoreView,
} from "../../../../lib/scouting/prospectScores";
import { useRecruitIndex } from "../../../../hooks/useRecruitIndex";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

export interface UseProspectScoresReturn extends AEScores {
  /** Each game's opponent tier (P4 / G5 / FCS), and the names that didn't match a team. */
  gameTiers: GameTiers;
  /** Each charted game's automatic context (migration 065). */
  contexts: Map<string, GameContext>;
  /** The covariates the context effects read. */
  contextCov: ContextCovariates;
  /** The live AE Score (never with traits): the composite plus a WR's alignment penalty. */
  liveScores: Map<string, ScoreView>;
  /** Each prospect's charted games by opponent tier, for the AE Score tooltip. */
  gamesByTier: Map<string, Record<OpponentTier, number>>;
  /** Each prospect's charted opponents' average defensive SP+, for the tooltip. */
  defenseFaced: Map<string, { avg: number; games: number }>;
  /** 247 HS class year per prospect (null when unmatched), for estimated ages. */
  hsClass: Map<string, number | null>;
  /** Age today: the birthday if set, else estimated from the HS class. */
  ages: Map<string, ProspectAge>;
  /** Each prospect's role buckets (roleFit.ts). They feed none of the scores. */
  roleFits: Map<string, RoleFit>;
  /** PFF numbers over each prospect's charted games (lib/pff/totals.ts). */
  pffVals: Map<string, PffValues>;
}

/**
 * Every prospect's scores, from ScoutingHub's data (lib/scouting/prospectScores.ts).
 * The Big Board and a prospect's Overview page both call this, so the two show
 * the same numbers. Viewing choices (live vs as of draft, traits, the Dynasty
 * weights) stay with the screen.
 */
export function useProspectScores(
  input: ProspectScoresInput & { pffTotals?: Map<string, PffTotals> },
): UseProspectScoresReturn {
  const { prospects, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData, pffTotals } = input;

  // Each game's opponent tier (P4 / G5 / FCS), for the opponent adjustment.
  const gameTiers = useMemo(() => tierGames(games), [games]);
  // Each game's automatic context (migration 065) and the covariates the
  // context effects read: opponent defense SP+ and weather count where their
  // held-out tests passed (contextGrading.ts).
  const contexts = useMemo(() => resolveGameContexts(games, gradingData.context), [games, gradingData.context]);
  const contextCov = useMemo(() => gameCovariates(games, contexts, gameTiers.byGame), [games, contexts, gameTiers]);

  // The AE columns and the AE Score; each league model is fit once.
  const ae = useMemo(
    () => computeAEScores({ prospects, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData }, gameTiers.byGame, contextCov),
    [prospects, games, rbPlays, qbPlays, tePlays, gameTiers, gameRouteCells, gradingData, contextCov],
  );
  const liveScores = useMemo(() => liveScoresFrom(prospects, ae.composite), [prospects, ae.composite]);

  const gamesByTier = useMemo(() => gamesByTierFrom(games, gameTiers.byGame), [games, gameTiers]);
  const defenseFaced = useMemo(() => defenseFacedFrom(games, contexts), [games, contexts]);

  // Age: the birthday when there is one, else estimated from the 247 HS class
  // year (prospectAge.ts). The estimate covers 2027-28 prospects, whose
  // birthdates no public source carries.
  const { matchProspect } = useRecruitIndex();
  const hsClass = useMemo(
    () => new Map(prospects.map((p) => [p.id, matchProspect(p)?.year ?? null])),
    [prospects, matchProspect],
  );
  const ages = useMemo(() => {
    const now = new Date();
    const m = new Map<string, ProspectAge>();
    for (const p of prospects) {
      const a = prospectAgeAt(now, p.birthday, hsClass.get(p.id));
      if (a) m.set(p.id, a);
    }
    return m;
  }, [prospects, hsClass]);

  const roleFits = useMemo(
    () => computeRoleFits(prospects, games, rbPlays, qbPlays, tePlays, pffTotals),
    [prospects, games, rbPlays, qbPlays, tePlays, pffTotals],
  );

  const pffVals = useMemo(() => {
    const m = new Map<string, PffValues>();
    for (const p of prospects) m.set(p.id, pffValues(pffTotals?.get(p.id)));
    return m;
  }, [prospects, pffTotals]);

  return {
    ...ae, gameTiers, contexts, contextCov, liveScores, gamesByTier, defenseFaced, hsClass, ages, roleFits, pffVals,
  };
}

// The Dynasty sliders, persisted per browser (a viewing preference). The Big
// Board edits them; the Overview page reads the same saved weights.
const DYNASTY_WEIGHTS_KEY = "dynastyScoreWeights";

export interface UseDynastyWeightsReturn {
  weights: DynastyWeights;
  setWeight: (key: keyof DynastyWeights, value: number) => void;
  /** Back to the defaults, saved. */
  reset: () => void;
}

/** The Dynasty Score weights saved in this browser, over the defaults. */
export function useDynastyWeights(): UseDynastyWeightsReturn {
  const [weights, setWeights] = useState<DynastyWeights>(() => ({
    ...DEFAULT_DYNASTY_WEIGHTS,
    ...getLocalStorageItem<Partial<DynastyWeights>>(DYNASTY_WEIGHTS_KEY, {}),
  }));
  function setWeight(key: keyof DynastyWeights, value: number) {
    const next = { ...weights, [key]: value };
    setWeights(next);
    setLocalStorageItem(DYNASTY_WEIGHTS_KEY, next);
  }
  function reset() {
    setWeights(DEFAULT_DYNASTY_WEIGHTS);
    setLocalStorageItem(DYNASTY_WEIGHTS_KEY, DEFAULT_DYNASTY_WEIGHTS);
  }
  return { weights, setWeight, reset };
}
