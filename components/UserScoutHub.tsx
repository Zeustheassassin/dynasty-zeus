"use client";
// ============================================================
// UserScoutHub — read-only "User Scout" view
// ============================================================
// Type any Sleeper username and inspect that user's leagues exactly
// like the League Hub (multi-league direction/ranks table + per-league
// Power Rankings, Standings, Rosters & Rules, Opponent Rosters, Season
// Simulator) — WITHOUT connecting them or touching the logged-in
// account. All data is read-only (see hooks/useSpyState.ts).
// ============================================================
import { useMemo, useState } from "react";
import { AppProviders } from "../app/providers/AppProviders";
import { useSpyState } from "../hooks/useSpyState";
import { useLeagueTabState } from "./LeagueHub/hooks/useLeagueTabState";
import {
  getRosterDirectionProfile, getAdjustedDirectionBucket, getBucketColor,
} from "../lib/helpers";
import PowerRankingsTab from "./LeagueHub/PowerRankingsTab";
import OppRostersTab from "./LeagueHub/OppRostersTab";
import RostersTab from "./LeagueHub/RostersTab";
import StandingsTab from "./league/StandingsTab";
import SimulatorTab from "./LeagueHub/SimulatorTab";
import type {
  SleeperPlayer, SleeperNFLState, AugmentedPick,
  LeagueHubTab, ProjectionRow, RookieBoardPlayer,
} from "../lib/types";
import type { PlayerUsage } from "../hooks/usePlayerStats";

interface UserScoutHubProps {
  players: Record<string, SleeperPlayer>;
  nflState: SleeperNFLState | null;
  projectionData: ProjectionRow[];
  projectionWeek: number;
  playerStats: Record<string, PlayerUsage> | null;
  rookies: RookieBoardPlayer[];
}

const SPY_TABS: Array<{ id: LeagueHubTab; label: string }> = [
  { id: "ROSTERS", label: "Rosters & Rules" },
  { id: "OPP_ROSTERS", label: "Opponent Rosters" },
  { id: "POWER_RANKINGS", label: "Power Rankings" },
  { id: "STANDINGS", label: "Standings" },
  { id: "SIMULATOR", label: "Season Simulator" },
];

const GRID =
  "grid grid-cols-[minmax(180px,1.4fr)_minmax(170px,1.1fr)_56px_56px_56px_56px_64px] gap-2 items-center px-1";

const BUCKET_ORDER: Record<string, number> = {
  Elite: 0, "True Contender": 1, "Almost There": 2, "Fading Contender": 3,
  "Window Closing": 4, Purgatory: 5, Rebuilder: 6, Stranded: 7, "Fading Out": 8, Hopeless: 9,
};

