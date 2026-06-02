"use client";
import React, { createContext, useContext, useMemo } from "react";
import type { SleeperRoster } from "./types";

interface RosterContextValue {
  /** The authenticated user's own roster in the selected league, or null. */
  myRoster: SleeperRoster | null;
}

const RosterContext = createContext<RosterContextValue>({
  myRoster: null,
});

export function RosterProvider({
  myRoster,
  children,
}: RosterContextValue & { children: React.ReactNode }) {
  const value = useMemo<RosterContextValue>(() => ({ myRoster }), [myRoster]);
  return <RosterContext.Provider value={value}>{children}</RosterContext.Provider>;
}

/**
 * Returns the current user's own roster in the active league.
 * Returns `{ myRoster: null }` when no league is selected or the user is
 * not a member of the selected league.
 */
export function useMyRoster(): RosterContextValue {
  return useContext(RosterContext);
}
