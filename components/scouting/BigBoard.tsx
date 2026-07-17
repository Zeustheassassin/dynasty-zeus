"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import type { ProspectWithStats, Prospect, RouteType, ScoutingGame, RBPlay, QBPlay, TEPlay } from "../../lib/types";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import {
  computeRBAboveExpected,
  computeQBAboveExpected,
  computeTERouteAboveExpected,
} from "../../lib/scouting/aboveExpected";
import { POS_COLOR } from "../../lib/uiTheme";

type LoadPositionPlaysFn = (pos: "RB" | "QB" | "TE") => void;

// NFL Draft column is a per-prospect projected round (1st–7th).
const DRAFT_ROUNDS = [1, 2, 3, 4, 5, 6, 7];
const ROUND_LABEL: Record<number, string> = {
  1: "1st", 2: "2nd", 3: "3rd", 4: "4th", 5: "5th", 6: "6th", 7: "7th",
};

type BoardTab = "all" | "QB" | "RB" | "WR" | "TE";

type SortKey =
  | "personal_rank" | "overall_rank" | "name" | "school" | "conference" | "draft_class_year" | "height" | "weight" | "age" | "position"
  | "total_routes" | "total_games" | "targets" | "catches" | "drops" | "contested" | "contested_catches"
  | "success_rate" | "target_rate" | "adj_success_above_exp" | "above_expected"
  | "pct_left" | "pct_right" | "pct_slot" | "pct_backfield"
  | "depth_behind_los" | "depth_on_los" | "total_snaps"
  | "cvg_man" | "cvg_man_catch" | "cvg_zone" | "cvg_zone_catch"
  | "cvg_double" | "cvg_double_catch" | "cvg_press" | "cvg_press_catch"
  | `rt_${RouteType}_count` | `rt_${RouteType}_targets` | `rt_${RouteType}_catches` | `rt_${RouteType}_rate`
  | "cvg_man_rate" | "cvg_zone_rate" | "cvg_press_rate"
  | "open_pct_slot" | "open_pct_slot_on" | "open_pct_slot_off"
  | "open_pct_right" | "open_pct_right_on" | "open_pct_right_off"
  | "open_pct_left" | "open_pct_left_on" | "open_pct_left_off"
  | "open_pct_backfield"
;

