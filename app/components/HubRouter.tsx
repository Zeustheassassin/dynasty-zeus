"use client";
import React from "react";
import dynamic from "next/dynamic";
import { isWideHub, type MainTab } from "../../lib/hubs";
import Dashboard from "../../components/Dashboard";
import AlertsPage from "../../components/AlertsPage";
import ManagementHub from "../../components/ManagementHub";
import GamedayHub from "../../components/GamedayHub";
import ErrorBoundary from "../../components/ErrorBoundary";
import { ExposureModal } from "./modals/ExposureModal";
import { DraftScoutModal } from "./modals/DraftScoutModal";
import type { DraftScoutPatterns } from "./modals/DraftScoutModal";
import { TradeHubOpponentModal } from "./modals/TradeHubOpponentModal";
import { PlayerProfilePanel } from "./modals/PlayerProfilePanel";
import type {
  SleeperPlayer, SleeperLeague, SleeperRoster,
  SleeperNFLState, SleeperUser, SleeperDraft, SleeperDraftPick,
  AugmentedPick, LeagueOverviewEntry, HistoricalSnapshot,
  LeagueMateView, CommittedSimsByLeague, CachedSimRow, RookieBoardPlayer,
  GamedayMatchup, WatchlistEntry,
  TradeAttempt, TradeAttemptStatus, FcTrendEntry, PredictedPick, DraftPoolRanks,
  LeagueHubTab, ProjectionRow, SimulationTeamRow,
  LeagueMgmtData, CommPaymentsData, TradePartnerRanking,
} from "../../lib/types";
import type { AnnotatedTrade } from "../../hooks/useUserTrades";
import type { PlayerUsage } from "../../hooks/usePlayerStats";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer } from "../../components/AlertsPage/alertsPageHelpers";
import type { ExposureData } from "../../hooks/useUserExposure";
import type { DraftScoutLeague } from "../../hooks/useDraftScout";
import type { StandingRow, AnnotatedTransaction } from "../../components/LeagueHub/leagueHubTypes";
import type { ShareEntry } from "../../components/DataHub/dataHubTypes";
import type { PersonalSignal } from "../../lib/helpers/personalRankings";

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
const UserScoutHub = dynamic(() => import("../../components/UserScoutHub"), { ssr: false, loading: HubSkeleton });

// ── Local types ──────────────────────────────────────────────────────────────
type DataHubTabId = "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW" | "MY_SHARES";

// ── Props ────────────────────────────────────────────────────────────────────
interface HubRouterProps {
  // Navigation
  mainTab: MainTab;
  dataHubTab: DataHubTabId;
  setMainTab: (tab: MainTab) => void;

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
  leagueTransactions: LeagueTransaction[];
  loadingTransactions: boolean;
  injuryReportPlayers: InjuryReportPlayer[];
  allTradeAttempts: { id: string; league_id: string; status: string }[];
  loadLeagueOverview: () => Promise<void>;
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
  leagueOverviewError: string | null;
  selectedLeagueMateProfilesView: LeagueMateView[];
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;
  freeAgents: SleeperPlayer[];
  loadingCalcValues: boolean;
  calcValuesError: string | null;
  loadingDraftRefresh: boolean;
  rookies: RookieBoardPlayer[];
  draftedPlayerIds: Set<string>;
  loadRoster: (league: SleeperLeague) => void;
  loadRedraftValues: () => void;
  loadUserTrades: (ownerId: string, bypass?: boolean) => void;
  loadUserExposure: (ownerId: string) => void;
  loadDraftScout: (userId: string) => void;
  saveLeagueNote: (leagueId: string, text: string) => void;
  saveSimulationToSupabase: (leagueId: string, rows: SimulationTeamRow[]) => void;
  handleRunAllSims: () => void;
  refreshDraftBoard: () => Promise<void>;
  setPlayerProfileId: (id: string | null) => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS") => void;

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
  /** Personal-ranking-derived disposition map; feeds the Trade Finder's tuned scoring (Phase 2 swap). */
  finderDispositions: Record<string, { sell: string; buy: string }>;
  /** Personal-ranking-derived raw signal map; the Finder's block predicates read it directly (Stage 6). */
  finderSignals: Record<string, PersonalSignal>;
  personalOrdering: string[];
  savePersonalOrdering: (next: string[]) => void;
  loadingRedraft: boolean;
  redraftError: string | null;
  projectionData: ProjectionRow[];
  setProjectionData: React.Dispatch<React.SetStateAction<ProjectionRow[]>>;
  projectionPosFilter: string;
  setProjectionPosFilter: (pos: string) => void;
  projectionWeek: number;
  projectionSeasonYear: number | null;
  projectionSourceStatus: Record<string, boolean>;
  loadingProjections: boolean;
  projectionUsesSeasonFallback: boolean;
  enabledExtraSources: string[];
  toggleExtraSource: (id: string) => void;
  selectedUserId: string | null;
  setSelectedUserId: (id: string | null) => void;
  externalShares: ExposureData | null;
  loadingShares: boolean;
  exposureError: string | null;
  historicalSnapshot: HistoricalSnapshot | null;
  saveSnapshotNow: () => Promise<void>;

