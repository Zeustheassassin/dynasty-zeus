"use client";
import React from "react";
import dynamic from "next/dynamic";
import Dashboard from "../../components/Dashboard";
import AlertsPage from "../../components/AlertsPage";
import ManagementHub from "../../components/ManagementHub";
import GamedayHub from "../../components/GamedayHub";
import ErrorBoundary from "../../components/ErrorBoundary";
import { CURRENT_YEAR, formatRelativeDate } from "../../lib/helpers";
import { ROOKIE_YEAR } from "../../hooks/useRookieBoardState";
import type {
  SleeperPlayer, SleeperLeague, SleeperRoster, SleeperTradedPick,
  SleeperNFLState, SleeperUser, SleeperDraft, SleeperDraftPick,
  AugmentedPick, LeagueOverviewEntry, LeagueMateStatEntry, HistoricalSnapshot,
  LeagueMateView, CommittedSimsByLeague, CachedSimRow, RookieBoardPlayer,
  GamedayMatchup, WatchlistEntry, GmBriefing,
  TradeAttempt, TradeAttemptStatus, FcTrendEntry, PredictedPick,
  LeagueHubTab, ProjectionRow, SimulationTeamRow,
  LeagueMgmtData, CommPaymentsData, TradePartnerRanking,
} from "../../lib/types";
import type { AnnotatedTrade } from "../../hooks/useUserTrades";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer } from "../../components/AlertsPage/alertsPageHelpers";
import type { ExposureData } from "../../hooks/useUserExposure";
import type { DraftScoutLeague } from "../../hooks/useDraftScout";
import type { StandingRow, AnnotatedTransaction, TeamSummary } from "../../components/LeagueHub/leagueHubTypes";
import type { ShareEntry } from "../../components/DataHub/dataHubTypes";

// ── Hub loading skeleton ───────────────────────────────────────────────────
function HubSkeleton() {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-4 animate-pulse">
      <div className="h-16 rounded-2xl bg-gray-800/60" />
      <div className="h-10 rounded-xl bg-gray-800/40 w-1/3" />
      <div className="h-64 rounded-2xl bg-gray-800/30" />
    </div>
  );
}

const DraftHub = dynamic(() => import("../../components/DraftHub"), { ssr: false, loading: HubSkeleton });
const DataHub = dynamic(() => import("../../components/DataHub"), { ssr: false, loading: HubSkeleton });
const LeagueHub = dynamic(() => import("../../components/LeagueHub"), { ssr: false, loading: HubSkeleton });
const TradeHub = dynamic(() => import("../../components/TradeHub"), { ssr: false, loading: HubSkeleton });
const ScoutingHub = dynamic(() => import("../../components/ScoutingHub"), { ssr: false, loading: HubSkeleton });

// ── Local types ──────────────────────────────────────────────────────────────
type DataHubTabId = "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW";

type DraftScoutPatterns = {
  n: number;
  total: number;
  tendencies: string[];
  sortedPos: [string, number][];
  roundBreakdown: Record<string, Record<string, number>>;
};

// ── Props ────────────────────────────────────────────────────────────────────
interface HubRouterProps {
  // Navigation
  mainTab: string;
  dataHubTab: DataHubTabId;
  setMainTab: (tab: string) => void;

  // User / league
  user: SleeperUser | null;
  username: string;
  setUsername: React.Dispatch<React.SetStateAction<string>>;
  leagues: SleeperLeague[];
  players: Record<string, SleeperPlayer>;
  allPicks: AugmentedPick[];
  picks: AugmentedPick[];
  users: Record<string, string>;
  rosters: SleeperRoster[];
  nflState: SleeperNFLState | null;
  selectedLeague: SleeperLeague | null;
  setSelectedLeague: (league: SleeperLeague | null) => void;

  // Sleeper connect (Dashboard)
  connectLoading: boolean;
  connectError: string;
  connectSuccess: string;
  connectSleeper: () => void;

  // Alerts Hub
  visibleDashboardAlerts: DashboardAlert[];
  actionableDashboardAlerts: DashboardAlert[];
  watchlistEntries: WatchlistEntry[];
  dismissDashboardAlert: (alertId: string) => void;
  loadingExternalAlerts: boolean;
  leagueTransactions: LeagueTransaction[];
  loadingTransactions: boolean;
  injuryReportPlayers: InjuryReportPlayer[];
  allTradeAttempts: { id: string; league_id: string; status: string }[];
  allRosterBriefings: GmBriefing[];
  loadLeagueOverview: () => void;
  loadingLeagueOverview: boolean;
  onNavigateToAttempts: (leagueId: string) => void;

  // League Hub
  leagueHubTab: LeagueHubTab;
  setLeagueHubTab: (tab: LeagueHubTab) => void;
  activeLeagueHubGroup: { id: string; label: string; tabs: Array<{ id: LeagueHubTab; label: string }> };
  standings: StandingRow[];
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
  simQueue: string[];
  simProgress: { done: number; total: number } | null;
  loadingLeagueMateIntel: boolean;
  loadingCrossLeagueMateIntel: boolean;
  loadingActivity: boolean;
  loadingLeagueWeeklyMatchups: boolean;
  leagueNotes: Record<string, string>;
  activityTransactions: AnnotatedTransaction[];
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  leagueOverviewLoaded: boolean;
  teamSummary: TeamSummary | null;
  selectedLeagueMateProfilesView: LeagueMateView[];
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;
  freeAgents: SleeperPlayer[];
  loadingCalcValues: boolean;
  loadingDraftRefresh: boolean;
  rookies: RookieBoardPlayer[];
  draftedPlayerIds: Set<string>;
  loadRoster: (league: SleeperLeague) => void;
  loadRedraftValues: () => void;
  loadUserTrades: (ownerId: string) => void;
  loadUserExposure: (ownerId: string) => void;
  loadDraftScout: (userId: string) => void;
  saveLeagueNote: (leagueId: string, text: string) => void;
  saveSimulationToSupabase: (leagueId: string, rows: SimulationTeamRow[]) => void;
  handleRunAllSims: () => void;
  refreshDraftBoard: () => Promise<void>;
  setPlayerProfileId: (id: string | null) => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS" | "MARKET") => void;

