"use client";
import { useMemo } from "react";
import type { SleeperRoster, LeagueOverviewEntry, CommittedSimsByLeague, CachedSimRow } from "../../lib/types";
import { useDashboardPlayoffOdds, type LeagueRosterKey } from "../../hooks/useDashboardPlayoffOdds";
import { MultiPointSparkline } from "../charts/MultiPointSparkline";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import { getCrossLeagueDirections, DIRECTION_BUCKET_ORDER } from "../../lib/helpers";
import { CardButton } from "../ui/Card";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";
import Skeleton from "../ui/Skeleton";

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
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
}

// Cross-league "my teams" summary (A7) — one card per connected league,
// record from the already-loaded roster (allLeagueData, Phase-pre-existing
// cross-league-rosters fetch) plus a playoff-odds trend sparkline sourced
// from Phase F's league_simulation_history table. No new per-league fetch
// beyond the batched odds-history read. Also shows each league's strategic
// direction bucket (same Elite/True Contender/.../Hopeless vocabulary as
// Team Tools) via getCrossLeagueDirections, once leagueOverviewData loads.
export default function TeamSummaryGrid({ entries, loading, onSelectLeague, leagueOverviewData, committedSimsByLeague, leagueSimCache }: TeamSummaryGridProps) {
  const players = usePlayers();
  // Same value source OverviewTab/LeagueMatesTab/UserScoutHub use (selected
  // league's scoring-adjusted values) — using unadjusted values here made
  // this tally's bucket counts disagree with Overview's for borderline teams.
  const { pickFcValues, leagueAdjustedFcValues, leagueAdjustedRedraftValues } = useValues();

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

  // Feed each league's latest known playoff odds into the same
  // getAdjustedDirectionBucket step OverviewTab/LeagueMatesTab/UserScoutHub
  // all apply — otherwise this tally shows the RAW pre-adjustment bucket,
  // which can disagree with the "real" bucket shown everywhere else for the
  // same team (see getCrossLeagueDirections' header comment). Source must
  // match OverviewTab's precedence (live "Run All Sims" commit, then the
  // Supabase sim cache) — the weekly league_simulation_history cron table
  // used for the sparkline below lags behind or is missing for some leagues,
  // which previously made this tally's bucket counts disagree with Overview's.
  const playoffOddsByLeague = useMemo(() => {
    const map: Record<string, number> = {};
    Object.entries(myRosterIdByLeague).forEach(([leagueId, rosterId]) => {
      const committedRow = committedSimsByLeague[leagueId]?.[rosterId];
      const cachedSimRow = leagueSimCache[leagueId]?.[rosterId];
      if (committedRow || cachedSimRow) {
        map[leagueId] = committedRow?.playoffOdds ?? cachedSimRow?.playoff_odds ?? 0;
      }
    });
    return map;
  }, [myRosterIdByLeague, committedSimsByLeague, leagueSimCache]);

  const directions = useMemo(
    () => getCrossLeagueDirections({
      leagueOverviewData, myRosterIdByLeague, players, pickFcValues,
      redraftValues: leagueAdjustedRedraftValues, dynastyValues: leagueAdjustedFcValues, playoffOddsByLeague,
    }),
    [leagueOverviewData, myRosterIdByLeague, players, pickFcValues, leagueAdjustedRedraftValues, leagueAdjustedFcValues, playoffOddsByLeague]
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
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState>Connect your Sleeper account to see a summary of every league you&apos;re in.</EmptyState>
    );
  }

  return (
    <div className="space-y-3">
      {directionTally.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {directionTally.map(({ bucket, count }) => {
            const bucketColor = Object.values(directions).find((d) => d.bucket === bucket)?.bucketColor ?? "text-gray-300 bg-gray-800 border-gray-600";
            return (
              <Badge key={bucket} className={`gap-1.5 py-1 ${bucketColor}`}>
                {bucket}
                <span className="opacity-80">×{count}</span>
              </Badge>
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
            <CardButton
              key={entry.leagueId ?? entry.leagueName}
              onClick={() => entry.leagueId && onSelectLeague(entry.leagueId)}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="truncate text-sm font-semibold text-white">{entry.leagueName ?? "League"}</div>
                {direction && (
                  <Badge className={`text-[10px] ${direction.bucketColor}`}>{direction.bucket}</Badge>
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
            </CardButton>
          );
        })}
      </div>
    </div>
  );
}
