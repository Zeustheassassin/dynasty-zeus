"use client";
import React, { createContext, useContext, useMemo } from "react";
import type {
  RosterDirectionProfile,
  LeagueSimulation,
  DynamicPickValue,
} from "./types";

interface ValuesContextValue {
  leagueAdjustedFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  pickFcValues: Record<string, number>;
  fcNameValues: Record<string, number>;
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
  leagueAdjustedRedraftValues: {},
  pickFcValues: {},
  fcNameValues: {},
  selectedLeagueDirection: null,
  selectedLeagueDirectionAdjusted: null,
  selectedLeagueSimulation: null,
  selectedLeagueDynamicPickValues: {},
  previewTradeSimulation: () => null,
});

export function ValuesProvider({
  children,
  leagueAdjustedFcValues,
  leagueAdjustedRedraftValues,
  pickFcValues,
  fcNameValues,
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
      leagueAdjustedRedraftValues,
      pickFcValues,
      fcNameValues,
      selectedLeagueDirection,
      selectedLeagueDirectionAdjusted,
      selectedLeagueSimulation,
      selectedLeagueDynamicPickValues,
      previewTradeSimulation,
    }),
    [
      leagueAdjustedFcValues,
      leagueAdjustedRedraftValues,
      pickFcValues,
      fcNameValues,
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
