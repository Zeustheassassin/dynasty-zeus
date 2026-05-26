"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats, ScoutingGame, RBPlay, QBPlay, TEPlay } from "../../../lib/types";
import type { LoadPositionPlaysFn } from "../../ScoutingHub";

const WRStatsTable = dynamic(() => import("./WRStatsTable"), { ssr: false });
const RBStatsTable = dynamic(() => import("./RBStatsTable"), { ssr: false });
const QBStatsTable = dynamic(() => import("./QBStatsTable"), { ssr: false });
const TEStatsTable = dynamic(() => import("./TEStatsTable"), { ssr: false });

type PositionTab = "WR" | "RB" | "QB" | "TE";

interface Props {
  prospects: Prospect[];
  prospectsWithStats: ProspectWithStats[];
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  loadPositionPlays: LoadPositionPlaysFn;
  loading: boolean;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  onSelectProspect?: (p: Prospect) => void;
}

const POSITION_DESCRIPTIONS: Record<PositionTab, string> = {
  WR: "SAE · Open% by route, alignment, coverage · Target & catch rates",
  RB: "SRAE · Success% by run type, formation & box situation · Receiving",
  QB: "AAE · Accuracy by depth, coverage, timing, pressure, platform, handling & route mix · Decision timing breakdown",
  TE: "TE-SAER · Open% by positioning, location & coverage · TE-SAEB · Block success above expected",
};

export default function AnalysisHub({
  prospects, prospectsWithStats, games, rbPlays, qbPlays, tePlays,
  loadPositionPlays, loading, draftYearFilter, setDraftYearFilter, onSelectProspect,
}: Props) {
  const [posTab, setPosTab] = useState<PositionTab>("WR");

  // Trigger lazy fetch when a non-WR tab is activated. The fetch lives on
  // ScoutingHub now so its results are shared with GamesLog. Idempotent —
  // calling for a position whose plays already loaded is a no-op.
  useEffect(() => {
    if (posTab === "RB" || posTab === "QB" || posTab === "TE") {
      loadPositionPlays(posTab);
    }
  }, [posTab, loadPositionPlays]);

  const DRAFT_YEARS = [2026, 2027];

  return (
    <div>
      {/* Position tabs + filter row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-1 border-b border-gray-800">
          {(["QB", "RB", "WR", "TE"] as PositionTab[]).map((pos) => (
            <button
              key={pos}
              onClick={() => setPosTab(pos)}
              className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                posTab === pos
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-gray-400 hover:text-white"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>

        {/* Draft year filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Class:</span>
          <button
            onClick={() => setDraftYearFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition ${
              draftYearFilter === null
                ? "bg-blue-600 border-blue-500 text-white"
                : "border-gray-600 text-gray-400 hover:text-white"
            }`}
          >
            All
          </button>
          {DRAFT_YEARS.map((y) => (
            <button
              key={y}
              onClick={() => setDraftYearFilter(draftYearFilter === y ? null : y)}
              className={`px-3 py-1 text-xs rounded-full border transition ${
                draftYearFilter === y
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "border-gray-600 text-gray-400 hover:text-white"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 mb-4">{POSITION_DESCRIPTIONS[posTab]}</p>

      {/* Stats table */}
      {posTab === "WR" && (
        <WRStatsTable
          prospectsWithStats={prospectsWithStats}
          loading={loading}
          draftYearFilter={draftYearFilter}
          onSelectProspect={onSelectProspect}
        />
      )}
      {posTab === "RB" && (
        <RBStatsTable
          prospects={prospects}
          games={games}
          rbPlays={rbPlays}
          loading={loading}
          draftYearFilter={draftYearFilter}
          onSelectProspect={onSelectProspect}
        />
      )}
      {posTab === "QB" && (
        <QBStatsTable
          prospects={prospects}
          games={games}
          qbPlays={qbPlays}
          loading={loading}
          draftYearFilter={draftYearFilter}
          onSelectProspect={onSelectProspect}
        />
      )}
      {posTab === "TE" && (
        <TEStatsTable
          prospects={prospects}
          games={games}
          tePlays={tePlays}
          loading={loading}
          draftYearFilter={draftYearFilter}
          onSelectProspect={onSelectProspect}
        />
      )}
    </div>
  );
}