export default function UserScoutHub({
  players, nflState, projectionData, projectionWeek, playerStats, rookies,
}: UserScoutHubProps) {
  const spy = useSpyState({ players, nflState, projectionData, projectionWeek, playerStats, rookies });
  const tabState = useLeagueTabState();
  const [leagueHubTab, setLeagueHubTab] = useState<LeagueHubTab>("ROSTERS");
  const [input, setInput] = useState("");

  const {
    targetUser, targetLeagues, lookup, lookupLoading, lookupError, reset,
    pickFcValues, redraftValues,
    leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded,
    spyPlayoffByLeague, simProgress, simRunning, runAllSpySims,
    selectedSpyLeague, selectSpyLeague, clearSelectedLeague, loadingLeague, spyLeagueBundle,
  } = spy;

  const overviewRows = useMemo(() => {
    if (!targetUser) return [];
    return targetLeagues
      .map((league) => {
        const entry = leagueOverviewData[league.league_id];
        if (!entry) return null;
        const lr = entry.rosters;
        const ownedPicks: AugmentedPick[] = entry.picks || [];
        const myRosterId = lr.find((r) => r.owner_id === targetUser.user_id)?.roster_id;
        if (myRosterId == null) return null;
        const profile = getRosterDirectionProfile({
          rosterId: myRosterId,
          rosters: lr,
          ownedPicks,
          players,
          pickValues: pickFcValues,
          redraftValues,
          dynastyValueForPlayer: (id: string) => players[id]?.value ?? 0,
        });
        if (!profile) return null;
        const playoffOdds = spyPlayoffByLeague[league.league_id];
        const hasSim = playoffOdds != null;
        const adjBucket = getAdjustedDirectionBucket(profile.bucket, profile, playoffOdds ?? 0, hasSim);
        return {
          league,
          ...profile,
          bucket: adjBucket,
          bucketColor: getBucketColor(adjBucket),
          playoffOdds: playoffOdds ?? 0,
          hasSim,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => {
        const d = (BUCKET_ORDER[a.bucket] ?? 999) - (BUCKET_ORDER[b.bucket] ?? 999);
        if (d !== 0) return d;
        if (b.playoffOdds !== a.playoffOdds) return b.playoffOdds - a.playoffOdds;
        if (a.dynRank !== b.dynRank) return a.dynRank - b.dynRank;
        return a.league.name.localeCompare(b.league.name);
      });
  }, [targetUser, targetLeagues, leagueOverviewData, players, pickFcValues, redraftValues, spyPlayoffByLeague]);

  const submit = () => { if (input.trim() && !lookupLoading) lookup(input); };

  // ── Username search bar (always visible) ──────────────────────────────────
  const searchBar = (
    <div className="flex gap-2 items-center flex-wrap">
      <input
        className="p-2 rounded bg-gray-800 border border-gray-700 text-sm flex-1 min-w-[200px]"
        placeholder="Enter any Sleeper username to scout"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
      />
      <button
        onClick={submit}
        disabled={lookupLoading || !input.trim()}
        className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-medium disabled:opacity-50"
      >
        {lookupLoading ? "Looking up…" : "Scout User"}
      </button>
      {targetUser && (
        <button
          onClick={() => { reset(); setInput(""); }}
          className="px-3 py-2 rounded text-sm bg-gray-700 hover:bg-gray-600"
        >
          Clear
        </button>
      )}
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div>
        <h2 className="text-lg font-bold mb-1">User Scout</h2>
        <p className="text-xs text-gray-500 mb-3">
          Read-only. Looking someone up never changes your own Sleeper connection or data.
        </p>
        {searchBar}
        {lookupError && <div className="mt-2 text-sm text-red-400">{lookupError}</div>}
      </div>

      {!targetUser && !lookupLoading && (
        <div className="text-sm text-gray-500 border border-dashed border-gray-800 rounded-xl p-8 text-center">
          Enter a Sleeper username above to inspect their dynasty leagues, rosters, power rankings, and playoff odds.
        </div>
      )}

      {targetUser && (
        <>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="text-sm text-gray-300">
              Scouting <span className="font-semibold text-white">{targetUser.display_name}</span>
              <span className="text-gray-500"> · {targetLeagues.length} dynasty league{targetLeagues.length === 1 ? "" : "s"}</span>
            </div>
            {selectedSpyLeague && (
              <button
                onClick={clearSelectedLeague}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                ← All leagues
              </button>
            )}
          </div>

          {/* ── Drill-down: one league rendered through the real LeagueHub tabs ── */}
          {selectedSpyLeague ? (
            loadingLeague || !spyLeagueBundle ? (
              <p className="text-sm text-blue-400">Loading {selectedSpyLeague.name}…</p>
            ) : (
              <AppProviders
                supabaseUser={null}
                players={players}
                selectedLeague={spyLeagueBundle.league}
                rosters={spyLeagueBundle.rosters}
                users={spyLeagueBundle.users}
                leagueAdjustedFcValues={spyLeagueBundle.leagueAdjustedFcValues}
                leagueAdjustedRedraftValues={spyLeagueBundle.leagueAdjustedRedraftValues}
                pickFcValues={pickFcValues}
                fcNameValues={{}}
                selectedLeagueDirection={spyLeagueBundle.selectedLeagueDirection}
                selectedLeagueDirectionAdjusted={spyLeagueBundle.selectedLeagueDirectionAdjusted}
                selectedLeagueSimulation={spyLeagueBundle.selectedLeagueSimulation}
                selectedLeagueDynamicPickValues={{}}
                myRoster={spyLeagueBundle.myRoster}
              >
                <div className="space-y-4">
                  <div className="text-sm font-semibold text-gray-200">{spyLeagueBundle.league.name}</div>
                  {/* Sub-tab nav */}
                  <div className="flex flex-wrap gap-1.5">
                    {SPY_TABS.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setLeagueHubTab(t.id)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition ${
                          leagueHubTab === t.id
                            ? "border-blue-500 text-blue-400 bg-blue-900/30"
                            : "border-gray-700 text-gray-400 hover:text-gray-200"
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {leagueHubTab === "ROSTERS" && (
                    <RostersTab
                      leagues={targetLeagues}
                      user={targetUser}
                      picks={spyLeagueBundle.picks}
                      leagueSearch={tabState.leagueSearch}
                      setLeagueSearch={tabState.setLeagueSearch}
                      freeAgents={spyLeagueBundle.freeAgents}
                      setSelectedLeague={(lg) => { if (lg) selectSpyLeague(lg); else clearSelectedLeague(); }}
                      loadRoster={(lg) => selectSpyLeague(lg)}
                    />
                  )}
                  {leagueHubTab === "OPP_ROSTERS" && (
                    <OppRostersTab
                      user={targetUser}
                      allPicks={spyLeagueBundle.allPicks}
                      oppRosterOwnerId={tabState.oppRosterOwnerId}
                      setOppRosterOwnerId={tabState.setOppRosterOwnerId}
                    />
                  )}
                  {leagueHubTab === "POWER_RANKINGS" && (
                    <PowerRankingsTab
                      user={targetUser}
                      allPicks={spyLeagueBundle.allPicks}
                      loadingCalcValues={false}
                      prSortKey={tabState.prSortKey}
                      setPrSortKey={tabState.setPrSortKey}
                      prSortAsc={tabState.prSortAsc}
                      setPrSortAsc={tabState.setPrSortAsc}
                      prPopup={tabState.prPopup}
                      setPrPopup={tabState.setPrPopup}
                      prMode={tabState.prMode}
                      setPrMode={tabState.setPrMode}
                      ignoredOwnerIds={[]}
                      toggleIgnoredOwner={() => {}}
                      setPlayerProfileId={() => {}}
                      historicalSnapshot={null}
                    />
                  )}
                  {leagueHubTab === "STANDINGS" && (
                    <StandingsTab standings={spyLeagueBundle.standings} />
                  )}
                  {leagueHubTab === "SIMULATOR" && (
                    <SimulatorTab
                      user={targetUser}
                      loadingLeagueWeeklyMatchups={false}
                      onSaveSim={() => {}}
                    />
                  )}
                </div>
              </AppProviders>
            )
          ) : (
            /* ── Multi-league overview table ── */
            <div className="space-y-3">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={runAllSpySims}
                  disabled={simRunning || !targetLeagues.length}
                  className="text-[11px] font-semibold px-3 py-1 rounded-full border border-blue-600 text-blue-400 hover:bg-blue-900/40 transition disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                >
                  {simRunning ? "Simulating…" : "Run All Sims"}
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
              </div>

              {loadingLeagueOverview && !leagueOverviewLoaded ? (
                <p className="text-sm text-blue-400">Loading league data…</p>
              ) : !targetLeagues.length ? (
                <p className="text-sm text-gray-500">No dynasty leagues found.</p>
              ) : (
                <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 overflow-x-auto">
                  <div className="min-w-[700px]">
                    <div className={`${GRID} text-[10px] uppercase tracking-wide text-gray-500 mb-1 pb-2 border-b border-gray-800`}>
                      <span>League</span>
                      <span>Direction</span>
                      <span className="text-center">Dyn</span>
                      <span className="text-center">Rdft</span>
                      <span className="text-center">Stnd</span>
                      <span className="text-center">MaxPF</span>
                      <span className="text-center">Playoff%</span>
                    </div>
                    <div className="space-y-0.5">
                      {overviewRows.map((row) => (
                        <div key={row.league.league_id} className={`${GRID} text-xs py-1.5 rounded hover:bg-gray-800/40 transition`}>
                          <button
                            className="min-w-0 text-sm text-gray-200 font-medium text-left truncate hover:text-blue-400 transition"
                            onClick={() => selectSpyLeague(row.league)}
                          >
                            {row.league.name}
                          </button>
                          <div className="min-w-0">
                            <span className={`inline-flex max-w-full text-[10px] font-semibold px-2 py-0.5 rounded-full border truncate ${row.bucketColor}`}>{row.bucket}</span>
                            <div className="mt-0.5 text-[10px] text-gray-500 truncate">{row.shortAction}</div>
                          </div>
                          <span className="text-center text-gray-300">{row.dynRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-center text-gray-300">{row.redRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-center text-gray-300">{row.standRank}<span className="text-gray-600">/{row.n}</span></span>
                          <span className="text-center text-gray-300">{row.maxPfRank}<span className="text-gray-600">/{row.n}</span></span>
                          <div className="text-center">
                            {row.hasSim ? (
                              <div className={`font-mono font-semibold ${row.playoffOdds >= 50 ? "text-emerald-400" : row.playoffOdds >= 25 ? "text-yellow-400" : "text-red-400"}`}>
                                {row.playoffOdds}%
                              </div>
                            ) : (
                              <button
                                className="text-[10px] text-blue-500 hover:text-blue-400 transition"
                                onClick={() => selectSpyLeague(row.league)}
                              >
                                view →
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
