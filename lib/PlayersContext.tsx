"use client";
import React, { createContext, useContext } from "react";
import type { SleeperPlayer } from "./types";

type PlayersMap = Record<string, SleeperPlayer>;

const PlayersContext = createContext<PlayersMap>({});

export function PlayersProvider({
  players,
  children,
}: {
  players: PlayersMap;
  children: React.ReactNode;
}) {
  return (
    <PlayersContext.Provider value={players}>
      {children}
    </PlayersContext.Provider>
  );
}

/** Returns the full Sleeper player map. Stable reference — only updates when the map itself changes. */
export function usePlayers(): PlayersMap {
  return useContext(PlayersContext);
}
