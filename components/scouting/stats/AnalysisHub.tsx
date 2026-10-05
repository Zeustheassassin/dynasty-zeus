"use client";
import { useState, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Prospect, ProspectWithStats, ScoutingGame, RBPlay, QBPlay, TEPlay } from "../../../lib/types";
import type { LoadPositionPlaysFn } from "../../ScoutingHub";
import type { PffTotals } from "../../../lib/pff/totals";
import { EMPTY_GRADING_DATA, type GradingData } from "../../../lib/scouting/aeComponents";
import type { ProspectGameRouteCellsRow } from "../../../lib/scouting/aggregateMerge";

const WRStatsTable = dynamic(() => import("./WRStatsTable"), { ssr: false });
const RBStatsTable = dynamic(() => import("./RBStatsTable"), { ssr: false });
const QBStatsTable = dynamic(() => import("./QBStatsTable"), { ssr: false });
const TEStatsTable = dynamic(() => import("./TEStatsTable"), { ssr: false });
const GradingChecks = dynamic(() => import("./GradingChecks"), { ssr: false });

// The four position tables, plus the Grading checks (Stage 4: tag readiness and
// tests, garbage time, era scale, AE Score components).
type PositionTab = "WR" | "RB" | "QB" | "TE" | "Grading";

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
  /** PFF over each prospect's charted games. */
  pffTotals?: Map<string, PffTotals>;
  /** PFF rows and the migration-064 views (tag stats, components, Grading). */
  gradingData?: GradingData;
  /** prospect_game_route_cells (058), for the Grading checks' WR model. */
  gameRouteCells?: ProspectGameRouteCellsRow[] | null;
}

const POSITION_LABELS: Record<PositionTab, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
  Grading: "Grading checks",
};

const POSITION_DESCRIPTIONS: Record<PositionTab, string> = {
  WR: "Role fit (X · Y · Slot · Gadget) · SAE · Open% by route, alignment, coverage · Target & catch rates",
  RB: "Role fit (Three-down · Zone · Gap/Power · Receiving · Big-play) · SRAE · Success% by run type, formation & box situation · Receiving",
  QB: "Role fit (Creator · Distributor · Vertical · Dual-threat) · AAE · Accuracy by depth, coverage, timing, pressure, platform, handling & route mix · Decision timing breakdown",
  TE: "Role fit (Inline Y · Move · H-back · Blocking) · TE-SAER · Open% by positioning, location & coverage · TE-SAEB · Block success above expected",
  Grading: "Where the grading pieces that wait on data stand: per-play difficulty tags (and their held-out tests), garbage time, the era scale check, and every AE Score component's pool, spread and trust",
};

export default function AnalysisHub({
  prospects, prospectsWithStats, games, rbPlays, qbPlays, tePlays,
  loadPositionPlays, loading, draftYearFilter, setDraftYearFilter, onSelectProspect, pffTotals,
  gradingData = EMPTY_GRADING_DATA, gameRouteCells = null,
}: Props) {
  const [posTab, setPosTab] = useState<PositionTab>("WR");

  // Trigger lazy fetch when a non-WR tab is activated. The fetch lives on
  // ScoutingHub now so its results are shared with GamesLog. Idempotent —
  // calling for a position whose plays already loaded is a no-op.
  useEffect(() => {
    if (posTab === "RB" || posTab === "QB" || posTab === "TE") {
      loadPositionPlays(posTab);
    } else if (posTab === "Grading") {
      loadPositionPlays("RB");
      loadPositionPlays("QB");
      loadPositionPlays("TE");
    }
  }, [posTab, loadPositionPlays]);

  // Derive class-year filter chips from the prospects actually loaded so the
  // list auto-grows each year as new classes are added (and historical classes
  // remain selectable as long as their prospects are still on file).
  const DRAFT_YEARS = useMemo(() => {
    const years = new Set<number>();
    for (const p of prospects) if (p.draft_class_year) years.add(p.draft_class_year);
    return [...years].sort((a, b) => a - b);
  }, [prospects]);

  return (
    <div>
      {/* Position tabs + filter row */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <div className="flex gap-1 border-b border-slate-800">
          {(["QB", "RB", "WR", "TE", "Grading"] as PositionTab[]).map((pos) => (
            <button
              key={pos}
              onClick={() => setPosTab(pos)}
              className={`px-5 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
                posTab === pos
                  ? "border-blue-500 text-blue-400"
                  : "border-transparent text-slate-400 hover:text-white"
              }`}
            >
              <span className="hidden sm:inline">{POSITION_LABELS[pos]}</span>
              <span className="sm:hidden">{pos === "Grading" ? "Checks" : pos}</span>
            </button>
          ))}
        </div>

        {/* Draft year filter */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Class:</span>
          <button
            onClick={() => setDraftYearFilter(null)}
            className={`px-3 py-1 text-xs rounded-full border transition ${
              draftYearFilter === null
                ? "bg-blue-600 border-blue-500 text-white"
                : "border-slate-600 text-slate-400 hover:text-white"
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
                  : "border-slate-600 text-slate-400 hover:text-white"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <p className="text-xs text-slate-500 mb-4">{POSITION_DESCRIPTIONS[posTab]}</p>

      {/* Stats table */}
      {posTab === "WR" && (
        <WRStatsTable
          prospectsWithStats={prospectsWithStats}
          loading={loading}
          draftYearFilter={draftYearFilter}
          onSelectProspect={onSelectProspect}
          pffTotals={pffTotals}
          routeTagCells={gradingData.routeTagCells}
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
          pffTotals={pffTotals}
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
          pffTotals={pffTotals}
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
          pffTotals={pffTotals}
        />
      )}
      {posTab === "Grading" && (
        <GradingChecks
          prospects={prospects}
          games={games}
          qbPlays={qbPlays}
          rbPlays={rbPlays}
          tePlays={tePlays}
          gameRouteCells={gameRouteCells}
          gradingData={gradingData}
          loading={loading}
        />
      )}
    </div>
  );
}
