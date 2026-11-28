"use client";
import { useMemo } from "react";
import type { SleeperLeague } from "../lib/types";
import type { LeagueFormat } from "../lib/helpers/leagueFormat";
import type { LeagueValue } from "../lib/helpers/positionalValue";
import { tierScore, type DraftBoardProspect } from "../lib/helpers/draftBoard";
import { nflDraftOver } from "../lib/helpers/draftClass";
import {
  leagueBoardRows, pickValueCurve, type LeaguePlace, type PickCurve, type ScoreRate,
} from "../lib/helpers/leagueBoard";
import { useLeaguePositionalValues } from "./useLeaguePositionalValues";

/** What the Live Draft Board shows about the order its rookie list is in. */
export interface LiveDraftOrderView {
  /** The drafting league's format (the league picked at the top of the app); null when none is picked. */
  format: LeagueFormat | null;
  /** Its multipliers against the usual format; null until the NFL seasons load, or when they fail. */
  value: LeagueValue | null;
  /** The class's pick values (the user's over FantasyCalc's); null when the class has none. */
  curve: PickCurve | null;
  /** The score the order reads: Dynasty, or Dynasty+ once the class's NFL draft is over. */
  scoreName: "Dynasty" | "Dynasty+";
  /** What a point of that score is worth on the user's Pick Values; null until the order can be read (too few scored places among the priced picks, or no multipliers / pick values yet). */
  rate: ScoreRate | null;
  seasons: number[];
  error: string | null;
  retry: () => void;
  /**
   * Each ranked prospect's place in the league's order, keyed by his place on
   * the live board (RookieBoardPlayer.boardRank). Empty while the board is in
   * OVR order.
   */
  places: ReadonlyMap<number, LeaguePlace>;
}

export interface LiveDraftLeagueOrder {
  /** The board in the drafting league's order, or as given (OVR) until that can be read. */
  rows: readonly DraftBoardProspect[];
  view: LiveDraftOrderView;
}

const NO_PLACES: ReadonlyMap<number, LeaguePlace> = new Map();

/**
 * The live draft reads the drafting league's view of the user's board (stage 3
 * of the 2026-11-27 positional value plan): the same order the Rookie Big
 * Board's "Order for" shows for that league (leagueBoardRows: the score OVR
 * follows, Dynasty until the NFL draft is over and Dynasty+ after, plus each
 * position's multiplier from League Formats as a shift priced by the user's
 * Pick Values; via useLeaguePositionalValues). Everything that goes down
 * the user's board in the live draft follows it: their own predicted slots,
 * the slot picker, Top Available. Other managers' predictions don't read it.
 *
 * Until the seasons load (or if they fail, the class has no pick values, or
 * too few of its priced places are scored) the rows stay in the order given,
 * so the live draft always has a board. The seasons load once `enabled` is
 * first true (the Live Draft Board open outside the season) and a league is
 * picked.
 */
export function useLiveDraftLeagueOrder(
  prospects: readonly DraftBoardProspect[],
  leagues: readonly SleeperLeague[],
  leagueId: string | null,
  pickValues: Record<string, number>,
  enabled: boolean,
): LiveDraftLeagueOrder {
  const pv = useLeaguePositionalValues(leagues, enabled && leagueId != null);
  const format = useMemo(
    () => (leagueId != null ? pv.formats.find((f) => f.leagueId === leagueId) ?? null : null),
    [pv.formats, leagueId],
  );
  const value = format ? pv.values?.byLeague.get(format.leagueId) ?? null : null;
  // Every row is the board's class (useDraftBoardProspects loads one class).
  const classYear = prospects.length ? prospects[0].draft_class_year : null;
  const curve = useMemo(() => (classYear != null ? pickValueCurve(pickValues, classYear) : null), [pickValues, classYear]);
  // Dynasty until the class's NFL draft is over, Dynasty+ from the Sunday the rookie drafts start.
  const plus = useMemo(() => classYear != null && nflDraftOver(classYear, new Date()), [classYear]);

  const ordered = useMemo(() => {
    if (!value || !curve) return null;
    const lb = leagueBoardRows(prospects, (p) => tierScore(p, plus), value.mult, curve);
    if (!lb) return null;
    return { rows: lb.rows, rate: lb.rate, places: new Map([...lb.places.values()].map((lp) => [lp.place, lp])) };
  }, [prospects, value, curve, plus]);

  const { seasons, error, retry } = pv;
  const view = useMemo<LiveDraftOrderView>(
    () => ({
      format, value, curve, seasons, error, retry,
      scoreName: plus ? "Dynasty+" : "Dynasty",
      rate: ordered?.rate ?? null,
      places: ordered?.places ?? NO_PLACES,
    }),
    [format, value, curve, seasons, error, retry, plus, ordered],
  );
  return { rows: ordered?.rows ?? prospects, view };
}
