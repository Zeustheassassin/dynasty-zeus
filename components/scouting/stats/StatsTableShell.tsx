"use client";
import { useRef, useCallback, useState, useEffect, useMemo } from "react";

export interface StatRow {
  id: string;
  name: string;
  [key: string]: number | string | null;
}

export interface ColDef {
  key: string;
  label: string;
  group: string;
  fmt?: "pct" | "count" | "dec1" | "plusMinus" | "name" | "yr";
  sticky?: boolean;
  width?: number;
  /** 1 = higher is better, -1 = lower is better, 0/undefined = no color */
  colorDir?: 1 | -1;
  tooltip?: string;
  /** Fixed value to show in the League footer row instead of the computed mean/total */
  leagueOverride?: number;
  /** For pct / plusMinus columns: row field name holding the denominator (e.g. number of attempts).
   *  When set, the league total is sum(value*weight) / sum(weight), not mean of values.
   *  This produces a true global rate / play-weighted mean instead of average-of-averages. */
  weightBy?: string;
}

interface Props {
  cols: ColDef[];
  rows: StatRow[];
  defaultSortKey?: string;
  defaultSortDir?: "asc" | "desc";
  loading?: boolean;
  draftYearFilter?: number | null;
  onNameClick?: (id: string) => void;
}

export function fmtVal(val: number | string | null, f?: ColDef["fmt"]): string {
  if (val == null) return "—";
  if (typeof val === "string") return val;
  if (isNaN(val)) return "—";
  switch (f) {
    case "pct":       return `${val.toFixed(1)}%`;
    case "count":     return String(Math.round(val));
    case "dec1":      return val.toFixed(1);
    case "plusMinus": return `${val >= 0 ? "+" : ""}${val.toFixed(1)}`;
    case "yr":        return String(Math.round(val));
    default:          return val.toFixed(1);
  }
}

