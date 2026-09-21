"use client";
import { useState, useCallback, useRef } from "react";
import { sleeperApi } from "../../lib/sleeperApi";
import type { SleeperMatchup } from "../../lib/types";

export interface LoadGamedayMatchupsOpts {
  /** Skip the browser + 5-minute server caches (live scoring). */
  bypass?: boolean;
  /** A background poll: no loading flash, and a failure keeps what's on screen. */
  silent?: boolean;
}

export function useGamedayState() {
  const [gamedayMatchups, setGamedayMatchups] = useState<SleeperMatchup[]>([]);
  const [loadingGamedayMatchups, setLoadingGamedayMatchups] = useState(false);
  const [selectedGamedayMatchupId, setSelectedGamedayMatchupId] = useState<number | null>(null);
  const [gamedayMatchupsUpdatedAt, setGamedayMatchupsUpdatedAt] = useState<number | null>(null);
  // The league/week the screen currently wants. A slow poll for a league the user
  // has since switched away from must not overwrite the new league's matchups.
  const latestKeyRef = useRef("");

  const loadGamedayMatchups = useCallback(async (leagueId: string, week: number, opts?: LoadGamedayMatchupsOpts) => {
    if (!leagueId || !week) return;
    const key = `${leagueId}:${week}`;
    const silent = !!opts?.silent;
    if (!silent) {
      latestKeyRef.current = key;
      setLoadingGamedayMatchups(true);
    }
    try {
      const data = await sleeperApi.getLeagueMatchups(leagueId, week, opts?.bypass);
      if (latestKeyRef.current !== key) return; // superseded
      setGamedayMatchups(Array.isArray(data) ? data : []);
      setGamedayMatchupsUpdatedAt(Date.now());
    } catch {
      if (!silent && latestKeyRef.current === key) setGamedayMatchups([]);
    } finally {
      if (!silent && latestKeyRef.current === key) setLoadingGamedayMatchups(false);
    }
  }, []);

  return {
    gamedayMatchups,
    setGamedayMatchups,
    loadingGamedayMatchups,
    gamedayMatchupsUpdatedAt,
    selectedGamedayMatchupId,
    setSelectedGamedayMatchupId,
    loadGamedayMatchups,
  };
}
