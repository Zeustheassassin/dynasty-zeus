"use client";
import { useMemo, useState } from "react";
import type { ProspectAge } from "../../../../lib/scouting/prospectAge";
import { prospectAgeAt } from "../../../../lib/scouting/prospectAge";
import { learnOpponents, tierGames, type GameTiers, type OpponentTier } from "../../../../lib/scouting/opponentTier";
import { gameCovariates, resolveGameContexts, type ContextCovariates, type GameContext } from "../../../../lib/scouting/gameContext";
import { computeRoleFits } from "../../../../lib/scouting/roleFits";
import type { RoleFit } from "../../../../lib/scouting/roleFit";
import { pffValues, type PffTotals, type PffValues } from "../../../../lib/pff/totals";
import {
  DEFAULT_DYNASTY_WEIGHTS, type DynastyWeights, type LandingInputs,
} from "../../../../lib/scouting/dynastyScore";
import { landingInputsFrom } from "../../../../lib/scouting/landingSpot";
import { roleStandings, type RoleStanding } from "../../../../lib/scouting/roleStanding";
import type { DraftPickRow } from "../../../../lib/nflDraft";
import { chartedSeasonRows, middleUsageByProspect, type MiddleUsage } from "../../../../lib/scouting/middleUsage";
import { qbFullSeasons, qbStyleValues, type QBFullSeasons } from "../../../../lib/scouting/qbStyle";
import { qbRushingByProspect, rushingBonuses, type QBRushing, type RushingBonus } from "../../../../lib/scouting/qbRushing";
import { pastFirstRead } from "../../../../lib/scouting/chartedComponents";
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
  /** The live AE Score: the composite plus a WR's alignment penalty and a QB's middle of the field. */
  liveScores: Map<string, ScoreView>;
  /** Each QB's middle-of-the-field share over his PFF full seasons (middleUsage.ts). */
  middleUsage: Map<string, MiddleUsage>;
  /** Each QB's style and pocket profile over his PFF full seasons (qbStyle.ts). */
  qbFull: Map<string, QBFullSeasons>;
  /** Each QB's rushing over his PFF full seasons (qbRushing.ts). */
  qbRushing: Map<string, QBRushing>;
  /** The Dynasty Score's QB rushing bonus, before its slider, gated by passing. */
  rushing: Map<string, RushingBonus>;
  /** Each prospect's charted games by opponent tier, for the AE Score tooltip. */
  gamesByTier: Map<string, Record<OpponentTier, number>>;
  /** Each prospect's charted opponents' average defensive SP+, for the tooltip. */
  defenseFaced: Map<string, { avg: number; games: number }>;
  /** 247 HS class year per prospect (null when unmatched), for estimated ages. */
  hsClass: Map<string, number | null>;
  /** The whole 247 index has loaded, so every estimated age (and the Dynasty
   *  scores built on it) is final. Before that, hsClass is empty. */
  recruitsReady: boolean;
  /** Age today: the birthday if set, else estimated from the HS class. */
  ages: Map<string, ProspectAge>;
  /** Each prospect's role buckets (roleFit.ts). They feed Dynasty+ only, through role standing. */
  roleFits: Map<string, RoleFit>;
  /** Role standing at the role he'll play, 2027 classes on (roleStanding.ts): Dynasty+ for the drafted ones. */
  standings: Map<string, RoleStanding>;
  /** PFF numbers over each prospect's charted games (lib/pff/totals.ts). */
  pffVals: Map<string, PffValues>;
  /** Dynasty+ landing-spot inputs per drafted prospect, from LANDING_FIRST_CLASS on (landingSpot.ts). */
  landing: Map<string, LandingInputs>;
}

/**
 * Every prospect's scores, from ScoutingHub's data (lib/scouting/prospectScores.ts).
 * The Big Board and a prospect's Overview page both call this, so the two show
 * the same numbers. Viewing choices (live vs as of draft, the Dynasty
 * weights) stay with the screen.
 */