interface Props {
  prospects: ProspectWithStats[];
  loading: boolean;
  onSelectProspect: (p: Prospect) => void;
  onUpdateRank: (id: string, rank: number) => Promise<void>;
  onUpdateOverallRank: (id: string, rank: number) => Promise<void>;
  draftYearFilter: number | null;
  setDraftYearFilter: (y: number | null) => void;
  // Raw plays + games are lazy-loaded by ScoutingHub. The board triggers
  // load via loadPositionPlays on mount and uses the resulting plays to
  // compute the unified Above-Expected metric (AAE / SRAE / SAE / TE-SAER).
  games: ScoutingGame[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  loadPositionPlays: LoadPositionPlaysFn;
}

function computeAge(birthday: string | null | undefined): number | null {
  if (!birthday) return null;
  const b = new Date(birthday);
  if (isNaN(b.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - b.getFullYear();
  if (today < new Date(today.getFullYear(), b.getMonth(), b.getDate())) age--;
  return age;
}

function getSortValue(
  p: ProspectWithStats,
  key: SortKey,
  aboveExpMap?: Map<string, number | null>,
): number | string {
  const BIG = 99999;
  if (key === "personal_rank") return p.personal_rank ?? BIG;
  if (key === "overall_rank") return p.overall_rank ?? BIG;
  if (key === "name") return p.name;
  if (key === "above_expected") return aboveExpMap?.get(p.id) ?? -BIG;
  if (key === "school") return p.school;
  if (key === "conference") return p.conference ?? "";
  if (key === "position") return p.position;
  if (key === "draft_class_year") return p.draft_class_year;
  if (key === "height") return p.height || "ZZZ";
  if (key === "weight") return p.weight ?? BIG;
  if (key === "age") return computeAge(p.birthday) ?? BIG;
  if (key === "total_routes") return p.total_routes;
  if (key === "total_games") return p.total_games;
  if (key === "targets") return p.targets;
  if (key === "catches") return p.catches;
  if (key === "drops") return p.drops;
  if (key === "contested") return p.contested;
  if (key === "contested_catches") return p.contested_catches;
  if (key === "success_rate") return p.success_rate ?? -BIG;
  if (key === "target_rate") return p.target_rate ?? -BIG;
  if (key === "adj_success_above_exp") return p.adj_success_above_exp ?? -BIG;
  if (key === "pct_left") return p.pct_left ?? -BIG;
  if (key === "pct_right") return p.pct_right ?? -BIG;
  if (key === "pct_slot") return p.pct_slot ?? -BIG;
  if (key === "pct_backfield") return p.pct_backfield ?? -BIG;
  if (key === "depth_behind_los") return p.depth_behind_los;
  if (key === "depth_on_los") return p.depth_on_los;
  if (key === "total_snaps") return p.total_routes;
  if (key === "cvg_man") return p.coverage_stats.man.count;
  if (key === "cvg_man_catch") return p.coverage_stats.man.catches;
  if (key === "cvg_zone") return p.coverage_stats.zone.count;
  if (key === "cvg_zone_catch") return p.coverage_stats.zone.catches;
  if (key === "cvg_double") return p.coverage_stats.double.count;
  if (key === "cvg_double_catch") return p.coverage_stats.double.catches;
  if (key === "cvg_press") return p.coverage_stats.press.count;
  if (key === "cvg_press_catch") return p.coverage_stats.press.catches;
  if (key === "cvg_man_rate") { const s = p.coverage_stats.man; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "cvg_zone_rate") { const s = p.coverage_stats.zone; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "cvg_press_rate") { const s = p.coverage_stats.press; return s.count > 0 ? s.open / s.count : -BIG; }
  if (key === "open_pct_slot") return p.open_pct_slot ?? -BIG;
  if (key === "open_pct_slot_on") return p.open_pct_slot_on_line ?? -BIG;
  if (key === "open_pct_slot_off") return p.open_pct_slot_off_line ?? -BIG;
  if (key === "open_pct_right") return p.open_pct_right ?? -BIG;
  if (key === "open_pct_right_on") return p.open_pct_right_on_line ?? -BIG;
  if (key === "open_pct_right_off") return p.open_pct_right_off_line ?? -BIG;
  if (key === "open_pct_left") return p.open_pct_left ?? -BIG;
  if (key === "open_pct_left_on") return p.open_pct_left_on_line ?? -BIG;
  if (key === "open_pct_left_off") return p.open_pct_left_off_line ?? -BIG;
  if (key === "open_pct_backfield") return p.open_pct_backfield ?? -BIG;
  if (key.startsWith("rt_")) {
    const parts = key.split("_");
    const stat = parts[parts.length - 1] as "count" | "targets" | "catches" | "rate";
    const rt = parts.slice(1, -1).join("_") as RouteType;
    if (stat === "rate") { const rs = p.route_stats[rt]; return rs && rs.count > 0 ? rs.open / rs.count : -BIG; }
    return p.route_stats[rt]?.[stat as "count" | "targets" | "catches"] ?? 0;
  }
  return 0;
}

export default function BigBoard({
  prospects,
  loading,
  onSelectProspect,
  onUpdateRank,
  onUpdateOverallRank,
  draftYearFilter,
  setDraftYearFilter,
  games,
  rbPlays,
  qbPlays,
  tePlays,
  loadPositionPlays,
}: Props) {
  // Trigger lazy load of all three position plays the first time the
  // board renders. ScoutingHub no-ops if a position is already loaded
  // for the current games key, so this is safe to call repeatedly.
  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);

  // Unified Above-Expected map: AAE for QB, SRAE for RB, TE-SAER for TE
  // (route-running variant; TE-SAEB blocking lives only on the TE stats
  // table), and the pre-aggregated WR adj_success_above_exp for WR.
  // Returns null for any prospect under the per-position min-sample threshold.
  const aboveExpectedMap = useMemo(() => {
    const m = new Map<string, number | null>();
    const rb = computeRBAboveExpected(prospects, games, rbPlays);
    const qb = computeQBAboveExpected(prospects, games, qbPlays);
    const te = computeTERouteAboveExpected(prospects, games, tePlays);
    for (const [id, v] of rb) m.set(id, v);
    for (const [id, v] of qb) m.set(id, v);
    for (const [id, v] of te) m.set(id, v);
    for (const p of prospects) {
      if (p.position === "WR") m.set(p.id, p.adj_success_above_exp);
    }
    return m;
  }, [prospects, games, rbPlays, qbPlays, tePlays]);

  const [boardTab, setBoardTab] = useState<BoardTab>("all");
  // All board sorts by overall_rank; position boards sort by personal_rank
  const [sortKey, setSortKey] = useState<SortKey>("overall_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const [editingRankId, setEditingRankId] = useState<string | null>(null);
  const [rankInput, setRankInput] = useState("");
  const [savingRankId, setSavingRankId] = useState<string | null>(null);

  // Projected NFL draft round (1–7) per prospect, persisted to localStorage.
  // Migrates rounds out of the legacy {team,round,pick} "nflDraftInfo" map so
  // any previously-entered rounds carry over to the new round-only column.
  const [draftRound, setDraftRound] = useState<Record<string, number>>(() => {
    const direct = getLocalStorageItem<Record<string, number>>("nflDraftRound", {});
    if (Object.keys(direct).length > 0) return direct;
    const legacy = getLocalStorageItem<Record<string, { round?: number | null }>>("nflDraftInfo", {});
    const migrated: Record<string, number> = {};
    for (const [id, v] of Object.entries(legacy)) {
      if (v && typeof v.round === "number") migrated[id] = v.round;
    }
    return migrated;
  });

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const dragRankRef = useRef<number | null>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => {
    const s = new Set(prospects.map((p) => p.draft_class_year));
    return Array.from(s).sort((a, b) => a - b);
  }, [prospects]);

  const sorted = useMemo(() => {
    let list = prospects;
    if (boardTab !== "all") list = list.filter((p) => p.position === boardTab);
    if (draftYearFilter) list = list.filter((p) => p.draft_class_year === draftYearFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((p) => p.name.toLowerCase().includes(q) || p.school.toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => {
      const va = getSortValue(a, sortKey, aboveExpectedMap);
      const vb = getSortValue(b, sortKey, aboveExpectedMap);
      if (typeof va === "number" && typeof vb === "number")
        return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [prospects, boardTab, draftYearFilter, search, sortKey, sortDir, aboveExpectedMap]);

  useEffect(() => {
    const table = tableScrollRef.current;
    if (!table || !topSpacerRef.current) return;
    topSpacerRef.current.style.width = `${table.scrollWidth}px`;
    const ro = new ResizeObserver(() => {
      if (topSpacerRef.current) topSpacerRef.current.style.width = `${table.scrollWidth}px`;
    });
    ro.observe(table);
    return () => ro.disconnect();
  }, [sorted]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function th(label: string, key: SortKey, cls = "") {
    const active = sortKey === key;
    return (
      <th
        key={key}
        onClick={() => toggleSort(key)}
        className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none ${
          active ? "text-blue-400" : "text-slate-500"
        } ${cls}`}
      >
        {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  function stickyTh(label: string, key: SortKey, leftPx: number, widthPx: number) {
    const active = sortKey === key;
    return (
      <th
        key={key}
        onClick={() => toggleSort(key)}
        style={{ left: leftPx, minWidth: widthPx, width: widthPx }}
        className={`sticky z-20 bg-slate-950 px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none border-r border-slate-800 ${
          active ? "text-blue-400" : "text-slate-500"
        }`}
      >
        {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
    );
  }

  // ── Above-Expected cell renderer ──────────────────────────────
  // Single column on the All board showing the position-appropriate
  // metric: AAE for QB, SRAE for RB, SAE for WR, TE-SAER for TE.
  // Color-coded green/red on sign; small grey tag identifies which
  // metric the value represents.
  const aboveExpectedLabel = (pos: string): string => {
    if (pos === "QB") return "AAE";
    if (pos === "RB") return "SRAE";
    if (pos === "WR") return "SAE";
    if (pos === "TE") return "TE-SAER";
    return "";
  };
  function aboveExpectedCell(p: ProspectWithStats) {
    const v = aboveExpectedMap.get(p.id);
    if (v == null) {
      return (
        <td className={`${tdBase} text-slate-600 border-r border-slate-800`}>—</td>
      );
    }
    const color = v >= 0 ? "text-emerald-400" : "text-red-400";
    const sign = v >= 0 ? "+" : "";
    return (
      <td className={`${tdBase} border-r border-slate-800 ${color} font-medium`}>
        {sign}{v.toFixed(1)}
        <span className="ml-1 text-[10px] text-slate-500 font-normal">{aboveExpectedLabel(p.position)}</span>
      </td>
    );
  }

  const rankUpdater = boardTab === "all" ? onUpdateOverallRank : onUpdateRank;
  const rankField = (p: ProspectWithStats) => boardTab === "all" ? p.overall_rank : p.personal_rank;

  async function commitRank(id: string) {
    const nr = parseInt(rankInput, 10);
    if (!rankInput || isNaN(nr) || nr < 1) { setEditingRankId(null); return; }
    setSavingRankId(id);
    await rankUpdater(id, nr);
    setSavingRankId(null);
    setEditingRankId(null);
  }

  function setRound(id: string, value: string) {
    const rd = parseInt(value, 10);
    const updated = { ...draftRound };
    if (isNaN(rd)) delete updated[id]; else updated[id] = rd;
    setDraftRound(updated);
    setLocalStorageItem("nflDraftRound", updated);
  }

  // NFL Draft cell: a compact dropdown projecting the round (1st–7th) the
  // player is expected to be picked. "—" clears the projection.
  function draftCell(p: ProspectWithStats) {
    const rd = draftRound[p.id];
    return (
      <td
        className="px-1.5 py-1 text-center whitespace-nowrap border-r border-slate-800"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <select
          aria-label={`Projected NFL draft round for ${p.name}`}
          value={rd ?? ""}
          onChange={(e) => setRound(p.id, e.target.value)}
          className={`bg-slate-950 text-xs rounded px-1 py-0.5 cursor-pointer focus:outline-none border ${
            rd ? "text-indigo-300 font-medium border-indigo-700/50" : "text-slate-600 border-transparent hover:border-slate-700"
          }`}
        >
          <option value="">—</option>
          {DRAFT_ROUNDS.map((r) => (
            <option key={r} value={r}>{ROUND_LABEL[r]}</option>
          ))}
        </select>
      </td>
    );
  }

  async function handleDrop(targetId: string) {
    if (!draggingId || draggingId === targetId) { setDraggingId(null); setDragOverId(null); return; }
    const draggedP = prospects.find((p) => p.id === draggingId);
    const targetP = prospects.find((p) => p.id === targetId);
    if (!draggedP || !targetP) return;
    setSavingRankId(draggingId);
    await rankUpdater(draggingId, rankField(targetP) ?? dragRankRef.current ?? 1);
    setSavingRankId(null);
    setDraggingId(null);
    setDragOverId(null);
  }

  const tdBase = "px-1.5 py-1.5 text-center whitespace-nowrap text-xs";

  // Shared sticky row cells (drag handle + rank + name)
  function stickyRowCells(p: ProspectWithStats) {
    const isSaving = savingRankId === p.id;
    const rank = rankField(p);
    return (
      <>
        <td className="sticky left-0 z-10 bg-slate-950 px-1 text-slate-700 cursor-grab active:cursor-grabbing text-center w-6"
          onClick={(e) => e.stopPropagation()}>⠿</td>
        <td style={{ left: 24, minWidth: 44, width: 44 }}
          className="sticky z-10 bg-slate-950 border-r border-slate-800 text-center"
          onClick={(e) => { e.stopPropagation(); setEditingRankId(p.id); setRankInput(rank ? `${rank}` : ""); }}>
          {editingRankId === p.id ? (
            <input autoFocus type="number" min={1}
              className="w-10 px-0.5 py-0.5 bg-slate-800 border border-blue-500 rounded text-yellow-400 font-bold text-xs focus:outline-none text-center"
              value={rankInput}
              onChange={(e) => setRankInput(e.target.value)}
              onBlur={() => commitRank(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRank(p.id); if (e.key === "Escape") setEditingRankId(null); }}
              onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className={`cursor-text hover:bg-slate-800 px-1 rounded text-yellow-400 font-bold ${isSaving ? "animate-pulse" : ""}`}>
              {rank ? `#${rank}` : "—"}
            </span>
          )}
        </td>
        <td style={{ left: 68, minWidth: 140, width: 140 }}
          className="sticky z-10 bg-slate-950 border-r border-slate-800 px-1.5 py-1.5 text-center text-white font-medium whitespace-nowrap">
          {p.name}
        </td>
      </>
    );
  }

  function rowProps(p: ProspectWithStats, i: number) {
    const isDragging = draggingId === p.id;
    const isDragOver = dragOverId === p.id;
    const rowBg = isDragOver ? "bg-blue-900/30" : i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/30";
    return {
      draggable: true,
      onDragStart: () => { setDraggingId(p.id); dragRankRef.current = rankField(p) ?? i + 1; },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverId(p.id); },
      onDragLeave: () => setDragOverId(null),
      onDrop: () => handleDrop(p.id),
      onDragEnd: () => { setDraggingId(null); setDragOverId(null); },
      onClick: () => onSelectProspect(p),
      className: `cursor-pointer transition hover:bg-slate-800/60 ${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-t-2 border-blue-500" : ""} ${rowBg}`,
    };
  }

  const scrollWrapper = (tableNode: React.ReactNode) => (
    <div className="mx-auto w-fit max-w-full">
      <div
        ref={topScrollRef}
        className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
        onScroll={() => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = topScrollRef.current!.scrollLeft; }}
      >
        <div ref={topSpacerRef} style={{ height: 1 }} />
      </div>
      <div
        ref={tableScrollRef}
        className="overflow-x-auto rounded border border-slate-800 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-slate-900 [&::-webkit-scrollbar-thumb]:bg-slate-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-slate-400"
        onScroll={() => { if (topScrollRef.current) topScrollRef.current.scrollLeft = tableScrollRef.current!.scrollLeft; }}
      >
        {tableNode}
      </div>
    </div>
  );

  // ── Unified board (All + each position tab) ────────────────
  // Every tab shares this layout. The All tab adds a Pos column and ranks by
  // overall_rank (OVR), showing PosRk as a read-only readout; each position tab
  // ranks by personal_rank (POS), showing OVR as the read-only readout. The
  // Above-Exp (AE) column shows on every tab.
  function renderStandardTable() {
    const isAll = boardTab === "all";
    const primaryLabel = isAll ? "OVR" : "POS";
    const primaryKey: SortKey = isAll ? "overall_rank" : "personal_rank";
    const secondaryLabel = isAll ? "PosRk" : "OVR";
    const secondaryGroup = isAll ? "Pos Rank" : "OVR";
    const secondaryKey: SortKey = isAll ? "personal_rank" : "overall_rank";
    const secondaryValue = (p: ProspectWithStats) => (isAll ? p.personal_rank : p.overall_rank);
    const identitySpan = isAll ? 6 : 5; // Pos column shows only on the All tab
    return scrollWrapper(
      <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-slate-700 bg-slate-950">
            <th className="sticky left-0 z-20 bg-slate-950 w-6" />
            <th style={{ left: 24, minWidth: 44 }} className="sticky z-20 bg-slate-950" />
            <th style={{ left: 68, minWidth: 140 }} className="sticky z-20 bg-slate-950 border-r border-slate-800" />
            <th colSpan={1} className="px-2 py-1 text-center text-indigo-900 font-medium border-r border-slate-800">NFL Draft</th>
            <th colSpan={1} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">{secondaryGroup}</th>
            <th colSpan={identitySpan} className="px-2 py-1 text-center text-slate-600 font-medium border-r border-slate-800">Identity</th>
            <th colSpan={1} className="px-2 py-1 text-center text-emerald-900 font-medium border-r border-slate-800">Above Exp</th>
          </tr>
          <tr className="border-b border-slate-800 bg-slate-950">
            <th className="sticky left-0 z-20 bg-slate-950 w-6 text-slate-700 text-center px-1">⠿</th>
            {stickyTh(primaryLabel, primaryKey, 24, 44)}
            {stickyTh("Name", "name", 68, 140)}
            <th className="px-1.5 py-1.5 text-center text-indigo-700 whitespace-nowrap text-xs border-r border-slate-800 select-none">Round</th>
            {th(secondaryLabel, secondaryKey, "border-l border-r border-slate-800 text-slate-400")}
            {isAll && th("Pos", "position", "border-l border-slate-800")}
            {th("School", "school", isAll ? "" : "border-l border-slate-800")}
            {th("Yr", "draft_class_year")}
            {th("Age", "age")}
            {th("Ht", "height")}
            {th("Wt", "weight", "border-r border-slate-800")}
            {th("AE", "above_expected", "border-l border-slate-800 border-r border-slate-800 text-emerald-700")}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-900">
          {sorted.map((p, i) => {
            const age = computeAge(p.birthday);
            const sv = secondaryValue(p);
            return (
              <tr key={p.id} {...rowProps(p, i)}>
                {stickyRowCells(p)}
                {draftCell(p)}
                <td className={`${tdBase} text-slate-500 border-l border-r border-slate-800`}>{sv ? `#${sv}` : "—"}</td>
                {isAll && (
                  <td className={`${tdBase} font-semibold border-l border-slate-800 ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</td>
                )}
                <td className={`${tdBase} text-slate-400 ${isAll ? "" : "border-l border-slate-800"}`}>{p.school}</td>
                <td className={`${tdBase} text-slate-400`}>{p.draft_class_year}</td>
                <td className={`${tdBase} text-slate-400`}>{age ?? "—"}</td>
                <td className={`${tdBase} text-slate-400`}>{p.height || "—"}</td>
                <td className={`${tdBase} text-slate-400 border-r border-slate-800`}>{p.weight ?? "—"}</td>
                {aboveExpectedCell(p)}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const BOARD_TABS: { key: BoardTab; label: string; accent: string }[] = [
    { key: "all",  label: "All",  accent: "border-slate-400 text-slate-300" },
    { key: "QB",   label: "QB",   accent: "border-blue-500 text-blue-400" },
    { key: "RB",   label: "RB",   accent: "border-green-500 text-green-400" },
    { key: "WR",   label: "WR",   accent: "border-yellow-500 text-yellow-400" },
    { key: "TE",   label: "TE",   accent: "border-orange-500 text-orange-400" },
  ];

  return (
    <div>
      {/* Position board tabs */}
      <div className="flex justify-center gap-1 mb-4 border-b border-slate-800">
        {BOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setBoardTab(t.key); setSortKey(t.key === "all" ? "overall_rank" : "personal_rank"); setSortDir("asc"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              boardTab === t.key ? t.accent : "border-transparent text-slate-400 hover:text-white"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-1.5 text-xs text-slate-600">
                {prospects.filter((p) => p.position === t.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
        <input
          className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500 w-48"
          placeholder="Search name / school…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-slate-400">Class:</span>
        <button
          onClick={() => setDraftYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${!draftYearFilter ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
        >All</button>
        {years.map((y) => (
          <button key={y} onClick={() => setDraftYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${draftYearFilter === y ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}
          >{y}</button>
        ))}
        <span className="text-xs text-slate-500">{sorted.length} prospects</span>
      </div>
      <p className="text-xs text-slate-600 mb-2 text-center">Drag rows to reorder · Click rank to edit · Click any column header to sort</p>

      {loading ? (
        <div className="text-slate-500 text-sm text-center py-12">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-slate-500 text-sm text-center py-12">No prospects match your filters.</div>
      ) : (
        renderStandardTable()
      )}
    </div>
  );
}
