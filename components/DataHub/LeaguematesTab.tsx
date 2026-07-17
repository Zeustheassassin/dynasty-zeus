"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { sleeperApi } from "../../lib/sleeperApi";
import type { SleeperLeague, SleeperRoster, SleeperUser, LeagueMateStatEntry } from "../../lib/types";
import { POS_COLOR } from "./dataHubHelpers";
import type { ExposureData, FetchedRoster, FetchedUser } from "./dataHubTypes";
import { CURRENT_YEAR } from "../../lib/helpers";

interface LeaguematesTabProps {
  leagueMateStats: LeagueMateStatEntry[];
  setLeagueMateStats: (stats: LeagueMateStatEntry[]) => void;
  leagueMateStatsLoaded: boolean;
  setLeagueMateStatsLoaded: (loaded: boolean) => void;
  loadingLeagueMateStats: boolean;
  setLoadingLeagueMateStats: (loading: boolean) => void;
  leagueMateSearch: string;
  setLeagueMateSearch: (s: string) => void;
  leagueMateSort: "name" | "total" | "bestball" | "shared";
  setLeagueMateSort: (sort: "name" | "total" | "bestball" | "shared") => void;
  loadUserExposure: (userId: string) => void;
  selectedUserId: string | null;
  externalShares: ExposureData | null;
  loadingShares: boolean;
  leagues: SleeperLeague[];
  user: SleeperUser | null;
}

