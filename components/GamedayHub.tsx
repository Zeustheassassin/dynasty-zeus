"use client";
import React from "react";
import type { SleeperLeague, GamedayMatchup, GamedayDashboardEntry } from "../lib/types";
import type { GamedayHubTab } from "../app/hooks/useHubRouting";
import ErrorBoundary from "./ErrorBoundary";
import LeagueMatchupsTab from "./GamedayHub/LeagueMatchupsTab";
import GamedayDashboardTab from "./GamedayHub/GamedayDashboardTab";

interface GamedayHubProps {
  // League selection
  leagues: SleeperLeague[];
  loadRoster: (league: SleeperLeague) => void;

  // Sub-tab
  gamedayHubTab: GamedayHubTab;
  setGamedayHubTab: (tab: GamedayHubTab) => void;

  // League Matchups tab
  gamedayWeek: number;
  gamedayMatchupCards: GamedayMatchup[];
  loadingGamedayMatchups: boolean;
  selectedGamedayMatchup: GamedayMatchup | null;
  setSelectedGamedayMatchupId: (id: number | null) => void;
  loadGamedayMatchups: (leagueId: string, week: number) => void;
  loadSchedule: (week: number) => void;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number) => void;
  setPlayerProfileId: (id: string | null) => void;

  // Gameday Dashboard tab
  gamedayDashboardEntries: GamedayDashboardEntry[];
  loadingGamedayDashboard: boolean;
  onRefreshGamedayDashboard: () => void;
}

const TABS: { id: GamedayHubTab; label: string }[] = [
  { id: "MATCHUPS", label: "League Matchups" },
  { id: "DASHBOARD", label: "Gameday Dashboard" },
];

function GamedayHub({
  leagues,
  loadRoster,
  gamedayHubTab,
  setGamedayHubTab,
  gamedayWeek,
  gamedayMatchupCards,
  loadingGamedayMatchups,
  selectedGamedayMatchup,
  setSelectedGamedayMatchupId,
  loadGamedayMatchups,
  loadSchedule,
  setProjectionWeek,
  setProjectionLoaded,
  loadProjections,
  setPlayerProfileId,
  gamedayDashboardEntries,
  loadingGamedayDashboard,
  onRefreshGamedayDashboard,
}: GamedayHubProps) {
  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">
      <div className="flex gap-1 border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setGamedayHubTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition ${
              gamedayHubTab === tab.id
                ? "border-blue-500 text-blue-400"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {gamedayHubTab === "MATCHUPS" && (
        <LeagueMatchupsTab
          leagues={leagues}
          loadRoster={loadRoster}
          gamedayWeek={gamedayWeek}
          gamedayMatchupCards={gamedayMatchupCards}
          loadingGamedayMatchups={loadingGamedayMatchups}
          selectedGamedayMatchup={selectedGamedayMatchup}
          setSelectedGamedayMatchupId={setSelectedGamedayMatchupId}
          loadGamedayMatchups={loadGamedayMatchups}
          loadSchedule={loadSchedule}
          setProjectionWeek={setProjectionWeek}
          setProjectionLoaded={setProjectionLoaded}
          loadProjections={loadProjections}
          setPlayerProfileId={setPlayerProfileId}
        />
      )}

      {gamedayHubTab === "DASHBOARD" && (
        <ErrorBoundary label="Gameday Dashboard">
          <GamedayDashboardTab
            week={gamedayWeek}
            entries={gamedayDashboardEntries}
            loading={loadingGamedayDashboard}
            onRefresh={onRefreshGamedayDashboard}
            onOpenLeague={(league) => {
              loadRoster(league);
              setGamedayHubTab("MATCHUPS");
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
}

export default React.memo(GamedayHub);