  // Gameday Hub
  gamedayWeek: number;
  gamedayMatchupCards: GamedayMatchup[];
  loadingGamedayMatchups: boolean;
  selectedGamedayMatchup: GamedayMatchup | null;
  setSelectedGamedayMatchupId: (id: number | null) => void;
  loadGamedayMatchups: (leagueId: string, week: number) => void;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number | "season", extraSources?: string[]) => void;
  shares: Record<string, ShareEntry>;
  totalLeagues: number;
  loadingAllLeagueData: boolean;
  shareSearch: string;
  setShareSearch: (s: string) => void;
  sharePosition: string;
  setSharePosition: (pos: string) => void;

  // Data Hub
  setDataHubTab: (tab: DataHubTabId) => void;
  dynastyRankPos: string;
  setDynastyRankPos: (pos: string) => void;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  savePlayerDisposition: (playerId: string, sell: string, buy: string) => void;
  loadingRedraft: boolean;
  projectionData: ProjectionRow[];
  setProjectionData: React.Dispatch<React.SetStateAction<ProjectionRow[]>>;
  projectionPosFilter: string;
  setProjectionPosFilter: (pos: string) => void;
  projectionWeek: number;
  projectionSeasonYear: number | null;
  projectionSourceStatus: Record<string, boolean>;
  loadingProjections: boolean;
  projectionUsesSeasonFallback: boolean;
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
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  externalShares: ExposureData | null;
  loadingShares: boolean;
  historicalSnapshot: HistoricalSnapshot | null;
  saveSnapshotNow: () => Promise<void>;

  // Draft Hub
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES";
  setDraftHubSection: (s: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES") => void;
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (query: string) => void;
  draftSettings: SleeperDraft | null;
  draftPicks: SleeperDraftPick[];
  draftOrder: Record<string, number>;
  predictedDraftPicks: Record<string, PredictedPick>;
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  tempRanks: Record<number, string>;
  setTempRanks: React.Dispatch<React.SetStateAction<Record<number, string>>>;
  topAvailableRookies: RookieBoardPlayer[];
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;

  // Trade Hub
  tradeHubSection: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS" | "TRADE_LOG" | "ATTEMPTS" | "MARKET";
  calcOpponentRosterId: number | null;
  calcGive: string[];
  setCalcGive: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceive: string[];
  setCalcReceive: React.Dispatch<React.SetStateAction<string[]>>;
  calcGivePicks: string[];
  setCalcGivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceivePicks: string[];
  setCalcReceivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  finderSeed: number;
  setFinderSeed: React.Dispatch<React.SetStateAction<number>>;
  finderPinnedPlayerId: string | null;
  setFinderPinnedPlayerId: (id: string | null) => void;
  finderTargetOppRosterId: number | null;
  setFinderTargetOppRosterId: (id: number | null) => void;
  finderTargetPlayerId: string | null;
  setFinderTargetPlayerId: (id: string | null) => void;
  selectedLeagueDraftHasOccurred: boolean;
  calcSearchA: string;
  setCalcSearchA: (s: string) => void;
  calcSearchB: string;
  setCalcSearchB: (s: string) => void;
  leaguePlayerTags: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>;
  handleToggleLeaguePlayerTag: (leagueId: string, playerId: string, forceTag?: "CORE" | "WANT_TO_TRADE") => void;
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  tradeRecommendationCards: unknown[];
  tradePartnerRankings: TradePartnerRanking[];
  tradeHubData: AnnotatedTrade[] | null;
  loadingTradeHub: boolean;
  tradeHubUserId: string | null;
  setTradeHubUserId: React.Dispatch<React.SetStateAction<string | null>>;
  setTradeHubData: React.Dispatch<React.SetStateAction<AnnotatedTrade[] | null>>;
  tradeAttempts: TradeAttempt[];
  loadingTradeAttempts: boolean;
  tradeAttemptsLeagueId: string | null;
  markTradeAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  updateAttemptStatus: (id: string, status: TradeAttemptStatus, counterDetails?: string) => Promise<void>;
  deleteAttempt: (id: string) => Promise<void>;
  loadTradeAttempts: (leagueId: string) => Promise<void>;
  onRefreshDirection: () => void;
  buyLowPlayerIds: string[];
  playerStats: Record<string, { avgTargets: number; avgCarries: number; snapPct: number; gamesPlayed: number; recentTargets?: number; recentCarries?: number; recentSnapPct?: number; targetTrend?: number; carryTrend?: number; snapTrend?: number }> | null;
  fcTrendData: FcTrendEntry[];
  loadingFcTrends: boolean;
  refreshFcTrends: () => void;

  // Management Hub
  mgmtHubTab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS";
  setMgmtHubTab: (tab: "LEAGUE_MGMT" | "COMMISSIONER_TOOLS") => void;
  leagueMgmtData: LeagueMgmtData;
  setLeagueMgmtData: React.Dispatch<React.SetStateAction<LeagueMgmtData>>;
  commPaymentsData: CommPaymentsData;
  setCommPaymentsData: React.Dispatch<React.SetStateAction<CommPaymentsData>>;
  commToolsLeagueId: string;
  setCommToolsLeagueId: (id: string) => void;
  commToolsRosters: SleeperRoster[];
  setCommToolsRosters: (rosters: SleeperRoster[]) => void;
  commToolsUsers: Record<string, SleeperUser>;
  setCommToolsUsers: (users: Record<string, SleeperUser>) => void;
  loadingCommToolsRosters: boolean;
  setLoadingCommToolsRosters: (loading: boolean) => void;

  // Draft Scout Modal
  draftScoutUserId: string | null;
  clearDraftScout: () => void;
  loadingDraftScout: boolean;
  draftScoutData: DraftScoutLeague[] | null;
  draftScoutPatterns: DraftScoutPatterns | null;

  // Player Profile Panel
  playerProfileId: string | null;
  calcFcValues: Record<string, number>;
  leagueAdjustedRedraftValues: Record<string, number>;
  playerNotes: Record<string, string>;
  savePlayerNote: (playerId: string, text: string) => void;

  // Exposure Modal
  myPlayerSet: Set<string>;
}

