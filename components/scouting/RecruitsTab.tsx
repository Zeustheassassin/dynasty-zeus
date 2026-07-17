"use client";
import { useState, useMemo } from "react";
import { useRecruits } from "../../hooks/useRecruits";
import type { RecruitRow } from "../../lib/recruiting/cfd";

const YEAR_MIN = 2017;
const YEAR_MAX = new Date().getFullYear() + 1;
const ALL_YEARS = Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => YEAR_MAX - i);

const POSITION_COLORS: Record<string, string> = {
  QB:   "text-blue-400",
  RB:   "text-green-400",
  WR:   "text-yellow-400",
  TE:   "text-orange-400",
  EDGE: "text-purple-400",
  ATH:  "text-pink-400",
};

const STAR_COLORS: Record<number, string> = {
  5: "text-yellow-400",
  4: "text-amber-300",
  3: "text-slate-400",
  2: "text-slate-500",
};

type SortKey = "ranking" | "stars" | "rating" | "name" | "school" | "committed_to" | "position";
type SortDir = "asc" | "desc";

export default function RecruitsTab() {
  const [year, setYear] = useState<number>(YEAR_MAX - 1); // default to last completed class
  const { recruits, meta, loading, refreshing, error, refresh } = useRecruits(year);

  // Filters
  const [search, setSearch]               = useState("");
  const [positionFilter, setPositionFilter] = useState<string | null>(null);
  const [starsFilter, setStarsFilter]       = useState<number | null>(null);
  const [commitFilter, setCommitFilter]     = useState<"all" | "committed" | "uncommitted">("all");
  const [sortKey, setSortKey]               = useState<SortKey>("ranking");
  const [sortDir, setSortDir]               = useState<SortDir>("asc");

  const positions = useMemo(() => {
    const set = new Set<string>();
    recruits.forEach((r) => { if (r.position) set.add(r.position); });
    return Array.from(set).sort();
  }, [recruits]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = recruits.filter((r) => {
      if (positionFilter && r.position !== positionFilter) return false;
      if (starsFilter != null && r.stars !== starsFilter) return false;
      if (commitFilter === "committed" && !r.committed_to) return false;
      if (commitFilter === "uncommitted" && r.committed_to) return false;
      if (q) {
        const hay = `${r.name} ${r.school ?? ""} ${r.committed_to ?? ""} ${r.city ?? ""} ${r.state_province ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls always last
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return list;
  }, [recruits, positionFilter, starsFilter, commitFilter, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" || key === "school" ? "asc" : "asc"); }
  }

  function th(label: string, key: SortKey, cls = "") {
    const active = sortKey === key;
    return (
      <th
        onClick={() => toggleSort(key)}
        className={`px-2 py-1.5 text-left whitespace-nowrap cursor-pointer hover:text-white transition select-none ${
          active ? "text-blue-400" : "text-slate-400"
        } ${cls}`}
      >
        {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const lastRefreshed = meta?.last_refreshed_at
    ? new Date(meta.last_refreshed_at).toLocaleString(undefined, {
        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
      })
    : null;

  return (
    <div className="space-y-3">
      {/* Header: year picker + refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 uppercase tracking-wide">Class</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
          >
            {ALL_YEARS.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs font-semibold rounded transition"
          title="Pulls a fresh class from CollegeFootballData (counts against the monthly API budget)"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh from CFD"}
        </button>

        <div className="text-xs text-slate-500">
          {lastRefreshed
            ? <>Cached {lastRefreshed} · {meta?.total_records ?? 0} recruits</>
            : error
              ? null  /* error banner already explains; suppress the misleading "click Refresh" hint */
              : <>No cache yet — click Refresh to load this class</>}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search name / school / commit / city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-1.5 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
        />

        <div className="flex items-center gap-1">
          {[5, 4, 3].map((s) => (
            <button
              key={s}
              onClick={() => setStarsFilter(starsFilter === s ? null : s)}
              className={`text-xs font-bold px-2 py-1 rounded border transition ${
                starsFilter === s
                  ? "bg-yellow-500/20 border-yellow-500 text-yellow-300"
                  : "border-slate-700 text-slate-500 hover:text-white"
              }`}
            >
              {s}★
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {(["all", "committed", "uncommitted"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCommitFilter(c)}
              className={`text-xs font-medium px-2 py-1 rounded border transition capitalize ${
                commitFilter === c
                  ? "bg-blue-600 border-blue-500 text-white"
                  : "border-slate-700 text-slate-500 hover:text-white"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Position pills */}
      {positions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setPositionFilter(null)}
            className={`text-[11px] font-bold px-2.5 py-1 rounded border transition ${
              positionFilter === null
                ? "bg-slate-700 border-slate-500 text-white"
                : "border-slate-700 text-slate-500 hover:text-white"
            }`}
          >
            ALL
          </button>
          {positions.map((pos) => (
            <button
              key={pos}
              onClick={() => setPositionFilter(positionFilter === pos ? null : pos)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded border transition ${
                positionFilter === pos
                  ? `${POSITION_COLORS[pos] || "text-slate-300"} border-current`
                  : "border-slate-700 text-slate-500 hover:text-white"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      )}

      {/* Results count */}
      <div className="text-xs text-slate-600">
        {loading
          ? "Loading…"
          : `Showing ${filtered.length} of ${recruits.length} recruits`}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="w-full text-xs border-collapse">
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr>
              {th("Rank", "ranking", "w-16")}
              {th("Name", "name")}
              {th("Pos", "position", "w-14")}
              {th("★", "stars", "w-12 text-center")}
              {th("Rating", "rating", "w-20")}
              {th("School", "school")}
              {th("Commit", "committed_to")}
              <th className="px-2 py-1.5 text-left text-slate-400">Hometown</th>
              <th className="px-2 py-1.5 text-left text-slate-400 w-20">Ht/Wt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-center text-slate-500">
                  {recruits.length === 0
                    ? error
                      ? "—"  /* error banner above already explains; don't suggest Refresh again */
                      : "No recruits cached for this year. Click Refresh to load from CFD."
                    : "No recruits match your filters."}
                </td>
              </tr>
            )}
            {filtered.map((r, i) => (
              <tr key={r.id} className={i % 2 === 0 ? "bg-slate-950" : "bg-slate-900/40"}>
                <td className="px-2 py-1.5 text-blue-400 font-mono text-[11px]">
                  {r.ranking ? `#${r.ranking}` : "—"}
                </td>
                <td className="px-2 py-1.5 text-white font-medium">{r.name}</td>
                <td className={`px-2 py-1.5 font-bold ${POSITION_COLORS[r.position ?? ""] ?? "text-slate-400"}`}>
                  {r.position ?? "—"}
                </td>
                <td className={`px-2 py-1.5 text-center font-bold ${STAR_COLORS[r.stars ?? 0] ?? "text-slate-600"}`}>
                  {r.stars ? r.stars : "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-300 font-mono">
                  {r.rating != null ? r.rating.toFixed(4) : "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-400 truncate max-w-[200px]">{r.school || "—"}</td>
                <td className="px-2 py-1.5 text-slate-300 truncate max-w-[160px]">
                  {r.committed_to || <span className="text-slate-600 italic">uncommitted</span>}
                </td>
                <td className="px-2 py-1.5 text-slate-500 truncate max-w-[160px]">
                  {[r.city, r.state_province].filter(Boolean).join(", ") || "—"}
                </td>
                <td className="px-2 py-1.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                  {formatHt(r.height)} / {r.weight ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Convert decimal inches (75.5) → 6'3.5" style. */
function formatHt(inches: number | null): string {
  if (inches == null) return "—";
  const ft = Math.floor(inches / 12);
  const inRemainder = inches - ft * 12;
  const inDisplay = inRemainder % 1 === 0 ? String(inRemainder) : inRemainder.toFixed(1);
  return `${ft}'${inDisplay}"`;
}

// Suppress unused-warning for type re-export (intentional API surface).
export type { RecruitRow };
