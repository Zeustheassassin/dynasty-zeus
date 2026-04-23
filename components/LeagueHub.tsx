"use client";
import React from "react";
import type {
  LeagueHubTab,
  SleeperLeague,
  SleeperUser,
  SleeperTradedPick,
  SleeperDraft,
  SleeperDraftPick,
  SleeperNFLState,
  RookieBoardPlayer,
  ProjectionRow,
  CommittedSimsByLeague,
  CachedSimRow,
  LeagueOverviewEntry,
  LeagueMateView,
  SimulationTeamRow,
  SleeperPlayer,
} from "../lib/types";
import { LEAGUE_HUB_GROUPS } from "../lib/leagueHubGroups";
import { useLeagueTabState } from "./LeagueHub/hooks/useLeagueTabState";
import StandingsTab from "./league/StandingsTab";
import OverviewTab from "./LeagueHub/OverviewTab";
import SimulatorTab from "./LeagueHub/SimulatorTab";
import RostersTab from "./LeagueHub/RostersTab";
import LeagueMatesTab from "./LeagueHub/LeagueMatesTab";
import OppRostersTab from "./LeagueHub/OppRostersTab";
import StartersTab from "./LeagueHub/StartersTab";
import NotesTab from "./LeagueHub/NotesTab";
import PowerRankingsTab from "./LeagueHub/PowerRankingsTab";
import DraftBoardTab from "./LeagueHub/DraftBoardTab";
import ActivityTab from "./LeagueHub/ActivityTab";
import type { StandingRow, AnnotatedTransaction, TeamSummary, PredictedPick } from "./LeagueHub/leagueHubTypes";

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
  selectedLeagueMateProfilesView: LeagueMateView[];

  // Cross-hub shared state (stays in page.tsx)
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
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL_BOARDS";
  nflState: SleeperNFLState | null;

  // Additional state
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
  picks, allPicks,
  committedSimsByLeague, leagueSimCache, simQueue, simProgress,
  loadingLeagueMateIntel, loadingCrossLeagueMateIntel, loadingActivity, loadingLeagueWeeklyMatchups,
  leagueNotes, activityTransactions,
  leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded,
  teamSummary, selectedLeagueMateProfilesView,
  ignoredOwnerIds, toggleIgnoredOwner,
  projectionData, draftPicks, draftOrder, draftSettings, myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing, draftSlotSearchQuery, setDraftSlotSearchQuery,
  draftHubSection, nflState,
  freeAgents, loadingCalcValues,
  predictedDraftPicks, loadingDraftRefresh, rookies, draftedPlayerIds,
  loadRoster, loadLeagueOverview, loadRedraftValues, loadUserTrades, loadUserExposure, loadDraftScout,
  saveLeagueNote, onSaveSim, handleRunAllSims, refreshDraftBoard,
  setPlayerProfileId, setCalcOpponentRosterId, setMainTab, setTradeHubSection,
}: LeagueHubProps) {
  const {
    activeTab, setActiveTab,
    search, setSearch,
    leagueSearch, setLeagueSearch,
    oppRosterTab, setOppRosterTab,
    oppRosterOwnerId, setOppRosterOwnerId,
    oppRosterSearch, setOppRosterSearch,
    prSortKey, setPrSortKey,
    prSortAsc, setPrSortAsc,
    prPopup, setPrPopup,
    prMode, setPrMode,
  } = useLeagueTabState();

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

        {leagueHubTab === "OVERVIEW" && (
          <OverviewTab
            leagues={leagues}
            user={user}
            leagueOverviewData={leagueOverviewData}
            loadingLeagueOverview={loadingLeagueOverview}
            leagueOverviewLoaded={leagueOverviewLoaded}
            committedSimsByLeague={committedSimsByLeague}
            leagueSimCache={leagueSimCache}
            simQueue={simQueue}
            simProgress={simProgress}
            loadRoster={loadRoster}
            setLeagueHubTab={setLeagueHubTab}
            loadLeagueOverview={loadLeagueOverview}
            loadRedraftValues={loadRedraftValues}
            handleRunAllSims={handleRunAllSims}
          />
        )}

        {leagueHubTab === "SIMULATOR" && (
          <SimulatorTab
            user={user}
            loadingLeagueWeeklyMatchups={loadingLeagueWeeklyMatchups}
            onSaveSim={onSaveSim}
          />
        )}

        {leagueHubTab === "ROSTERS" && (
          <RostersTab
            leagues={leagues}
            user={user}
            picks={picks}
            teamSummary={teamSummary}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            search={search}
            setSearch={setSearch}
            leagueSearch={leagueSearch}
            setLeagueSearch={setLeagueSearch}
            freeAgents={freeAgents}
            setSelectedLeague={setSelectedLeague}
            loadRoster={loadRoster}
          />
        )}

        {leagueHubTab === "LEAGUE_MATES" && (
          <LeagueMatesTab
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
            loadingLeagueMateIntel={loadingLeagueMateIntel}
            loadingCrossLeagueMateIntel={loadingCrossLeagueMateIntel}
            loadUserTrades={loadUserTrades}
            loadUserExposure={loadUserExposure}
            setCalcOpponentRosterId={setCalcOpponentRosterId}
            setMainTab={setMainTab}
            setTradeHubSection={setTradeHubSection}
          />
        )}

        {leagueHubTab === "OPP_ROSTERS" && (
          <OppRostersTab
            user={user}
            allPicks={allPicks}
            oppRosterTab={oppRosterTab}
            setOppRosterTab={setOppRosterTab}
            oppRosterOwnerId={oppRosterOwnerId}
            setOppRosterOwnerId={setOppRosterOwnerId}
            oppRosterSearch={oppRosterSearch}
            setOppRosterSearch={setOppRosterSearch}
          />
        )}

        {leagueHubTab === "STANDINGS" && (
          <StandingsTab
            standings={standings}
          />
        )}

        {leagueHubTab === "STARTERS" && (
          <StartersTab
            projectionData={projectionData}
            nflState={nflState}
          />
        )}

        {leagueHubTab === "NOTES" && (
          <NotesTab
            leagues={leagues}
            leagueNotes={leagueNotes}
            saveLeagueNote={saveLeagueNote}
            setSelectedLeague={setSelectedLeague}
          />
        )}

        {leagueHubTab === "POWER_RANKINGS" && (
          <PowerRankingsTab
            user={user}
            allPicks={allPicks}
            loadingCalcValues={loadingCalcValues}
            prSortKey={prSortKey}
            setPrSortKey={setPrSortKey}
            prSortAsc={prSortAsc}
            setPrSortAsc={setPrSortAsc}
            prPopup={prPopup}
            setPrPopup={setPrPopup}
            prMode={prMode}
            setPrMode={setPrMode}
            ignoredOwnerIds={ignoredOwnerIds}
            toggleIgnoredOwner={toggleIgnoredOwner}
            setPlayerProfileId={setPlayerProfileId}
          />
        )}

        {leagueHubTab === "DRAFT_BOARD" && (
          <DraftBoardTab
            user={user}
            allPicks={allPicks}
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
            predictedDraftPicks={predictedDraftPicks}
            loadingDraftRefresh={loadingDraftRefresh}
            rookies={rookies}
            draftedPlayerIds={draftedPlayerIds}
            refreshDraftBoard={refreshDraftBoard}
            loadDraftScout={loadDraftScout}
          />
        )}

        {leagueHubTab === "ACTIVITY" && (
          <ActivityTab
            activityTransactions={activityTransactions}
            loadingActivity={loadingActivity}
            setPlayerProfileId={setPlayerProfileId}
          />
        )}
      </>
    </div>
  );
}

export default React.memo(LeagueHub);
