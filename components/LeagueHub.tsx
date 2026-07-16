"use client";
import React from "react";
import type {
  LeagueHubTab,
  SleeperLeague,
  SleeperUser,
  SleeperTradedPick,
  SleeperNFLState,
  ProjectionRow,
  CommittedSimsByLeague,
  CachedSimRow,
  LeagueOverviewEntry,
  LeagueMateView,
  SimulationTeamRow,
  SleeperPlayer,
  HistoricalSnapshot,
} from "../lib/types";
import type { MainTab } from "../lib/hubs";
import { LEAGUE_HUB_GROUPS } from "../lib/leagueHubGroups";
import { useLeagueTabState } from "./LeagueHub/hooks/useLeagueTabState";
import StandingsTab from "./league/StandingsTab";
import OverviewTab from "./LeagueHub/OverviewTab";
import SimulatorTab from "./LeagueHub/SimulatorTab";
import RostersTab from "./LeagueHub/RostersTab";
import RosterOverviewTab from "./LeagueHub/RosterOverviewTab";
import LeagueMatesTab from "./LeagueHub/LeagueMatesTab";
import OppRostersTab from "./LeagueHub/OppRostersTab";
import StartersTab from "./LeagueHub/StartersTab";
import RosterToolsTab from "./LeagueHub/RosterToolsTab";
import NotesTab from "./LeagueHub/NotesTab";
import PowerRankingsTab from "./LeagueHub/PowerRankingsTab";
import ActivityTab from "./LeagueHub/ActivityTab";
import ErrorBanner from "./ErrorBanner";
import type { StandingRow, AnnotatedTransaction } from "./LeagueHub/leagueHubTypes";

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
  leagueOverviewError: string | null;

  // Computed
  selectedLeagueMateProfilesView: LeagueMateView[];

  // Cross-hub shared state (stays in page.tsx)
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;

  // Projections / season state (used by Starters tab)
  projectionData: ProjectionRow[];
  nflState: SleeperNFLState | null;

  // Additional state
  freeAgents: SleeperPlayer[];
  loadingCalcValues: boolean;
  historicalSnapshot: HistoricalSnapshot | null;

  // Functions
  loadRoster: (league: SleeperLeague) => void;
  loadLeagueOverview: () => Promise<void>;
  loadRedraftValues: () => void;
  loadUserTrades: (ownerId: string, bypass?: boolean) => void;
  loadUserExposure: (ownerId: string) => void;
  saveLeagueNote: (leagueId: string, text: string) => void;
  onSaveSim: (leagueId: string, rows: SimulationTeamRow[]) => void;
  handleRunAllSims: () => void;
  setPlayerProfileId: (id: string | null) => void;
  setCalcOpponentRosterId: (id: number | null) => void;
  setMainTab: (tab: MainTab) => void;
  setTradeHubSection: (section: "CALCULATOR" | "FINDER") => void;
}

// ── Component ──────────────────────────────────────────────────────────────
function LeagueHub({
  leagueHubTab, setLeagueHubTab, activeLeagueHubGroup,
  leagues, user, standings, setSelectedLeague,
  picks, allPicks,
  committedSimsByLeague, leagueSimCache, simQueue, simProgress,
  loadingLeagueMateIntel, loadingCrossLeagueMateIntel, loadingActivity, loadingLeagueWeeklyMatchups,
  leagueNotes, activityTransactions,
  leagueOverviewData, loadingLeagueOverview, leagueOverviewLoaded, leagueOverviewError,
  selectedLeagueMateProfilesView,
  ignoredOwnerIds, toggleIgnoredOwner,
  projectionData, nflState,
  freeAgents, loadingCalcValues, historicalSnapshot,
  loadRoster, loadLeagueOverview, loadRedraftValues, loadUserTrades, loadUserExposure,
  saveLeagueNote, onSaveSim, handleRunAllSims,
  setPlayerProfileId, setCalcOpponentRosterId, setMainTab, setTradeHubSection,
}: LeagueHubProps) {
  const {
    leagueSearch, setLeagueSearch,
    oppRosterOwnerId, setOppRosterOwnerId,
    prSortKey, setPrSortKey,
    prSortAsc, setPrSortAsc,
    prPopup, setPrPopup,
    prMode, setPrMode,
  } = useLeagueTabState();

  return (
    <div className={`mx-auto px-4 py-6 ${leagueHubTab === "ROSTERS" || leagueHubTab === "OPP_ROSTERS" || leagueHubTab === "ROSTER_TOOLS" ? "max-w-7xl" : "max-w-5xl"}`}>
      <>
        {leagueOverviewError && (
          <div className="mb-4">
            <ErrorBanner message={leagueOverviewError} onRetry={loadLeagueOverview} />
          </div>
        )}
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

        {leagueHubTab === "ROSTER_OVERVIEW" && (
          <RosterOverviewTab
            leagues={leagues}
            user={user}
            leagueOverviewData={leagueOverviewData}
            loadingLeagueOverview={loadingLeagueOverview}
            leagueOverviewLoaded={leagueOverviewLoaded}
            loadLeagueOverview={loadLeagueOverview}
            loadRoster={loadRoster}
            setLeagueHubTab={setLeagueHubTab}
          />
        )}

        {leagueHubTab === "OPP_ROSTERS" && (
          <OppRostersTab
            user={user}
            allPicks={allPicks}
            oppRosterOwnerId={oppRosterOwnerId}
            setOppRosterOwnerId={setOppRosterOwnerId}
          />
        )}

        {leagueHubTab === "STANDINGS" && (
          <StandingsTab
            standings={standings}
            selectedLeagueMateProfilesView={selectedLeagueMateProfilesView}
          />
        )}

        {leagueHubTab === "STARTERS" && (
          <StartersTab
            projectionData={projectionData}
            nflState={nflState}
          />
        )}

        {leagueHubTab === "ROSTER_TOOLS" && (
          <RosterToolsTab allPicks={allPicks} />
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
            historicalSnapshot={historicalSnapshot}
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
