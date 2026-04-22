"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import type { ProspectWithStats, Prospect, RouteType } from "../../lib/types";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];

type BoardTab = "all" | "QB" | "RB" | "WR" | "TE";

type SortKey =
  | "personal_rank" | "overall_rank" | "name" | "school" | "conference" | "draft_class_year" | "height" | "weight" | "age" | "position"
  | "total_routes" | "total_games" | "targets" | "catches" | "drops" | "contested" | "contested_catches"
  | "success_rate" | "target_rate" | "adj_success_above_exp"
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
}

function n(v: number | null | undefined): string {
  return v != null ? `${v}` : "—";
}
function pct(v: number | null | undefined): string {
  return v != null ? `${v.toFixed(1)}%` : "—";
}
function sae(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;
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

function getSortValue(p: ProspectWithStats, key: SortKey): number | string {
  const BIG = 99999;
  if (key === "personal_rank") return p.personal_rank ?? BIG;
  if (key === "overall_rank") return p.overall_rank ?? BIG;
  if (key === "name") return p.name;
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
}: Props) {
  const [boardTab, setBoardTab] = useState<BoardTab>("all");
  // All board sorts by overall_rank; position boards sort by personal_rank
  const [sortKey, setSortKey] = useState<SortKey>("overall_rank");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [search, setSearch] = useState("");

  const [editingRankId, setEditingRankId] = useState<string | null>(null);
  const [rankInput, setRankInput] = useState("");
  const [savingRankId, setSavingRankId] = useState<string | null>(null);

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
      const va = getSortValue(a, sortKey);
      const vb = getSortValue(b, sortKey);
      if (typeof va === "number" && typeof vb === "number")
        return sortDir === "asc" ? va - vb : vb - va;
      return sortDir === "asc"
        ? String(va).localeCompare(String(vb))
        : String(vb).localeCompare(String(va));
    });
  }, [prospects, boardTab, draftYearFilter, search, sortKey, sortDir]);

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
          active ? "text-blue-400" : "text-gray-500"
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
        className={`sticky z-20 bg-gray-950 px-1.5 py-1.5 text-left whitespace-nowrap cursor-pointer hover:text-white transition select-none border-r border-gray-800 ${
          active ? "text-blue-400" : "text-gray-500"
        }`}
      >
        {label}{active ? (sortDir === "asc" ? "↑" : "↓") : ""}
      </th>
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
        <td className="sticky left-0 z-10 bg-gray-950 px-1 text-gray-700 cursor-grab active:cursor-grabbing text-center w-6"
          onClick={(e) => e.stopPropagation()}>⠿</td>
        <td style={{ left: 24, minWidth: 44, width: 44 }}
          className="sticky z-10 bg-gray-950 border-r border-gray-800 text-center"
          onClick={(e) => { e.stopPropagation(); setEditingRankId(p.id); setRankInput(rank ? `${rank}` : ""); }}>
          {editingRankId === p.id ? (
            <input autoFocus type="number" min={1}
              className="w-10 px-0.5 py-0.5 bg-gray-800 border border-blue-500 rounded text-yellow-400 font-bold text-xs focus:outline-none text-center"
              value={rankInput}
              onChange={(e) => setRankInput(e.target.value)}
              onBlur={() => commitRank(p.id)}
              onKeyDown={(e) => { if (e.key === "Enter") commitRank(p.id); if (e.key === "Escape") setEditingRankId(null); }}
              onClick={(e) => e.stopPropagation()} />
          ) : (
            <span className={`cursor-text hover:bg-gray-800 px-1 rounded text-yellow-400 font-bold ${isSaving ? "animate-pulse" : ""}`}>
              {rank ? `#${rank}` : "—"}
            </span>
          )}
        </td>
        <td style={{ left: 68, minWidth: 140, width: 140 }}
          className="sticky z-10 bg-gray-950 border-r border-gray-800 px-1.5 py-1.5 text-white font-medium whitespace-nowrap">
          {p.name}
        </td>
      </>
    );
  }

  function rowProps(p: ProspectWithStats, i: number) {
    const isDragging = draggingId === p.id;
    const isDragOver = dragOverId === p.id;
    const rowBg = isDragOver ? "bg-blue-900/30" : i % 2 === 0 ? "bg-gray-950" : "bg-gray-900/30";
    return {
      draggable: true,
      onDragStart: () => { setDraggingId(p.id); dragRankRef.current = rankField(p) ?? i + 1; },
      onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragOverId(p.id); },
      onDragLeave: () => setDragOverId(null),
      onDrop: () => handleDrop(p.id),
      onDragEnd: () => { setDraggingId(null); setDragOverId(null); },
      onClick: () => onSelectProspect(p),
      className: `cursor-pointer transition hover:bg-gray-800/60 ${isDragging ? "opacity-40" : ""} ${isDragOver ? "border-t-2 border-blue-500" : ""} ${rowBg}`,
    };
  }

  const scrollWrapper = (tableNode: React.ReactNode) => (
    <>
      <div
        ref={topScrollRef}
        className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
        onScroll={() => { if (tableScrollRef.current) tableScrollRef.current.scrollLeft = topScrollRef.current!.scrollLeft; }}
      >
        <div ref={topSpacerRef} style={{ height: 1 }} />
      </div>
      <div
        ref={tableScrollRef}
        className="overflow-x-auto rounded border border-gray-800 [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
        onScroll={() => { if (topScrollRef.current) topScrollRef.current.scrollLeft = tableScrollRef.current!.scrollLeft; }}
      >
        {tableNode}
      </div>
    </>
  );

  // ── All board ──────────────────────────────────────────────
  function renderAllTable() {
    return scrollWrapper(
      <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-gray-700 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6" />
            <th style={{ left: 24, minWidth: 44 }} className="sticky z-20 bg-gray-950" />
            <th style={{ left: 68, minWidth: 140 }} className="sticky z-20 bg-gray-950 border-r border-gray-800" />
            <th colSpan={1} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Pos Rank</th>
            <th colSpan={6} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Identity</th>
          </tr>
          <tr className="border-b border-gray-800 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6 text-gray-700 text-center px-1">⠿</th>
            {stickyTh("OVR", "overall_rank", 24, 44)}
            {stickyTh("Name", "name", 68, 140)}
            {th("PosRk", "personal_rank", "border-l border-r border-gray-800 text-gray-400")}
            {th("Pos", "position", "border-l border-gray-800")}
            {th("School", "school")}
            {th("Yr", "draft_class_year")}
            {th("Age", "age")}
            {th("Ht", "height")}
            {th("Wt", "weight", "border-r border-gray-800")}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {sorted.map((p, i) => {
            const age = computeAge(p.birthday);
            const POSITION_COLORS: Record<string, string> = {
              QB: "text-blue-400", RB: "text-green-400", WR: "text-yellow-400", TE: "text-orange-400",
            };
            return (
              <tr key={p.id} {...rowProps(p, i)}>
                {stickyRowCells(p, i)}
                <td className={`${tdBase} text-gray-500 border-l border-r border-gray-800`}>{p.personal_rank ? `#${p.personal_rank}` : "—"}</td>
                <td className={`${tdBase} font-semibold border-l border-gray-800 ${POSITION_COLORS[p.position] ?? "text-gray-400"}`}>{p.position}</td>
                <td className={`${tdBase} text-gray-400`}>{p.school}</td>
                <td className={`${tdBase} text-gray-400`}>{p.draft_class_year}</td>
                <td className={`${tdBase} text-gray-400`}>{age ?? "—"}</td>
                <td className={`${tdBase} text-gray-400`}>{p.height || "—"}</td>
                <td className={`${tdBase} text-gray-400 border-r border-gray-800`}>{p.weight ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── Position stub board (QB / RB / TE) ────────────────────
  function renderPositionStubTable(pos: "QB" | "RB" | "TE") {
    const accentColor = pos === "QB" ? "text-blue-400" : pos === "RB" ? "text-green-400" : "text-orange-400";
    return scrollWrapper(
      <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-gray-700 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6" />
            <th style={{ left: 24, minWidth: 44 }} className="sticky z-20 bg-gray-950" />
            <th style={{ left: 68, minWidth: 140 }} className="sticky z-20 bg-gray-950 border-r border-gray-800" />
            <th colSpan={1} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">OVR</th>
            <th colSpan={6} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Identity</th>
            <th colSpan={1} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Scouting</th>
          </tr>
          <tr className="border-b border-gray-800 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6 text-gray-700 text-center px-1">⠿</th>
            {stickyTh("POS", "personal_rank", 24, 44)}
            {stickyTh("Name", "name", 68, 140)}
            {th("OVR", "overall_rank", "border-l border-r border-gray-800 text-gray-400")}
            {th("School", "school", "border-l border-gray-800")}
            {th("Yr", "draft_class_year")}
            {th("Age", "age")}
            {th("Ht", "height")}
            {th("Wt", "weight")}
            {th("Conf", "conference", "border-r border-gray-800")}
            {th("Games", "total_games", `border-l border-gray-800 border-r border-gray-800 ${accentColor}`)}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {sorted.map((p, i) => {
            const age = computeAge(p.birthday);
            return (
              <tr key={p.id} {...rowProps(p, i)}>
                {stickyRowCells(p, i)}
                <td className={`${tdBase} text-gray-500 border-l border-r border-gray-800`}>{p.overall_rank ? `#${p.overall_rank}` : "—"}</td>
                <td className={`${tdBase} text-gray-400 border-l border-gray-800`}>{p.school}</td>
                <td className={`${tdBase} text-gray-400`}>{p.draft_class_year}</td>
                <td className={`${tdBase} text-gray-400`}>{age ?? "—"}</td>
                <td className={`${tdBase} text-gray-400`}>{p.height || "—"}</td>
                <td className={`${tdBase} text-gray-400`}>{p.weight ?? "—"}</td>
                <td className={`${tdBase} text-gray-500 border-r border-gray-800`}>{p.conference || "—"}</td>
                <td className={`${tdBase} border-l border-r border-gray-800 font-medium ${accentColor}`}>{p.total_games || "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  // ── WR board (full stats) ──────────────────────────────────
  function renderWRTable() {
    return scrollWrapper(
      <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
        <thead>
          <tr className="border-b border-gray-700 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6" />
            <th style={{ left: 24, minWidth: 44 }} className="sticky z-20 bg-gray-950" />
            <th style={{ left: 68, minWidth: 140 }} className="sticky z-20 bg-gray-950 border-r border-gray-800" />
            <th colSpan={1} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">OVR</th>
            <th colSpan={4} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Identity</th>
            <th colSpan={2} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Totals</th>
            <th colSpan={5} className="px-2 py-1 text-center text-yellow-900 font-medium border-r border-gray-800">Targets</th>
            <th colSpan={17} className="px-2 py-1 text-center text-green-900 font-medium border-r border-gray-800">Metrics</th>
            <th colSpan={3} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Depth</th>
            <th colSpan={8} className="px-2 py-1 text-center text-gray-600 font-medium border-r border-gray-800">Aligned</th>
            <th colSpan={10} className="px-2 py-1 text-center text-teal-900 font-medium border-r border-gray-800">Align Open%</th>
            <th colSpan={8} className="px-2 py-1 text-center text-orange-900 font-medium border-r border-gray-800">
              Coverage — Att / Catch
            </th>
            <th colSpan={ROUTE_TYPES.length * 2} className="px-2 py-1 text-center text-blue-900 font-medium border-r border-gray-800">
              Routes by Type — Att / Catch
            </th>
          </tr>
          <tr className="border-b border-gray-800 bg-gray-950">
            <th className="sticky left-0 z-20 bg-gray-950 w-6 text-gray-700 text-center px-1">⠿</th>
            {stickyTh("POS", "personal_rank", 24, 44)}
            {stickyTh("Name", "name", 68, 140)}
            {th("OVR", "overall_rank", "border-l border-r border-gray-800 text-gray-400")}
            {th("School", "school", "border-l border-gray-800")}
            {th("Yr", "draft_class_year")}
            {th("Ht", "height")}
            {th("Wt", "weight", "border-r border-gray-800")}
            {th("Games", "total_games", "border-l border-gray-800")}
            {th("Routes", "total_routes", "border-r border-gray-800")}
            {th("Tgt", "targets", "border-l border-gray-800 text-yellow-500")}
            {th("Rec", "catches", "text-green-400")}
            {th("Drops", "drops", "text-red-400")}
            {th("Cont", "contested", "text-purple-400")}
            {th("ContC", "contested_catches", "text-purple-300 border-r border-gray-800")}
            {th("Tgt%", "target_rate", "border-l border-gray-800")}
            {th("Suc%", "success_rate", "text-green-300")}
            {th("SAE%", "adj_success_above_exp")}
            {th("Man%", "cvg_man_rate", "text-orange-400")}
            {th("Zone%", "cvg_zone_rate", "text-orange-400")}
            {th("Press%", "cvg_press_rate", "text-orange-400")}
            {ROUTE_TYPES.map((rt, i) => (
              <th key={`rt_${rt}_rate`} onClick={() => toggleSort(`rt_${rt}_rate`)}
                className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none capitalize ${i === ROUTE_TYPES.length - 1 ? "border-r border-gray-800" : ""} ${sortKey === `rt_${rt}_rate` ? "text-green-400" : "text-green-800"}`}>
                {rt}{sortKey === `rt_${rt}_rate` ? (sortDir === "asc" ? "↑" : "↓") : ""}%
              </th>
            ))}
            {th("BehindLOS", "depth_behind_los", "border-l border-gray-800")}
            {th("OnLOS", "depth_on_los")}
            {th("Snaps", "total_snaps", "border-r border-gray-800")}
            {th("RWR", "pct_right")}
            <th key="pct_right_pct" onClick={() => toggleSort("pct_right")} className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none text-gray-400 ${sortKey === "pct_right" ? "text-blue-400" : ""}`}>Right%{sortKey === "pct_right" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
            {th("LWR", "pct_left")}
            <th key="pct_left_pct" onClick={() => toggleSort("pct_left")} className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none text-gray-400 ${sortKey === "pct_left" ? "text-blue-400" : ""}`}>Left%{sortKey === "pct_left" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
            {th("Slot", "pct_slot")}
            <th key="pct_slot_pct" onClick={() => toggleSort("pct_slot")} className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none text-gray-400 ${sortKey === "pct_slot" ? "text-blue-400" : ""}`}>Slot%{sortKey === "pct_slot" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
            {th("BF", "pct_backfield")}
            <th key="pct_backfield_pct" onClick={() => toggleSort("pct_backfield")} className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none text-gray-400 border-r border-gray-800 ${sortKey === "pct_backfield" ? "text-blue-400" : ""}`}>BF%{sortKey === "pct_backfield" ? (sortDir === "asc" ? "↑" : "↓") : ""}</th>
            {th("Slot", "open_pct_slot", "border-l border-gray-800 text-teal-400")}
            {th("Slot-On", "open_pct_slot_on", "text-teal-300")}
            {th("Slot-Off", "open_pct_slot_off", "text-teal-300")}
            {th("Right", "open_pct_right", "text-teal-400")}
            {th("R-On", "open_pct_right_on", "text-teal-300")}
            {th("R-Off", "open_pct_right_off", "text-teal-300")}
            {th("Left", "open_pct_left", "text-teal-400")}
            {th("L-On", "open_pct_left_on", "text-teal-300")}
            {th("L-Off", "open_pct_left_off", "text-teal-300")}
            {th("BF%", "open_pct_backfield", "text-teal-400 border-r border-gray-800")}
            {th("Man", "cvg_man", "border-l border-gray-800 text-orange-500")}
            {th("ManC", "cvg_man_catch", "text-orange-300")}
            {th("Zone", "cvg_zone", "text-orange-500")}
            {th("ZoneC", "cvg_zone_catch", "text-orange-300")}
            {th("Dbl", "cvg_double", "text-orange-500")}
            {th("DblC", "cvg_double_catch", "text-orange-300")}
            {th("Press", "cvg_press", "text-orange-500")}
            {th("PressC", "cvg_press_catch", "text-orange-300 border-r border-gray-800")}
            {ROUTE_TYPES.map((rt, i) => [
              <th key={`rt_${rt}_count`} onClick={() => toggleSort(`rt_${rt}_count`)}
                className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none capitalize ${i === 0 ? "border-l border-gray-800" : ""} ${sortKey === `rt_${rt}_count` ? "text-blue-400" : "text-blue-700"}`}>
                {rt}{sortKey === `rt_${rt}_count` ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>,
              <th key={`rt_${rt}_catches`} onClick={() => toggleSort(`rt_${rt}_catches`)}
                className={`px-1.5 py-1.5 text-center whitespace-nowrap cursor-pointer hover:text-white transition select-none border-r border-gray-800 ${sortKey === `rt_${rt}_catches` ? "text-green-400" : "text-blue-900"}`}>
                Rec{sortKey === `rt_${rt}_catches` ? (sortDir === "asc" ? "↑" : "↓") : ""}
              </th>,
            ])}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-900">
          {sorted.map((p, i) => {
            const saeVal = p.adj_success_above_exp;
            return (
              <tr key={p.id} {...rowProps(p, i)}>
                {stickyRowCells(p, i)}
                <td className={`${tdBase} text-gray-500 border-l border-r border-gray-800`}>{p.overall_rank ? `#${p.overall_rank}` : "—"}</td>
                <td className={`${tdBase} text-gray-400 border-l border-gray-800`}>{p.school}</td>
                <td className={`${tdBase} text-gray-400`}>{p.draft_class_year}</td>
                <td className={`${tdBase} text-gray-400`}>{p.height || "—"}</td>
                <td className={`${tdBase} text-gray-400 border-r border-gray-800`}>{p.weight ?? "—"}</td>
                <td className={`${tdBase} text-gray-400 border-l border-gray-800`}>{p.total_games}</td>
                <td className={`${tdBase} text-blue-400 font-medium border-r border-gray-800`}>{p.total_routes}</td>
                <td className={`${tdBase} text-yellow-400 border-l border-gray-800 font-medium`}>{p.targets || "—"}</td>
                <td className={`${tdBase} text-green-400 font-medium`}>{p.catches || "—"}</td>
                <td className={`${tdBase} text-red-400`}>{p.drops || "—"}</td>
                <td className={`${tdBase} text-purple-400`}>{p.contested || "—"}</td>
                <td className={`${tdBase} text-purple-300 border-r border-gray-800`}>{p.contested_catches || "—"}</td>
                <td className={`${tdBase} text-gray-300 border-l border-gray-800`}>{pct(p.target_rate)}</td>
                <td className={`${tdBase} text-green-300`}>{pct(p.success_rate)}</td>
                <td className={`${tdBase} font-medium ${saeVal == null ? "text-gray-500" : saeVal >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {sae(saeVal)}
                </td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.man.count > 0 ? `${Math.round((p.coverage_stats.man.open / p.coverage_stats.man.count) * 100)}%` : "—"}</td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.zone.count > 0 ? `${Math.round((p.coverage_stats.zone.open / p.coverage_stats.zone.count) * 100)}%` : "—"}</td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.press.count > 0 ? `${Math.round((p.coverage_stats.press.open / p.coverage_stats.press.count) * 100)}%` : "—"}</td>
                {ROUTE_TYPES.map((rt, ri) => {
                  const rs = p.route_stats[rt];
                  return (
                    <td key={`rt_${rt}_rate`} className={`${tdBase} text-green-700 ${ri === ROUTE_TYPES.length - 1 ? "border-r border-gray-800" : ""}`}>
                      {rs && rs.count > 0 ? `${Math.round((rs.open / rs.count) * 100)}%` : "—"}
                    </td>
                  );
                })}
                <td className={`${tdBase} text-gray-400 border-l border-gray-800`}>{p.depth_behind_los || "—"}</td>
                <td className={`${tdBase} text-gray-400`}>{p.depth_on_los || "—"}</td>
                <td className={`${tdBase} text-gray-500 border-r border-gray-800`}>{p.total_routes || "—"}</td>
                <td className={`${tdBase} text-gray-400`}>{p.pct_right != null ? `${Math.round((p.pct_right / 100) * p.total_routes)}` : "—"}</td>
                <td className={`${tdBase} text-gray-500`}>{pct(p.pct_right)}</td>
                <td className={`${tdBase} text-gray-400`}>{p.pct_left != null ? `${Math.round((p.pct_left / 100) * p.total_routes)}` : "—"}</td>
                <td className={`${tdBase} text-gray-500`}>{pct(p.pct_left)}</td>
                <td className={`${tdBase} text-gray-400`}>{p.pct_slot != null ? `${Math.round((p.pct_slot / 100) * p.total_routes)}` : "—"}</td>
                <td className={`${tdBase} text-gray-500`}>{pct(p.pct_slot)}</td>
                <td className={`${tdBase} text-gray-400`}>{p.pct_backfield != null ? `${Math.round((p.pct_backfield / 100) * p.total_routes)}` : "—"}</td>
                <td className={`${tdBase} text-gray-500 border-r border-gray-800`}>{pct(p.pct_backfield)}</td>
                <td className={`${tdBase} text-teal-400 border-l border-gray-800`}>{pct(p.open_pct_slot)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_slot_on_line)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_slot_off_line)}</td>
                <td className={`${tdBase} text-teal-400`}>{pct(p.open_pct_right)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_right_on_line)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_right_off_line)}</td>
                <td className={`${tdBase} text-teal-400`}>{pct(p.open_pct_left)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_left_on_line)}</td>
                <td className={`${tdBase} text-teal-300`}>{pct(p.open_pct_left_off_line)}</td>
                <td className={`${tdBase} text-teal-400 border-r border-gray-800`}>{pct(p.open_pct_backfield)}</td>
                <td className={`${tdBase} text-orange-400 border-l border-gray-800`}>{p.coverage_stats.man.count > 0 ? p.coverage_stats.man.count : "—"}</td>
                <td className={`${tdBase} text-orange-200`}>{p.coverage_stats.man.count > 0 && p.coverage_stats.man.catches !== -1 ? n(p.coverage_stats.man.catches) : "—"}</td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.zone.count > 0 ? p.coverage_stats.zone.count : "—"}</td>
                <td className={`${tdBase} text-orange-200`}>{p.coverage_stats.zone.count > 0 && p.coverage_stats.zone.catches !== -1 ? n(p.coverage_stats.zone.catches) : "—"}</td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.double.count > 0 ? p.coverage_stats.double.count : "—"}</td>
                <td className={`${tdBase} text-orange-200`}>{p.coverage_stats.double.count > 0 && p.coverage_stats.double.catches !== -1 ? n(p.coverage_stats.double.catches) : "—"}</td>
                <td className={`${tdBase} text-orange-400`}>{p.coverage_stats.press.count > 0 ? p.coverage_stats.press.count : "—"}</td>
                <td className={`${tdBase} text-orange-200 border-r border-gray-800`}>{p.coverage_stats.press.count > 0 && p.coverage_stats.press.catches !== -1 ? n(p.coverage_stats.press.catches) : "—"}</td>
                {ROUTE_TYPES.map((rt, ri) => {
                  const rs = p.route_stats[rt];
                  return [
                    <td key={`rt_${rt}_count`} className={`${tdBase} ${ri === 0 ? "border-l border-gray-800" : ""} text-gray-300`}>
                      {rs?.count ?? "—"}
                    </td>,
                    <td key={`rt_${rt}_catches`} className={`${tdBase} text-green-300 border-r border-gray-800`}>
                      {rs == null || rs.catches === -1 ? "—" : rs.catches}
                    </td>,
                  ];
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  }

  const BOARD_TABS: { key: BoardTab; label: string; accent: string }[] = [
    { key: "all",  label: "All",  accent: "border-gray-400 text-gray-300" },
    { key: "QB",   label: "QB",   accent: "border-blue-500 text-blue-400" },
    { key: "RB",   label: "RB",   accent: "border-green-500 text-green-400" },
    { key: "WR",   label: "WR",   accent: "border-yellow-500 text-yellow-400" },
    { key: "TE",   label: "TE",   accent: "border-orange-500 text-orange-400" },
  ];

  return (
    <div>
      {/* Position board tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-800">
        {BOARD_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setBoardTab(t.key); setSortKey(t.key === "all" ? "overall_rank" : "personal_rank"); setSortDir("asc"); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              boardTab === t.key ? t.accent : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
            {t.key !== "all" && (
              <span className="ml-1.5 text-xs text-gray-600">
                {prospects.filter((p) => p.position === t.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 w-48"
          placeholder="Search name / school…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-gray-400">Class:</span>
        <button
          onClick={() => setDraftYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${!draftYearFilter ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
        >All</button>
        {years.map((y) => (
          <button key={y} onClick={() => setDraftYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${draftYearFilter === y ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >{y}</button>
        ))}
        <span className="ml-auto text-xs text-gray-500">{sorted.length} prospects · scroll right for full stats →</span>
      </div>
      <p className="text-xs text-gray-600 mb-2">Drag rows to reorder · Click rank to edit · Click any column header to sort</p>

      {loading ? (
        <div className="text-gray-500 text-sm text-center py-12">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12">No prospects match your filters.</div>
      ) : (
        <>
          {boardTab === "all" && renderAllTable()}
          {boardTab === "QB"  && renderPositionStubTable("QB")}
          {boardTab === "RB"  && renderPositionStubTable("RB")}
          {boardTab === "WR"  && renderWRTable()}
          {boardTab === "TE"  && renderPositionStubTable("TE")}
        </>
      )}
    </div>
  );
}
