"use client";
import { useMemo } from "react";
import type { SleeperRoster, LeagueOverviewEntry } from "../../lib/types";
import { useDashboardPlayoffOdds, type LeagueRosterKey } from "../../hooks/useDashboardPlayoffOdds";
import { MultiPointSparkline } from "../charts/MultiPointSparkline";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import { getCrossLeagueDirections, DIRECTION_BUCKET_ORDER } from "../../lib/helpers";

export interface DashboardLeagueEntry {
  leagueId?: string;
  leagueName?: string;
  roster: SleeperRoster | null;
}

interface TeamSummaryGridProps {
  entries: DashboardLeagueEntry[];
  loading: boolean;
  onSelectLeague: (leagueId: string) => void;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  redraftValues: Record<string, number>;
}

// Cross-league "my teams" summary (A7) — one card per connected league,
// record from the already-loaded roster (allLeagueData, Phase-pre-existing
// cross-league-rosters fetch) plus a playoff-odds trend sparkline sourced
// from Phase F's league_simulation_history table. No new per-league fetch
// beyond the batched odds-history read. Also shows each league's strategic
// direction bucket (same Elite/True Contender/.../Hopeless vocabulary as
// Team Tools) via getCrossLeagueDirections, once leagueOverviewData loads.
export default function TeamSummaryGrid({ entries, loading, onSelectLeague, leagueOverviewData, redraftValues }: TeamSummaryGridProps) {
  const players = usePlayers();
  const { pickFcValues } = useValues();

  const oddsKeys = useMemo(() => {
    const keys: LeagueRosterKey[] = [];
    entries.forEach((e) => {
      if (e.leagueId && e.roster) keys.push({ leagueId: e.leagueId, rosterId: e.roster.roster_id });
    });
    return keys;
  }, [entries]);
  const { historyByLeague } = useDashboardPlayoffOdds(oddsKeys);

  const myRosterIdByLeague = useMemo(() => {
    const map: Record<string, number> = {};
    entries.forEach((e) => {
      if (e.leagueId && e.roster) map[e.leagueId] = e.roster.roster_id;
    });
    return map;
  }, [entries]);

  const directions = useMemo(
    () => getCrossLeagueDirections({ leagueOverviewData, myRosterIdByLeague, players, pickFcValues, redraftValues }),
    [leagueOverviewData, myRosterIdByLeague, players, pickFcValues, redraftValues]
  );

  const directionTally = useMemo(() => {
    const counts: Partial<Record<string, number>> = {};
    Object.values(directions).forEach((d) => {
      counts[d.bucket] = (counts[d.bucket] ?? 0) + 1;
    });
    return DIRECTION_BUCKET_ORDER
      .map((bucket) => ({ bucket, count: counts[bucket] ?? 0 }))
      .filter((row) => row.count > 0);
  }, [directions]);

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
    <div className="space-y-3">
      {directionTally.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {directionTally.map(({ bucket, count }) => {
            const bucketColor = Object.values(directions).find((d) => d.bucket === bucket)?.bucketColor ?? "text-gray-300 bg-gray-800 border-gray-600";
            return (
              <span
                key={bucket}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${bucketColor}`}
              >
                {bucket}
                <span className="opacity-80">×{count}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => {
          const history = entry.leagueId ? historyByLeague[entry.leagueId] : undefined;
          const latest = history && history.length > 0 ? history[history.length - 1] : null;
          const settings = entry.roster?.settings;
          const direction = entry.leagueId ? directions[entry.leagueId] : undefined;
          return (
            <button
              key={entry.leagueId ?? entry.leagueName}
              type="button"
              onClick={() => entry.leagueId && onSelectLeague(entry.leagueId)}
              className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left transition hover:border-slate-600 hover:bg-slate-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="truncate text-sm font-semibold text-white">{entry.leagueName ?? "League"}</div>
                {direction && (
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${direction.bucketColor}`}>
                    {direction.bucket}
                  </span>
                )}
              </div>
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
    </div>
  );
}
