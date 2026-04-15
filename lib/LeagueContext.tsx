"use client";
import React, { createContext, useContext } from "react";
import type { SleeperLeague, SleeperRoster } from "./types";

interface LeagueContextValue {
  /** The currently selected league, or null when none is chosen. */
  selectedLeague: SleeperLeague | null;
  /** All rosters for the selected league (empty while loading). */
  rosters: SleeperRoster[];
  /** Map of roster_id → display name for every team in the league. */
  users: Record<string, string>;
}

const LeagueContext = createContext<LeagueContextValue>({
  selectedLeague: null,
  rosters: [],
  users: {},
});

export function LeagueProvider({
  selectedLeague,
  rosters,
  users,
  children,
}: LeagueContextValue & { children: React.ReactNode }) {
  return (
    <LeagueContext.Provider value={{ selectedLeague, rosters, users }}>
      {children}
    </LeagueContext.Provider>
  );
}

/**
 * Returns the selected-league context.
 * Components that already receive these as props can be migrated
 * to this hook incrementally; both paths are safe to use simultaneously.
 */
export function useLeague(): LeagueContextValue {
  return useContext(LeagueContext);
}