function LeaguematesTab({
  leagueMateStats, setLeagueMateStats,
  leagueMateStatsLoaded, setLeagueMateStatsLoaded,
  loadingLeagueMateStats, setLoadingLeagueMateStats,
  leagueMateSearch, setLeagueMateSearch,
  leagueMateSort, setLeagueMateSort,
  loadUserExposure,
  externalShares, loadingShares,
  leagues, user,
}: LeaguematesTabProps) {
  const players = usePlayers();

  const [expandedMateId, setExpandedMateId] = React.useState<string | null>(null);

  const loadLeagueMateStats = async () => {
    if (!user || !leagues.length) return;
    setLoadingLeagueMateStats(true);
    try {
      const myLeagueData = await Promise.all(
        leagues.map(async (league) => {
          const [rostersRes, leagueUsersRes] = await Promise.all([
            sleeperApi.getLeagueRosters(league.league_id).catch(() => [] as SleeperRoster[]),
            sleeperApi.getLeagueUsers(league.league_id),
          ]);
          return { league, rosters: rostersRes as FetchedRoster[], leagueUsers: leagueUsersRes as FetchedUser[] };
        })
      );

      const displayNameMap: Record<string, string> = {};
      const sharedLeaguesCount: Record<string, number> = {};
      const allOwnerIds = new Set<string>();

      myLeagueData.forEach(({ rosters: lr, leagueUsers }) => {
        leagueUsers.forEach((u) => {
          if (u?.user_id && u?.display_name) displayNameMap[u.user_id] = u.display_name;
        });
        lr.forEach((r) => {
          if (!r.owner_id || r.owner_id === user!.user_id) return;
          allOwnerIds.add(r.owner_id);
          sharedLeaguesCount[r.owner_id] = (sharedLeaguesCount[r.owner_id] || 0) + 1;
        });
      });

      const ownerStats = await Promise.all([...allOwnerIds].map(async (ownerId) => {
        const theirLeagues = await sleeperApi
          .getUserLeagues(ownerId, CURRENT_YEAR)
          .catch(() => [] as SleeperLeague[]);

        return {
          userId: ownerId,
          displayName: displayNameMap[ownerId] || ownerId,
          totalLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) === 0).length,
          bestBallLeagues: theirLeagues.filter((l) => (l.settings?.best_ball ?? 0) !== 0).length,
          sharedLeagues: sharedLeaguesCount[ownerId] || 0,
        };
      }));

      setLeagueMateStats(ownerStats);
      setLeagueMateStatsLoaded(true);
    } finally {
      setLoadingLeagueMateStats(false);
    }
  };

  const filtered = leagueMateStats.filter((o) =>
    o.displayName.toLowerCase().includes(leagueMateSearch.toLowerCase())
  );

  const sorted = [...filtered].sort((a, b) => {
    if (leagueMateSort === "total")    return b.totalLeagues    - a.totalLeagues    || a.displayName.localeCompare(b.displayName);
    if (leagueMateSort === "bestball") return b.bestBallLeagues - a.bestBallLeagues || a.displayName.localeCompare(b.displayName);
    if (leagueMateSort === "shared")  return b.sharedLeagues   - a.sharedLeagues   || a.displayName.localeCompare(b.displayName);
    return a.displayName.localeCompare(b.displayName);
  });

  const thSort = (col: typeof leagueMateSort, label: string) => (
    <button
      onClick={() => setLeagueMateSort(col)}
      className={`flex items-center gap-1 whitespace-nowrap ${leagueMateSort === col ? "text-blue-400" : "text-slate-500 hover:text-slate-300"}`}
    >
      {label}
      <span className="text-[10px]">{leagueMateSort === col ? "▼" : "↕"}</span>
    </button>
  );

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-white">League Mate Stats</h2>
        {!leagueMateStatsLoaded ? (
          <button
            onClick={loadLeagueMateStats}
            disabled={loadingLeagueMateStats}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded transition"
          >
            {loadingLeagueMateStats ? "Loading…" : "Load Stats"}
          </button>
        ) : (
          <button
            onClick={loadLeagueMateStats}
            disabled={loadingLeagueMateStats}
            className="px-3 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:opacity-50 rounded transition"
          >
            {loadingLeagueMateStats ? "Refreshing…" : "Refresh"}
          </button>
        )}
      </div>

      {!leagueMateStatsLoaded && !loadingLeagueMateStats && (
        <p className="text-sm text-slate-500">Click Load Stats to fetch data across all your leagues.</p>
      )}
      {loadingLeagueMateStats && (
        <p className="text-sm text-blue-400">Loading league mate data…</p>
      )}

      {leagueMateStatsLoaded && (
        <>
          <input
            className="w-full mb-4 p-2.5 rounded bg-slate-800 border border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            placeholder="Search owner name…"
            value={leagueMateSearch}
            onChange={(e) => setLeagueMateSearch(e.target.value)}
          />
          {sorted.length === 0 ? (
            <p className="text-sm text-slate-500">No owners match your search.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-2 px-3">{thSort("name", "Owner")}</th>
                    <th className="text-center py-2 px-3">{thSort("total", "Total Leagues")}</th>
                    <th className="text-center py-2 px-3">{thSort("bestball", "Best Ball")}</th>
                    <th className="text-center py-2 px-3">{thSort("shared", "Shared Leagues")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((owner, i) => {
                    const isExpanded = expandedMateId === owner.userId;
                    const ownerExposure: ExposureData | null = isExpanded ? (externalShares ?? null) : null;
                    return (
                      <React.Fragment key={owner.userId}>
                        <tr
                          className={`cursor-pointer transition ${i % 2 === 0 ? "bg-slate-900" : "bg-slate-950"} hover:bg-slate-800`}
                          onClick={() => {
                            if (isExpanded) {
                              setExpandedMateId(null);
                            } else {
                              setExpandedMateId(owner.userId);
                              loadUserExposure(owner.userId);
                            }
                          }}
                        >
                          <td className="py-2 px-3 text-white font-medium flex items-center gap-1">
                            <span className="text-slate-500 text-[10px] mr-1">{isExpanded ? "▼" : "▶"}</span>
                            {owner.displayName}
                          </td>
                          <td className="py-2 px-3 text-center text-slate-300">{owner.totalLeagues}</td>
                          <td className="py-2 px-3 text-center text-slate-300">{owner.bestBallLeagues}</td>
                          <td className="py-2 px-3 text-center">
                            <span className="text-blue-400 font-semibold">{owner.sharedLeagues}</span>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr className={i % 2 === 0 ? "bg-slate-900" : "bg-slate-950"}>
                            <td colSpan={4} className="px-4 pb-3 pt-1">
                              {loadingShares ? (
                                <p className="text-xs text-blue-400 py-2">Loading exposure…</p>
                              ) : ownerExposure !== null && ownerExposure.players.length > 0 ? (
                                <div>
                                  <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                                    Top Owned Players · {ownerExposure.leagueCount} league{ownerExposure.leagueCount !== 1 ? "s" : ""}
                                  </p>
                                  <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5">
                                    {ownerExposure.players.map((entry) => {
                                      const p = players[entry.playerId];
                                      if (!p) return null;
                                      return (
                                        <div key={entry.playerId} className="flex items-center gap-1.5 rounded-lg bg-slate-800/60 px-2 py-1">
                                          <span className={`text-[9px] font-bold shrink-0 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
                                          <span className="text-xs text-white truncate flex-1">{p.full_name}</span>
                                          <span className="text-[10px] text-blue-400 font-mono shrink-0">{entry.percent}%</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <p className="text-xs text-slate-600 py-1">No shared player data found.</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-slate-600 mt-3">Total Leagues = {CURRENT_YEAR} non-best-ball NFL leagues for that owner on Sleeper. Click a row to see shared player exposure.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(LeaguematesTab);
