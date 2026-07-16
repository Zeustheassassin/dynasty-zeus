"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";

// ============================================================
// usePlayerValueHistory — reads the daily dynasty-value history written
// by app/api/cron/player-value-history (migration 047), feeding the
// Phase D stage D4 (PlayerProfilePanel) / D5 (PowerRankingsTab) value
// trend charts a real time series instead of the 2-point comparison
// they shipped with — see project_platform_upgrade_phase_d_july16
// memory. Not user-scoped (RLS disabled, shared read-only cache — same
// trust model as league_simulation_history / useSimulationHistory.ts),
// so this is a plain `.in("player_id", …)` read.
//
// Callers must memoize `playerIds` (same requirement as
// useDashboardPlayoffOdds' `entries` — an inline array/object literal
// would create a new reference every render and re-fire the effect).
// ============================================================

const log = logger("hooks/usePlayerValueHistory");

// PostgREST handles large IN lists fine, but batching keeps any single
// request's URL/response small and predictable for wide rosters × many teams.
const CHUNK_SIZE = 200;

export interface PlayerValuePoint {
  date: string;
  value: number;
}

export function usePlayerValueHistory(playerIds: string[]) {
  const [historyByPlayer, setHistoryByPlayer] = useState<Record<string, PlayerValuePoint[]>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!playerIds.length) {
      setHistoryByPlayer({}); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      const chunks: string[][] = [];
      for (let i = 0; i < playerIds.length; i += CHUNK_SIZE) chunks.push(playerIds.slice(i, i + CHUNK_SIZE));

      const results = await Promise.all(
        chunks.map((chunk) =>
          supabase
            .from("player_value_history")
            .select("player_id,snapshot_date,value")
            .in("player_id", chunk)
            .order("snapshot_date", { ascending: true })
        )
      );
      if (cancelled) return;

      const byPlayer: Record<string, PlayerValuePoint[]> = {};
      let hadError = false;
      results.forEach(({ data, error }) => {
        if (error) { hadError = true; log.error("player_value_history read failed", { err: error.message }); return; }
        (data ?? []).forEach((row) => {
          if (!byPlayer[row.player_id]) byPlayer[row.player_id] = [];
          byPlayer[row.player_id].push({ date: row.snapshot_date, value: row.value });
        });
      });
      setHistoryByPlayer(hadError ? {} : byPlayer);
      setLoadingHistory(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [playerIds]);

  return { historyByPlayer, loadingHistory };
}
