"use client";
import React from "react";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import type { SleeperUser, ProjectionRow } from "../../lib/types";
import { POS_COLOR } from "./dataHubHelpers";

const PROJ_SOURCES = [
  { id: "fantasypros" as const, label: "FantasyPros",       tier: 1 as const, weight: 0.45 },
  { id: "numberfire"  as const, label: "numberFire",         tier: 1 as const, weight: 0.35 },
  { id: "sleeper"     as const, label: "RotoWire/Sleeper",   tier: 2 as const, weight: 0.20 },
];

interface ProjectionsTabProps {
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
  user: SleeperUser | null;
}

function ProjectionsTab({
  projectionData, setProjectionData,
  projectionPosFilter, setProjectionPosFilter,
  projectionWeek, setProjectionWeek,
  setProjectionLoaded, loadProjections,
  projectionSeasonYear, projectionSourceStatus,
  loadingProjections, projectionUsesSeasonFallback,
  user,
}: ProjectionsTabProps) {
  const { rosters } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues } = useValues();

  const [projRosterOnly, setProjRosterOnly] = React.useState(false);
  const [enabledExtraSources, setEnabledExtraSources] = React.useState<Set<string>>(new Set());

  const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
  const myPlayerSet = new Set<string>(myRoster?.players ?? []);
  const visible = projectionData
    .filter((p) => projectionPosFilter === "ALL" || p.position === projectionPosFilter)
    .filter((p) => !projRosterOnly || myPlayerSet.has(p.sleeperId));

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 shrink-0">View:</span>
          <select
            value={projectionWeek}
            onChange={(e) => {
              const w = Number(e.target.value);
              setProjectionWeek(w);
              setProjectionLoaded(false);
              setProjectionData([]);
              loadProjections(w === 0 ? "season" : w, [...enabledExtraSources]);
            }}
            className="bg-gray-800 border border-gray-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value={0}>Full Season Projection</option>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
              <option key={w} value={w}>Week {w}</option>
            ))}
          </select>
        </div>

        {projectionSeasonYear && (
          <span className="rounded-full border border-gray-700 bg-gray-900/70 px-3 py-1 text-[11px] font-medium text-gray-300">
            {projectionWeek === 0 ? `${projectionSeasonYear} season projections` : `${projectionSeasonYear} projections`}
          </span>
        )}

        <div className="flex gap-2">
          {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
            <button
              key={pos}
              onClick={() => setProjectionPosFilter(pos)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${projectionPosFilter === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              {pos}
            </button>
          ))}
        </div>

        <button
          onClick={() => setProjRosterOnly((v) => !v)}
          disabled={!myRoster}
          className={`text-xs font-semibold border rounded-lg px-3 py-1.5 transition disabled:opacity-40 ${projRosterOnly ? "bg-blue-600 border-blue-500 text-white" : "border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
          title={myRoster ? "Toggle to show only your rostered players" : "Load a league to use this filter"}
        >
          My Roster
        </button>
        <button
          onClick={() => {
            setProjectionLoaded(false);
            setProjectionData([]);
            loadProjections(projectionWeek === 0 ? "season" : projectionWeek, [...enabledExtraSources]);
          }}
          className="ml-auto text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition"
        >
          Refresh
        </button>
      </div>

      {/* Source pills */}
      <div className="flex gap-2 mb-1 flex-wrap items-center">
        {PROJ_SOURCES.map((src) => {
          const ok = projectionSourceStatus[src.id];
          const isSleeper = src.id === "sleeper";
          const isEnabled = isSleeper || enabledExtraSources.has(src.id);
          const verifyUrl =
            src.id === "fantasypros"
              ? `https://www.fantasypros.com/nfl/projections/qb.php?week=${projectionWeek === 0 ? "draft" : projectionWeek}&scoring=PPR`
              : src.id === "numberfire"
              ? "https://www.fanduel.com/research/nfl/fantasy/fantasy-football-projections/qb"
              : `https://api.sleeper.app/projections/nfl/${projectionSeasonYear ?? new Date().getFullYear()}?season_type=regular&position=QB&order_by=pts_ppr`;

          return (
            <div key={src.id} className="flex items-center gap-1">
              {isSleeper ? (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${ok === true ? "bg-green-900 text-green-300" : ok === false ? "bg-red-900 text-red-400" : "bg-gray-800 text-gray-400"}`}
                >
                  {src.label} ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const next = new Set(enabledExtraSources);
                    if (next.has(src.id)) {
                      next.delete(src.id);
                    } else {
                      next.add(src.id);
                    }
                    setEnabledExtraSources(next);
                    setProjectionLoaded(false);
                    setProjectionData([]);
                    loadProjections(
                      projectionWeek === 0 ? "season" : projectionWeek,
                      [...next]
                    );
                  }}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border transition ${
                    isEnabled
                      ? ok === true
                        ? "bg-green-900 border-green-700 text-green-300"
                        : ok === false
                        ? "bg-red-900 border-red-700 text-red-400"
                        : "bg-blue-900 border-blue-700 text-blue-300"
                      : "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300"
                  }`}
                  title={isEnabled ? `Disable ${src.label}` : `Enable ${src.label} — verify the link first`}
                >
                  {src.label} {isEnabled ? (ok === true ? "✓" : ok === false ? "✕" : "…") : "+ Add"}
                </button>
              )}
              {/* Verify link */}
              <a
                href={verifyUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={`Open ${src.label} source — verify it shows ${projectionSeasonYear ?? new Date().getFullYear()} data before enabling`}
                className="text-[10px] text-gray-600 hover:text-blue-400 transition"
              >
                ↗
              </a>
            </div>
          );
        })}
        {loadingProjections && <span className="text-[10px] text-blue-400 ml-1">Loading…</span>}
      </div>
      <p className="text-[10px] text-gray-600 mb-4">
        Sleeper is always on and year-verified. Click <span className="text-gray-400">↗</span> on FantasyPros or numberFire to check the data year before enabling them — their full-season endpoints don&apos;t publish {new Date().getFullYear()} numbers until closer to training camp.
      </p>

      {projectionUsesSeasonFallback && projectionWeek !== 0 && (
        <div className="mb-4 rounded-lg border border-yellow-700/50 bg-yellow-950/30 px-3 py-2 text-[11px] text-yellow-300">
          Weekly projections not yet available — showing Sleeper full-season projections ÷ 17 as a placeholder. Rankings will automatically switch to the full multi-source consensus once week-by-week projections are published closer to the season.
        </div>
      )}

      {loadingProjections && projectionData.length === 0 ? (
        <p className="text-sm text-blue-400">Fetching consensus projections…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-gray-500">No projection data. Hit Refresh or check your connection.</p>
      ) : (
        <>
          <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
            <span className="w-6 text-right shrink-0">#</span>
            <span className="w-7 shrink-0">Pos</span>
            <span className="flex-1">Player</span>
            <span className="w-10 text-right shrink-0">FPTS</span>
            <span className="hidden sm:block w-14 text-right shrink-0">Dyn</span>
            <span className="w-10 text-right shrink-0 pr-1">Srcs</span>
          </div>
          <div className="space-y-1">
            {visible.map((p, idx) => {
              const dynVal = calcFcValues[p.sleeperId] ?? 0;
              return (
                <div key={p.sleeperId} className="flex items-center gap-3 bg-gray-800 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-500 w-6 text-right shrink-0">{idx + 1}</span>
                  <span className={`text-[10px] font-bold w-7 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                  <span className="text-sm text-white flex-1 truncate">{p.full_name}</span>
                  {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                  <span className="text-xs text-gray-300 font-mono w-10 text-right shrink-0">{p.fpts.toFixed(1)}</span>
                  <span className={`hidden sm:block text-[10px] font-mono w-14 text-right shrink-0 ${dynVal > 0 ? "text-gray-400" : "text-gray-700"}`}>
                    {dynVal > 0 ? dynVal.toLocaleString() : "—"}
                  </span>
                  <span className="text-[10px] text-gray-600 w-10 text-right shrink-0 pr-1" title={p.sources.join(", ")}>
                    {p.sources.length}/{Object.values(projectionSourceStatus).filter(Boolean).length || PROJ_SOURCES.length}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export default React.memo(ProjectionsTab);
