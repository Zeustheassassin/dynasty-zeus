"use client";
import { useState, useCallback, useMemo } from "react";
import { applyInjuryOverrides, type EspnInjuryEntry } from "../../lib/helpers/injuryOverrides";
import type { StatLine } from "../../lib/helpers/gamedayLive";
import type { SleeperPlayer } from "../../lib/types";

/**
 * The two fresh-during-game feeds the Gameday Hub layers on top of its base data:
 *  - live cumulative stat lines (per-stat pace), and
 *  - ESPN's injury report, overlaid onto Sleeper's up-to-24h-old players map.
 *
 * Both fail soft: a failed fetch keeps whatever was loaded before, and the
 * Gameday model already degrades to points-level pace / Sleeper's own status
 * when either is empty.
 */
export function useGamedayLiveData(players: Record<string, SleeperPlayer>) {
  const [liveStatsByPlayerId, setLiveStatsByPlayerId] = useState<Record<string, StatLine>>({});
  const [liveStatsUpdatedAt, setLiveStatsUpdatedAt] = useState<number | null>(null);
  const [injuries, setInjuries] = useState<EspnInjuryEntry[]>([]);

  const loadLiveStats = useCallback(async (season: string | number, week: number) => {
    if (!season || !week) return;
    try {
      const res = await fetch(`/api/stats/sleeper-live?season=${season}&week=${week}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === "object") {
        setLiveStatsByPlayerId(data as Record<string, StatLine>);
        setLiveStatsUpdatedAt(Date.now());
      }
    } catch { /* keep the last good stat lines */ }
  }, []);

  const loadInjuries = useCallback(async () => {
    try {
      const res = await fetch("/api/injuries/espn");
      if (!res.ok) return;
      const data = await res.json();
      // An empty list means "couldn't get one" as often as "nobody is hurt" — keep the previous overlay.
      if (Array.isArray(data?.players) && data.players.length > 0) setInjuries(data.players as EspnInjuryEntry[]);
    } catch { /* keep the last good report */ }
  }, []);

  /** Sleeper's players map with ESPN's fresher injury status applied — feed this
   *  (not `players`) to the Gameday builders. Same reference when nothing changed. */
  const gamedayPlayers = useMemo(() => applyInjuryOverrides(players, injuries), [players, injuries]);

  return { liveStatsByPlayerId, liveStatsUpdatedAt, loadLiveStats, loadInjuries, gamedayPlayers };
}
