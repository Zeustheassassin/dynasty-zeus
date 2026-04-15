"use client";
import React from "react";
import {
  getLineupSettings,
  getNonStandardRules,
  formatRule,
  groupRules,
  getStoredPickValue,
  getBucketColor,
  getAdjustedDirectionBucket,
  ordinal,
  getProjectionKickoffAt,
  getLineupSlotEligiblePositions,
  rebalanceLineupForKickoffWindows,
  getRosterDirectionProfile,
  CURRENT_YEAR, YEARS,
} from "../lib/helpers";
import type {
  LeagueHubTab,
  SleeperLeague,
  SleeperPlayer,
  SleeperRoster,
  AugmentedPick,
  SleeperDraft,
  SleeperDraftPick,
  SleeperTradedPick,
  SleeperTransaction,
  SleeperNFLState,
  SleeperUser,
  RookieBoardPlayer,
  ProjectionRow,
  RosterDirectionProfile,
  CommittedSimsByLeague,
  CachedSimRow,
  LeagueOverviewEntry,
  LeagueMateView,
  LineupCoachRow,
  LeagueSimulation,
  SimulationTeamRow,
} from "../lib/types";
import { LEAGUE_HUB_GROUPS } from "../lib/leagueHubGroups";
import { supabase } from "../lib/supabaseclient";
import { usePlayers } from "../lib/PlayersContext";
import { useAuth } from "../lib/AuthContext";
import { useLeague } from "../lib/LeagueContext";
import { useMyRoster } from "../lib/RosterContext";
import StandingsTab from "./league/StandingsTab";

// ── Constants ──────────────────────────────────────────────────────────────
const ROOKIE_YEAR = CURRENT_YEAR;

const getStarterSlots = (roster: SleeperRoster, league: SleeperLeague) => {
  if (!roster?.starters || !league?.roster_positions) return [];
  return roster.starters.map((playerId: string, i: number) => ({
    playerId,
    slot: league.roster_positions[i],
  }));
};

// ── Local supporting types ─────────────────────────────────────────────────

interface StandingRow { roster_id: number; wins: number; losses: number; ties: number; fpts: number; max_pf: number; owner_id: string; }


type AnnotatedTransaction = SleeperTransaction & {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
};

interface TeamSummary {
  summary: Record<string, number>;
  pickSummary: Record<string, number>;
}

interface PredictedPick {
  name: string;
  position: string;
  team: string;
  adp: number;
  player_id: string | null | undefined;
  boardRank: number;
  poolRank: number;
}

// ── Props ──────────────────────────────────────────────────────────────────
interface LeagueHubProps {
  // Tab state
  leagueHubTab: LeagueHubTab;
  setLeagueHubTab: (tab: LeagueHubTab) => void;
  activeLeagueHubGroup: { id: string; label: string; tabs: Array<{ id: LeagueHubTab; label: string }> };

  // League / roster state
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  standings: StandingRow[];
  setSelectedLeague: (league: SleeperLeague | null) => void;
  picks: SleeperTradedPick[];
  allPicks: SleeperTradedPick[];
  pickFcValues: Record<string, number>;
  calcFcValues: Record<string, number>;
  redraftValues: Record<string, number>;

  // Sim state
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
  simQueue: string[];
  simProgress: { done: number; total: number } | null;

  // Loading states
  loadingLeagueMateIntel: boolean;
  loadingCrossLeagueMateIntel: boolean;
  loadingActivity: boolean;
  loadingLeagueWeeklyMatchups: boolean;

  // Notes / activity
  leagueNotes: Record<string, string>;
  activityTransactions: AnnotatedTransaction[];

  // League overview
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  loadingLeagueOverview: boolean;
  leagueOverviewLoaded: boolean;

  // Computed
  teamSummary: TeamSummary | null;
  selectedLeagueDirection: RosterDirectionProfile | null;
  selectedLeagueDirectionAdjusted: RosterDirectionProfile | null;
  selectedLeagueSimulation: LeagueSimulation | null;
  selectedLeagueMateProfilesView: LeagueMateView[];

  // Roster view state
  activeTab: string;
  setActiveTab: (tab: string) => void;
  search: string;
  setSearch: (s: string) => void;
  oppRosterTab: string;
  setOppRosterTab: (tab: string) => void;
  oppRosterOwnerId: string;
  setOppRosterOwnerId: (id: string) => void;
  oppRosterSearch: string;
  setOppRosterSearch: (s: string) => void;

  // Power rankings state
  prSortKey: "dynTotal" | "redTotal" | "qbTotal" | "rbTotal" | "wrTotal" | "teTotal";
  setPrSortKey: (key: "dynTotal" | "redTotal" | "qbTotal" | "rbTotal" | "wrTotal" | "teTotal") => void;
  prSortAsc: boolean;
  setPrSortAsc: React.Dispatch<React.SetStateAction<boolean>>;
  prPopup: { rosterId: number; col: "dyn" | "red" | "QB" | "RB" | "WR" | "TE" } | null;
  setPrPopup: (popup: { rosterId: number; col: "dyn" | "red" | "QB" | "RB" | "WR" | "TE" } | null) => void;
  prMode: "full" | "starters" | "bench";
  setPrMode: (mode: "full" | "starters" | "bench") => void;
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;

  // Draft state
  projectionData: ProjectionRow[];
  draftPicks: SleeperDraftPick[];
  draftOrder: Record<string, number>;
  draftSettings: SleeperDraft | null;
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (q: string) => void;
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES";
  nflState: SleeperNFLState | null;

  // Additional state
  leagueSearch: string;
  setLeagueSearch: (s: string) => void;
  filteredPlayers: SleeperPlayer[] | undefined;
  freeAgents: SleeperPlayer[];
  loadingCalcValues: boolean;
  predictedDraftPicks: Record<string, PredictedPick>;
  loadingDraftRefresh: boolean;
  rookies: RookieBoardPlayer[];
  draftedPlayerIds: Set<string>;

  // Functions
  loadRoster: (league: SleeperLeague) => void;
  loadLeagueOverview: () => void;
  loadRedraftValues: () => void;
  loadUserTrades: (ownerId: string) => void;
  loadUserExposure: (ownerId: string) => void;
  loadDraftScout: (userId: string) => void;
  saveLeagueNote: (leagueId: string, text: string) => void;
  onSaveSim: (leagueId: string, rows: SimulationTeamRow[]) => void;
  handleRunAllSims: () => void;
  refreshDraftBoard: () => Promise<void>;
  setPlayerProfileId: (id: string | null) => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setMainTab: (tab: string) => void;
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS") => void;
}

