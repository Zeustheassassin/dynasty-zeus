"use client";
import { useEffect, useMemo, useState } from "react";
import type { Prospect, ProspectWithStats, ScoutingGame, RBPlay, QBPlay, TEPlay } from "../../../lib/types";
import { fmtVal, type ColDef, type StatRow } from "./StatsTableShell";
import { RB_STAT_COLS, buildRBStatRows } from "./RBStatsTable";
import { QB_STAT_COLS, buildQBStatRows } from "./QBStatsTable";
import { TE_STAT_COLS, buildTEStatRows } from "./TEStatsTable";
import { WR_STAT_COLS, buildWRStatRows } from "./WRStatsTable";
import type { LoadPositionPlaysFn } from "../../ScoutingHub";

type PositionTab = "QB" | "RB" | "WR" | "TE";
const POSITIONS: PositionTab[] = ["QB", "RB", "WR", "TE"];
const POSITION_LABELS: Record<PositionTab, string> = {
  QB: "Quarterback",
  RB: "Running Back",
  WR: "Wide Receiver",
  TE: "Tight End",
};

interface Props {
  prospects: Prospect[];
  prospectsWithStats: ProspectWithStats[];
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  loadPositionPlays: LoadPositionPlaysFn;
  loading?: boolean;
}

function ProspectPicker({
  label, prospect, onSelect, options, excludeId,
}: {
  label: string;
  prospect: Prospect | null;
  onSelect: (p: Prospect | null) => void;
  options: Prospect[];
  excludeId?: string;
}) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return options.filter((p) => p.id !== excludeId).slice(0, 8);
    return options.filter((p) => p.id !== excludeId && p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [query, options, excludeId]);

  if (prospect) {
    return (
      <div className="bg-slate-900 rounded-xl border border-slate-800 p-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
          <p className="text-sm font-semibold text-white truncate">{prospect.name}</p>
          <p className="text-[11px] text-slate-500">{prospect.school} · {prospect.draft_class_year}</p>
        </div>
        <button onClick={() => onSelect(null)} className="text-xs text-slate-500 hover:text-white shrink-0">Change</button>
      </div>
    );
  }

  return (
    <div className="bg-slate-900 rounded-xl border border-slate-800 p-3">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">{label}</p>
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search prospect..."
        className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
        aria-label={`Search for ${label.toLowerCase()}`}
      />
      {results.length > 0 && (
        <ul className="mt-1.5 divide-y divide-slate-800 border border-slate-800 rounded overflow-hidden max-h-56 overflow-y-auto">
          {results.map((p) => (
            <li key={p.id}>
              <button
                onClick={() => { onSelect(p); setQuery(""); }}
                className="w-full text-left px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-800 flex items-center justify-between gap-2"
              >
                <span className="truncate">{p.name}</span>
                <span className="text-slate-500 shrink-0">{p.school} · {p.draft_class_year}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CompareProspectsTab({
  prospects, prospectsWithStats, games, rbPlays, qbPlays, tePlays, loadPositionPlays, loading,
}: Props) {
  const [position, setPosition] = useState<PositionTab>("WR");
  const [prospectA, setProspectA] = useState<Prospect | null>(null);
  const [prospectB, setProspectB] = useState<Prospect | null>(null);

  useEffect(() => {
    if (position === "RB" || position === "QB" || position === "TE") loadPositionPlays(position);
  }, [position, loadPositionPlays]);

  const handlePositionChange = (pos: PositionTab) => {
    setPosition(pos);
    setProspectA(null);
    setProspectB(null);
  };

  const { cols, rows } = useMemo((): { cols: ColDef[]; rows: StatRow[] } => {
    switch (position) {
      case "RB": return { cols: RB_STAT_COLS, rows: buildRBStatRows(prospects, games, rbPlays) };
      case "QB": return { cols: QB_STAT_COLS, rows: buildQBStatRows(prospects, games, qbPlays) };
      case "TE": return { cols: TE_STAT_COLS, rows: buildTEStatRows(prospects, games, tePlays) };
      default:   return { cols: WR_STAT_COLS, rows: buildWRStatRows(prospectsWithStats) };
    }
  }, [position, prospects, prospectsWithStats, games, rbPlays, qbPlays, tePlays]);

  const positionProspects = useMemo(
    () => prospects.filter((p) => p.position === position),
    [prospects, position],
  );

  const rowA = prospectA ? rows.find((r) => r.id === prospectA.id) ?? null : null;
  const rowB = prospectB ? rows.find((r) => r.id === prospectB.id) ?? null : null;

  // Group columns (skip the sticky "name" identity column — shown in the header instead).
  const groups = useMemo(() => {
    const dataCols = cols.filter((c) => c.fmt !== "name");
    const byGroup = new Map<string, ColDef[]>();
    for (const c of dataCols) {
      if (!byGroup.has(c.group)) byGroup.set(c.group, []);
      byGroup.get(c.group)!.push(c);
    }
    return [...byGroup.entries()];
  }, [cols]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex gap-1 border-b border-slate-800">
        {POSITIONS.map((pos) => (
          <button
            key={pos}
            onClick={() => handlePositionChange(pos)}
            className={`px-5 py-2 text-sm font-medium border-b-2 transition ${
              position === pos ? "border-blue-500 text-blue-400" : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            <span className="hidden sm:inline">{POSITION_LABELS[pos]}</span>
            <span className="sm:hidden">{pos}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ProspectPicker label="Prospect A" prospect={prospectA} onSelect={setProspectA} options={positionProspects} excludeId={prospectB?.id} />
        <ProspectPicker label="Prospect B" prospect={prospectB} onSelect={setProspectB} options={positionProspects} excludeId={prospectA?.id} />
      </div>

      {loading && <p className="text-center text-xs text-slate-600 py-8">Loading stats...</p>}

      {!loading && rowA && rowB && (
        <div className="bg-slate-900 rounded-xl border border-slate-800 overflow-hidden">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center border-b border-slate-800 bg-slate-950/60 p-3">
            <span className="text-left text-sm font-bold text-white truncate">{prospectA!.name}</span>
            <span className="text-xs text-slate-600 px-3">vs</span>
            <span className="text-right text-sm font-bold text-white truncate">{prospectB!.name}</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto divide-y divide-slate-800/60">
            {groups.map(([group, groupCols]) => (
              <div key={group}>
                <div className="px-3 py-1 bg-slate-900/60 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {group}
                </div>
                {groupCols.map((c) => {
                  const va = rowA[c.key];
                  const vb = rowB[c.key];
                  const numA = typeof va === "number" && !isNaN(va) ? va : null;
                  const numB = typeof vb === "number" && !isNaN(vb) ? vb : null;
                  let betterSide: "a" | "b" | null = null;
                  if (c.colorDir && numA != null && numB != null && numA !== numB) {
                    betterSide = (numA > numB) === (c.colorDir === 1) ? "a" : "b";
                  }
                  return (
                    <div key={c.key} className="grid grid-cols-[1fr_auto_1fr] items-center px-3 py-1.5 text-sm">
                      <div className={`text-left ${betterSide === "a" ? "font-bold text-emerald-400" : "text-slate-300"}`}>
                        {fmtVal(va, c.fmt)}
                      </div>
                      <div className="text-[10px] text-slate-600 px-3 text-center whitespace-nowrap" title={c.tooltip ?? c.label}>
                        {c.label}
                      </div>
                      <div className={`text-right ${betterSide === "b" ? "font-bold text-emerald-400" : "text-slate-300"}`}>
                        {fmtVal(vb, c.fmt)}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && (!rowA || !rowB) && (
        <p className="text-center text-xs text-slate-600 py-8">
          Select two {position} prospects above to compare their charted stats.
        </p>
      )}
    </div>
  );
}
