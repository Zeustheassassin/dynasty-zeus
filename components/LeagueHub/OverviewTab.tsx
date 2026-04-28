"use client";
import React from "react";
import {
  getBucketColor,
  getAdjustedDirectionBucket,
  getRosterDirectionProfile,
} from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { sleeperApi } from "../../lib/sleeperApi";
import type {
  SleeperLeague,
  SleeperUser,
  SleeperRoster,
  AugmentedPick,
  LeagueHubTab,
} from "../../lib/types";
import type { CommittedSimsByLeague, CachedSimRow, LeagueOverviewEntry } from "../../lib/types";
import { setLocalStorageItem, removeLocalStorageItem } from "@/lib/hooks/useLocalStorage";

interface OverviewTabProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  loadingLeagueOverview: boolean;
  leagueOverviewLoaded: boolean;
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
  simQueue: string[];
  simProgress: { done: number; total: number } | null;
  loadRoster: (league: SleeperLeague) => void;
  setLeagueHubTab: (tab: LeagueHubTab) => void;
  loadLeagueOverview: () => Promise<void>;
  loadRedraftValues: () => void;
  handleRunAllSims: () => void;
}

function OverviewTab({
  leagues,
  user,
  leagueOverviewData,
  loadingLeagueOverview,
  leagueOverviewLoaded,
  committedSimsByLeague,
  leagueSimCache,
  simQueue,
  simProgress,
  loadRoster,
  setLeagueHubTab,
  loadLeagueOverview,
  loadRedraftValues,
  handleRunAllSims,
}: OverviewTabProps) {
  const players = usePlayers();
  const { selectedLeague } = useLeague();
  const {
    leagueAdjustedFcValues: calcFcValues,
    leagueAdjustedRedraftValues: redraftValues,
    pickFcValues,
  } = useValues();
  const [refreshingRosters, setRefreshingRosters] = React.useState(false);
  const [rosterRefreshProgress, setRosterRefreshProgress] = React.useState<{ done: number; total: number } | null>(null);
  const [mountedAt] = React.useState(() => Date.now());

  const handleRefreshAllRosters = React.useCallback(async () => {
    setRefreshingRosters(true);
    const total = leagues.length;
    setRosterRefreshProgress({ done: 0, total });
    // Clear both cache layers: leagueData_* (loadRoster's 2h cache) and
    // sleeperCache:* (cachedFetch's 5m cache). The bypass: true flag below
    // also forces the server proxy to skip its Next.js Data Cache.
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("leagueData_") || key?.startsWith("sleeperCache:")) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => removeLocalStorageItem(k));
    await Promise.all(
      leagues.map((league) =>
        Promise.all([
          sleeperApi.getLeagueRosters(league.league_id, true).catch(() => [] as SleeperRoster[]),
          sleeperApi.getLeagueTradedPicks(league.league_id, true),
          sleeperApi.getLeagueDrafts(league.league_id, true),
          sleeperApi.getLeagueUsers(league.league_id, true),
        ]).then(([allRosters, tradedPicksData, draftsData]) => {
          setLocalStorageItem(
            `leagueData_${league.league_id}`,
            { data: { allRosters, tradedPicksData, draftsData }, cachedAt: Date.now() }
          );
          setRosterRefreshProgress((prev) => prev ? { done: prev.done + 1, total: prev.total } : null);
        })
      )
    );
    // Rebuild the overview table state from the now-fresh cache. Without this,
    // leagueOverviewData stays stale even though the underlying caches updated.
    await loadLeagueOverview();
    if (selectedLeague) await loadRoster(selectedLeague);
    setRefreshingRosters(false);
    const t = setTimeout(() => setRosterRefreshProgress(null), 3000);
    return () => clearTimeout(t);
  }, [leagues, selectedLeague, loadRoster, loadLeagueOverview]);

  const leagueRows = React.useMemo(() => {
    const bucketOrder: Record<string, number> = {
      Elite: 0,
      "True Contender": 1,
      "Almost There": 2,
      "Fading Contender": 3,
      "Window Closing": 4,
      Purgatory: 5,
      Rebuilder: 6,
      Stranded: 7,
      "Fading Out": 8,
      Hopeless: 9,
    };
    return leagues.map((league) => {
    const entry = leagueOverviewData[league.league_id];
    if (!entry) return null;
    const lr = entry.rosters;
    const ownedPicks: AugmentedPick[] = entry.picks || [];
    const myRosterId = lr.find((r) => r.owner_id === user?.user_id)?.roster_id;
    if (!myRosterId) return null;
    const profile = getRosterDirectionProfile({
      rosterId: myRosterId,
      rosters: lr,
      ownedPicks,
      players,
      pickValues: pickFcValues,
      redraftValues,
      dynastyValueForPlayer: (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0,
    });
    if (!profile) return null;
    const committedRow = committedSimsByLeague[league.league_id]?.[Number(myRosterId)];
    const cachedSimRow = leagueSimCache[league.league_id]?.[Number(myRosterId)];
    const playoffOdds = committedRow?.playoffOdds ?? cachedSimRow?.playoff_odds ?? 0;
    const hasCachedSim = !!(committedRow ?? cachedSimRow);
    const simAge = cachedSimRow?.computed_at
      ? Math.round((mountedAt - new Date(cachedSimRow.computed_at).getTime()) / (1000 * 60 * 60))
      : null;
    const adjBucket = getAdjustedDirectionBucket(profile.bucket, profile, playoffOdds, hasCachedSim);
    const adjColor = getBucketColor(adjBucket);
    return {
      league,
      ...profile,
      bucket: adjBucket,
      bucketColor: adjColor,
      rawBucket: profile.bucket,
      playoffOdds,
      hasCachedSim,
      simAge,
    };
  }).filter((x): x is NonNullable<typeof x> => x !== null).sort((a, b) => {
    const bucketDiff = (bucketOrder[a.bucket] ?? 999) - (bucketOrder[b.bucket] ?? 999);
    if (bucketDiff !== 0) return bucketDiff;
    if (b.playoffOdds !== a.playoffOdds) return b.playoffOdds - a.playoffOdds;
    if (a.dynRank !== b.dynRank) return a.dynRank - b.dynRank;
    return a.league.name.localeCompare(b.league.name);
  });
  }, [leagues, leagueOverviewData, user, calcFcValues, redraftValues, pickFcValues, players, committedSimsByLeague, leagueSimCache, mountedAt]);

  if (loadingLeagueOverview && !leagueOverviewLoaded) return <p className="text-sm text-blue-400">Loading league data…</p>;
  if (!leagues.length) return <p className="text-sm text-gray-500">No leagues found.</p>;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[780px] space-y-2">
          <div className="flex items-center gap-3 pb-1">
            <button
              onClick={handleRunAllSims}
              disabled={simQueue.length > 0}
              className="text-[11px] font-semibold px-3 py-1 rounded-full border border-blue-600 text-blue-400 hover:bg-blue-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {simQueue.length > 0 ? "Simulating…" : "Run All Sims"}
            </button>
            <button
              onClick={handleRefreshAllRosters}
              disabled={refreshingRosters}
              title="Clear roster cache and re-fetch all leagues from Sleeper"
              className="flex items-center gap-1 text-[11px] font-semibold px-3 py-1 rounded-full border border-gray-600 text-gray-400 hover:border-gray-400 hover:text-gray-200 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" className={`w-3 h-3 ${refreshingRosters ? "animate-spin" : ""}`}>
                <path fillRule="evenodd" d="M13.836 2.477a.75.75 0 0 1 .75.75v3.182a.75.75 0 0 1-.75.75h-3.182a.75.75 0 0 1 0-1.5h1.37l-.84-.841a4.5 4.5 0 0 0-7.08 1.196.75.75 0 1 1-1.31-.734 6 6 0 0 1 9.44-1.595l.842.841V3.227a.75.75 0 0 1 .75-.75Zm-.911 7.5A.75.75 0 0 1 13.199 11a6 6 0 0 1-9.44 1.595l-.842-.841v1.017a.75.75 0 0 1-1.5 0V9.591a.75.75 0 0 1 .75-.75H5.35a.75.75 0 0 1 0 1.5H3.98l.84.841a4.5 4.5 0 0 0 7.08-1.196.75.75 0 0 1 1.025-.009Z" clipRule="evenodd" />
              </svg>
              {refreshingRosters ? "Refreshing…" : "Refresh Rosters"}
            </button>
            {simProgress && (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${(simProgress.done / simProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {simProgress.done === simProgress.total
                    ? `Done — ${simProgress.total} leagues updated`
                    : `${simProgress.done} / ${simProgress.total}`}
                </span>
              </div>
            )}
            {rosterRefreshProgress && (
              <div className="flex-1 flex items-center gap-2 min-w-0">
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gray-400 rounded-full transition-all duration-300"
                    style={{ width: `${(rosterRefreshProgress.done / rosterRefreshProgress.total) * 100}%` }}
                  />
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {rosterRefreshProgress.done === rosterRefreshProgress.total
                    ? `Done — ${rosterRefreshProgress.total} leagues refreshed`
                    : `${rosterRefreshProgress.done} / ${rosterRefreshProgress.total} leagues`}
                </span>
              </div>
            )}
          </div>
          <div className="grid grid-cols-[minmax(220px,1.4fr)_minmax(150px,1fr)_72px_72px_72px_72px_72px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
            <span>League</span>
            <span>Direction</span>
            <span className="text-center">Dyn</span>
            <span className="text-center">Rdft</span>
            <span className="text-center">Stnd</span>
            <span className="text-center">MaxPF</span>
            <span className="text-center">Playoff%</span>
          </div>
          {leagueRows.map((row) => (
            <div key={row.league.league_id} className={`grid grid-cols-[minmax(220px,1.4fr)_minmax(190px,1.15fr)_72px_72px_72px_72px_72px] gap-2 items-center bg-gray-900 border rounded-xl px-3 py-2.5 transition-colors ${simQueue[0] === row.league.league_id ? "border-blue-700" : "border-gray-800"}`}>
              <button className="min-w-0 text-sm text-white font-medium text-left truncate hover:text-blue-400 transition" onClick={() => { loadRoster(row.league); setLeagueHubTab("ROSTERS"); }}>
                {row.league.name}
              </button>
              <div className="min-w-0">
                <span className={`inline-flex max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-full border text-center truncate ${row.bucketColor}`}>{row.bucket}</span>
                <div className="mt-1 text-[10px] text-gray-500 truncate">{row.shortAction}</div>
              </div>
              <span className="text-xs text-center text-gray-300">{row.dynRank}<span className="text-gray-600">/{row.n}</span></span>
              <span className="text-xs text-center text-gray-300">{row.redRank}<span className="text-gray-600">/{row.n}</span></span>
              <span className="text-xs text-center text-gray-300">{row.standRank}<span className="text-gray-600">/{row.n}</span></span>
              <span className="text-xs text-center text-gray-300">{row.maxPfRank}<span className="text-gray-600">/{row.n}</span></span>
              <div className="text-center">
                {row.hasCachedSim ? (
                  <div>
                    <span className={`text-xs font-mono font-semibold ${row.playoffOdds >= 50 ? "text-green-400" : row.playoffOdds >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                      {row.playoffOdds}%
                    </span>
                    {row.simAge !== null && (
                      <div className={`text-[10px] ${row.simAge > 48 ? "text-orange-500" : "text-gray-600"}`}>
                        {row.simAge < 1 ? "just now" : row.simAge < 24 ? `${row.simAge}h ago` : `${Math.round(row.simAge / 24)}d ago`}
                      </div>
                    )}
                  </div>
                ) : (
                  <button
                    className="text-[10px] text-blue-500 hover:text-blue-400 transition underline-offset-2 hover:underline"
                    onClick={() => { loadRoster(row.league); setLeagueHubTab("SIMULATOR"); }}
                  >
                    run sim →
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      {!leagueOverviewLoaded && !loadingLeagueOverview && (
        <button onClick={() => { loadLeagueOverview(); loadRedraftValues(); }} className="text-xs text-blue-400 hover:text-blue-300 border border-blue-700 rounded-lg px-3 py-1.5 transition">
          Load Overview
        </button>
      )}
    </div>
  );
}

export default React.memo(OverviewTab);