// ── Component ──────────────────────────────────────────────────────────────
function LeagueHub({
  leagueHubTab, setLeagueHubTab, activeLeagueHubGroup,
  leagues, user, standings, setSelectedLeague,
  picks, allPicks, pickFcValues, calcFcValues, redraftValues,
  committedSimsByLeague, leagueSimCache, simQueue, simProgress,
  loadingLeagueMateIntel, loadingCrossLeagueMateIntel, loadingActivity, loadingLeagueWeeklyMatchups,
  leagueNotes, activityTransactions,
  leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded,
  teamSummary, selectedLeagueDirection, selectedLeagueDirectionAdjusted, selectedLeagueSimulation, selectedLeagueMateProfilesView,
  activeTab, setActiveTab, search, setSearch,
  oppRosterTab, setOppRosterTab, oppRosterOwnerId, setOppRosterOwnerId, oppRosterSearch, setOppRosterSearch,
  prSortKey, setPrSortKey, prSortAsc, setPrSortAsc, prPopup, setPrPopup, prMode, setPrMode,
  projectionData, draftPicks, draftOrder, draftSettings, myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing, draftSlotSearchQuery, setDraftSlotSearchQuery,
  draftHubSection, nflState,
  leagueSearch, setLeagueSearch, filteredPlayers, freeAgents, loadingCalcValues,
  predictedDraftPicks, loadingDraftRefresh, rookies, draftedPlayerIds,
  loadRoster, loadLeagueOverview, loadRedraftValues, loadUserTrades, loadUserExposure, loadDraftScout,
  saveLeagueNote, onSaveSim, handleRunAllSims, refreshDraftBoard,
  setPlayerProfileId, setCalcOpponentRosterId, setMainTab, setTradeHubSection,
  ignoredOwnerIds, toggleIgnoredOwner,
}: LeagueHubProps) {
  const players = usePlayers();
  const { supabaseUser } = useAuth();
  const { selectedLeague, rosters, users } = useLeague();
  const { myRoster: roster } = useMyRoster();
  const [lastNoteSavedAt, setLastNoteSavedAt] = React.useState<number | null>(null);
  const [leagueMateIntelLoadedAt, setLeagueMateIntelLoadedAt] = React.useState<number | null>(null);
  const [simSavedAt, setSimSavedAt] = React.useState<number | null>(null);
  const [refreshingRosters, setRefreshingRosters] = React.useState(false);
  const [rosterRefreshProgress, setRosterRefreshProgress] = React.useState<{ done: number; total: number } | null>(null);

  const handleRefreshAllRosters = React.useCallback(async () => {
    setRefreshingRosters(true);
    const total = leagues.length;
    setRosterRefreshProgress({ done: 0, total });
    // Bust the localStorage cache for every league upfront
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("leagueData_")) keysToRemove.push(key);
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
    // Re-fetch all leagues in parallel; increment progress as each one lands
    await Promise.all(
      leagues.map((league) =>
        Promise.all([
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/rosters`).then((r) => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/traded_picks`).then((r) => r.json()),
          fetch(`https://api.sleeper.app/v1/league/${league.league_id}/drafts`).then((r) => r.json()).catch(() => []),
        ]).then(([allRosters, tradedPicksData, draftsData]) => {
          try {
            localStorage.setItem(
              `leagueData_${league.league_id}`,
              JSON.stringify({ data: { allRosters, tradedPicksData, draftsData }, cachedAt: Date.now() })
            );
          } catch { /* quota exceeded — skip */ }
          setRosterRefreshProgress((prev) => prev ? { done: prev.done + 1, total: prev.total } : null);
        })
      )
    );
    // Reload the currently selected league so the UI reflects fresh data
    if (selectedLeague) await loadRoster(selectedLeague);
    setRefreshingRosters(false);
    const t = setTimeout(() => setRosterRefreshProgress(null), 3000);
    return () => clearTimeout(t);
  }, [leagues, selectedLeague, loadRoster]);

  // Reset sim-saved confirmation when the active league changes
  React.useEffect(() => { setSimSavedAt(null); }, [selectedLeague?.league_id]);

  // Record when league-mate intel finishes loading
  const prevIntelLoading = React.useRef(false);
  React.useEffect(() => {
    const isLoading = loadingLeagueMateIntel || loadingCrossLeagueMateIntel;
    if (prevIntelLoading.current && !isLoading && selectedLeagueMateProfilesView.length > 0) {
      setLeagueMateIntelLoadedAt(Date.now());
    }
    prevIntelLoading.current = isLoading;
  }, [loadingLeagueMateIntel, loadingCrossLeagueMateIntel, selectedLeagueMateProfilesView.length]);

  return (
          <div className={`mx-auto px-4 py-6 ${leagueHubTab === "DRAFT_BOARD" ? "w-full max-w-full" : "max-w-5xl"}`}>
          <>
            {/* Sub-tab nav */}
            <div className="mb-6 rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
              <div className="flex flex-wrap justify-center gap-2">
                {LEAGUE_HUB_GROUPS.map((group) => {
                  const isActive = activeLeagueHubGroup.id === group.id;
                  return (
                    <button
                      key={group.id}
                      onClick={() => setLeagueHubTab(group.tabs[0].id)}
                      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                        isActive
                          ? "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:text-white"
                      }`}
                    >
                      {group.label}
                    </button>
                  );
                })}
              </div>
              {activeLeagueHubGroup.tabs.length > 1 && (
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {activeLeagueHubGroup.tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setLeagueHubTab(tab.id)}
                      className={`rounded-full px-3 py-1 text-xs font-semibold transition border ${
                        leagueHubTab === tab.id
                          ? "bg-blue-700/50 text-blue-200 border-blue-600"
                          : "bg-gray-800 text-gray-500 border-transparent hover:text-gray-300"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* ── League Overview ── */}
            {leagueHubTab === "OVERVIEW" && (() => {
              if (loadingLeagueOverview) return <p className="text-sm text-blue-400">Loading league data…</p>;
              if (!leagues.length) return <p className="text-sm text-gray-500">No leagues found.</p>;

              // Ordering: contenders → transition → sellers/rebuilders
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

              // Build per-league dynasty + redraft values for every team
              const leagueRows = leagues.map((league) => {
                const entry = leagueOverviewData[league.league_id];
                if (!entry) return null;
                const lr: SleeperRoster[] = entry.rosters;
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
                // committedSimsByLeague is the source of truth — updated synchronously
                // in-memory by saveSimulationToSupabase and persisted in localStorage.
                // leagueSimCache (Supabase) is secondary and can be stale after auth refreshes.
                const committedRow = committedSimsByLeague[league.league_id]?.[Number(myRosterId)];
                const cachedSimRow = leagueSimCache[league.league_id]?.[Number(myRosterId)];
                const playoffOdds = committedRow?.playoffOdds ?? cachedSimRow?.playoff_odds ?? 0;
                const hasCachedSim = !!(committedRow ?? cachedSimRow);
                const simAge = cachedSimRow?.computed_at
                  ? Math.round((Date.now() - new Date(cachedSimRow.computed_at).getTime()) / (1000 * 60 * 60))
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
                if (a.dynRank !== b.dynRank) return a.dynRank - b.dynRank;
                if (a.redRank !== b.redRank) return a.redRank - b.redRank;
                return a.league.name.localeCompare(b.league.name);
              });

              return (
                <div className="space-y-2">
                  <div className="overflow-x-auto pb-1">
                    <div className="min-w-[780px] space-y-2">
                      {/* Run All Sims button + Refresh Rosters + progress bar */}
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
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className={`w-3 h-3 ${refreshingRosters ? "animate-spin" : ""}`}>
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
                      {/* Header */}
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
            })()}

            {/* ── Simulator ── */}
            {leagueHubTab === "SIMULATOR" && (() => {
              if (!selectedLeague || !rosters.length) {
                return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the simulator.</p>;
              }
              if (!selectedLeagueSimulation) {
                return (
                  <p className="text-sm text-blue-400">
                    Building simulator snapshot…{" "}
                    <span className="text-gray-600 text-xs">(if this persists, reload the league from Rosters &amp; Rules)</span>
                  </p>
                );
              }

              const myRosterId = rosters.find((entry) => entry.owner_id === user?.user_id)?.roster_id;
              return (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Season Simulator</div>
                        <div className="mt-1 text-sm text-gray-200">
                          {selectedLeagueSimulation.simulationMode === "offseason"
                            ? "Offseason mode uses season-long player projections to build optimal lineups, simulate standings, and estimate projected max PF before real schedules exist."
                            : "In-season mode blends real results, current schedule, and Monte Carlo rest-of-season sims for projected standings and playoff odds."}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="text-[11px] text-gray-500">
                          {selectedLeagueSimulation.simulationMode === "offseason"
                            ? `${selectedLeagueSimulation.simCount} sims - ${selectedLeagueSimulation.regularSeasonWeeks}-week baseline`
                            : loadingLeagueWeeklyMatchups
                            ? "Loading weekly matchup history..."
                            : `Week ${selectedLeagueSimulation.currentWeek} - ${selectedLeagueSimulation.weeksPlayed} completed weeks - ${selectedLeagueSimulation.simCount} sims`}
                        </div>
                        <button
                          onClick={() => {
                            onSaveSim(selectedLeague.league_id, selectedLeagueSimulation.rows);
                            setSimSavedAt(Date.now());
                          }}
                          className="text-[11px] font-semibold px-3 py-1 rounded-full border border-blue-600 text-blue-400 hover:bg-blue-900/40 transition whitespace-nowrap"
                        >
                          {simSavedAt ? "✓ Saved" : "Save Sim"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto pb-1">
                    <div className="min-w-[1250px] space-y-2">
                      <div className="grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
                        <span>Team</span>
                        <span className="text-center">Power</span>
                        <span className="text-center">Proj Max PF</span>
                        <span className="text-center">Exp Wins</span>
                        <span className="text-center">Avg Finish</span>
                        <span className="text-center">Finish Band</span>
                        <span className="text-center">Playoffs</span>
                        <span className="text-center">Bye</span>
                        <span className="text-center">Title</span>
                        <span className="text-center">1.01</span>
                        <span className="text-center">{selectedLeagueSimulation.simulationMode === "offseason" ? "Avg Matchup" : "This Week"}</span>
                      </div>
                      {selectedLeagueSimulation.rows.map((row) => {
                        const isMe = Number(row.rosterId) === Number(myRosterId);
                        return (
                          <div key={row.rosterId} className={`grid grid-cols-[minmax(180px,1.45fr)_78px_108px_88px_92px_92px_88px_82px_96px_92px_110px] gap-2 items-center rounded-xl border px-3 py-3 ${isMe ? "border-blue-700 bg-blue-950/20" : "border-gray-800 bg-gray-900"}`}>
                            <div className="min-w-0">
                              <div className={`truncate text-sm font-semibold ${isMe ? "text-blue-300" : "text-white"}`}>{row.ownerName}</div>
                              <div className="text-[11px] text-gray-500">
                                {row.actualWins}-{row.actualLosses} actual • likely finish {ordinal(row.projectedFinish)}
                              </div>
                              {selectedLeagueSimulation.simulationMode !== "offseason" && (
                                <div className="text-[10px] text-gray-600">
                                  All-play {row.allPlayWins}-{row.allPlayLosses} • luck {row.luckScore > 0 ? "+" : ""}{row.luckScore.toFixed(1)}
                                </div>
                              )}
                            </div>
                            <div className="text-center text-sm font-semibold text-white">{row.powerScore.toFixed(1)}</div>
                            <div className="text-center text-sm text-gray-200">{Math.round(row.projectedMaxPf || row.maxPf || 0).toLocaleString()}</div>
                            <div className="text-center text-sm text-gray-200">{row.expectedWins.toFixed(1)}</div>
                            <div className="text-center text-sm text-gray-200">{row.avgFinish?.toFixed?.(1) ?? row.avgFinish}</div>
                            <div className="text-center text-xs text-gray-300">{row.finishRange}</div>
                            <div className="text-center text-sm text-green-300">{Math.round(row.playoffOdds)}%</div>
                            <div className="text-center text-sm text-cyan-300">{Math.round(row.byeOdds)}%</div>
                            <div className="text-center text-sm text-amber-300">{Math.round(row.titleOdds)}%</div>
                            <div className="text-center text-sm text-rose-300">{Math.round(row.oneOhOneOdds || 0)}%</div>
                            <div className="text-center text-xs text-gray-300">
                              {row.currentOpponent ? `${Math.round((row.currentWeekWinProb ?? 0) * 100)}% vs ${row.currentOpponent}` : `${Math.round((row.avgWinProb ?? 0) * 100)}% avg`}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {selectedLeagueSimulation.weeklyMatchups?.length > 0 && (
                    <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Schedule Preview</div>
                          <div className="mt-1 text-sm text-gray-200">
                            {selectedLeagueSimulation.simulationMode === "offseason"
                              ? "Generated weekly matchups used for offseason sims."
                              : "Upcoming matchup forecast from the active league schedule."}
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 lg:grid-cols-2">
                        {selectedLeagueSimulation.weeklyMatchups.slice(0, 4).map((week) => (
                          <div key={week.week} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="flex items-center justify-between">
                              <div className="text-xs font-semibold text-white">Week {week.week}</div>
                              <div className="text-[10px] uppercase tracking-wide text-gray-500">{week.source}</div>
                            </div>
                            <div className="mt-2 space-y-1.5">
                              {week.matchups?.slice(0, 6).map((matchup, idx) => (
                                <div key={`${week.week}-${idx}`} className="flex items-center justify-between rounded-lg bg-gray-800/80 px-3 py-2 text-xs">
                                  <div className="min-w-0 text-gray-200">
                                    <span className="font-medium text-white">{matchup.aName}</span>
                                    <span className="text-gray-500"> vs </span>
                                    <span className="font-medium text-white">{matchup.bName}</span>
                                  </div>
                                  <div className="shrink-0 text-right text-gray-400">
                                    {Math.round((matchup.aWinProb || 0) * 100)}% • {Math.round(matchup.aProjected || 0)}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* ── Rosters & Rules ── */}
            {leagueHubTab === "ROSTERS" && (
           <>
           {user && leagues.length > 0 && !selectedLeague && (
  <div className="max-w-4xl mx-auto">

    <h2 className="text-xl font-semibold mb-4 text-slate-300">
      Your Leagues
    </h2>

    <input
      className="w-full mb-6 px-4 py-3 rounded-xl bg-slate-900 border border-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-500"
      placeholder="Search leagues..."
      value={leagueSearch}
      onChange={(e) => setLeagueSearch(e.target.value)}
    />

    {leagues
      .filter((l) =>
        l.name.toLowerCase().includes(leagueSearch.toLowerCase())
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((l) => (
        <div
  key={l.league_id}
  onClick={() => loadRoster(l)}
  className="group bg-slate-900 border border-slate-800 p-4 rounded-xl mb-3 cursor-pointer hover:bg-slate-800 transition flex justify-between items-center"
>
  {/* LEFT */}
  <p className="font-medium">{l.name}</p>

  {/* RIGHT */}
  <span className="text-slate-500 group-hover:text-blue-400 transition">
    →
  </span>
</div>
      ))}
  </div>
)}
            {selectedLeague && roster && (
              <>
                <button
                  onClick={() => setSelectedLeague(null)}
                  className="mb-2 text-sm text-gray-400"
                >
                  ← Back
                </button>

                <div className="mb-4">
                  <h2 className="text-lg font-bold">
                    {selectedLeague.name}
                  </h2>
                  <div className="text-xs text-gray-400">
                    {roster.settings?.team_name || "Your Team"}
                  </div>

                  {/* 🔥 NEW LINEUP SETTINGS DISPLAY */}
                  <div className="text-xs text-blue-400 mt-1">
                    {getLineupSettings(selectedLeague)}
                  </div>
                </div>
                {selectedLeagueDirection && (() => {
                  // Use the fully adjusted profile for display — all three factors combined
                  const dir = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
                  return (
                  <div className="mb-4 bg-gray-900 border border-gray-700 rounded-xl p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Roster Direction</div>
                        <div className="mt-1 text-sm text-gray-200">{dir.summary}</div>
                      </div>
                      <div className="flex items-center gap-2 self-start">
                        <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border ${dir.bucketColor}`}>
                          {dir.bucket}
                        </span>
                        {dir.rawBucket && dir.rawBucket !== dir.bucket && (
                          <span className="text-[10px] text-gray-500">({dir.rawBucket} by assets)</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-6">
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Dynasty</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.dynRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Redraft</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.redRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Standings</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.standRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Max PF</div>
                        <div className="text-sm font-semibold text-white">{ordinal(dir.maxPfRank)}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">Core Age</div>
                        <div className="text-sm font-semibold text-white">{dir.coreAge || "-"}</div>
                      </div>
                      <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                        <div className="text-[10px] uppercase tracking-wide text-gray-500">1sts</div>
                        <div className="text-sm font-semibold text-white">{dir.firstRounders}</div>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {dir.actions.map((action: string) => (
                        <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                          {action}
                        </span>
                      ))}
                    </div>

                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-green-400">What You Have</div>
                        <div className="mt-1 space-y-1">
                          {dir.strengths.length > 0 ? dir.strengths.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No clear structural advantage yet.</div>
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-orange-400">What To Watch</div>
                        <div className="mt-1 space-y-1">
                          {dir.concerns.length > 0 ? dir.concerns.map((item: string) => (
                            <div key={item} className="text-xs text-gray-300">{item}</div>
                          )) : (
                            <div className="text-xs text-gray-500">No major red flags from the current profile.</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                  );
                })()}
                {(() => {
  const rules = getNonStandardRules(selectedLeague?.scoring_settings);
  const grouped = groupRules(rules);

  return Object.entries(grouped).map(([section, items]) => {
    if (items.length === 0) return null;

    return (
      <div key={section} className="mb-2">
  <div className="text-xs font-medium text-gray-400 mb-0.5 uppercase tracking-wide">
  {section}
</div>

  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">  {/* 👈 ADD THIS */}

    {items.map((rule, i) => (
      <div
        key={i}
        className="flex justify-between items-center bg-yellow-200/10 border border-yellow-500/20 rounded px-2 py-1.5"
      >
        <span className="text-yellow-300 text-xs">
          {formatRule(rule.key)}
        </span>

        <span className="text-green-400 text-xs">
          {rule.value > 0 ? `+${rule.value}` : rule.value}
        </span>
      </div>
    ))}

  </div> {/* 👈 ADD THIS */}

</div>
    );
  });
})()}
{/* 🔥 TEAM SUMMARY */}
{(() => {
  const data = teamSummary;
  if (!data) return null;

  const { summary, pickSummary } = data;

  return (
    <div className="mt-4 flex flex-wrap gap-2 text-xs mb-4">

      {/* POSITION COUNTS */}
      {["QB", "RB", "WR", "TE"].map((pos) => (
  <div
    key={pos}
    className="px-3 py-1 bg-gray-800/60 rounded-full border border-gray-700/50"
  >
    {pos}: {summary[pos]}
  </div>
))}

      {/* PICKS */}
      {Object.keys(pickSummary).map((year) => (
        <div
          key={year}
          className="px-3 py-1 bg-blue-900/40 rounded-full border border-blue-700"
        >
          {year} Picks: {pickSummary[year]}
        </div>
      ))}
    </div>
  );
})()}

<div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">

  {/* PLAYER TABS */}
  <div className="flex flex-wrap gap-2 mb-3">
    {["ROSTER", "QB", "RB", "WR", "TE", "PICKS", "FREE AGENTS"].map((pos) => (
      <button
        key={pos}
        onClick={() => setActiveTab(pos)}
        className={`px-3 py-1 rounded ${
          activeTab === pos
            ? "bg-blue-600"
            : "bg-gray-800 hover:bg-gray-700"
        }`}
      >
        {pos}
      </button>
    ))}
  </div>

  {/* SEARCH */}
  <input
    className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    placeholder="Search players..."
    value={search}
    onChange={(e) => setSearch(e.target.value)}
  />

</div>
                {["QB", "RB", "WR", "TE"].includes(activeTab) && (
  <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">

    <div className="text-sm font-semibold mb-3 text-gray-300">
      {activeTab}
    </div>

    {filteredPlayers?.map((p) => {
      const colors: Record<string, string> = {
        starter: "bg-green-800/60",
        bench: "bg-blue-800/40",
        taxi: "bg-purple-800/60",
      };

      return (
        <div
          key={p.player_id}
          className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${colors[p.role ?? ""]}`}
        >
          {/* LEFT */}
          <div className="flex items-center gap-2 truncate">
            <span className="font-medium">{p.full_name}</span>
            <span className="text-xs text-gray-400">{p.team}</span>
            <span className="text-xs text-gray-500">
              {(p.role ?? "").toUpperCase()}
            </span>
          </div>

          {/* RIGHT */}
          <div className="flex items-center gap-3 text-xs whitespace-nowrap">
            <span className="text-gray-400">
              Age {p.age || "—"}
            </span>
            <span className="text-blue-400 font-semibold">
              {p.value || 0}
            </span>
          </div>
        </div>
      );
    })}
  </div>
)}
  {activeTab === "ROSTER" && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
    {["QB", "RB", "WR", "TE"].map((pos) => {
  const taxiIds = new Set(roster?.taxi || []);
  const starterIds = new Set(roster?.starters || []);

  const allPlayers = (roster?.players || []).filter(
    (id) => !taxiIds.has(id)
  );

  const starterSlots = getStarterSlots(roster, selectedLeague);

const starters = starterSlots
  .map((s) => ({
    ...players[s.playerId],
    slot: s.slot,
  }))
  .filter((p) => p && p.position === pos);

  const bench = allPlayers
  .filter((id) => !starterIds.has(id))
  .map((id) => players[id])
  .filter((p) => p && p.position === pos)
  .sort((a, b) => ((b?.value || 0) - (a?.value || 0)));

  const playersByPos = [...starters, ...bench].sort(
    (a, b) => ((b?.value || 0) - (a?.value || 0))
  );

  const totalVal = playersByPos.reduce(
    (sum: number, p) => sum + (p?.value || 0),
    0
  );

  return (
    <div
      key={pos}
      className="bg-gray-900 border border-gray-700 rounded-lg p-4"
    >
      {/* HEADER */}
      <div className="flex justify-between mb-3">
        <div className="font-semibold text-sm">
          {pos} {playersByPos.length} TOTAL
        </div>
        <div className="text-xs text-gray-400">
          TOTAL {pos} VAL {totalVal}
        </div>
      </div>

      {/* STARTERS */}
      {starters.map((p, i) => (
        <div
          key={`s-${i}`}
          className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-green-700">
              {p.slot.replace("_", " ")}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-300">
            VAL {p.value || 0}
          </div>
        </div>
      ))}

      {/* BENCH */}
      {bench.map((p, i) => (
        <div
          key={`b-${i}`}
          className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-blue-700">
              {pos}{starters.length + i + 1}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-300">
            VAL {p.value || 0}
          </div>
        </div>
      ))}
    </div>
  );
})}
    {/* TAXI */}
{(roster?.taxi || []).length > 0 && (
  <div className="mt-6 bg-gray-900 border border-gray-700 rounded-lg p-4">
    <div className="flex justify-between mb-3">
      <div className="font-semibold text-sm text-purple-400">
        TAXI {roster.taxi?.length ?? 0} TOTAL
      </div>
      <div className="text-xs text-gray-400">
        TOTAL TAXI VAL{" "}
        {(roster.taxi || [])
          .map((id) => players[id])
          .filter((p) => p)
          .reduce((sum: number, p) => sum + (p?.value || 0), 0)}
      </div>
    </div>

    {(roster.taxi || []).map((id, i) => {
      const p = players[id];
      if (!p) return null;

      return (
        <div
          key={i}
          className="flex justify-between items-center bg-gray-800 rounded p-2 mb-2"
        >
          <div className="flex items-center gap-2">
            <div className="text-xs px-2 py-1 rounded bg-purple-700">
              TX{i + 1}
            </div>
            <div>{p.full_name}</div>
          </div>

          <div className="text-xs text-gray-400">
            VAL {p.value || 0}
          </div>
        </div>
      );
    })}
  </div>
)}
{/* PICKS */}
<div className="mt-6">
  {YEARS.map((year) => {
    const yearPicks = picks
      .filter((p) => p.season === year)
      .sort((a, b) => a.round - b.round);

    if (!yearPicks.length) return null;

    return (
      <div
        key={year}
        className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4"
      >
        <div className="flex justify-between mb-3">
          <div className="font-semibold text-sm">
            {year} Picks {yearPicks.length} TOTAL
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {yearPicks.map((pick, i) => {
            const ownerName =
              users[pick.roster_id] ||
              users[pick.owner_id] ||
              "Unknown";

            const label =
              pick.season === CURRENT_YEAR
                ? pick.slot
                : `${pick.round}${
                    ["th", "st", "nd", "rd"][pick.round] || "th"
                  }`;

            return (
              <div
                key={i}
                className={`px-3 py-1 rounded-full text-xs border ${
                  pick.round === 1
                    ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                    : pick.round === 2
                    ? "bg-green-900/40 border-green-600 text-green-300"
                    : pick.round === 3
                    ? "bg-blue-900/40 border-blue-600 text-blue-300"
                    : "bg-orange-900/40 border-orange-600 text-orange-300"
                }`}
              >
                {label}
                <span className="ml-1 text-gray-400">
                  via {ownerName}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  })}
</div>
  </div>
)}
{activeTab === "PICKS" && (
  <div className="mt-2">

    {YEARS.map((year) => {
      const yearPicks = picks
        .filter((p: any) => p.season === year)
        .sort((a: any, b: any) => {
          if (a.round !== b.round) return a.round - b.round;
          return (a.pick_no || 0) - (b.pick_no || 0);
        });

      if (!yearPicks.length) return null;

      return (
        <div key={year} className="mb-4">
          <div className="text-sm font-bold mb-2">{year}</div>

          <div className="flex flex-wrap gap-2">
  {yearPicks.map((pick: any, i: number) => {
    const ownerName =
      users[pick.roster_id] ||
      users[pick.owner_id] ||
      "Unknown";

    const label =
      pick.season === CURRENT_YEAR
        ? pick.slot
        : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;

    return (
  <div
    key={i}
    className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
      pick.round === 1
        ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
        : pick.round === 2
        ? "bg-green-900/40 border-green-600 text-green-300"
        : pick.round === 3
        ? "bg-blue-900/40 border-blue-600 text-blue-300"
        : "bg-orange-900/40 border-orange-600 text-orange-300"
    }`}
  >
    <span className="font-semibold">{label}</span>
    <span className="text-[10px] text-gray-300">
      via {ownerName}
    </span>
  </div>
);
  })}
</div>
        </div>
      );
    })}

  </div>
)}
{activeTab === "FREE AGENTS" && (
  <div className="mt-4 bg-gray-900 border border-gray-800 rounded-xl p-4">
    <div className="text-sm font-semibold mb-3 text-gray-300">
      Top Free Agents (by Value)
    </div>

    {freeAgents.map((p) => (
      <div
        key={p.player_id}
        className="flex justify-between items-center bg-gray-800/70 px-3 py-1.5 rounded-lg mb-1 text-sm"
      >
        <div className="flex items-center gap-2">
          <div className="text-[10px] px-2 py-0.5 rounded bg-gray-700/80">
            {p.position}
          </div>
          <div>{p.full_name}</div>
        </div>

        <div className="text-[11px] text-gray-400">
          VAL {p.value || 0}
        </div>
      </div>
    ))}
  </div>
)}
              </>
            )}
            </>
            )}

            {/* ── League Mates ── */}
            {leagueHubTab === "LEAGUE_MATES" && (() => {
              if (!selectedLeague || !rosters.length) {
                return <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view league-mate intelligence.</p>;
              }

              const bestPartnerRosterId = selectedLeagueMateProfilesView[0]?.rosterId;

              return (
                <div className="space-y-4">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">League-Mate Intelligence</div>
                        <div className="mt-1 text-sm text-gray-200">
                          Static roster profiles, recent trade behavior, and trade-partner fit for <strong className="text-gray-100">{selectedLeague.name}</strong>.
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-500 text-right">
                        {loadingLeagueMateIntel || loadingCrossLeagueMateIntel
                          ? "Refreshing trade behavior and all-league tendencies..."
                          : supabaseUser ? "Supabase cache enabled" : "Browser-only until you log in"}
                        {leagueMateIntelLoadedAt && !loadingLeagueMateIntel && !loadingCrossLeagueMateIntel && (
                          <div className="text-[10px] text-gray-600 mt-0.5">
                            Updated {new Date(leagueMateIntelLoadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {selectedLeagueMateProfilesView.length === 0 ? (
                    <p className="text-sm text-gray-500">No league-mate profiles available yet.</p>
                  ) : (
                    selectedLeagueMateProfilesView.map((mate) => {
                      const mateSimRow = selectedLeagueSimulation?.rowByRosterId?.get(Number(mate.rosterId));
                      const matePlayoffOdds = mateSimRow?.playoffOdds ?? 0;
                      const mateAdjBucket = getAdjustedDirectionBucket(
                        mate.directionProfile?.bucket,
                        mate.directionProfile,
                        matePlayoffOdds,
                        !!mateSimRow
                      );
                      const mateAdjColor = getBucketColor(mateAdjBucket);
                      return (
                      <div key={mate.rosterId} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-base font-semibold text-white">{mate.ownerName}</div>
                              {Number(mate.rosterId) === Number(bestPartnerRosterId) && (
                                <span className="rounded-full border border-green-700 bg-green-950/50 px-2 py-0.5 text-[10px] font-semibold text-green-300">
                                  Best Trade Partner
                                </span>
                              )}
                              <span className={`inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full border ${mateAdjColor}`}>
                                {mateAdjBucket}
                              </span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                                mate.fitScore >= 24 ? "border-blue-700 bg-blue-950/40 text-blue-300" :
                                mate.fitScore >= 10 ? "border-cyan-700 bg-cyan-950/40 text-cyan-300" :
                                "border-gray-700 bg-gray-950/60 text-gray-400"
                              }`}>
                                {mate.fitLabel}
                              </span>
                            </div>
                            <div className="mt-2 text-sm text-gray-300">{mate.motivation}</div>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => loadUserExposure(mate.ownerId)}
                              className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                            >
                              Most Owned Players
                            </button>
                            <button
                              onClick={() => loadUserTrades(mate.ownerId)}
                              className="rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white transition hover:border-blue-500"
                            >
                              Recent Trades
                            </button>
                            <button
                              onClick={() => { setCalcOpponentRosterId(Number(mate.rosterId)); setMainTab("TRADE_HUB"); setTradeHubSection("FINDER"); }}
                              className="rounded-xl border border-blue-700 bg-blue-950/40 px-3 py-2 text-sm text-blue-200 transition hover:border-blue-500"
                            >
                              Open In Trade Finder
                            </button>
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Build</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.buildBiasLabel}</div>
                            <div className="mt-1 text-xs text-gray-500">Top groups: {mate.strongestPos} / {mate.secondPos}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Draft Capital</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.firstRounders} firsts</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.directionProfile.futureFirsts} future firsts • {Math.round(mate.directionProfile.pickTotal || 0).toLocaleString()} pick value</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Roster Age</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.directionProfile.coreAge || "-"}</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.directionProfile.summary}</div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-gray-500">Recent Behavior</div>
                            <div className="mt-1 text-sm font-semibold text-white">{mate.tradeCount30d} trades in 30d</div>
                            <div className="mt-1 text-xs text-gray-500">{mate.recentBuyLabel} • picks {mate.picksIn30d}-{mate.picksOut30d}</div>
                          </div>
                        </div>

                        <div className="mt-4 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                            <div className="text-[10px] uppercase tracking-wide text-violet-400">Across All Leagues</div>
                            <div className="text-[11px] text-gray-500">
                              {mate.totalDynastyLeagues > 0 ? `${mate.totalDynastyLeagues} dynasty leagues tracked` : "Loading broader tendencies"}
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-gray-300">{mate.crossLeagueSummary}</div>
                          <div className="mt-2 text-sm text-gray-400">{mate.crossLeagueTradeSummary}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-violet-800 bg-violet-950/30 px-3 py-1 text-[11px] text-violet-200">
                              {mate.preferenceLabel}
                            </span>
                            <span className="rounded-full border border-amber-800 bg-amber-950/30 px-3 py-1 text-[11px] text-amber-200">
                              {mate.tradePreferenceLabel}
                            </span>
                            {mate.preferredPositions?.map((pos: string) => (
                              <span key={pos} className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-[11px] text-gray-300">
                                Prefers {pos}
                              </span>
                            ))}
                            {mate.tradePreferredPositions?.map((pos: string) => (
                              <span key={`trade-${pos}`} className="rounded-full border border-amber-800 bg-amber-950/20 px-3 py-1 text-[11px] text-amber-200">
                                Trades For {pos}
                              </span>
                            ))}
                            {mate.repeatedPlayers?.slice(0, 3).map((player) => (
                              <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200">
                                Likes {player.name}
                              </span>
                            ))}
                            {mate.acquiredPlayers?.slice(0, 2).map((player) => (
                              <span key={`acquired-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-3 py-1 text-[11px] text-emerald-200">
                                Recently Bought {player.name}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-4 grid gap-3 lg:grid-cols-2">
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-green-400">Why They Fit</div>
                            <div className="mt-2 space-y-1">
                              {mate.fitReasons?.length > 0 ? mate.fitReasons.map((reason: string) => (
                                <div key={reason} className="text-xs text-gray-300">{reason}</div>
                              )) : (
                                <div className="text-xs text-gray-500">No major structural trade edge right now.</div>
                              )}
                            </div>
                          </div>
                          <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="text-[10px] uppercase tracking-wide text-orange-400">Likely Motivations</div>
                            <div className="mt-2 space-y-1">
                              {mate.directionProfile.actions?.slice(0, 3).map((action: string) => (
                                <div key={action} className="text-xs text-gray-300">{action}</div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              );
            })()}

            {/* ── Opponent Rosters ── */}
            {leagueHubTab === "OPP_ROSTERS" && (() => {
              if (!selectedLeague || !rosters.length) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view opponent rosters.</p>
              );

              const oppRolePriority: Record<string, number> = { starter: 0, bench: 1, taxi: 2 };

              // Build opponent roster from selected owner
              const oppRoster = rosters.find((r) => r.owner_id === oppRosterOwnerId);
              const oppPlayerIds: string[] = oppRoster?.players || [];
              const oppTaxiIds = new Set<string>(oppRoster?.taxi || []);
              const oppStarterIds = new Set<string>(oppRoster?.starters || []);

              const getOppRole = (id: string) => {
                if (oppStarterIds.has(id)) return "starter";
                if (oppTaxiIds.has(id)) return "taxi";
                return "bench";
              };

              const oppGrouped: Record<string, Array<SleeperPlayer & { role: string }>> = { QB: [], RB: [], WR: [], TE: [] };
              oppPlayerIds.forEach((id) => {
                const p = players[id];
                if (!p || !oppGrouped[p.position]) return;
                oppGrouped[p.position].push({ ...p, role: getOppRole(id) });
              });
              Object.keys(oppGrouped).forEach((pos) => {
                oppGrouped[pos].sort((a, b) => {
                  const rd = oppRolePriority[a.role] - oppRolePriority[b.role];
                  return rd !== 0 ? rd : (b.value || 0) - (a.value || 0);
                });
              });

              const oppFilteredPlayers = (["QB","RB","WR","TE"].includes(oppRosterTab) ? oppGrouped[oppRosterTab] : [])
                ?.filter((p) => p.full_name?.toLowerCase().includes(oppRosterSearch.toLowerCase()));

              const oppPicksForOwner = allPicks.filter((p) => p.owner_id === oppRoster?.roster_id);

              const roleColors: Record<string, string> = {
                starter: "bg-green-800/60",
                bench: "bg-blue-800/40",
                taxi: "bg-purple-800/60",
              };

              return (
                <div>
                  {/* League name + owner dropdown */}
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="text-sm text-gray-400">{selectedLeague.name}</span>
                    <select
                      value={oppRosterOwnerId}
                      onChange={(e) => { setOppRosterOwnerId(e.target.value); setOppRosterTab("QB"); setOppRosterSearch(""); }}
                      className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm text-white"
                    >
                      <option value="">— select an owner —</option>
                      {rosters
                        .filter((r) => r.owner_id && r.owner_id !== user?.user_id)
                        .map((r) => (
                          <option key={r.roster_id} value={r.owner_id}>
                            {users[r.owner_id] || r.owner_id}
                          </option>
                        ))}
                    </select>
                  </div>

                  {oppRosterOwnerId && !oppRoster && (
                    <p className="text-sm text-gray-500">Roster not found.</p>
                  )}

                  {oppRoster && (
                    <>
                      {/* Tabs + search */}
                      <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 mb-4">
                        <div className="flex flex-wrap gap-2 mb-3">
                          {["ROSTER","QB","RB","WR","TE","PICKS"].map((pos) => (
                            <button
                              key={pos}
                              onClick={() => setOppRosterTab(pos)}
                              className={`px-3 py-1 rounded text-sm ${oppRosterTab === pos ? "bg-blue-600" : "bg-gray-800 hover:bg-gray-700"}`}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                        {["QB","RB","WR","TE"].includes(oppRosterTab) && (
                          <input
                            className="w-full p-2.5 rounded bg-gray-800 border border-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Search players..."
                            value={oppRosterSearch}
                            onChange={(e) => setOppRosterSearch(e.target.value)}
                          />
                        )}
                      </div>

                      {/* Position view */}
                      {["QB","RB","WR","TE"].includes(oppRosterTab) && (
                        <div className="bg-gray-900 border border-gray-700 rounded-xl p-4">
                          <div className="text-sm font-semibold mb-3 text-gray-300">{oppRosterTab}</div>
                          {oppFilteredPlayers?.map((p) => (
                            <div key={p.player_id} className={`flex items-center justify-between px-3 py-1.5 mb-1 rounded text-sm ${roleColors[p.role]}`}>
                              <div className="flex items-center gap-2 truncate">
                                <span className="font-medium">{p.full_name}</span>
                                <span className="text-xs text-gray-400">{p.team}</span>
                                <span className="text-xs text-gray-500">{p.role.toUpperCase()}</span>
                              </div>
                              <div className="flex items-center gap-3 text-xs whitespace-nowrap">
                                <span className="text-gray-400">Age {p.age || "—"}</span>
                                <span className="text-blue-400 font-semibold">{p.value || 0}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Full roster grid */}
                      {oppRosterTab === "ROSTER" && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {["QB","RB","WR","TE"].map((pos) => {
                            const posPlayers = oppGrouped[pos];
                            const starters = posPlayers.filter((p) => p.role === "starter");
                            const bench = posPlayers.filter((p) => p.role === "bench");
                            const totalVal = posPlayers.reduce((s: number, p) => s + (p.value || 0), 0);
                            return (
                              <div key={pos} className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                                <div className="flex justify-between mb-3">
                                  <div className="font-semibold text-sm">{pos} {posPlayers.length} TOTAL</div>
                                  <div className="text-xs text-gray-400">TOTAL {pos} VAL {totalVal}</div>
                                </div>
                                {starters.map((p, i) => (
                                  <div key={`s-${i}`} className="flex justify-between items-center bg-green-900/30 border border-green-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-green-700">STARTER</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                                  </div>
                                ))}
                                {bench.map((p, i) => (
                                  <div key={`b-${i}`} className="flex justify-between items-center bg-blue-900/30 border border-blue-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-blue-700">{pos}{starters.length + i + 1}</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-300">VAL {p.value || 0}</div>
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                          {/* Taxi */}
                          {oppTaxiIds.size > 0 && (
                            <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
                              <div className="font-semibold text-sm text-purple-400 mb-3">TAXI {oppTaxiIds.size} TOTAL</div>
                              {[...oppTaxiIds].map((id, i) => {
                                const p = players[id];
                                if (!p) return null;
                                return (
                                  <div key={i} className="flex justify-between items-center bg-purple-900/30 border border-purple-700 rounded p-2 mb-2">
                                    <div className="flex items-center gap-2">
                                      <div className="text-xs px-2 py-1 rounded bg-purple-700">TX{i+1}</div>
                                      <div>{p.full_name}</div>
                                    </div>
                                    <div className="text-xs text-gray-400">VAL {p.value || 0}</div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Picks */}
                      {oppRosterTab === "PICKS" && (
                        <div className="mt-2">
                          {YEARS.map((year) => {
                            const yearPicks = oppPicksForOwner
                              .filter((p) => p.season === year)
                              .sort((a, b) => a.round - b.round);
                            if (!yearPicks.length) return null;
                            return (
                              <div key={year} className="mb-4 bg-gray-900 border border-gray-700 rounded-lg p-4">
                                <div className="font-semibold text-sm mb-2">{year} Picks — {yearPicks.length} TOTAL</div>
                                <div className="flex flex-wrap gap-2">
                                  {yearPicks.map((pick, i) => {
                                    const label = pick.season === CURRENT_YEAR ? pick.slot : `${pick.round}${["th","st","nd","rd"][pick.round] || "th"}`;
                                    const originalOwner = users[pick.roster_id] || "";
                                    return (
                                      <div key={i} className={`px-3 py-1 rounded-full text-xs border flex items-center gap-1 ${
                                        pick.round === 1 ? "bg-yellow-900/40 border-yellow-600 text-yellow-300"
                                        : pick.round === 2 ? "bg-green-900/40 border-green-600 text-green-300"
                                        : pick.round === 3 ? "bg-blue-900/40 border-blue-600 text-blue-300"
                                        : "bg-orange-900/40 border-orange-600 text-orange-300"
                                      }`}>
                                        <span className="font-semibold">{label}</span>
                                        {originalOwner && pick.roster_id !== oppRoster.roster_id && (
                                          <span className="text-[10px] text-gray-300">via {originalOwner}</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Standings ── */}
            {leagueHubTab === "STANDINGS" && (
              <StandingsTab
                selectedLeague={selectedLeague}
                roster={roster}
                standings={standings}
                totalRosters={rosters.length}
                users={users}
              />
            )}

            {/* ── Suggested Starters ── */}
            {leagueHubTab === "STARTERS" && (() => {
              if (!selectedLeague || !roster) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first.</p>
              );
              const week = nflState?.week;
              const isInSeason = nflState?.season_type === "regular";
              const projectionBySleeperId = new Map(
                projectionData.map((row) => [String(row.sleeperId), row])
              );
              const hasKickoffData = projectionData.some((row) => getProjectionKickoffAt(row as unknown as Record<string, unknown>));

              // Score function: uses projections if in-season, redraft values otherwise
              const playerScore = (id: string) => {
                if (isInSeason) {
                  const proj = projectionBySleeperId.get(String(id));
                  return proj?.fpts ?? 0;
                }
                return redraftValues[id] ?? 0;
              };

              const playerKickoffAt = (id: string) => {
                if (!isInSeason) return null;
                const proj = projectionBySleeperId.get(String(id));
                return proj ? getProjectionKickoffAt(proj as unknown as Record<string, unknown>) : null;
              };

              const positions: string[] = selectedLeague.roster_positions?.filter((p: string) => !["BN","IR","TAXI"].includes(p)) ?? [];
              const myPlayerIds: string[] = roster.players ?? [];
              const taxiIds = new Set<string>((roster.taxi ?? []).map((id) => String(id)));
              const used = new Set<string>();
              const initialLineup: LineupCoachRow[] = [];
              const currentStarterRows = positions.map((slot: string, index: number) => {
                const starterId = String(roster?.starters?.[index] || "");
                const starterPlayer = starterId ? players[starterId] : null;
                return {
                  slot,
                  player: starterPlayer,
                  score: starterPlayer ? playerScore(starterPlayer.player_id) : 0,
                  kickoffAt: starterPlayer ? playerKickoffAt(starterPlayer.player_id) : null,
                };
              });

              // Fill each slot greedily with highest-scoring eligible player
              for (const slot of positions) {
                const eligible = getLineupSlotEligiblePositions(slot);
                const best = myPlayerIds
                  .filter(id => !used.has(id))
                  .map(id => ({ id, p: players[id] }))
                  .filter(({ p }) => p && eligible.includes(p.position))
                  .sort((a, b) => playerScore(b.id) - playerScore(a.id))[0];
                if (best) {
                  used.add(best.id);
                  initialLineup.push({ slot, player: best.p, score: playerScore(best.id), kickoffAt: playerKickoffAt(best.id) });
                } else {
                  initialLineup.push({ slot, player: null, score: 0, kickoffAt: null });
                }
              }

              const lineup = rebalanceLineupForKickoffWindows(initialLineup, isInSeason && hasKickoffData);

              const benchPlayers = myPlayerIds
                .filter((id) => !used.has(id) && !taxiIds.has(String(id)))
                .map((id) => players[id])
                .filter((p): p is SleeperPlayer => !!p)
                .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

              const taxiPlayers = myPlayerIds
                .filter((id) => taxiIds.has(String(id)))
                .map((id) => players[id])
                .filter((p): p is SleeperPlayer => !!p)
                .sort((a, b) => playerScore(b.player_id) - playerScore(a.player_id));

              const lineupCoachNotes = lineup
                .map(({ slot, player, score }, index) => {
                  if (!player?.player_id) return null;
                  const currentRow = currentStarterRows[index];
                  const currentPlayer = currentRow?.player;
                  if (currentPlayer?.player_id === player.player_id) return null;
                  const delta = score - (currentRow?.score || 0);
                  const reasonParts = [
                    delta > 0
                      ? `${isInSeason ? "Projection" : "Redraft score"} improves by ${delta.toFixed(1)}`
                      : `${isInSeason ? "Projection" : "Redraft score"} is safer for this slot`,
                    currentPlayer?.status && /out|doubtful|inactive|suspended/i.test(String(currentPlayer.status))
                      ? `${currentPlayer.full_name} is ${String(currentPlayer.status).toLowerCase()}`
                      : null,
                    slot === "FLEX" || slot === "SUPER_FLEX"
                      ? `${player.full_name} is the strongest remaining ${slot === "SUPER_FLEX" ? "flex-eligible" : "flex"} fit`
                      : `${player.full_name} grades best at ${slot.replace("_", " ")}`,
                    isInSeason &&
                    hasKickoffData &&
                    currentRow?.slot !== slot &&
                    currentPlayer?.position === player.position
                      ? `${player.full_name} gets the earlier locked slot so later-game flexibility stays in ${currentRow.slot.replace("_", " ")}`
                      : null,
                  ].filter(Boolean);

                  return {
                    slot,
                    suggested: player,
                    current: currentPlayer,
                    delta,
                    reason: reasonParts.join(" • "),
                  };
                })
                .filter(Boolean) as Array<{
                  slot: string;
                  suggested: SleeperPlayer;
                  current: SleeperPlayer | null | undefined;
                  delta: number;
                  reason: string;
                }>;

              const currentLineupScore = currentStarterRows.reduce((sum: number, row) => sum + (row.score || 0), 0);
              const suggestedLineupScore = lineup.reduce((sum: number, row) => sum + (row.score || 0), 0);
              const lineupDelta = suggestedLineupScore - currentLineupScore;

              const posColor: Record<string,string> = { QB:"bg-red-900/50 border-red-700", RB:"bg-green-900/50 border-green-700", WR:"bg-blue-900/50 border-blue-700", TE:"bg-yellow-900/50 border-yellow-700", FLEX:"bg-purple-900/50 border-purple-700", SUPER_FLEX:"bg-pink-900/50 border-pink-700" };

              return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs text-gray-500">
                      {isInSeason
                        ? <>Week {week} starters based on <strong className="text-gray-300">consensus projections</strong></>
                        : <>Offseason starters based on <strong className="text-gray-300">redraft rankings</strong></>
                      }
                      {" — "}<span className="text-blue-400">{selectedLeague.name}</span>
                    </p>
                  </div>
                  <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Lineup Coach</div>
                        <div className="mt-1 text-sm text-gray-200">
                          {lineupCoachNotes.length === 0
                            ? "Your current lineup already matches the coach recommendation."
                            : `The coach would make ${lineupCoachNotes.length} swap${lineupCoachNotes.length === 1 ? "" : "s"}${lineupDelta > 0 ? ` for roughly +${lineupDelta.toFixed(1)}` : ""}.`}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center md:min-w-[220px]">
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Current</div>
                          <div className="mt-1 text-sm font-semibold text-white">{currentLineupScore.toFixed(1)}</div>
                        </div>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Suggested</div>
                          <div className={`mt-1 text-sm font-semibold ${lineupDelta > 0 ? "text-green-300" : "text-white"}`}>
                            {suggestedLineupScore.toFixed(1)}
                          </div>
                        </div>
                      </div>
                    </div>
                    {lineupCoachNotes.length > 0 && (
                      <div className="mt-4 grid gap-2">
                        {lineupCoachNotes.map((note) => (
                          <div key={`${note.slot}-${note.suggested.player_id}-${note.current?.player_id || "empty"}`} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-sm">
                              <span className="rounded-full border border-blue-800 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                                {note.slot.replace("_", " ")}
                              </span>
                              <span className="text-white">{note.current?.full_name || "Empty slot"}</span>
                              <span className="text-gray-500">→</span>
                              <span className="font-semibold text-green-300">{note.suggested.full_name}</span>
                              <span className={`text-xs font-mono ${note.delta > 0 ? "text-green-300" : "text-gray-400"}`}>
                                {note.delta > 0 ? "+" : ""}{note.delta.toFixed(1)}
                              </span>
                            </div>
                            <div className="mt-1 text-xs text-gray-400">{note.reason}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  {lineup.map(({ slot, player, score }, i) => {
                    const statusStr = player?.status ? String(player.status).toLowerCase() : "";
                    const isOut = /out|inactive|suspended|covid|nfi|pup/.test(statusStr);
                    const isDoubtful = statusStr === "doubtful";
                    const isQuestionable = statusStr === "questionable";
                    return (
                      <div key={i} className={`flex items-center gap-3 border rounded-xl px-3 py-2 ${posColor[slot] ?? "bg-gray-800 border-gray-700"}`}>
                        <span className="text-[10px] font-bold uppercase w-16 shrink-0 text-gray-300">{slot.replace("_"," ")}</span>
                        {player ? (
                          <>
                            <span className="text-sm text-white flex-1 font-medium">{player.full_name}</span>
                            {isOut && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-900/60 text-red-400 border border-red-700 shrink-0">OUT</span>}
                            {isDoubtful && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-orange-900/60 text-orange-400 border border-orange-700 shrink-0">D</span>}
                            {isQuestionable && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-yellow-900/60 text-yellow-400 border border-yellow-700 shrink-0">Q</span>}
                            <span className="text-[10px] text-gray-400 shrink-0">{player.team}</span>
                            <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                          </>
                        ) : (
                          <span className="text-sm text-gray-600 italic">Empty</span>
                        )}
                      </div>
                    );
                  })}
                  <div className="grid gap-3 pt-2 md:grid-cols-2">
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Bench</span>
                        <span className="text-[10px] text-gray-600">{benchPlayers.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {benchPlayers.length === 0 ? (
                          <p className="text-xs text-gray-600 italic">No bench players</p>
                        ) : (
                          benchPlayers.map((player) => {
                            const score = playerScore(player.player_id);
                            return (
                              <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                                <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                                <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                                <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold uppercase tracking-widest text-gray-400">Taxi</span>
                        <span className="text-[10px] text-gray-600">{taxiPlayers.length}</span>
                      </div>
                      <div className="space-y-1.5">
                        {taxiPlayers.length === 0 ? (
                          <p className="text-xs text-gray-600 italic">No taxi players</p>
                        ) : (
                          taxiPlayers.map((player) => {
                            const score = playerScore(player.player_id);
                            return (
                              <div key={player.player_id} className="flex items-center gap-2 rounded-lg bg-gray-800/80 px-3 py-1.5">
                                <span className="text-[10px] font-bold w-7 shrink-0 text-gray-400">{player.position}</span>
                                <span className="text-sm text-white flex-1 truncate">{player.full_name}</span>
                                <span className="text-[10px] text-gray-500 shrink-0">{player.team}</span>
                                <span className="text-xs font-mono text-gray-300 shrink-0">{score > 0 ? score.toFixed(1) : "—"}</span>
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* ── League Notes ── */}
            {leagueHubTab === "NOTES" && (() => {
              const noteLeague = selectedLeague ?? leagues[0];
              if (!noteLeague) return <p className="text-sm text-gray-500">No leagues found.</p>;
              return (
                <div className="space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-sm font-semibold text-gray-300">Notes for:</span>
                    <select
                      className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
                      value={noteLeague.league_id}
                      onChange={(e) => {
                        const l = leagues.find((lg) => lg.league_id === e.target.value);
                        if (l) setSelectedLeague(l);
                      }}
                    >
                      {leagues.map((lg) => <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>)}
                    </select>
                  </div>
                  <textarea
                    className="w-full h-96 bg-gray-900 border border-gray-700 rounded-xl p-4 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                    placeholder={`Jot down thoughts, trade ideas, waiver targets for ${noteLeague.name}…`}
                    value={leagueNotes[noteLeague.league_id] ?? ""}
                    onChange={(e) => { saveLeagueNote(noteLeague.league_id, e.target.value); setLastNoteSavedAt(Date.now()); }}
                  />
                  <p className="text-[10px] text-gray-600">
                    {lastNoteSavedAt ? <span className="text-green-600">✓ Saved just now{supabaseUser ? " · syncing across devices" : ""}</span> : supabaseUser ? "Notes sync across your devices." : "Notes save to this browser only."}
                  </p>
                </div>
              );
            })()}

            {/* ── Power Rankings ── */}
            {leagueHubTab === "POWER_RANKINGS" && (() => {
              if (!selectedLeague || !rosters.length) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view Power Rankings.</p>
              );
              if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

              const calcVal = (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0;

              const rosterPositions: string[] = selectedLeague.roster_positions || [];

              // Project optimal starters given roster positions and player values
              type PRPlayer = SleeperPlayer & { dynVal: number; redVal: number };
              const projectStarterIds = (playerList: PRPlayer[]): Set<string> => {
                const starterSlots = rosterPositions.filter((s) => s !== "BN" && s !== "TAXI");
                const available = [...playerList].sort((a, b) => b.dynVal - a.dynVal);
                const starterIds = new Set<string>();
                const pickBest = (eligible: string[]) => {
                  const idx = available.findIndex((p) => eligible.includes(p.position));
                  if (idx !== -1) { starterIds.add(available[idx].player_id); available.splice(idx, 1); }
                };
                starterSlots.filter((s) => ["QB","RB","WR","TE","K","DEF"].includes(s)).forEach((s) => pickBest([s]));
                starterSlots.filter((s) => s === "WRRB_FLEX").forEach(() => pickBest(["WR","RB"]));
                starterSlots.filter((s) => s === "FLEX").forEach(() => pickBest(["RB","WR","TE"]));
                starterSlots.filter((s) => s === "SUPER_FLEX").forEach(() => pickBest(["QB","RB","WR","TE"]));
                return starterIds;
              };

              // Build all rosters with per-position dynasty totals + picks
              const prRows = rosters.map((r) => {
                const ownerId = r.owner_id;
                const ownerName = users[ownerId] || `Team ${r.roster_id}`;
                const allPlayerList = (r.players || []).map((id: string) => {
                  const p = players[id];
                  return p ? { ...p, dynVal: calcVal(id), redVal: redraftValues[id] || 0 } : null;
                }).filter((p): p is PRPlayer => !!p);

                const starterIds = projectStarterIds(allPlayerList);
                const playerList = prMode === "starters"
                  ? allPlayerList.filter((p) => starterIds.has(p.player_id))
                  : prMode === "bench"
                  ? allPlayerList.filter((p) => !starterIds.has(p.player_id))
                  : allPlayerList;

                const pickVal = prMode === "full"
                  ? allPicks.filter((p) => p.owner_id === r.roster_id).reduce((s: number, p) => s + getStoredPickValue(pickFcValues, p), 0)
                  : 0;

                const dynTotal = playerList.reduce((s: number, p) => s + p.dynVal, 0) + pickVal;
                const redTotal = playerList.reduce((s: number, p) => s + p.redVal, 0);
                const qbTotal  = playerList.filter((p) => p.position === "QB").reduce((s: number, p) => s + p.dynVal, 0);
                const rbTotal  = playerList.filter((p) => p.position === "RB").reduce((s: number, p) => s + p.dynVal, 0);
                const wrTotal  = playerList.filter((p) => p.position === "WR").reduce((s: number, p) => s + p.dynVal, 0);
                const teTotal  = playerList.filter((p) => p.position === "TE").reduce((s: number, p) => s + p.dynVal, 0);

                return { roster_id: r.roster_id, ownerId, ownerName, playerList, pickVal, dynTotal, redTotal, qbTotal, rbTotal, wrTotal, teTotal };
              });

              const prRosterToName: Record<number, string> = {};
              rosters.forEach((r) => { prRosterToName[Number(r.roster_id)] = users[r.owner_id] || `Team ${r.roster_id}`; });

              const rankMap = (key: "dynTotal"|"redTotal"|"qbTotal"|"rbTotal"|"wrTotal"|"teTotal") => {
                const sorted = [...prRows].sort((a, b) => b[key] - a[key]);
                return Object.fromEntries(sorted.map((row, i) => [row.roster_id, i + 1]));
              };

              const dynRanks = rankMap("dynTotal");
              const redRanks = rankMap("redTotal");
              const qbRanks  = rankMap("qbTotal");
              const rbRanks  = rankMap("rbTotal");
              const wrRanks  = rankMap("wrTotal");
              const teRanks  = rankMap("teTotal");

              const n = prRows.length;
              const pillColor = (r: number) => {
                const top3rd = Math.ceil(n / 3);
                const bot3rd = n - Math.floor(n / 3) + 1;
                if (r <= top3rd) return "bg-green-900/40 text-green-400 border-green-700";
                if (r >= bot3rd) return "bg-red-900/40 text-red-400 border-red-700";
                return "bg-gray-800/60 text-gray-400 border-gray-700";
              };

              const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

              const sortedRows = [...prRows].sort((a, b) => {
                const diff = b[prSortKey] - a[prSortKey];
                return prSortAsc ? -diff : diff;
              });

              const SortTh = ({ col, label }: { col: typeof prSortKey; label: string }) => {
                const active = prSortKey === col;
                return (
                  <th
                    className="text-center pb-2 px-2 cursor-pointer select-none hover:text-white transition"
                    onClick={() => { if (active) setPrSortAsc(v => !v); else { setPrSortKey(col); setPrSortAsc(false); } }}
                  >
                    {label}{active ? (prSortAsc ? " ↑" : " ↓") : ""}
                  </th>
                );
              };

              const RankPill = ({ r, rosterId, col }: { r: number; rosterId: number; col: "dyn"|"red"|"QB"|"RB"|"WR"|"TE" }) => (
                <button
                  onClick={() => setPrPopup({ rosterId, col })}
                  className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border transition hover:opacity-80 cursor-pointer ${pillColor(r)}`}
                >
                  {ordinal(r)}
                </button>
              );

              // Popup content
              let popupContent: React.ReactNode = null;
              if (prPopup) {
                const popRow = prRows.find(r => r.roster_id === prPopup.rosterId);
                if (popRow) {
                  const col = prPopup.col;
                  let popPlayers: any[] = [];
                  if (col === "dyn" || col === "red") {
                    popPlayers = [...popRow.playerList].sort((a, b) =>
                      col === "dyn" ? b.dynVal - a.dynVal : b.redVal - a.redVal
                    );
                  } else {
                    popPlayers = popRow.playerList.filter((p: any) => p.position === col)
                      .sort((a: any, b: any) => b.dynVal - a.dynVal);
                  }
                  const colLabel = col === "dyn" ? "Dynasty" : col === "red" ? "Redraft" : col;
                  popupContent = (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setPrPopup(null)}>
                      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-80 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-xs text-gray-500 uppercase tracking-wider">{colLabel} Roster</p>
                            <p className="text-sm font-semibold text-white">{popRow.ownerName}</p>
                          </div>
                          <button onClick={() => setPrPopup(null)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
                        </div>
                        <div className="space-y-1">
                          {popPlayers.map((p: any) => (
                            <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <button onClick={() => { setPrPopup(null); setPlayerProfileId(p.player_id); }} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                                <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                              </div>
                              <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">
                                {col === "red" ? (p.redVal || 0).toLocaleString() : (p.dynVal || 0).toLocaleString()}
                              </span>
                            </div>
                          ))}
                          {(col === "dyn") && (allPicks as any[]).filter((p: any) => p.owner_id === prPopup.rosterId).length > 0 && (
                            <>
                              <p className="text-[10px] text-gray-600 uppercase tracking-wider pt-1 pb-0.5 pl-1">Picks</p>
                              {(allPicks as any[]).filter((p: any) => p.owner_id === prPopup.rosterId).map((p: any, i: number) => {
                                const via = p.roster_id !== p.owner_id ? ` (via ${prRosterToName[p.roster_id] || `Team ${p.roster_id}`})` : "";
                                const label = p.slot && String(p.slot).includes(".") ? `${p.season} ${p.slot}` : `${p.season} Rd ${p.round}`;
                                const val = getStoredPickValue(pickFcValues, p);
                                return (
                                  <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                                    <span className="text-xs text-white truncate">{label}{via}</span>
                                    <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">{val.toLocaleString()}</span>
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                }
              }

              return (
                <>
                  {popupContent}
                  <div className="space-y-3">
                    {/* Mode toggle */}
                    <div className="flex items-center gap-1">
                      {(["full","starters","bench"] as const).map((m) => {
                        const labels = { full: "Full Team", starters: "Projected Starters", bench: "Projected Bench" };
                        const active = prMode === m;
                        return (
                          <button
                            key={m}
                            onClick={() => setPrMode(m)}
                            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
                          >
                            {labels[m]}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-xs text-gray-500">
                      Power rankings for <strong className="text-gray-300">{selectedLeague.name}</strong>.{" "}
                      {prMode === "full" && "Dynasty rank includes picks."}
                      {prMode === "starters" && "Showing projected optimal starting lineup based on dynasty values."}
                      {prMode === "bench" && "Showing projected bench (players outside the optimal starting lineup)."}
                      {" "}Click any pill to see that team's roster. Click column headers to sort.
                    </p>
                    <div className="overflow-x-auto pb-1">
                      <table className="min-w-full text-sm border-separate border-spacing-y-1">
                        <thead>
                          <tr className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
                            <th className="text-left pl-3 pb-2 pr-2">Owner</th>
                            <SortTh col="dynTotal" label="Dynasty" />
                            <SortTh col="redTotal" label="Redraft" />
                            <SortTh col="qbTotal" label="QB" />
                            <SortTh col="rbTotal" label="RB" />
                            <SortTh col="wrTotal" label="WR" />
                            <SortTh col="teTotal" label="TE" />
                            {prMode === "full" && <th className="text-center pb-2 px-2 text-gray-600">Picks</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {sortedRows.map((row) => {
                            const isMe = row.roster_id === myRosterId;
                            const isIgnored = !isMe && ignoredOwnerIds.includes(row.ownerId);
                            return (
                              <tr key={row.roster_id} className={`group ${isMe ? "bg-blue-900/20" : isIgnored ? "bg-red-950/20" : "bg-gray-900"}`}>
                                <td className={`pl-3 pr-2 py-2.5 rounded-l-xl text-sm font-medium ${isMe ? "text-blue-300" : isIgnored ? "text-red-400/70" : "text-white"}`}>
                                  <div className="flex items-center gap-2">
                                    <span>{row.ownerName}</span>
                                    {isMe && <span className="text-[10px] text-blue-500">(you)</span>}
                                    {isIgnored && <span className="text-[10px] text-red-500 font-normal">ignored</span>}
                                    {!isMe && (
                                      <button
                                        onClick={() => toggleIgnoredOwner(row.ownerId)}
                                        title={isIgnored ? "Remove from ignore list" : "Ignore this owner"}
                                        className={`text-[11px] leading-none transition ${isIgnored ? "opacity-100 text-red-500 hover:text-red-300" : "opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400"}`}
                                      >
                                        🚫
                                      </button>
                                    )}
                                  </div>
                                </td>
                                <td className="text-center px-2 py-2.5"><RankPill r={dynRanks[row.roster_id]} rosterId={row.roster_id} col="dyn" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={redRanks[row.roster_id]} rosterId={row.roster_id} col="red" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={qbRanks[row.roster_id]} rosterId={row.roster_id} col="QB" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={rbRanks[row.roster_id]} rosterId={row.roster_id} col="RB" /></td>
                                <td className="text-center px-2 py-2.5"><RankPill r={wrRanks[row.roster_id]} rosterId={row.roster_id} col="WR" /></td>
                                <td className={`text-center px-2 py-2.5 ${prMode !== "full" ? "rounded-r-xl" : ""}`}><RankPill r={teRanks[row.roster_id]} rosterId={row.roster_id} col="TE" /></td>
                                {prMode === "full" && <td className="text-center px-2 py-2.5 rounded-r-xl text-xs text-gray-400 font-mono">{row.pickVal > 0 ? row.pickVal.toLocaleString() : <span className="text-gray-700">—</span>}</td>}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              );
            })()}

            {/* ── Draft Board ── */}
            {leagueHubTab === "DRAFT_BOARD" && (() => {
              if (!selectedLeague) return (
                <p className="text-sm text-gray-500">Select a league first to view the draft board.</p>
              );

              const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;
              const mySlots = (allPicks as any[]).filter((p: any) => Number(p.owner_id ?? 0) === Number(myRosterId) && p.slot && /^\d+\.\d+$/.test(String(p.slot))).map((p: any) => p.slot as string);

              // Post-draft projection: players user has selected + predictions for remaining my slots
              const projectedMyPicks: string[] = [];
              mySlots.forEach(slot => {
                const pred = predictedDraftPicks[slot];
                const pid = myDraftSlotPicks[slot] || pred?.player_id || pred?.name;
                if (pid) projectedMyPicks.push(pid);
              });

              return (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-base font-semibold text-white">{ROOKIE_YEAR} Rookie Draft Board</h2>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {mySlots.length > 0 ? `Your picks: ${mySlots.join(", ")}` : "Loading your draft slots…"}
                        {" · "}Ghost picks = AI prediction based on your big board + team needs
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {Object.keys(myDraftSlotPicks).length > 0 && (
                        <button
                          onClick={() => {
                            if (!window.confirm("Clear all your draft picks? This cannot be undone.")) return;
                            setMyDraftSlotPicks({});
                            if (selectedLeague?.league_id) {
                              localStorage.removeItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                              if (supabaseUser) {
                                supabase
                                  .from("draft_board_picks")
                                  .delete()
                                  .eq("user_id", supabaseUser.id)
                                  .eq("league_id", selectedLeague.league_id)
                                  .eq("season", ROOKIE_YEAR)
                                  .then(() => {});
                              }
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
                        >
                          ✕ Reset Picks
                        </button>
                      )}
                      <button
                        onClick={refreshDraftBoard}
                        disabled={loadingDraftRefresh}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
                      >
                        {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh"}
                      </button>
                    </div>
                  </div>

                  {!draftSettings ? (
                    <div className="text-gray-400 text-sm">
                      No draft found for this league. The draft board will appear once Sleeper creates the {ROOKIE_YEAR} draft.
                    </div>
                  ) : (
                    <>
                      {/* Draft grid */}
                      {draftHubSection === "BOARD" && draftSettings && (() => {
                        const slotOwnerMap: Record<string, number> = {};
                        (allPicks as any[]).forEach((p: any) => { if (p.slot) slotOwnerMap[p.slot] = Number(p.owner_id ?? p.roster_id ?? 0); });
                        const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
                        // roster_id → display name map for cell owner rows
                        const rosterToName: Record<number, string> = {};
                        (rosters as any[]).forEach((r: any) => {
                          rosterToName[Number(r.roster_id)] = users[r.owner_id] || `Team ${r.roster_id}`;
                        });
                        return (
                          <div className="overflow-x-auto lg:overflow-x-visible">
                            <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500">
                              <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600"/>My Slots (click to set)</span>
                              <span className="flex items-center gap-1 italic text-gray-600">Italic = predicted</span>
                              <span className="flex items-center gap-1"><span className="text-orange-400 font-bold">REACH</span> = &gt;8 ahead of ADP</span>
                              <span className="flex items-center gap-1"><span className="text-green-400 font-bold">VALUE</span> = &gt;5 after ADP</span>
                            </div>
                            <div
                              className="grid w-full gap-y-1.5 gap-x-1.5"
                              style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
                            >
                              {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
                                const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
                                const slotRosterId = slotOwnerMap[`1.${String(slot).padStart(2,"0")}`] || null;
                                const isMe = slotRosterId === Number(myRosterId);
                                const teamName = (userId && users[userId]) || `Team ${slot}`;
                                return (
                                  <button key={slot} onClick={() => userId && loadDraftScout(userId)}
                                    className={`min-w-0 min-h-[2.5rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}>
                                    {teamName}{isMe ? " ★" : ""}
                                  </button>
                                );
                              })}
                              {Array.from({ length: Number(draftSettings?.settings?.rounds) || 4 }, (_, i) => i + 1).flatMap((round) =>
                                Array.from({ length: rosters.length }, (_, i) => i + 1).map((slotNum) => {
                                  const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
                                  const slotOwner = slotOwnerMap[slotStr];
                                  const isMySlot = slotOwner === Number(myRosterId);
                                  const playerPick = draftPicks.find((dp: any) => dp.round === round && Number(dp.roster_id ?? dp.picked_by) === slotOwner);
                                  const actualPlayer = playerPick ? players[playerPick.player_id] : null;
                                  const userOverrideId = myDraftSlotPicks[slotStr];
                                  const userOverride = userOverrideId ? rookies.find((r: any) => r.player_id === userOverrideId || r.name === userOverrideId) : null;
                                  const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                                  const overallPick = (round - 1) * rosters.length + slotNum;
                                  const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                                  // REACH/VALUE for AI-predicted user slots — compare pick position to player's consensus pool rank
                                  const predReach = isMySlot && prediction && prediction.poolRank > 0 && overallPick < (prediction.poolRank ?? 999) - 8;
                                  const predValue = isMySlot && prediction && prediction.poolRank > 0 && overallPick > (prediction.poolRank ?? 0) + 5;
                                  const isEditing = draftSlotEditing === slotStr;
                                  return (
                                    <div key={slotStr}
                                      className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                                        ${isMySlot ? "border-2 border-blue-600 bg-blue-950/40" : "border border-gray-700 bg-gray-800"}
                                        ${isMySlot && !actualPlayer ? "cursor-pointer hover:bg-blue-900/40" : ""}
                                      `}
                                      onClick={() => { if (!isMySlot || actualPlayer) return; setDraftSlotEditing(isEditing ? null : slotStr); setDraftSlotSearchQuery(""); }}
                                    >
                                      {actualPlayer ? (
                                        <>
                                          <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                                          <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                                          <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                                        </>
                                      ) : userOverride ? (
                                        <>
                                          {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                                          <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                                          <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                                          <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[slotOwner] || "You"}</div>
                                          <button className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); const n = {...myDraftSlotPicks}; delete n[slotStr]; setMyDraftSlotPicks(n); }}>✕</button>
                                        </>
                                      ) : prediction ? (
                                        <>
                                          {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                                          {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                                          <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                                          <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                                          <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                                          {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                                        </>
                                      ) : (
                                        <>
                                          <div className="text-gray-600 font-semibold text-[10px]">{slotStr}</div>
                                          <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[slotOwner] || ""}</div>
                                          {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                                        </>
                                      )}
                                      {isEditing && (
                                        <div className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1" onClick={(e) => e.stopPropagation()}>
                                          <input autoFocus className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500" placeholder="Search rookie…" value={draftSlotSearchQuery} onChange={(e) => setDraftSlotSearchQuery(e.target.value)} />
                                          <div className="max-h-44 overflow-y-auto space-y-0.5">
                                            {rookies.map((r: any, idx: number) => ({...r, boardRank: idx + 1}))
                                              .filter((r: any) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                                              .filter((r: any) => !Array.from(draftedPlayerIds).includes(String(r.player_id)) && !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && (pid === r.player_id || pid === r.name)))
                                              .slice(0, 15)
                                              .map((r: any) => {
                                                const pickNum = (round - 1) * rosters.length + slotNum;
                                                const reachAmt = typeof r.adp === "number" ? Math.round(pickNum - r.adp) : null;
                                                return (
                                                  <button key={`${r.boardRank}-${r.player_id || r.name}`} className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                                    onClick={() => { setMyDraftSlotPicks(prev => ({...prev, [slotStr]: r.player_id || r.name})); setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>
                                                    <span className="text-white text-[10px] truncate">#{r.boardRank} {r.name}</span>
                                                    <span className="flex items-center gap-1 shrink-0">
                                                      <span className={`text-[9px] ${posColor[r.position] || "text-gray-400"}`}>{r.position}</span>
                                                      {reachAmt !== null && reachAmt < -8 && <span className="text-[8px] text-orange-400 font-bold">REACH</span>}
                                                      {reachAmt !== null && reachAmt > 5 && <span className="text-[8px] text-green-400">VALUE</span>}
                                                    </span>
                                                  </button>
                                                );
                                              })}
                                          </div>
                                          <button className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400" onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>cancel</button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Post-draft projection */}
                      {projectedMyPicks.length > 0 && (
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                          <h3 className="text-sm font-semibold text-white mb-2">Projected Rookie Haul</h3>
                          <p className="text-[10px] text-gray-500 mb-3">Based on your set picks + AI predictions for remaining slots. Save to Supabase automatically.</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {projectedMyPicks.map((pid) => {
                              const r = rookies.find((rk: any) => rk.player_id === pid || rk.name === pid);
                              if (!r) return null;
                              const idx = rookies.indexOf(r);
                              const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
                              return (
                                <div key={pid} className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
                                  <div>
                                    <div className="text-xs text-white font-medium">{r.name}</div>
                                    <div className={`text-[10px] ${posColor[r.position] || "text-gray-400"}`}>{r.position} · {r.team || "FA"}</div>
                                  </div>
                                  <div className="text-right">
                                    <div className="text-xs text-gray-400">#{idx + 1}</div>
                                    <div className="text-[9px] text-gray-600">ADP {Math.round(r.adp ?? 99)}</div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* ── Activity Feed ── */}
            {leagueHubTab === "ACTIVITY" && (() => {
              if (!selectedLeague) return (
                <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view the activity feed.</p>
              );
              if (loadingActivity) return <p className="text-sm text-blue-400">Loading transactions…</p>;

              const rosterToUser: Record<number, string> = {};
              rosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });
              const ownerName = (rosterId: number) => {
                const uid = rosterToUser[rosterId];
                return users[uid] || `Team ${rosterId}`;
              };

              const fmtTs = (ts: number) => {
                if (!ts) return "";
                const d = new Date(ts);
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
              };

              const txns = activityTransactions.filter((t: any) =>
                Object.keys(t.adds || {}).length > 0 ||
                Object.keys(t.drops || {}).length > 0 ||
                (t.draft_picks || []).length > 0
              );

              if (!txns.length) return (
                <div className="text-center py-10 text-gray-500 text-sm">
                  No transactions found for {selectedLeague.name}. Activity appears here as the season progresses.
                </div>
              );

              return (
                <div className="space-y-2">
                  <p className="text-xs text-gray-500 mb-3">
                    Recent transactions for <strong className="text-gray-300">{selectedLeague.name}</strong>. Click any player name to view their profile.
                  </p>
                  {txns.map((t: any, idx: number) => {
                    const isWaiver = t.type === "waiver";
                    const isTrade = t.type === "trade";
                    const adds = Object.entries(t.adds || {}) as [string, number][];
                    const drops = Object.entries(t.drops || {}) as [string, number][];
                    const picks = (t.draft_picks || []) as any[];

                    const typeLabel = isTrade ? "Trade" : isWaiver ? "Waiver" : "Free Agent";
                    const typeColor = isTrade
                      ? "bg-purple-900/40 text-purple-300 border-purple-700"
                      : isWaiver
                      ? "bg-blue-900/40 text-blue-300 border-blue-700"
                      : "bg-green-900/40 text-green-300 border-green-700";

                    if (isTrade) {
                      // Group adds/drops by roster (each roster's perspective)
                      const rosterIds = Array.from(new Set([
                        ...adds.map(([, rid]) => rid),
                        ...drops.map(([, rid]) => rid),
                        ...(t.roster_ids || []),
                      ])) as number[];

                      return (
                        <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${typeColor}`}>{typeLabel}</span>
                              <span className="text-xs text-gray-500">{fmtTs(t.status_updated || t.created)}</span>
                            </div>
                          </div>
                          <div className={`grid gap-3`} style={{ gridTemplateColumns: `repeat(${Math.min(rosterIds.length, 3)}, 1fr)` }}>
                            {rosterIds.map((rid) => {
                              const got = adds.filter(([, r]) => r === rid).map(([pid]) => pid);
                              const gave = drops.filter(([, r]) => r === rid).map(([pid]) => pid);
                              const gotPicks = picks.filter((p: any) => p.owner_id === rid);
                              const gavePicks = picks.filter((p: any) => p.previous_owner_id === rid);
                              return (
                                <div key={rid}>
                                  <p className="text-xs font-semibold text-blue-300 mb-1">{ownerName(rid)}</p>
                                  {got.length > 0 && (
                                    <div className="mb-1">
                                      <p className="text-[10px] text-green-500 uppercase font-bold mb-0.5">Received</p>
                                      {got.map(pid => {
                                        const p = players[pid];
                                        return p ? (
                                          <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-white hover:text-blue-400 transition text-left">
                                            {p.full_name} <span className="text-gray-500">{p.position}</span>
                                          </button>
                                        ) : null;
                                      })}
                                      {gotPicks.map((pk: any, i: number) => (
                                        <p key={i} className="text-xs text-gray-400">{pk.season} Rd {pk.round}</p>
                                      ))}
                                    </div>
                                  )}
                                  {gave.length > 0 && (
                                    <div>
                                      <p className="text-[10px] text-red-400 uppercase font-bold mb-0.5">Gave</p>
                                      {gave.map(pid => {
                                        const p = players[pid];
                                        return p ? (
                                          <button key={pid} onClick={() => setPlayerProfileId(pid)} className="block text-xs text-gray-400 hover:text-blue-400 transition text-left line-through">
                                            {p.full_name} <span className="text-gray-600">{p.position}</span>
                                          </button>
                                        ) : null;
                                      })}
                                      {gavePicks.map((pk: any, i: number) => (
                                        <p key={i} className="text-xs text-gray-600 line-through">{pk.season} Rd {pk.round}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }

                    // Add / Drop / Waiver
                    return (
                      <div key={t.transaction_id || idx} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3 flex items-start gap-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border shrink-0 mt-0.5 ${typeColor}`}>{typeLabel}</span>
                        <div className="min-w-0 flex-1">
                          {adds.map(([pid, rid]) => {
                            const p = players[pid];
                            return p ? (
                              <div key={pid} className="flex items-center gap-1.5 text-xs">
                                <span className="text-green-400 font-bold">+</span>
                                <button onClick={() => setPlayerProfileId(pid)} className="text-white hover:text-blue-400 transition font-medium">
                                  {p.full_name}
                                </button>
                                <span className="text-gray-500">{p.position} · {p.team}</span>
                                <span className="text-gray-600">→ {ownerName(rid)}</span>
                              </div>
                            ) : null;
                          })}
                          {drops.map(([pid, rid]) => {
                            const p = players[pid];
                            return p ? (
                              <div key={pid} className="flex items-center gap-1.5 text-xs">
                                <span className="text-red-400 font-bold">−</span>
                                <button onClick={() => setPlayerProfileId(pid)} className="text-gray-400 hover:text-blue-400 transition line-through">
                                  {p.full_name}
                                </button>
                                <span className="text-gray-600">{p.position} · {p.team} dropped by {ownerName(rid)}</span>
                              </div>
                            ) : null;
                          })}
                        </div>
                        <span className="text-[10px] text-gray-600 shrink-0 mt-0.5">{fmtTs(t.status_updated || t.created)}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}

          </>
          </div>
  );
}

export default React.memo(LeagueHub);