export default function StatsTableShell({
  cols, rows, defaultSortKey, defaultSortDir = "desc", loading, draftYearFilter, onNameClick,
}: Props) {
  const firstDataCol = cols.find((c) => !c.sticky);
  const [sortKey, setSortKey] = useState(defaultSortKey ?? firstDataCol?.key ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [search, setSearch] = useState("");

  const topRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const botRef = useRef<HTMLDivElement>(null);

  const syncScroll = useCallback((src: HTMLDivElement, left: number) => {
    for (const r of [topRef, midRef, botRef]) {
      if (r.current && r.current !== src) r.current.scrollLeft = left;
    }
  }, []);

  useEffect(() => {
    const cleanup: (() => void)[] = [];
    for (const r of [topRef, midRef, botRef]) {
      const el = r.current;
      if (!el) continue;
      const h = () => syncScroll(el, el.scrollLeft);
      el.addEventListener("scroll", h, { passive: true });
      cleanup.push(() => el.removeEventListener("scroll", h));
    }
    return () => cleanup.forEach((f) => f());
  }, [syncScroll]);

  // Filter
  const filtered = rows.filter((r) => {
    if (draftYearFilter && r.yr !== draftYearFilter) return false;
    return !search || (r.name as string).toLowerCase().includes(search.toLowerCase());
  });

  // Sort — nulls always last
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "string" && typeof bv === "string")
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    const diff = (av as number) < (bv as number) ? -1 : 1;
    return sortDir === "asc" ? diff : -diff;
  });

  // Column group metadata
  const groupSpans: { group: string; span: number }[] = [];
  const groupIndexByKey: Record<string, number> = {};
  const firstInGroupKeys = new Set<string>();
  {
    let gIdx = -1;
    let lastGroup = "";
    for (const c of cols) {
      if (c.group !== lastGroup) {
        gIdx++;
        lastGroup = c.group;
        groupSpans.push({ group: c.group, span: 1 });
        firstInGroupKeys.add(c.key);
      } else {
        groupSpans[groupSpans.length - 1].span++;
      }
      groupIndexByKey[c.key] = gIdx;
    }
  }

  // Per-column min/max for span calculation — always from ALL rows so span is stable
  const colRange = useMemo(() => {
    const r: Record<string, { min: number; max: number }> = {};
    for (const c of cols) {
      if (!c.colorDir) continue;
      let min = Infinity, max = -Infinity;
      for (const row of rows) {
        const v = row[c.key];
        if (typeof v === "number" && !isNaN(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      if (min !== Infinity) r[c.key] = { min, max };
    }
    return r;
  }, [cols, rows]);

  // League totals/averages — always computed from ALL rows (true league baseline)
  const leagueTotals = useMemo(() => {
    const result: Record<string, number | null> = {};
    for (const c of cols) {
      if (c.fmt === "yr" || c.fmt === "name" || c.sticky) { result[c.key] = null; continue; }
      if (c.leagueOverride !== undefined) { result[c.key] = c.leagueOverride; continue; }
      // Weighted average for pct / plusMinus columns with a denominator:
      // sum(value*weight) / sum(weight). For pct columns this gives a true global
      // rate; for plusMinus (AAE) columns it gives the play-weighted league mean,
      // which the math guarantees ≈ 0 when every QB's plays feed the baseline.
      // Falls through to plain mean if the denominator field isn't on any row.
      if (c.weightBy && (c.fmt === "pct" || c.fmt === "plusMinus")) {
        let weightedSum = 0;
        let totalWeight = 0;
        for (const row of rows) {
          const pct = row[c.key];
          const weight = row[c.weightBy];
          if (typeof pct === "number" && !isNaN(pct) && typeof weight === "number" && !isNaN(weight) && weight > 0) {
            weightedSum += pct * weight;
            totalWeight += weight;
          }
        }
        if (totalWeight > 0) {
          result[c.key] = parseFloat((weightedSum / totalWeight).toFixed(1));
          continue;
        }
        // fall through to mean fallback
      }
      const vals = rows.map((r) => r[c.key]).filter((v): v is number => typeof v === "number" && !isNaN(v));
      if (vals.length === 0) { result[c.key] = null; continue; }
      if (c.fmt === "count") {
        // Raw count columns: show total
        result[c.key] = vals.reduce((s, v) => s + v, 0);
      } else {
        // Pct / dec1 / plusMinus without a weightBy: fall back to mean
        result[c.key] = parseFloat((vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(1));
      }
    }
    return result;
  }, [cols, rows]);

  function cellColor(c: ColDef, val: number | string | null): string {
    if (!c.colorDir || typeof val !== "number" || isNaN(val)) return "";
    const range = colRange[c.key];
    const avg = leagueTotals[c.key];
    if (!range || range.max === range.min || typeof avg !== "number") return "";
    const span = range.max - range.min;
    const delta = ((val - avg) / span) * c.colorDir;
    if (delta >= 0.2) return "text-green-400";
    if (delta >= 0.05) return "text-emerald-300";
    if (delta <= -0.2) return "text-red-400";
    if (delta <= -0.05) return "text-red-300";
    return "text-gray-200";
  }

  function handleSort(key: string) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  const declaredWidth = cols.reduce((s, c) => s + (c.width ?? 72), 0);

  // Cells use minWidth (soft), so content can push the table wider than the
  // declared total. The top/bottom proxy scrollbars need the *actual* rendered
  // width to scroll all the way to the last column, otherwise rightmost
  // columns get clipped.
  const [actualWidth, setActualWidth] = useState(declaredWidth);
  useEffect(() => {
    const el = midRef.current;
    if (!el) return;
    const update = () => setActualWidth(Math.max(el.scrollWidth, declaredWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const tbl = el.querySelector("table");
    if (tbl) ro.observe(tbl);
    return () => ro.disconnect();
  }, [declaredWidth, cols, rows]);
  const totalWidth = actualWidth;

  // Group separator + alternating tint helpers
  function groupSepClass(key: string): string {
    if (!firstInGroupKeys.has(key)) return "";
    const gIdx = groupIndexByKey[key];
    if (gIdx === 0) return ""; // no separator before Identity group
    return "border-l-2 border-gray-600";
  }

  function thGroupClass(group: string, isFirst: boolean, gIdx: number): string {
    const sep = isFirst && gIdx > 0 ? "border-l-2 border-gray-600" : "";
    const tint = gIdx % 2 === 1 ? "bg-slate-900/80" : "bg-gray-950";
    return `px-2 py-1 text-center text-xs font-semibold uppercase tracking-wide ${
      group === "Raw" ? "text-gray-500" : "text-gray-400"
    } ${sep} ${tint}`;
  }

  return (
    <div className="space-y-2">
      {/* Search bar */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search player..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white placeholder-gray-500 w-52 focus:outline-none focus:border-blue-500"
          aria-label="Search players"
        />
        <span className="text-xs text-gray-500">{sorted.length} player{sorted.length !== 1 ? "s" : ""}</span>
      </div>

      {/* Top scrollbar — proxy that scrolls the middle table div via syncScroll.
          Thin styling matches the bottom proxy so only one visual bar shows on
          each side; the middle div hides its own native scrollbar below. */}
      <div
        ref={topRef}
        className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
        aria-hidden="true"
      >
        <div style={{ width: totalWidth, height: 1 }} />
      </div>

      {/* Table — native scrollbar hidden so the only visible bars are the
          top + bottom proxies, all kept in sync. */}
      <div
        ref={midRef}
        className="overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <table className="border-collapse text-xs" style={{ minWidth: totalWidth }}>
          <thead>
            {/* Group header row */}
            <tr>
              {groupSpans.map(({ group, span }, gi) => (
                <th
                  key={group}
                  colSpan={span}
                  className={thGroupClass(group, true, gi)}
                >
                  {group === "Identity" ? "" : group}
                </th>
              ))}
            </tr>
            {/* Column header row */}
            <tr className="border-y border-gray-700">
              {cols.map((c) => {
                const gIdx = groupIndexByKey[c.key];
                const bgClass = gIdx % 2 === 1 ? "bg-slate-900" : "bg-gray-900";
                return (
                  <th
                    key={c.key}
                    onClick={() => handleSort(c.key)}
                    title={c.tooltip ?? c.label}
                    style={{ minWidth: c.width ?? 72 }}
                    className={[
                      "px-2 py-1.5 text-left font-medium whitespace-nowrap cursor-pointer select-none transition",
                      sortKey === c.key ? "text-blue-400" : "text-gray-400 hover:text-gray-200",
                      c.sticky ? `sticky left-0 z-20 ${bgClass} shadow-[2px_0_4px_rgba(0,0,0,0.5)]` : bgClass,
                      groupSepClass(c.key),
                    ].join(" ")}
                  >
                    {c.label}
                    {sortKey === c.key && (
                      <span className="ml-0.5 text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-10 text-center text-gray-500">
                  Loading stats...
                </td>
              </tr>
            )}
            {!loading && sorted.length === 0 && (
              <tr>
                <td colSpan={cols.length} className="px-4 py-10 text-center text-gray-500">
                  No data
                </td>
              </tr>
            )}
            {!loading && sorted.map((row, ri) => (
              <tr
                key={row.id}
                className={ri % 2 === 0 ? "hover:bg-gray-700/30" : "hover:bg-gray-700/30"}
              >
                {cols.map((c) => {
                  const rawVal = row[c.key];
                  const display = fmtVal(rawVal, c.fmt);
                  const color = typeof rawVal === "number" ? cellColor(c, rawVal) : "";
                  const gIdx = groupIndexByKey[c.key];
                  const baseBg = ri % 2 === 0
                    ? (gIdx % 2 === 1 ? "bg-slate-800/40" : "bg-gray-900/40")
                    : (gIdx % 2 === 1 ? "bg-slate-800/20" : "bg-gray-900/10");
                  return (
                    <td
                      key={c.key}
                      className={[
                        "px-2 py-1.5 whitespace-nowrap",
                        c.sticky
                          ? "sticky left-0 z-10 bg-gray-900 shadow-[2px_0_4px_rgba(0,0,0,0.5)] font-medium text-white"
                          : `${baseBg} ${color || "text-gray-300"}`,
                        groupSepClass(c.key),
                      ].join(" ")}
                    >
                      {c.sticky && onNameClick ? (
                        <button
                          onClick={() => onNameClick(row.id)}
                          className="text-left hover:text-blue-400 transition-colors"
                        >
                          {display}
                        </button>
                      ) : display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          {/* League totals footer */}
          {!loading && rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-blue-800/60">
                {cols.map((c) => {
                  const val = leagueTotals[c.key];
                  const isName = c.sticky;
                  const isCount = c.fmt === "count";
                  const display = isName
                    ? "League"
                    : c.fmt === "yr"
                    ? "—"
                    : fmtVal(val, c.fmt);
                  const label = isCount && !isName ? "total" : "";
                  const gIdx = groupIndexByKey[c.key];
                  const bgClass = gIdx % 2 === 1 ? "bg-slate-900/80" : "bg-gray-900/60";
                  return (
                    <td
                      key={c.key}
                      title={label}
                      className={[
                        "px-2 py-2 whitespace-nowrap font-semibold",
                        c.sticky
                          ? "sticky left-0 z-10 bg-gray-900 text-blue-300 shadow-[2px_0_4px_rgba(0,0,0,0.5)]"
                          : `${bgClass} text-blue-300/80`,
                        groupSepClass(c.key),
                      ].join(" ")}
                    >
                      {display}
                      {label && <span className="ml-0.5 text-blue-400/40 text-[10px]">Σ</span>}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Bottom scrollbar — same thin styling as the top proxy. */}
      <div
        ref={botRef}
        className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-gray-900 [&::-webkit-scrollbar-thumb]:bg-gray-600 [&::-webkit-scrollbar-thumb]:rounded hover:[&::-webkit-scrollbar-thumb]:bg-gray-400"
        aria-hidden="true"
      >
        <div style={{ width: totalWidth, height: 1 }} />
      </div>
    </div>
  );
}