export function useProspectScores(
  input: ProspectScoresInput & { pffTotals?: Map<string, PffTotals>; draftPicks?: readonly DraftPickRow[] },
): UseProspectScoresReturn {
  const { prospects, games, rbPlays, qbPlays, tePlays, gameRouteCells, gradingData, pffTotals, draftPicks } = input;

  // Each game's opponent tier (P4 / G5 / FCS), for the opponent adjustment.
  // A name the tables can't read takes the opponent of its PFF link, and that
  // name is learned for the user's other games (learnOpponents).
  const learned = useMemo(() => learnOpponents(games, gradingData.context.rows), [games, gradingData.context]);
  const gameTiers = useMemo(() => tierGames(games, learned), [games, learned]);
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
  // A QB's middle of the field (10+ yds between the numbers) over PFF's full
  // seasons adds to his live AE Score (middleUsage.ts).
  // Only the seasons he was charted in (chartedSeasonRows): an older season
  // must not haunt a QB who has improved (the user, 2026-11-10).
  const seasonRows = useMemo(() => chartedSeasonRows(gradingData.pffSeasonDepth ?? [], games), [gradingData.pffSeasonDepth, games]);
  const middleUsage = useMemo(() => middleUsageByProspect(seasonRows), [seasonRows]);
  const liveScores = useMemo(() => liveScoresFrom(prospects, ae.composite, middleUsage), [prospects, ae.composite, middleUsage]);
  // A QB's rushing over PFF's full seasons and the Dynasty Score's rushing
  // bonus, gated by his passing (qbRushing.ts).
  const qbRushing = useMemo(() => qbRushingByProspect(seasonRows), [seasonRows]);
  const rushing = useMemo(
    () => rushingBonuses(prospects, liveScores, ae.composite, qbRushing),
    [prospects, liveScores, ae.composite, qbRushing],
  );

  const gamesByTier = useMemo(() => gamesByTierFrom(games, gameTiers.byGame), [games, gameTiers]);
  const defenseFaced = useMemo(() => defenseFacedFrom(games, contexts), [games, contexts]);

  // Age: the birthday when there is one, else estimated from the 247 HS class
  // year (prospectAge.ts). The estimate covers 2027-28 prospects, whose
  // birthdates no public source carries.
  const { matchProspect, complete: recruitsReady } = useRecruitIndex();
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

  // QBs' full-season style profile; its middle 10+ share and the charted read
  // rate join the PFF values as the Big Board's QB style columns (qs_*).
  const qbFull = useMemo(() => qbFullSeasons(seasonRows), [seasonRows]);
  const qbReads = useMemo(() => {
    const g2p = new Map(games.map((g) => [g.id, g.prospect_id]));
    const m = new Map<string, { num: number; den: number }>();
    for (const pl of qbPlays) {
      const r = pastFirstRead(pl);
      const pid = g2p.get(pl.game_id);
      if (r == null || !pid) continue;
      const c = m.get(pid) ?? { num: 0, den: 0 };
      c.den++; if (r) c.num++;
      m.set(pid, c);
    }
    return m;
  }, [games, qbPlays]);
  const pffVals = useMemo(() => {
    const m = new Map<string, PffValues>();
    for (const p of prospects) {
      const v = pffValues(pffTotals?.get(p.id));
      m.set(p.id, p.position === "QB" ? { ...v, ...qbStyleValues(qbFull.get(p.id), qbReads.get(p.id)) } : v);
    }
    return m;
  }, [prospects, pffTotals, qbFull, qbReads]);

  // The landing spot (2027 classes on): role standing at the role he'll play,
  // and rookie competition, his team's picks ahead of him.
  const standings = useMemo(() => roleStandings(prospects, roleFits), [prospects, roleFits]);
  const landing = useMemo(
    () => landingInputsFrom(prospects, draftPicks ?? [], roleFits, standings),
    [prospects, draftPicks, roleFits, standings],
  );

  return {
    ...ae, gameTiers, contexts, contextCov, liveScores, middleUsage, qbFull, qbRushing, rushing, gamesByTier, defenseFaced, hsClass, recruitsReady, ages, roleFits, standings, pffVals, landing,
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
