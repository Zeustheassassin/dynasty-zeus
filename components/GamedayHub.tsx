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
  onRefreshGamedaySnapshot: () => void;
  gamedayMatchupsUpdatedAt: number | null;
  /** A game is in progress right now (drives the live indicator). */
  gamedayLive: boolean;
  setPlayerProfileId: (id: string | null) => void;

  // Gameday Dashboard tab
  gamedayDashboardEntries: GamedayDashboardEntry[];
  loadingGamedayDashboard: boolean;
  gamedayDashboardUpdatedAt: number | null;
  onRefreshGamedayDashboard: () => void;
}

const TABS: { id: GamedayHubTab; label: string }[] = [
  { id: "DASHBOARD", label: "Gameday Dashboard" },
  { id: "MATCHUPS", label: "League Matchups" },
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
  onRefreshGamedaySnapshot,
  gamedayMatchupsUpdatedAt,
  gamedayLive,
  setPlayerProfileId,
  gamedayDashboardEntries,
  loadingGamedayDashboard,
  gamedayDashboardUpdatedAt,
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
          onRefreshSnapshot={onRefreshGamedaySnapshot}
          updatedAt={gamedayMatchupsUpdatedAt}
          live={gamedayLive}
          setPlayerProfileId={setPlayerProfileId}
        />
      )}

      {gamedayHubTab === "DASHBOARD" && (
        <ErrorBoundary label="Gameday Dashboard">
          <GamedayDashboardTab
            week={gamedayWeek}
            entries={gamedayDashboardEntries}
            loading={loadingGamedayDashboard}
            updatedAt={gamedayDashboardUpdatedAt}
            live={gamedayLive}
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
