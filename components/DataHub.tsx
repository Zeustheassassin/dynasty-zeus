"use client";
import React, { useState } from "react";
import type {
  SleeperLeague, SleeperUser, AugmentedPick, ProjectionRow, LeagueMateStatEntry, HistoricalSnapshot,
} from "../lib/types";
import type { ShareEntry, ExposureData } from "./DataHub/dataHubTypes";
import RankingsTab from "./DataHub/RankingsTab";
import ValueTrendsTab from "./DataHub/ValueTrendsTab";
import ProjectionsTab from "./DataHub/ProjectionsTab";
import PickValuesTab from "./DataHub/PickValuesTab";
import LeaguematesTab from "./DataHub/LeaguematesTab";
import DepthChartsTab from "./DataHub/DepthChartsTab";
import BuyLowTab from "./DataHub/BuyLowTab";

// ── Local types ─────────────────────────────────────────────────────────────
type DataHubTabId = "RANKINGS" | "VALUE_TRENDS" | "PROJECTIONS" | "PICK_VALUES" | "LEAGUEMATES" | "DEPTH_CHARTS" | "BUY_LOW";

interface DataHubProps {
  // Navigation
  dataHubTab: DataHubTabId;
  setDataHubTab: (tab: DataHubTabId) => void;

  shares: Record<string, ShareEntry>;

  // Dynasty/Redraft rankings
  loadingCalcValues: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  savePlayerDisposition: (playerId: string, sell: string, buy: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  loadingRedraft: boolean;

  // Projections tab
  projectionData: ProjectionRow[];
  setProjectionData: React.Dispatch<React.SetStateAction<ProjectionRow[]>>;
  projectionPosFilter: string;
  setProjectionPosFilter: (pos: string) => void;
  projectionWeek: number;
  setProjectionWeek: (week: number) => void;
  setProjectionLoaded: (loaded: boolean) => void;
  loadProjections: (week: number | "season", extraSources?: string[]) => void;
  projectionSeasonYear: number | null;
  projectionSourceStatus: Record<string, boolean>;
  loadingProjections: boolean;
  projectionUsesSeasonFallback: boolean;

  // Pick values tab
  allPicks: AugmentedPick[];

  // League mate stats tab
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  // League mate exposure drill-down
  loadUserExposure: (userId: string) => void;
  selectedUserId: string | null;
  externalShares: ExposureData | null;
  loadingShares: boolean;

  // Value trends
  historicalSnapshot: HistoricalSnapshot | null;
  onSaveSnapshot: () => Promise<void>;
}

// ── Component ──────────────────────────────────────────────────────────────
function DataHub({
  dataHubTab, setDataHubTab,
  shares,
  loadingCalcValues,
  playerDispositions, savePlayerDisposition, setPlayerProfileId,
  loadingRedraft,
  projectionData, setProjectionData, projectionPosFilter, setProjectionPosFilter,
  projectionWeek, setProjectionWeek, setProjectionLoaded, loadProjections,
  projectionSeasonYear, projectionSourceStatus, loadingProjections, projectionUsesSeasonFallback,
  allPicks,
  leagues, user,
  loadUserExposure, selectedUserId, externalShares, loadingShares,
  historicalSnapshot, onSaveSnapshot,
}: DataHubProps) {
  const [dynastyRankPos, setDynastyRankPos] = useState("ALL");
  const [leagueMateStats, setLeagueMateStats] = useState<LeagueMateStatEntry[]>([]);
  const [leagueMateStatsLoaded, setLeagueMateStatsLoaded] = useState(false);
  const [loadingLeagueMateStats, setLoadingLeagueMateStats] = useState(false);
  const [leagueMateSearch, setLeagueMateSearch] = useState("");
  const [leagueMateSort, setLeagueMateSort] = useState<"name" | "total" | "bestball" | "shared">("total");
  return (
    <>
      {/* Sub-tab nav */}
      <div className="flex justify-center border-b border-gray-800 mb-6">
        <div className="flex justify-center gap-1 sm:gap-3 lg:gap-5 text-center flex-wrap">
          {(["RANKINGS", "VALUE_TRENDS", "PROJECTIONS", "PICK_VALUES", "LEAGUEMATES", "DEPTH_CHARTS", "BUY_LOW"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setDataHubTab(tab)}
              className={`pb-2 px-1 text-xs sm:text-sm font-semibold transition whitespace-nowrap ${
                dataHubTab === tab
                  ? tab === "BUY_LOW"
                    ? "border-b-2 border-green-400 text-green-400"
                    : "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab === "RANKINGS" ? "Rankings" :
               tab === "VALUE_TRENDS" ? "Value Trends" :
               tab === "PROJECTIONS" ? "Projections" :
               tab === "PICK_VALUES" ? "Pick Values" :
               tab === "LEAGUEMATES" ? "League Mates" :
               tab === "DEPTH_CHARTS" ? "Depth Charts" :
               "Buy Low"}
            </button>
          ))}
        </div>
      </div>

      {dataHubTab === "RANKINGS" && (
        <RankingsTab
          dynastyRankPos={dynastyRankPos}
          setDynastyRankPos={setDynastyRankPos}
          loadingCalcValues={loadingCalcValues}
          loadingRedraft={loadingRedraft}
          playerDispositions={playerDispositions}
          savePlayerDisposition={savePlayerDisposition}
          setPlayerProfileId={setPlayerProfileId}
          shares={shares}
          historicalSnapshot={historicalSnapshot}
        />
      )}

      {dataHubTab === "VALUE_TRENDS" && (
        <ValueTrendsTab
          historicalSnapshot={historicalSnapshot}
          onSaveSnapshot={onSaveSnapshot}
          shares={shares}
          user={user}
        />
      )}

      {dataHubTab === "PROJECTIONS" && (
        <ProjectionsTab
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
          user={user}
        />
      )}

      {dataHubTab === "PICK_VALUES" && (
        <PickValuesTab
          allPicks={allPicks}
          leagues={leagues}
          user={user}
        />
      )}

      {dataHubTab === "LEAGUEMATES" && (
        <LeaguematesTab
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
          leagues={leagues}
          user={user}
        />
      )}

      {dataHubTab === "DEPTH_CHARTS" && <DepthChartsTab />}

      {dataHubTab === "BUY_LOW" && (
        <BuyLowTab
          projectionData={projectionData}
          setPlayerProfileId={setPlayerProfileId}
        />
      )}
    </>
  );
}

export default React.memo(DataHub);
