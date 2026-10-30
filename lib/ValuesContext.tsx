"use client";
import React, { createContext, useContext, useMemo } from "react";
import type {
  RosterDirectionProfile,
  LeagueSimulation,
  DynamicPickValue,
} from "./types";

interface ValuesContextValue {
  leagueAdjustedFcValues: Record<string, number>;
  /**
   * Raw FantasyCalc dynasty values, straight off /api/fc-values with no league
   * scoring multipliers applied. Use this wherever a value must NOT change when
   * the user switches leagues — e.g. the Draft History boards, which grade past
   * picks across every league at once. Empty in read-only spy mode.
   */
  rawFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  /** Pick values every consumer should use: FantasyCalc with the user's own values laid over it. */
  pickFcValues: Record<string, number>;
  /** FantasyCalc's pick values alone — the defaults the Pick Values editor shows. */
  marketPickFcValues: Record<string, number>;
  /** The user's own pick values by key ("2027-1.01", "2028-1"); empty when none are set. */
  pickValueOverrides: Record<string, number>;
  savePickValueOverrides: (next: Record<string, number>) => void;
  selectedLeagueDirection: RosterDirectionProfile | null;
  selectedLeagueDirectionAdjusted: RosterDirectionProfile | null;
  selectedLeagueSimulation: LeagueSimulation | null;
  selectedLeagueDynamicPickValues: Record<string, DynamicPickValue>;
  /** On-demand "what if" trade preview — re-runs the simulator with a hypothetical roster
   * swap applied. Callers invoke this only when the user asks (e.g. a Preview button), never
   * automatically, since it re-runs the full Monte Carlo simulation on the main thread. */
  previewTradeSimulation: (
    myRosterId: number,
    opponentRosterId: number,
    giveIds: string[],
    receiveIds: string[],
  ) => LeagueSimulation | null;
}

const ValuesContext = createContext<ValuesContextValue>({
  leagueAdjustedFcValues: {},
  rawFcValues: {},
  leagueAdjustedRedraftValues: {},
  pickFcValues: {},
  marketPickFcValues: {},
  pickValueOverrides: {},
  savePickValueOverrides: () => {},
  selectedLeagueDirection: null,
  selectedLeagueDirectionAdjusted: null,
  selectedLeagueSimulation: null,
  selectedLeagueDynamicPickValues: {},
  previewTradeSimulation: () => null,
});

export function ValuesProvider({
  children,
  leagueAdjustedFcValues,
  rawFcValues,
  leagueAdjustedRedraftValues,
  pickFcValues,
  marketPickFcValues,
  pickValueOverrides,
  savePickValueOverrides,
  selectedLeagueDirection,
  selectedLeagueDirectionAdjusted,
  selectedLeagueSimulation,
  selectedLeagueDynamicPickValues,
  previewTradeSimulation,
}: ValuesContextValue & { children: React.ReactNode }) {
  // The rest-spread previously rebuilt the value object on every render; memoise
  // on the individual fields so the ~18 useValues() consumers only re-render when
  // a value they read actually changes.
  const value = useMemo<ValuesContextValue>(
    () => ({
      leagueAdjustedFcValues,
      rawFcValues,
      leagueAdjustedRedraftValues,
      pickFcValues,
      marketPickFcValues,
      pickValueOverrides,
      savePickValueOverrides,
      selectedLeagueDirection,
      selectedLeagueDirectionAdjusted,
      selectedLeagueSimulation,
      selectedLeagueDynamicPickValues,
      previewTradeSimulation,
    }),
    [
      leagueAdjustedFcValues,
      rawFcValues,
      leagueAdjustedRedraftValues,
      pickFcValues,
      marketPickFcValues,
      pickValueOverrides,
      savePickValueOverrides,
      selectedLeagueDirection,
      selectedLeagueDirectionAdjusted,
      selectedLeagueSimulation,
      selectedLeagueDynamicPickValues,
      previewTradeSimulation,
    ],
  );
  return <ValuesContext.Provider value={value}>{children}</ValuesContext.Provider>;
}

export function useValues(): ValuesContextValue {
  return useContext(ValuesContext);
}
