"use client";
import React, { createContext, useContext } from "react";
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
  ...value
}: ValuesContextValue & { children: React.ReactNode }) {
  return <ValuesContext.Provider value={value}>{children}</ValuesContext.Provider>;
}

export function useValues(): ValuesContextValue {
  return useContext(ValuesContext);
}