  // Draft Hub
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL";
  setDraftHubSection: (s: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL") => void;
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
  draftPoolRanks: DraftPoolRanks;
  topAvailableRookies: RookieBoardPlayer[];
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  addRookie: (name: string, position: string) => void;
  editRookieName: (originalName: string, newName: string) => void;
  removeAddedRookie: (name: string) => void;
  clearNameEdit: (originalName: string) => void;
  rookieOverrides: { added: { name: string; position: string }[]; nameEdits: Record<string, string> };

  // Trade Hub
  tradeHubSection: "CALCULATOR" | "FINDER" | "TRADE_LOG" | "ATTEMPTS";
  calcOpponentRosterId: number | null;
  selectedLeagueDraftHasOccurred: boolean;
  leaguePlayerTags: Record<string, Record<string, "CORE" | "WANT_TO_TRADE">>;
  handleToggleLeaguePlayerTag: (leagueId: string, playerId: string, forceTag?: "CORE" | "WANT_TO_TRADE") => void;
  leagueMateProfileByRosterId: Map<number, LeagueMateView>;
  tradePartnerRankings: TradePartnerRanking[];
  tradeHubData: AnnotatedTrade[] | null;
  loadingTradeHub: boolean;
  tradeHubError: string | null;
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
  dismissDashboardAlert, leagueTransactions, loadingTransactions,
  injuryReportPlayers, allTradeAttempts,
  loadLeagueOverview, loadingLeagueOverview, onNavigateToAttempts,
  leagueHubTab, setLeagueHubTab, activeLeagueHubGroup, standings,
  committedSimsByLeague, leagueSimCache, simQueue, simProgress,
  loadingLeagueMateIntel, loadingCrossLeagueMateIntel, loadingActivity, loadingLeagueWeeklyMatchups,
  leagueNotes, activityTransactions, leagueOverviewData, leagueOverviewLoaded, leagueOverviewError,
  selectedLeagueMateProfilesView, ignoredOwnerIds, toggleIgnoredOwner,
  freeAgents, loadingCalcValues, calcValuesError, loadingDraftRefresh, rookies, draftedPlayerIds,
  loadRoster, loadRedraftValues, loadUserTrades, loadUserExposure, loadDraftScout,
  saveLeagueNote, saveSimulationToSupabase, handleRunAllSims, refreshDraftBoard,
  setPlayerProfileId, setCalcOpponentRosterId, setTradeHubSection,
  gamedayWeek, gamedayMatchupCards, loadingGamedayMatchups, selectedGamedayMatchup,
  setSelectedGamedayMatchupId, loadGamedayMatchups,
  setProjectionWeek, setProjectionLoaded, loadProjections,
  shares, totalLeagues, loadingAllLeagueData, shareSearch, setShareSearch, sharePosition, setSharePosition,
  setDataHubTab,
  finderDispositions, finderSignals, personalOrdering, savePersonalOrdering, loadingRedraft, redraftError,
  projectionData, setProjectionData, projectionPosFilter, setProjectionPosFilter,
  projectionWeek, projectionSeasonYear, projectionSourceStatus, loadingProjections, projectionUsesSeasonFallback,
  enabledExtraSources, toggleExtraSource,
  selectedUserId, setSelectedUserId, externalShares, loadingShares, exposureError, historicalSnapshot, saveSnapshotNow,
  draftHubSection, setDraftHubSection, myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing, draftSlotSearchQuery, setDraftSlotSearchQuery,
  draftSettings, draftPicks, draftOrder, predictedDraftPicks, draftPoolRanks,
  topAvailableRookies, movePlayer, handleRankChange,
  addRookie, editRookieName, removeAddedRookie, clearNameEdit, rookieOverrides,
  tradeHubSection, calcOpponentRosterId,
  selectedLeagueDraftHasOccurred,
  leaguePlayerTags, handleToggleLeaguePlayerTag, leagueMateProfileByRosterId,
  tradePartnerRankings,
  tradeHubData, loadingTradeHub, tradeHubError, tradeHubUserId, setTradeHubUserId, setTradeHubData,
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
        isWideHub(mainTab)
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
            leagueTransactions={leagueTransactions}
            loadingTransactions={loadingTransactions}
            players={players}
            injuryReportPlayers={injuryReportPlayers}
            currentNFLWeek={nflState?.season_type === "regular" ? Number(nflState?.week || 0) : 0}
            allTradeAttempts={allTradeAttempts}
            allLeagues={leagues}
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
            leagueOverviewError={leagueOverviewError}
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
            ignoredOwnerIds={ignoredOwnerIds}
            toggleIgnoredOwner={toggleIgnoredOwner}
            projectionData={projectionData}
            nflState={nflState}
            freeAgents={freeAgents}
            loadingCalcValues={loadingCalcValues}
            historicalSnapshot={historicalSnapshot}
            loadRoster={loadRoster}
            loadLeagueOverview={loadLeagueOverview}
            loadRedraftValues={loadRedraftValues}
            loadUserTrades={loadUserTrades}
            loadUserExposure={loadUserExposure}
            saveLeagueNote={saveLeagueNote}
            onSaveSim={saveSimulationToSupabase}
            handleRunAllSims={handleRunAllSims}
            setPlayerProfileId={setPlayerProfileId}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            setMainTab={setMainTab}
            setTradeHubSection={setTradeHubSection}
          />
          </ErrorBoundary>
        )}

        {/* USER SCOUT — read-only lookup of any Sleeper user's leagues */}
        {mainTab === "USER_SCOUT" && (
          <ErrorBoundary label="User Scout">
          <UserScoutHub
            players={players}
            nflState={nflState}
            projectionData={projectionData}
            projectionWeek={projectionWeek}
            playerStats={playerStats as Record<string, PlayerUsage> | null}
            rookies={rookies}
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
            totalLeagues={totalLeagues}
            loadingCalcValues={loadingCalcValues}
            calcValuesError={calcValuesError}
            personalOrdering={personalOrdering}
            savePersonalOrdering={savePersonalOrdering}
            setPlayerProfileId={setPlayerProfileId}
            loadingRedraft={loadingRedraft}
            redraftError={redraftError}
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
            enabledExtraSources={enabledExtraSources}
            toggleExtraSource={toggleExtraSource}
            leagues={leagues}
            user={user}
            loadUserExposure={loadUserExposure}
            selectedUserId={selectedUserId}
            externalShares={externalShares}
            loadingShares={loadingShares}
            historicalSnapshot={historicalSnapshot}
            onSaveSnapshot={saveSnapshotNow}
            fcTrendData={fcTrendData}
            loadingFcTrends={loadingFcTrends}
            onRefreshFcTrends={refreshFcTrends}
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
    draftedPlayerIds={draftedPlayerIds}
    predictedDraftPicks={predictedDraftPicks}
    draftPoolRanks={draftPoolRanks}
    topAvailableRookies={topAvailableRookies}
    refreshDraftBoard={refreshDraftBoard}
    loadDraftScout={loadDraftScout}
    movePlayer={movePlayer}
    handleRankChange={handleRankChange}
    addRookie={addRookie}
    editRookieName={editRookieName}
    removeAddedRookie={removeAddedRookie}
    clearNameEdit={clearNameEdit}
    rookieOverrides={rookieOverrides}
    loadingDraftRefresh={loadingDraftRefresh}
    leagues={leagues}
  />
  </ErrorBoundary>
)}

      </div>
{/* ── TRADE HUB TAB ────────────────────────────────────────────────── */}
{mainTab === "TRADE_HUB" && (
  <ErrorBoundary label="Trade Hub">
  {/* Phase 2: the Finder's buy/sell opinion comes from the personal-ranking signal
      map (finderDispositions for the tuned scoring, finderSignals for the block
      predicates), not the manual dropdowns — those still render in DataHub until
      Phase 3 removes them. */}
  <TradeHub
    tradeHubSection={tradeHubSection}
    setTradeHubSection={setTradeHubSection}
    setMainTab={setMainTab}
    setDataHubTab={setDataHubTab}
    leagues={leagues}
    user={user}
    allPicks={allPicks}
    calcOpponentRosterId={calcOpponentRosterId}
    setCalcOpponentRosterId={setCalcOpponentRosterId}
    selectedLeagueDraftHasOccurred={selectedLeagueDraftHasOccurred}
    loadingCalcValues={loadingCalcValues}
    playerDispositions={finderDispositions}
    finderSignals={finderSignals}
    leaguePlayerTags={leaguePlayerTags}
    onToggleLeaguePlayerTag={handleToggleLeaguePlayerTag}
    leagueMateProfileByRosterId={leagueMateProfileByRosterId}
    selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
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
  />
  </ErrorBoundary>
)}

      {selectedUserId && (
        <ExposureModal
          selectedUserId={selectedUserId}
          users={users}
          loadingShares={loadingShares}
          exposureError={exposureError}
          externalShares={externalShares}
          players={players}
          myPlayerSet={myPlayerSet}
          onClose={() => setSelectedUserId(null)}
        />
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
  <DraftScoutModal
    draftScoutUserId={draftScoutUserId}
    users={users}
    loadingDraftScout={loadingDraftScout}
    draftScoutData={draftScoutData}
    draftScoutPatterns={draftScoutPatterns}
    onClose={clearDraftScout}
  />
)}

{/* TRADE HUB MODAL — opponent trades only; own trades shown inline in Trade Log tab */}
{tradeHubUserId && user && tradeHubUserId !== user.user_id && (
  <TradeHubOpponentModal
    tradeHubUserId={tradeHubUserId}
    users={users}
    loadingTradeHub={loadingTradeHub}
    tradeHubError={tradeHubError}
    tradeHubData={tradeHubData}
    players={players}
    allPicks={allPicks}
    onClose={() => { setTradeHubUserId(null); setTradeHubData(null); }}
  />
)}
      {/* ── Global Player Profile Panel ── */}
      {playerProfileId && (
        <PlayerProfilePanel
          playerProfileId={playerProfileId}
          players={players}
          calcFcValues={calcFcValues}
          leagueAdjustedRedraftValues={leagueAdjustedRedraftValues}
          playerNotes={playerNotes}
          rosters={rosters}
          users={users}
          selectedLeague={selectedLeague}
          leagueOverviewData={leagueOverviewData}
          leagues={leagues}
          historicalSnapshot={historicalSnapshot}
          savePlayerNote={savePlayerNote}
          onClose={() => setPlayerProfileId(null)}
        />
      )}
    </>
  );
}