// ── Component ────────────────────────────────────────────────────────────────
export function HubRouter({
  mainTab, dataHubTab, setMainTab,
  user, username, setUsername, leagues, players, allPicks, picks, users, rosters,
  nflState, selectedLeague, setSelectedLeague,
  connectLoading, connectError, connectSuccess, connectSleeper,
  visibleDashboardAlerts, actionableDashboardAlerts, watchlistEntries,
  dismissDashboardAlert, loadingExternalAlerts, leagueTransactions, loadingTransactions,
  injuryReportPlayers, allTradeAttempts, allRosterBriefings,
  loadLeagueOverview, loadingLeagueOverview, onNavigateToAttempts,
  leagueHubTab, setLeagueHubTab, activeLeagueHubGroup, standings,
  committedSimsByLeague, leagueSimCache, simQueue, simProgress,
  loadingLeagueMateIntel, loadingCrossLeagueMateIntel, loadingActivity, loadingLeagueWeeklyMatchups,
  leagueNotes, activityTransactions, leagueOverviewData, leagueOverviewLoaded,
  teamSummary, selectedLeagueMateProfilesView, ignoredOwnerIds, toggleIgnoredOwner,
  freeAgents, loadingCalcValues, loadingDraftRefresh, rookies, draftedPlayerIds,
  loadRoster, loadRedraftValues, loadUserTrades, loadUserExposure, loadDraftScout,
  saveLeagueNote, saveSimulationToSupabase, handleRunAllSims, refreshDraftBoard,
  setPlayerProfileId, setCalcOpponentRosterId, setTradeHubSection,
  gamedayWeek, gamedayMatchupCards, loadingGamedayMatchups, selectedGamedayMatchup,
  setSelectedGamedayMatchupId, loadGamedayMatchups,
  setProjectionWeek, setProjectionLoaded, loadProjections,
  shares, totalLeagues, loadingAllLeagueData, shareSearch, setShareSearch, sharePosition, setSharePosition,
  setDataHubTab, dynastyRankPos, setDynastyRankPos,
  playerDispositions, savePlayerDisposition, loadingRedraft,
  projectionData, setProjectionData, projectionPosFilter, setProjectionPosFilter,
  projectionWeek, projectionSeasonYear, projectionSourceStatus, loadingProjections, projectionUsesSeasonFallback,
  leagueMateStats, setLeagueMateStats, leagueMateStatsLoaded, setLeagueMateStatsLoaded,
  loadingLeagueMateStats, setLoadingLeagueMateStats,
  leagueMateSearch, setLeagueMateSearch, leagueMateSort, setLeagueMateSort,
  selectedUserId, setSelectedUserId, externalShares, loadingShares, historicalSnapshot, saveSnapshotNow,
  draftHubSection, setDraftHubSection, myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing, draftSlotSearchQuery, setDraftSlotSearchQuery,
  draftSettings, draftPicks, draftOrder, predictedDraftPicks,
  rookieSearch, setRookieSearch, dragIndex, setDragIndex, tempRanks, setTempRanks,
  topAvailableRookies, movePlayer, handleRankChange,
  tradeHubSection, calcOpponentRosterId,
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  finderSeed, setFinderSeed, finderPinnedPlayerId, setFinderPinnedPlayerId,
  finderTargetOppRosterId, setFinderTargetOppRosterId,
  finderTargetPlayerId, setFinderTargetPlayerId,
  selectedLeagueDraftHasOccurred, calcSearchA, setCalcSearchA, calcSearchB, setCalcSearchB,
  leaguePlayerTags, handleToggleLeaguePlayerTag, leagueMateProfileByRosterId,
  tradeRecommendationCards, tradePartnerRankings,
  tradeHubData, loadingTradeHub, tradeHubUserId, setTradeHubUserId, setTradeHubData,
  tradeAttempts, loadingTradeAttempts, tradeAttemptsLeagueId,
  markTradeAttempted, updateAttemptStatus, deleteAttempt, loadTradeAttempts,
  onRefreshDirection, buyLowPlayerIds,
  playerStats, fcTrendData, loadingFcTrends, refreshFcTrends,
  mgmtHubTab, setMgmtHubTab, leagueMgmtData, setLeagueMgmtData,
  commPaymentsData, setCommPaymentsData, commToolsLeagueId, setCommToolsLeagueId,
  commToolsRosters, setCommToolsRosters, commToolsUsers, setCommToolsUsers,
  loadingCommToolsRosters, setLoadingCommToolsRosters,
  draftScoutUserId, clearDraftScout, loadingDraftScout, draftScoutData, draftScoutPatterns,
  playerProfileId, calcFcValues, leagueAdjustedRedraftValues, playerNotes, savePlayerNote,
  myPlayerSet,
}: HubRouterProps) {
  return (
    <>
      <div className={
        mainTab === "DRAFT" || mainTab === "TRADE_HUB" || mainTab === "MANAGEMENT_HUB" || mainTab === "LEAGUES" || mainTab === "ALERTS" || mainTab === "GAMEDAY_HUB" || mainTab === "SCOUTING_HUB"
          ? ""
          : (mainTab === "DATA_HUB" && dataHubTab === "DEPTH_CHARTS")
            ? "w-full px-6 py-6"
            : "max-w-3xl mx-auto p-6"
      }>
{mainTab === "DASHBOARD" && (
  <>
    <>
  {!user && (
    <div className="mb-6">
      <div className="flex gap-2">
        <input
          className="p-2 rounded bg-gray-800 w-full"
          placeholder="Enter Sleeper username"
          value={username}
          onChange={(e) => {
            setUsername(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !connectLoading) connectSleeper();
          }}
        />
        <button
          onClick={connectSleeper}
          disabled={connectLoading}
          className="bg-blue-600 px-4 rounded disabled:opacity-60"
        >
          {connectLoading ? "Connecting..." : "Connect"}
        </button>
      </div>
      {connectError && <div className="mt-2 text-sm text-red-400">{connectError}</div>}
      {!connectError && connectSuccess && <div className="mt-2 text-sm text-emerald-400">{connectSuccess}</div>}
    </div>
  )}

  <Dashboard
    username={user?.display_name || ""}
    onNavigate={setMainTab}
  />
</>
  </>
)}
        {mainTab === "ALERTS" && (
          <ErrorBoundary label="Alerts Hub">
          <AlertsPage
            alerts={visibleDashboardAlerts}
            actionableAlerts={actionableDashboardAlerts}
            watchlistEntries={watchlistEntries}
            onDismissAlert={dismissDashboardAlert}
            loadingExternalAlerts={loadingExternalAlerts}
            leagueTransactions={leagueTransactions}
            loadingTransactions={loadingTransactions}
            players={players}
            injuryReportPlayers={injuryReportPlayers}
            currentNFLWeek={nflState?.season_type === "regular" ? Number(nflState?.week || 0) : 0}
            allTradeAttempts={allTradeAttempts}
            allLeagues={leagues}
            rosterBriefings={allRosterBriefings}
            onRefreshLeagueData={loadLeagueOverview}
            loadingLeagueOverview={loadingLeagueOverview}
            onNavigateToAttempts={onNavigateToAttempts}
          />
          </ErrorBoundary>
        )}
        {/* LEAGUE HUB */}
        {mainTab === "LEAGUES" && (
          <ErrorBoundary label="League Hub">
          <LeagueHub
            leagueHubTab={leagueHubTab}
            setLeagueHubTab={setLeagueHubTab}
            activeLeagueHubGroup={activeLeagueHubGroup}
            leagues={leagues}
            user={user}
            standings={standings}
            setSelectedLeague={setSelectedLeague}
            picks={picks}
            allPicks={allPicks}
            committedSimsByLeague={committedSimsByLeague}
            leagueSimCache={leagueSimCache}
            simQueue={simQueue}
            simProgress={simProgress}
            loadingLeagueMateIntel={loadingLeagueMateIntel}
            loadingCrossLeagueMateIntel={loadingCrossLeagueMateIntel}
            loadingActivity={loadingActivity}
            loadingLeagueWeeklyMatchups={loadingLeagueWeeklyMatchups}
            leagueNotes={leagueNotes}
            activityTransactions={activityTransactions}
            leagueOverviewData={leagueOverviewData}
            loadingLeagueOverview={loadingLeagueOverview}
            leagueOverviewLoaded={leagueOverviewLoaded}
            teamSummary={teamSummary}
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
            ignoredOwnerIds={ignoredOwnerIds}
            toggleIgnoredOwner={toggleIgnoredOwner}
            projectionData={projectionData}
            draftPicks={draftPicks}
            draftOrder={draftOrder}
            draftSettings={draftSettings}
            myDraftSlotPicks={myDraftSlotPicks}
            setMyDraftSlotPicks={setMyDraftSlotPicks}
            draftSlotEditing={draftSlotEditing}
            setDraftSlotEditing={setDraftSlotEditing}
            draftSlotSearchQuery={draftSlotSearchQuery}
            setDraftSlotSearchQuery={setDraftSlotSearchQuery}
            draftHubSection={draftHubSection}
            nflState={nflState}
            freeAgents={freeAgents}
            loadingCalcValues={loadingCalcValues}
            predictedDraftPicks={predictedDraftPicks}
            loadingDraftRefresh={loadingDraftRefresh}
            rookies={rookies}
            draftedPlayerIds={draftedPlayerIds}
            loadRoster={loadRoster}
            loadLeagueOverview={loadLeagueOverview}
            loadRedraftValues={loadRedraftValues}
            loadUserTrades={loadUserTrades}
            loadUserExposure={loadUserExposure}
            loadDraftScout={loadDraftScout}
            saveLeagueNote={saveLeagueNote}
            onSaveSim={saveSimulationToSupabase}
            handleRunAllSims={handleRunAllSims}
            refreshDraftBoard={refreshDraftBoard}
            setPlayerProfileId={setPlayerProfileId}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            setMainTab={setMainTab}
            setTradeHubSection={setTradeHubSection}
          />
          </ErrorBoundary>
        )}

        {mainTab === "GAMEDAY_HUB" && (
          <ErrorBoundary label="Gameday Hub">
          <GamedayHub
            leagues={leagues}
            loadRoster={loadRoster}
            gamedayWeek={gamedayWeek}
            gamedayMatchupCards={gamedayMatchupCards}
            loadingGamedayMatchups={loadingGamedayMatchups}
            selectedGamedayMatchup={selectedGamedayMatchup}
            setSelectedGamedayMatchupId={setSelectedGamedayMatchupId}
            loadGamedayMatchups={loadGamedayMatchups}
            setProjectionWeek={setProjectionWeek}
            setProjectionLoaded={setProjectionLoaded}
            loadProjections={loadProjections}
            setPlayerProfileId={setPlayerProfileId}
            shares={shares}
            totalLeagues={totalLeagues}
            loadingShares={loadingAllLeagueData}
            shareSearch={shareSearch}
            setShareSearch={setShareSearch}
            sharePosition={sharePosition}
            setSharePosition={setSharePosition}
            players={players}
          />
          </ErrorBoundary>
        )}


        {/* DATA HUB TAB */}
        {mainTab === "DATA_HUB" && (
          <ErrorBoundary label="Data Hub">
          <DataHub
            dataHubTab={dataHubTab}
            setDataHubTab={setDataHubTab}
            shares={shares}
            dynastyRankPos={dynastyRankPos}
            setDynastyRankPos={setDynastyRankPos}
            loadingCalcValues={loadingCalcValues}
            playerDispositions={playerDispositions}
            savePlayerDisposition={savePlayerDisposition}
            setPlayerProfileId={setPlayerProfileId}
            loadingRedraft={loadingRedraft}
            projectionData={projectionData}
            setProjectionData={setProjectionData}
            projectionPosFilter={projectionPosFilter}
            setProjectionPosFilter={setProjectionPosFilter}
            projectionWeek={projectionWeek}
            setProjectionWeek={setProjectionWeek}
            setProjectionLoaded={setProjectionLoaded}
            loadProjections={loadProjections}
            projectionSeasonYear={projectionSeasonYear}
            projectionSourceStatus={projectionSourceStatus}
            loadingProjections={loadingProjections}
            projectionUsesSeasonFallback={projectionUsesSeasonFallback}
            allPicks={allPicks}
            leagues={leagues}
            user={user}
            leagueMateStats={leagueMateStats}
            setLeagueMateStats={setLeagueMateStats}
            leagueMateStatsLoaded={leagueMateStatsLoaded}
            setLeagueMateStatsLoaded={setLeagueMateStatsLoaded}
            loadingLeagueMateStats={loadingLeagueMateStats}
            setLoadingLeagueMateStats={setLoadingLeagueMateStats}
            leagueMateSearch={leagueMateSearch}
            setLeagueMateSearch={setLeagueMateSearch}
            leagueMateSort={leagueMateSort}
            setLeagueMateSort={setLeagueMateSort}
            loadUserExposure={loadUserExposure}
            selectedUserId={selectedUserId}
            externalShares={externalShares}
            loadingShares={loadingShares}
            historicalSnapshot={historicalSnapshot}
            onSaveSnapshot={saveSnapshotNow}
          />
          </ErrorBoundary>
        )}
{mainTab === "DRAFT" && (
  <ErrorBoundary label="Draft Hub">
  <DraftHub
    draftHubSection={draftHubSection}
    setDraftHubSection={setDraftHubSection}
    myDraftSlotPicks={myDraftSlotPicks}
    setMyDraftSlotPicks={setMyDraftSlotPicks}
    draftSlotEditing={draftSlotEditing}
    setDraftSlotEditing={setDraftSlotEditing}
    draftSlotSearchQuery={draftSlotSearchQuery}
    setDraftSlotSearchQuery={setDraftSlotSearchQuery}
    user={user}
    draftSettings={draftSettings}
    draftPicks={draftPicks}
    draftOrder={draftOrder}
    allPicks={allPicks}
    rookies={rookies}
    rookieSearch={rookieSearch}
    setRookieSearch={setRookieSearch}
    dragIndex={dragIndex}
    setDragIndex={setDragIndex}
    tempRanks={tempRanks}
    setTempRanks={setTempRanks}
    draftedPlayerIds={draftedPlayerIds}
    predictedDraftPicks={predictedDraftPicks}
    topAvailableRookies={topAvailableRookies}
    refreshDraftBoard={refreshDraftBoard}
    loadDraftScout={loadDraftScout}
    movePlayer={movePlayer}
    handleRankChange={handleRankChange}
    loadingDraftRefresh={loadingDraftRefresh}
    leagues={leagues}
  />
  </ErrorBoundary>
)}

      </div>
{/* ── TRADE HUB TAB ────────────────────────────────────────────────── */}
{mainTab === "TRADE_HUB" && (
  <ErrorBoundary label="Trade Hub">
  <TradeHub
    tradeHubSection={tradeHubSection}
    setTradeHubSection={setTradeHubSection}
    leagues={leagues}
    user={user}
    allPicks={allPicks}
    calcOpponentRosterId={calcOpponentRosterId}
    setCalcOpponentRosterId={setCalcOpponentRosterId}
    calcGive={calcGive}
    setCalcGive={setCalcGive}
    calcReceive={calcReceive}
    setCalcReceive={setCalcReceive}
    calcGivePicks={calcGivePicks}
    setCalcGivePicks={setCalcGivePicks}
    calcReceivePicks={calcReceivePicks}
    setCalcReceivePicks={setCalcReceivePicks}
    finderSeed={finderSeed}
    setFinderSeed={setFinderSeed}
    finderPinnedPlayerId={finderPinnedPlayerId}
    setFinderPinnedPlayerId={setFinderPinnedPlayerId}
    finderTargetOppRosterId={finderTargetOppRosterId}
    setFinderTargetOppRosterId={setFinderTargetOppRosterId}
    finderTargetPlayerId={finderTargetPlayerId}
    setFinderTargetPlayerId={setFinderTargetPlayerId}
    selectedLeagueDraftHasOccurred={selectedLeagueDraftHasOccurred}
    loadingCalcValues={loadingCalcValues}
    calcSearchA={calcSearchA}
    setCalcSearchA={setCalcSearchA}
    calcSearchB={calcSearchB}
    setCalcSearchB={setCalcSearchB}
    playerDispositions={playerDispositions}
    leaguePlayerTags={leaguePlayerTags}
    onToggleLeaguePlayerTag={handleToggleLeaguePlayerTag}
    leagueMateProfileByRosterId={leagueMateProfileByRosterId}
    selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
    tradeRecommendationCards={tradeRecommendationCards}
    tradePartnerRankings={tradePartnerRankings}
    setPlayerProfileId={setPlayerProfileId}
    loadUserExposure={loadUserExposure}
    loadUserTrades={loadUserTrades}
    historicalSnapshot={historicalSnapshot}
    tradeHubData={tradeHubData}
    loadingTradeHub={loadingTradeHub}
    tradeHubUserId={tradeHubUserId}
    tradeAttempts={tradeAttempts}
    loadingTradeAttempts={loadingTradeAttempts}
    tradeAttemptsLeagueId={tradeAttemptsLeagueId}
    onMarkAttempted={markTradeAttempted}
    onUpdateAttemptStatus={updateAttemptStatus}
    onDeleteAttempt={deleteAttempt}
    onLoadTradeAttempts={loadTradeAttempts}
    onRefreshDirection={onRefreshDirection}
    buyLowPlayerIds={buyLowPlayerIds}
    ignoredOwnerIds={ignoredOwnerIds}
    toggleIgnoredOwner={toggleIgnoredOwner}
    nflState={nflState}
    playerStats={playerStats}
    crossLeagueExposure={shares}
    fcTrendData={fcTrendData}
    loadingFcTrends={loadingFcTrends}
    onRefreshFcTrends={refreshFcTrends}
  />
  </ErrorBoundary>
)}

      {selectedUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setSelectedUserId(null)}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="exposure-modal-title"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") setSelectedUserId(null); }}
      className="bg-gray-900 p-6 rounded w-96"
      onClick={(e) => e.stopPropagation()}
    >

      <div id="exposure-modal-title" className="text-lg font-bold mb-4">
        {users[selectedUserId]}&apos;s Top Owned Players
      </div>

      {loadingShares ? (
        <div className="text-sm text-gray-400">
          Loading exposure...
        </div>
      ) : (
        externalShares?.players?.map((entry) => {
  const p = players[entry.playerId];
  if (!p) return null;

  const isMine = myPlayerSet.has(entry.playerId);

  return (
  <div
    key={entry.playerId}
    className={`flex items-center justify-between text-sm py-1 px-2 ${
      isMine ? "bg-green-900/30 border border-green-700 rounded" : ""
    }`}
  >
    <div className="truncate">
      {p.full_name}
      {isMine && (
        <span className="ml-2 text-green-400 text-xs">
          🔥
        </span>
      )}
    </div>

    <div className="text-gray-400 text-xs whitespace-nowrap ml-2">
      {entry.count} • {entry.percent}%
    </div>
  </div>
);
})
      )}

      <button
        onClick={() => setSelectedUserId(null)}
        aria-label="Close exposure modal"
        className="mt-4 w-full bg-blue-600 p-2 rounded"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* ── MANAGEMENT HUB TAB ──────────────────────────────────────────── */}
{mainTab === "MANAGEMENT_HUB" && (
  <ErrorBoundary label="Management Hub">
  <ManagementHub
    mgmtHubTab={mgmtHubTab}
    setMgmtHubTab={setMgmtHubTab}
    leagues={leagues}
    leagueMgmtData={leagueMgmtData}
    setLeagueMgmtData={setLeagueMgmtData}
    commPaymentsData={commPaymentsData}
    setCommPaymentsData={setCommPaymentsData}
    commToolsLeagueId={commToolsLeagueId}
    setCommToolsLeagueId={setCommToolsLeagueId}
    commToolsRosters={commToolsRosters}
    setCommToolsRosters={setCommToolsRosters}
    commToolsUsers={commToolsUsers}
    setCommToolsUsers={setCommToolsUsers}
    loadingCommToolsRosters={loadingCommToolsRosters}
    setLoadingCommToolsRosters={setLoadingCommToolsRosters}
  />
  </ErrorBoundary>
)}

{/* ── SCOUTING HUB TAB ──────────────────────────────────────────── */}
{mainTab === "SCOUTING_HUB" && (
  <ErrorBoundary label="Scouting Hub">
    <ScoutingHub />
  </ErrorBoundary>
)}

{/* DRAFT SCOUT MODAL */}
{draftScoutUserId && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={clearDraftScout}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="draft-scout-modal-title"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") clearDraftScout(); }}
      className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >

      <div id="draft-scout-modal-title" className="text-lg font-bold mb-1">
        {users[draftScoutUserId]}&apos;s {ROOKIE_YEAR} Rookie Drafts
      </div>
      <div className="text-xs text-gray-500 mb-4">
        All leagues — patterns based on completed/in-progress picks
      </div>

      {loadingDraftScout ? (
        <div className="text-sm text-gray-400">Loading draft history...</div>
      ) : !draftScoutData?.length ? (
        <div className="text-sm text-gray-400">No {ROOKIE_YEAR} drafts started yet.</div>
      ) : (() => {
        const posColor = (pos: string) =>
          pos === "WR" ? "text-sky-300 bg-sky-900/40" :
          pos === "RB" ? "text-green-300 bg-green-900/40" :
          pos === "QB" ? "text-red-300 bg-red-900/40" :
          pos === "TE" ? "text-yellow-300 bg-yellow-900/40" :
          "text-gray-300 bg-gray-700/40";
        const posText = (pos: string) =>
          pos === "WR" ? "text-sky-300" :
          pos === "RB" ? "text-green-300" :
          pos === "QB" ? "text-red-300" :
          pos === "TE" ? "text-yellow-300" :
          "text-gray-400";
        return (
          <>
            {/* Pattern Analysis Card */}
            {draftScoutPatterns && (
              <div className="bg-gray-800/70 rounded-lg p-4 mb-5 border border-gray-700">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">
                  Draft Tendencies — {draftScoutPatterns.n} league{draftScoutPatterns.n !== 1 ? "s" : ""} · {draftScoutPatterns.total} picks
                </div>

                {draftScoutPatterns.tendencies.length > 0 && (
                  <ul className="mb-4 space-y-1">
                    {draftScoutPatterns.tendencies.map((t: string, i: number) => (
                      <li key={t || i} className="flex items-start gap-1.5 text-xs text-gray-200">
                        <span className="text-blue-400 mt-0.5 shrink-0">•</span>
                        {t}
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mb-3">
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Overall Position Mix</div>
                  <div className="flex flex-wrap gap-1.5">
                    {draftScoutPatterns.sortedPos.map(([pos, count]: [string, number]) => (
                      <span key={pos} className={`text-[11px] px-2 py-0.5 rounded font-semibold ${posColor(pos)}`}>
                        {pos} {count} ({Math.round(count / draftScoutPatterns.total * 100)}%)
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1.5">Round-by-Round</div>
                  <div className="space-y-1.5">
                    {Object.entries(draftScoutPatterns.roundBreakdown)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([round, counts]: [string, Record<string, number>]) => (
                        <div key={round} className="flex items-center gap-2">
                          <span className={`text-[10px] w-10 text-center px-1.5 py-0.5 rounded font-semibold shrink-0 ${
                            round === "1" ? "bg-yellow-900/50 text-yellow-300" :
                            round === "2" ? "bg-green-900/50 text-green-300" :
                            round === "3" ? "bg-blue-900/50 text-blue-300" :
                                            "bg-orange-900/50 text-orange-300"
                          }`}>Rd {round}</span>
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(counts)
                              .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
                              .map(([pos, cnt]: [string, number]) => (
                                <span key={pos} className={`text-[10px] px-1.5 py-0.5 rounded ${posColor(pos)}`}>
                                  {pos} ×{cnt}
                                </span>
                              ))}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}

            {/* Per-league picks */}
            {draftScoutData.map((league) => (
              <div key={league.leagueName} className="mb-5">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                  {league.leagueName}
                </div>
                {league.picks.length === 0 ? (
                  <div className="text-xs text-gray-500 italic">No picks made yet</div>
                ) : (
                  league.picks.map((pick) => {
                    const name = pick.player?.full_name || pick.playerName || "Unknown";
                    const pos = pick.player?.position || pick.position || "—";
                    return (
                      <div
                        key={pick.slot ?? `${pick.round}-${name}`}
                        className="flex items-center justify-between bg-gray-800 rounded px-3 py-1.5 mb-1 text-sm"
                      >
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-semibold ${
                            pick.round === 1 ? "bg-yellow-900/50 text-yellow-300" :
                            pick.round === 2 ? "bg-green-900/50 text-green-300" :
                            pick.round === 3 ? "bg-blue-900/50 text-blue-300" :
                                              "bg-orange-900/50 text-orange-300"
                          }`}>
                            {pick.slot}
                          </span>
                          <span className="font-medium">{name}</span>
                        </div>
                        <span className={`text-xs font-semibold ${posText(pos)}`}>{pos}</span>
                      </div>
                    );
                  })
                )}
              </div>
            ))}
          </>
        );
      })()}

      <button
        onClick={clearDraftScout}
        aria-label="Close draft scout modal"
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}

{/* TRADE HUB MODAL — opponent trades only; own trades shown inline in Trade Log tab */}
{tradeHubUserId && user && tradeHubUserId !== user.user_id && (
  <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => { setTradeHubUserId(null); setTradeHubData(null); }}>
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="trade-hub-modal-title"
      tabIndex={-1}
      onKeyDown={(e) => { if (e.key === "Escape") { setTradeHubUserId(null); setTradeHubData(null); } }}
      className="bg-gray-900 p-6 rounded-xl w-[560px] max-h-[85vh] overflow-y-auto"
      onClick={(e) => e.stopPropagation()}
    >

      <div id="trade-hub-modal-title" className="text-lg font-bold mb-1">
        {users[tradeHubUserId] || "Manager"}&apos;s Recent Trades
      </div>
      <div className="text-xs text-gray-500 mb-5">
        Past 30 days · All dynasty leagues · Up to 15 trades
      </div>

      {loadingTradeHub ? (
        <div className="text-sm text-gray-400">Loading trades...</div>
      ) : !tradeHubData?.length ? (
        <div className="text-sm text-gray-400">No trades found in the past 30 days.</div>
      ) : (
        tradeHubData.map((trade) => {
          const myRosterId = trade.myRosterId;

          // Players received
          const received = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid === myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Players given
          const given = Object.entries(trade.adds || {})
            .filter(([, rid]) => rid !== myRosterId)
            .map(([pid]) => players[pid]?.full_name || "Unknown Player");

          // Resolve actual draft slot (e.g. "2026 1.04") from allPicks when available
          const pickLabel = (p: SleeperTradedPick) => {
            if (String(p.season) === CURRENT_YEAR) {
              const match = allPicks.find(
                (ap) =>
                  String(ap.season) === String(p.season) &&
                  Number(ap.round) === Number(p.round) &&
                  Number(ap.roster_id) === Number(p.roster_id)
              );
              if (match?.slot?.includes(".")) return `${p.season} ${match.slot}`;
            }
            return `${p.season} Rd ${p.round}`;
          };

          // Picks received / given
          const picksReceived = (trade.draft_picks || [])
            .filter((p) => p.owner_id === myRosterId)
            .map(pickLabel);

          const picksGiven = (trade.draft_picks || [])
            .filter((p) => p.previous_owner_id === myRosterId)
            .map(pickLabel);

          const allReceived = [...received, ...picksReceived];
          const allGiven = [...given, ...picksGiven];

          return (
            <div key={trade.transaction_id} className="bg-gray-800 rounded-xl p-4 mb-3">

              {/* Header */}
              <div className="flex justify-between items-center mb-3">
                <span className="text-xs font-semibold text-blue-400 uppercase tracking-wide">
                  {trade.leagueName}
                </span>
                <span className="text-xs text-gray-500">
                  {formatRelativeDate(trade.created)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">

                {/* Received */}
                <div>
                  <div className="text-[10px] text-green-400 font-semibold uppercase mb-1">
                    Received
                  </div>
                  {allReceived.length ? allReceived.map((item) => (
                    <div key={item} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

                {/* Given */}
                <div>
                  <div className="text-[10px] text-red-400 font-semibold uppercase mb-1">
                    Gave
                  </div>
                  {allGiven.length ? allGiven.map((item) => (
                    <div key={item} className="text-sm text-white py-0.5">{item}</div>
                  )) : (
                    <div className="text-xs text-gray-500 italic">Nothing</div>
                  )}
                </div>

              </div>
            </div>
          );
        })
      )}

      <button
        onClick={() => { setTradeHubUserId(null); setTradeHubData(null); }}
        aria-label="Close trades modal"
        className="mt-2 w-full bg-blue-600 p-2 rounded text-sm"
      >
        Close
      </button>
    </div>
  </div>
)}
      {/* ── Global Player Profile Panel ── */}
      {(() => {
        if (!playerProfileId) return null;
        const p = players[playerProfileId];
        if (!p) return null;
        const dynVal = calcFcValues[playerProfileId] ?? p.value ?? 0;
        const redVal = leagueAdjustedRedraftValues[playerProfileId] ?? 0;
        const injuryStatus = p.injury_status || p.status;
        const injuryNote = [p.injury_body_part, p.injury_notes].filter(Boolean).join(" — ");
        const practiceDesc = p.practice_description || p.practice_participation || "";
        const injuryColor =
          injuryStatus === "IR" || injuryStatus === "PUP" ? "bg-red-900/50 text-red-300 border-red-700" :
          injuryStatus === "Out" ? "bg-red-900/40 text-red-400 border-red-800" :
          injuryStatus === "Doubtful" ? "bg-orange-900/40 text-orange-400 border-orange-700" :
          injuryStatus === "Questionable" ? "bg-yellow-900/40 text-yellow-400 border-yellow-700" :
          "bg-green-900/30 text-green-400 border-green-700";

        // Which leaguemates own this player
        const ownersInSelectedLeague = rosters
          .filter((r) => (r.players || []).includes(playerProfileId))
          .map((r) => users[r.owner_id] || `Team ${r.roster_id}`);

        // Cross-league ownership from overview data (uses per-league user map fetched during loadLeagueOverview)
        const crossLeagueOwners: { leagueName: string; owner: string }[] = [];
        Object.entries(leagueOverviewData).forEach(([lid, entry]: [string, LeagueOverviewEntry]) => {
          const lg = leagues.find((l) => l.league_id === lid);
          if (!lg) return;
          const leagueUserMap: Record<string, string> = entry.userMap || {};
          (entry.rosters || []).forEach((r) => {
            if ((r.players || []).includes(playerProfileId)) {
              const ownerName = leagueUserMap[r.owner_id] || users[r.owner_id] || `Team ${r.roster_id}`;
              crossLeagueOwners.push({ leagueName: lg.name, owner: ownerName });
            }
          });
        });

        const noteVal = playerNotes[playerProfileId] ?? "";
        const disp = playerDispositions[playerProfileId] ?? { sell: "Neutral", buy: "Neutral" };

        return (
          <>
            {/* Backdrop */}
            <div
              aria-hidden="true"
              className="fixed inset-0 bg-black/50 z-40"
              onClick={() => setPlayerProfileId(null)}
            />
            {/* Panel */}
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="player-profile-title"
              tabIndex={-1}
              onKeyDown={(e) => { if (e.key === "Escape") setPlayerProfileId(null); }}
              className="fixed top-0 right-0 h-full w-full max-w-sm bg-gray-950 border-l border-gray-800 z-50 flex flex-col shadow-2xl overflow-y-auto"
            >
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-gray-800">
                <div>
                  <h2 id="player-profile-title" className="text-lg font-bold text-white">{p.full_name}</h2>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-gray-400">{p.position}</span>
                    {p.team && <span className="text-xs text-gray-500">· {p.team}</span>}
                    {p.age && <span className="text-xs text-gray-500">· Age {p.age}</span>}
                  </div>
                </div>
                <button onClick={() => setPlayerProfileId(null)} aria-label="Close player profile" className="text-gray-500 hover:text-white text-xl leading-none mt-1">✕</button>
              </div>

              <div className="p-5 space-y-5 flex-1">
                {/* Values */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Dynasty Value</p>
                    <p className="text-xl font-bold text-white">{dynVal > 0 ? dynVal.toLocaleString() : "—"}</p>
                  </div>
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Redraft Value</p>
                    <p className="text-xl font-bold text-white">{redVal > 0 ? redVal.toLocaleString() : "—"}</p>
                  </div>
                </div>

                {/* Injury / Status */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Status</p>
                  <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full border ${injuryColor}`}>
                    {injuryStatus || "Active"}
                  </span>
                  {injuryNote && <p className="text-xs text-gray-400 mt-1.5">{injuryNote}</p>}
                  {practiceDesc && <p className="text-xs text-gray-500 mt-1">{practiceDesc}</p>}
                </div>

                {/* Ownership */}
                {ownersInSelectedLeague.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">
                      Owned in {selectedLeague?.name || "Selected League"}
                    </p>
                    {ownersInSelectedLeague.map((name) => (
                      <p key={name} className="text-sm text-white">{name}</p>
                    ))}
                  </div>
                )}

                {crossLeagueOwners.length > 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Cross-League Ownership</p>
                    <div className="space-y-1">
                      {crossLeagueOwners.map((entry) => (
                        <div key={`${entry.owner}-${entry.leagueName}`} className="flex items-baseline justify-between text-xs">
                          <span className="text-white truncate mr-2">{entry.owner}</span>
                          <span className="text-gray-500 shrink-0">{entry.leagueName}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {ownersInSelectedLeague.length === 0 && crossLeagueOwners.length === 0 && (
                  <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                    <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">Ownership</p>
                    <p className="text-xs text-gray-600">Not on any loaded roster.</p>
                  </div>
                )}

                {/* Dispositions */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800 space-y-3">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider">Trade Disposition</p>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading Away</p>
                    <select
                      value={disp.sell}
                      onChange={(e) => savePlayerDisposition(playerProfileId, e.target.value, disp.buy)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Not Willing to Trade">Not Willing to Trade</option>
                      <option value="Will Trade but Higher than Market">Will Trade but Higher than Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Lower than Market">Lower than Market</option>
                      <option value="Trade at All Costs">Trade at All Costs</option>
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1">Trading For</p>
                    <select
                      value={disp.buy}
                      onChange={(e) => savePlayerDisposition(playerProfileId, disp.sell, e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="Buy Over Market">Buy Over Market</option>
                      <option value="Buy at Market">Buy at Market</option>
                      <option value="Neutral">Neutral</option>
                      <option value="Buy Low">Buy Low</option>
                      <option value="Zero Interest">Zero Interest</option>
                    </select>
                  </div>
                  {(disp.sell !== "Neutral" || disp.buy !== "Neutral") && (
                    <p className="text-[10px] text-blue-400">Trade Finder will factor in these preferences.</p>
                  )}
                </div>

                {/* Notes */}
                <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Notes</p>
                  <textarea
                    value={noteVal}
                    onChange={(e) => savePlayerNote(playerProfileId, e.target.value)}
                    placeholder={`Jot down thoughts on ${p.first_name || p.full_name}…`}
                    className="w-full h-28 bg-gray-800 border border-gray-700 rounded-lg p-2.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                  />
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </>
  );
}
