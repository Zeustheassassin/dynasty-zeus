"use client";
import { useMemo } from "react";
import type { SleeperRoster } from "../../lib/types";
import { useDashboardPlayoffOdds, type LeagueRosterKey } from "../../hooks/useDashboardPlayoffOdds";
import { MultiPointSparkline } from "../charts/MultiPointSparkline";

export interface DashboardLeagueEntry {
  leagueId?: string;
  leagueName?: string;
  roster: SleeperRoster | null;
}

interface TeamSummaryGridProps {
  entries: DashboardLeagueEntry[];
  loading: boolean;
  onSelectLeague: (leagueId: string) => void;
}

// Cross-league "my teams" summary (A7) — one card per connected league,
// record from the already-loaded roster (allLeagueData, Phase-pre-existing
// cross-league-rosters fetch) plus a playoff-odds trend sparkline sourced
// from Phase F's league_simulation_history table. No new per-league fetch
// beyond the batched odds-history read.
export default function TeamSummaryGrid({ entries, loading, onSelectLeague }: TeamSummaryGridProps) {
  const oddsKeys = useMemo(() => {
    const keys: LeagueRosterKey[] = [];
    entries.forEach((e) => {
      if (e.leagueId && e.roster) keys.push({ leagueId: e.leagueId, rosterId: e.roster.roster_id });
    });
    return keys;
  }, [entries]);
  const { historyByLeague } = useDashboardPlayoffOdds(oddsKeys);

  if (loading && entries.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-800 bg-slate-900/40" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
        Connect your Sleeper account to see a summary of every league you&apos;re in.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((entry) => {
        const history = entry.leagueId ? historyByLeague[entry.leagueId] : undefined;
        const latest = history && history.length > 0 ? history[history.length - 1] : null;
        const settings = entry.roster?.settings;
        return (
          <button
            key={entry.leagueId ?? entry.leagueName}
            type="button"
            onClick={() => entry.leagueId && onSelectLeague(entry.leagueId)}
            className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-slate-600 hover:bg-slate-900"
          >
            <div className="truncate text-sm font-semibold text-white">{entry.leagueName ?? "League"}</div>
            <div className="mt-2 flex items-center justify-between">
              <span className="font-mono text-sm text-slate-300">
                {settings ? `${settings.wins}-${settings.losses}${settings.ties > 0 ? `-${settings.ties}` : ""}` : "—"}
              </span>
              {history && history.length >= 2 && (
                <MultiPointSparkline values={history.map((h) => h.playoffOdds)} higherIsBetter />
              )}
            </div>
            <div className="mt-2 text-[11px] text-slate-500">
              {latest
                ? `${latest.playoffOdds.toFixed(0)}% playoff · ${latest.titleOdds.toFixed(0)}% title odds`
                : "No simulator history yet"}
            </div>
          </button>
        );
      })}
    </div>
  );
}
