"use client";
import type { Dispatch, SetStateAction } from "react";
import type { HistoryDraftEntry, ConsensusCacheRow, ConsensusHistoryPoint, ConsensusMoverEntry } from "../shared";
import { posColor, closestPickEquiv, pickEquivColor, toPickSlot } from "../shared";
import ConsensusCompiler from "./ConsensusCompiler";
import { MultiPointSparkline } from "../../charts/MultiPointSparkline";
import Badge from "../../ui/Badge";
import EmptyState from "../../ui/EmptyState";

type ConsensusMeta = Record<string, {
  draftCount: number;
  leagueCount: number;
  connectedUserCount: number;
  compiledAt: string;
}>;

interface ConsensusBoardEntry {
  player_id: string;
  name: string;
  position: string;
  team: string;
  avgPickNo: number;
  draftCount: number;
  value: number;
}

interface ConsensusTabProps {
  selectedHistoryYear: string;
  supabaseUser: { id: string } | null;
  consensusMeta: ConsensusMeta;
  consensusCache: Record<string, ConsensusCacheRow[]>;
  consensusHistory: Record<string, Record<string, ConsensusHistoryPoint[]>>;
  loadingCacheYear: string | null;
  compiling: boolean;
  compileLog: string;
  compileProgress: number;
  showCompilePanel: boolean;
  setShowCompilePanel: Dispatch<SetStateAction<boolean>>;
  compileSelectedYears: Set<number>;
  setCompileSelectedYears: Dispatch<SetStateAction<Set<number>>>;
  playerGrades: Record<string, "hit" | "neutral" | "bust">;
  filteredDrafts: HistoryDraftEntry[];
  consensusList: ConsensusBoardEntry[];
  riserFallerList: { risers: ConsensusMoverEntry[]; fallers: ConsensusMoverEntry[] };
  players: Record<string, { full_name?: string | null; position?: string | null; team?: string | null }>;
  pickFcValues: Record<string, number>;
  calcFcValues: Record<string, number>;
  runCompile: (years: number[]) => Promise<void>;
  removeCompiledPlayer: (year: string, playerId: string) => Promise<void>;
  clearYear: (year: number) => Promise<void>;
  setGrade: (year: string, playerId: string, grade: "hit" | "neutral" | "bust") => void;
}

