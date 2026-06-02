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
    ],
  );
  return <ValuesContext.Provider value={value}>{children}</ValuesContext.Provider>;
}

export function useValues(): ValuesContextValue {
  return useContext(ValuesContext);
}
