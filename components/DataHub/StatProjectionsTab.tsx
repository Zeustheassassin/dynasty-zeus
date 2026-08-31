"use client";
import React from "react";
import type { ProjectionRow } from "../../lib/types";
import { POS_COLOR } from "./dataHubHelpers";

interface StatColumn {
  key: string;
  label: string;
  decimals: number;
}

// Same category set the consensus stat line is built from (hooks/useProjections.ts).
const STAT_COLUMNS: StatColumn[] = [
  { key: "pass_yd", label: "Pass Yd", decimals: 0 },
  { key: "pass_td", label: "Pass TD", decimals: 1 },
  { key: "pass_int", label: "Int", decimals: 1 },
  { key: "rush_yd", label: "Rush Yd", decimals: 0 },
  { key: "rush_td", label: "Rush TD", decimals: 1 },
  { key: "rec", label: "Rec", decimals: 1 },
  { key: "rec_yd", label: "Rec Yd", decimals: 0 },
  { key: "rec_td", label: "Rec TD", decimals: 1 },
];

function downloadCsv(rows: ProjectionRow[], filename: string) {
  const headers = ["Pos", "Player", "Team", "FPTS", ...STAT_COLUMNS.map((c) => c.label), "Sources"];
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    const cells = [
      r.position,
      r.full_name,
      r.team ?? "",
      r.fpts,
      ...STAT_COLUMNS.map((c) => r.stats?.[c.key] ?? ""),
      r.sources.join("/"),
    ];
    lines.push(cells.map(escape).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

interface StatProjectionsTabProps {
  projectionData: ProjectionRow[];
  projectionSeasonYear: number | null;
  projectionWeek: number;
  loadingProjections: boolean;
}

function StatProjectionsTab({
  projectionData, projectionSeasonYear, projectionWeek, loadingProjections,
}: StatProjectionsTabProps) {
  const [posFilter, setPosFilter] = React.useState("ALL");
  const [statsOnly, setStatsOnly] = React.useState(true);

  const visible = projectionData
    .filter((p) => posFilter === "ALL" || p.position === posFilter)
    .filter((p) => !statsOnly || p.stats !== null);

  const handleExport = () => {
    const label = projectionWeek === 0 ? "season" : `week${projectionWeek}`;
    downloadCsv(visible, `dynastyzeus-projections-${projectionSeasonYear ?? ""}-${label}.csv`);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex gap-2">
          {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
            <button
              key={pos}
              onClick={() => setPosFilter(pos)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${posFilter === pos ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:text-white"}`}
            >
              {pos}
            </button>
          ))}
        </div>

        <button
          onClick={() => setStatsOnly((v) => !v)}
          className={`text-xs font-semibold border rounded-lg px-3 py-1.5 transition ${statsOnly ? "bg-blue-600 border-blue-500 text-white" : "border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}
          title="Only show players with a real per-category stat line (Sleeper and/or ESPN matched them)"
        >
          Stat Breakdown Only
        </button>

        <button
          onClick={handleExport}
          disabled={visible.length === 0}
          className="ml-auto text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>

      <p className="text-[10px] text-slate-600 mb-4">
        Stat lines are a weighted-average consensus from whichever active sources report real per-category stats (Sleeper, ESPN) — FantasyPros and numberFire only ever report one blended point total, so they don&apos;t contribute a stat line here. Enable ESPN on the Projections tab to populate more rows.
      </p>

      {loadingProjections && projectionData.length === 0 ? (
        <p className="text-sm text-blue-400">Fetching projections…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">No stat-level projection data. Enable ESPN on the Projections tab, or load projections first.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-600 border-b border-slate-800">
                <th className="text-left py-2 pr-2">Pos</th>
                <th className="text-left py-2 pr-2">Player</th>
                <th className="text-left py-2 pr-2">Team</th>
                <th className="text-right py-2 px-2">FPTS</th>
                {STAT_COLUMNS.map((c) => (
                  <th key={c.key} className="text-right py-2 px-2">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr key={p.sleeperId} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                  <td className={`py-1.5 pr-2 font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</td>
                  <td className="py-1.5 pr-2 text-white whitespace-nowrap">{p.full_name}</td>
                  <td className="py-1.5 pr-2 text-slate-500">{p.team ?? ""}</td>
                  <td className="py-1.5 px-2 text-right font-mono text-slate-300">{p.fpts.toFixed(1)}</td>
                  {STAT_COLUMNS.map((c) => {
                    const v = p.stats?.[c.key];
                    return (
                      <td key={c.key} className="py-1.5 px-2 text-right font-mono text-slate-400">
                        {v !== undefined ? v.toFixed(c.decimals) : "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export default React.memo(StatProjectionsTab);