export default function ConsensusTab({
  selectedHistoryYear,
  supabaseUser,
  consensusMeta,
  consensusCache,
  consensusHistory,
  loadingCacheYear,
  compiling,
  compileLog,
  compileProgress,
  showCompilePanel,
  setShowCompilePanel,
  compileSelectedYears,
  setCompileSelectedYears,
  playerGrades,
  filteredDrafts,
  consensusList,
  riserFallerList,
  players,
  pickFcValues,
  calcFcValues,
  runCompile,
  removeCompiledPlayer,
  clearYear,
  setGrade,
}: ConsensusTabProps) {
  const hasCachedRows  = Array.isArray(consensusCache[selectedHistoryYear]) && consensusCache[selectedHistoryYear].length > 0;
  const isLoadingCache = loadingCacheYear === selectedHistoryYear;
  const meta           = consensusMeta[selectedHistoryYear];

  const totalDraftsForYear = hasCachedRows
    ? (meta?.draftCount ?? 0)
    : filteredDrafts.length;
  // Past years require 8% of compiled drafts to surface a player. Current year drops to 3%
  // because most drafts are still in progress and contribute fewer picks each — the 8% bar
  // would over-filter and hide legitimate live ADP signal.
  // Calendar year intentionally (not NFL season-year): history is keyed by calendar year.
  const isCurrentYear = selectedHistoryYear === String(new Date().getFullYear());
  const minDraftsPct = isCurrentYear ? 0.03 : 0.08;
  const minDrafts = Math.max(1, Math.ceil(totalDraftsForYear * minDraftsPct));

  interface DisplayListEntry { player_id: string; name: string; position: string; team: string; avgPickNo: number; draftCount: number; value: number; }
  const displayList: DisplayListEntry[] = (hasCachedRows
    ? consensusCache[selectedHistoryYear].map((row) => {
        const fullPlayer = players[row.player_id];
        return {
          player_id:  row.player_id,
          name:       row.player_name || fullPlayer?.full_name || "",
          position:   row.position    || fullPlayer?.position  || "",
          team:       row.team        || fullPlayer?.team      || "",
          avgPickNo:  row.avg_pick_no,
          draftCount: row.draft_count,
          value:      calcFcValues[row.player_id] ?? 0,
        };
      })
    : consensusList
  ).filter((p) =>
    p.draftCount >= minDrafts &&
    ["QB", "RB", "WR", "TE", "FB"].includes(p.position)
  );

  const draftCount  = hasCachedRows ? (meta?.draftCount ?? 0) : filteredDrafts.length;
  const sourceLabel = hasCachedRows
    ? `${draftCount} rookie draft${draftCount !== 1 ? "s" : ""} · ${meta?.leagueCount ?? 0} leagues · ${meta?.connectedUserCount ?? 0} connected users`
    : `${filteredDrafts.length} draft${filteredDrafts.length !== 1 ? "s" : ""} in your leagues only`;

  return (
    <div>
      {/* ── Compile Panel ── */}
      <ConsensusCompiler
        selectedHistoryYear={selectedHistoryYear}
        supabaseUser={supabaseUser}
        consensusMeta={consensusMeta}
        compiling={compiling}
        compileLog={compileLog}
        compileProgress={compileProgress}
        showCompilePanel={showCompilePanel}
        setShowCompilePanel={setShowCompilePanel}
        compileSelectedYears={compileSelectedYears}
        setCompileSelectedYears={setCompileSelectedYears}
        runCompile={runCompile}
        clearYear={clearYear}
      />

      {/* ── Risers / Fallers ── */}
      {(riserFallerList.risers.length > 0 || riserFallerList.fallers.length > 0) && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 p-4 mb-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-blue-400 mb-2">▲ Risers</div>
            <div className="space-y-1">
              {riserFallerList.risers.map((m) => (
                <div key={m.player_id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-200 truncate">
                    <span className={`font-bold mr-1 ${posColor[m.position] || "text-slate-400"}`}>{m.position}</span>
                    {m.name}
                  </span>
                  <span className="text-blue-400 font-semibold shrink-0 ml-2">+{m.delta.toFixed(1)}</span>
                </div>
              ))}
              {riserFallerList.risers.length === 0 && <div className="text-xs text-slate-600">None this run</div>}
            </div>
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-red-400 mb-2">▼ Fallers</div>
            <div className="space-y-1">
              {riserFallerList.fallers.map((m) => (
                <div key={m.player_id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-200 truncate">
                    <span className={`font-bold mr-1 ${posColor[m.position] || "text-slate-400"}`}>{m.position}</span>
                    {m.name}
                  </span>
                  <span className="text-red-400 font-semibold shrink-0 ml-2">{m.delta.toFixed(1)}</span>
                </div>
              ))}
              {riserFallerList.fallers.length === 0 && <div className="text-xs text-slate-600">None this run</div>}
            </div>
          </div>
        </div>
      )}

      {/* ── Board ── */}
      {isLoadingCache ? (
        <div className="flex items-center gap-3 text-sm text-blue-400 py-6">
          <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
          </svg>
          Loading compiled consensus…
        </div>
      ) : displayList.length === 0 ? (
        <EmptyState>
          No draft data for {selectedHistoryYear}.{" "}
          {supabaseUser
            ? 'Click "Compile Now" above to build a network consensus board.'
            : "Log in to compile a network consensus board."}
        </EmptyState>
      ) : (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 flex items-start justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-semibold text-white">
                {selectedHistoryYear} Consensus Draft Board
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                {displayList.length} players ranked by avg pick · {sourceLabel}
              </div>
            </div>
            {hasCachedRows && (
              <Badge tone="good" className="shrink-0">Network Data</Badge>
            )}
          </div>
          <div className="px-4 py-2 border-b border-slate-800/60 grid grid-cols-[2rem_3rem_1fr_5rem_4rem_6rem] gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
            <span>#</span><span>Pos</span><span>Player</span><span>Avg Pick</span><span>Drafts</span><span className="text-right">≈ Pick Val</span>
          </div>
          <div className="divide-y divide-slate-800/40">
            {displayList.map((p, i) => {
              const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(p.value, pickFcValues);
              const color  = pickEquivColor(equivPickNo, Math.round(p.avgPickNo));
              const grade  = playerGrades[`${selectedHistoryYear}_${p.player_id}`];
              const rowBg  = grade === "hit"     ? "bg-emerald-950/25"
                           : grade === "bust"    ? "bg-red-950/25"
                           : grade === "neutral" ? "bg-slate-800/30"
                           : "";
              return (
                <div key={p.player_id} className={`group grid grid-cols-[2rem_3rem_1fr_5rem_4rem_6rem] gap-2 items-center px-4 py-1.5 ${rowBg}`}>
                  <span className="text-xs text-slate-500">{i + 1}</span>
                  <span className={`text-[10px] font-bold ${posColor[p.position] || "text-slate-400"}`}>{p.position}</span>
                  <div className="min-w-0 flex items-center gap-1.5">
                    <span className="text-sm font-medium text-white truncate">{p.name}</span>
                    {p.team && <span className="text-[10px] text-slate-500 shrink-0">{p.team}</span>}
                    <MultiPointSparkline
                      values={(consensusHistory[selectedHistoryYear]?.[p.player_id] ?? []).map((pt) => pt.avg_pick_no)}
                    />
                    {hasCachedRows && supabaseUser && (
                      <button
                        title="Remove from compiled data"
                        onClick={(e) => { e.stopPropagation(); removeCompiledPlayer(selectedHistoryYear, p.player_id); }}
                        className="opacity-0 group-hover:opacity-100 text-[9px] text-slate-600 hover:text-red-400 transition shrink-0 leading-none"
                      >
                        ✕
                      </button>
                    )}
                    <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
                      {(["hit", "neutral", "bust"] as const).map((g) => {
                        const active = grade === g;
                        const activeCls =
                          g === "hit"     ? "border-emerald-600 bg-emerald-800/70 text-emerald-300"
                          : g === "neutral" ? "border-slate-500 bg-slate-700 text-slate-200"
                          :                   "border-red-600 bg-red-800/70 text-red-300";
                        return (
                          <button
                            key={g}
                            title={g.charAt(0).toUpperCase() + g.slice(1)}
                            onClick={(e) => { e.stopPropagation(); setGrade(selectedHistoryYear, p.player_id, g); }}
                            className={`text-[9px] font-bold px-1 py-0.5 rounded border transition ${
                              active
                                ? activeCls
                                : "border-slate-800 text-slate-700 hover:border-slate-600 hover:text-slate-500 bg-transparent"
                            }`}
                          >
                            {g === "hit" ? "H" : g === "neutral" ? "N" : "B"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-white">{toPickSlot(p.avgPickNo)}</span>
                  <span className="text-xs text-slate-400">{p.draftCount}x</span>
                  <span className={`text-xs font-semibold text-right ${color}`}>{equivLabel}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
