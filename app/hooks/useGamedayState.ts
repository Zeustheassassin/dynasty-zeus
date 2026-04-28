"use client";
import { useState, useCallback } from "react";
import { sleeperApi } from "../../lib/sleeperApi";
import type { SleeperMatchup } from "../../lib/types";

export function useGamedayState() {
  const [gamedayMatchups, setGamedayMatchups] = useState<SleeperMatchup[]>([]);
  const [loadingGamedayMatchups, setLoadingGamedayMatchups] = useState(false);
  const [selectedGamedayMatchupId, setSelectedGamedayMatchupId] = useState<number | null>(null);

  const loadGamedayMatchups = useCallback(async (leagueId: string, week: number) => {
    if (!leagueId || !week) return;
    setLoadingGamedayMatchups(true);
    try {
      const data = await sleeperApi.getLeagueMatchups(leagueId, week).catch(() => [] as SleeperMatchup[]);
      setGamedayMatchups(Array.isArray(data) ? data : []);
    } finally {
      setLoadingGamedayMatchups(false);
    }
  }, []);

  return {
    gamedayMatchups,
    setGamedayMatchups,
    loadingGamedayMatchups,
    selectedGamedayMatchupId,
    setSelectedGamedayMatchupId,
    loadGamedayMatchups,
  };
}
