"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { CURRENT_YEAR } from "../lib/helpers/season";

// ============================================================
// useSimulationHistory — reads the weekly odds-snapshot history
// written by app/api/cron/simulation-history for a single league +
// roster (Phase F stage F2, feeds the odds-tracker chart in
// SimulatorTab). league_simulation_history is NOT user-scoped (RLS
// disabled, shared read-only cache — see migration 044), so this is
// a plain `.eq("league_id", ...)` read, unlike the sibling
// league_simulations table useSimulatorState.ts reads (which is
// filtered by `user_id`).
// ============================================================

const log = logger("hooks/useSimulationHistory");

export interface SimulationHistoryPoint {
  week: number;
  playoffOdds: number;
  titleOdds: number;
  computedAt: string;
}

export interface UseSimulationHistoryReturn {
  history: SimulationHistoryPoint[];
  loadingHistory: boolean;
}

export function useSimulationHistory(
  leagueId: string | null | undefined,
  rosterId: number | null
): UseSimulationHistoryReturn {
  const [history, setHistory] = useState<SimulationHistoryPoint[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  useEffect(() => {
    if (!leagueId || rosterId == null) {
      // Clearing derived state when input conditions aren't met — same
      // accepted pattern as usePlayerStats.ts's off-season bail.
      setHistory([]); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    let cancelled = false;
    setLoadingHistory(true);

    (async () => {
      const { data, error } = await supabase
        .from("league_simulation_history")
        .select("week,playoff_odds,title_odds,computed_at")
        .eq("league_id", leagueId)
        .eq("roster_id", rosterId)
        .eq("season", CURRENT_YEAR)
        .order("week", { ascending: true });
      if (cancelled) return;
      if (error) {
        log.error("league_simulation_history read failed", { err: error.message });
        setHistory([]);
      } else {
        setHistory(
          (data ?? []).map((row) => ({
            week: row.week,
            playoffOdds: row.playoff_odds,
            titleOdds: row.title_odds,
            computedAt: row.computed_at,
          }))
        );
      }
      setLoadingHistory(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [leagueId, rosterId]);

  return { history, loadingHistory };
}
