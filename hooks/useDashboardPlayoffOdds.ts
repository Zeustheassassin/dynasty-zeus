"use client";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseclient";
import { logger } from "../lib/logger";
import { CURRENT_YEAR } from "../lib/helpers/season";

// ============================================================
// useDashboardPlayoffOdds — cross-league sibling of useSimulationHistory
// (Phase F, feeds SimulatorTab's single-league odds chart). That hook
// takes one (league_id, roster_id) pair; the Dashboard needs the user's
// own-roster odds history across every connected league at once, so this
// batches one `.in("league_id", …)` read instead of N hook instances
// (which Rules of Hooks wouldn't allow in a loop anyway). Same
// league_simulation_history table, no new backend/migration.
// ============================================================

const log = logger("hooks/useDashboardPlayoffOdds");

export interface DashboardOddsPoint {
  week: number;
  playoffOdds: number;
  titleOdds: number;
}

export interface LeagueRosterKey {
  leagueId: string;
  rosterId: number;
}

export function useDashboardPlayoffOdds(entries: LeagueRosterKey[]) {
  const [historyByLeague, setHistoryByLeague] = useState<Record<string, DashboardOddsPoint[]>>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!entries.length) {
      setHistoryByLeague({}); // eslint-disable-line react-hooks/set-state-in-effect
      return;
    }
    let cancelled = false;
    setLoading(true);

    (async () => {
      const rosterByLeague = new Map(entries.map((e) => [e.leagueId, e.rosterId]));
      const { data, error } = await supabase
        .from("league_simulation_history")
        .select("league_id,roster_id,week,playoff_odds,title_odds")
        .in("league_id", entries.map((e) => e.leagueId))
        .eq("season", CURRENT_YEAR)
        .order("week", { ascending: true });
      if (cancelled) return;
      if (error) {
        log.error("league_simulation_history read failed", { err: error.message });
        setHistoryByLeague({});
      } else {
        const byLeague: Record<string, DashboardOddsPoint[]> = {};
        (data ?? []).forEach((row) => {
          if (rosterByLeague.get(row.league_id) !== row.roster_id) return;
          if (!byLeague[row.league_id]) byLeague[row.league_id] = [];
          byLeague[row.league_id].push({
            week: row.week,
            playoffOdds: row.playoff_odds,
            titleOdds: row.title_odds,
          });
        });
        setHistoryByLeague(byLeague);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [entries]);

  return { historyByLeague, loadingOdds: loading };
}
