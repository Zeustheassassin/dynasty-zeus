"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { POS_COLOR } from "../../lib/uiTheme";

const log = logger("components/scouting/RecruitStatsTab");

// Positions surfaced in the table. CFD has many more (EDGE, OT, IOL, S, CB, LB, DL, K, P, LS)
// but these are the fantasy-relevant ones. Order is locked so the table reads consistently.
const POSITIONS = ["QB", "RB", "WR", "TE", "ATH"] as const;
const STAR_TIERS = [5, 4] as const;

// Older 247 classes (≤2020) used finer-grained position labels that the modern
// data does not. Roll them up so QB and RB rows include those legacy buckets.
//   DUAL (dual-threat QB), PRO (pro-style QB) → QB
//   APB  (all-purpose back)                   → RB
const POSITION_ALIASES: Record<string, string> = {
  DUAL: "QB",
  PRO:  "QB",
  APB:  "RB",
};

const STAR_TIER_COLORS: Record<number, string> = {
  5: "text-yellow-400",
  4: "text-amber-300",
};

interface SummaryRow {
  year: number;
  position: string;
  stars: number;
  count: number;
}

interface MetaRow {
  year: number;
  total_records: number;
  last_refreshed_at: string;
}

export default function RecruitStatsTab() {
  const [stats, setStats]     = useState<SummaryRow[]>([]);
  const [years, setYears]     = useState<number[]>([]);
  const [meta, setMeta]       = useState<Record<number, MetaRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [statsRes, metaRes] = await Promise.all([
          supabase
            .from("recruits_position_stars_summary")
            .select("year,position,stars,count"),
          supabase
            .from("recruits_meta")
            .select("year,total_records,last_refreshed_at")
            .order("year", { ascending: true }),
        ]);
        if (cancelled) return;
        if (statsRes.error) throw new Error(statsRes.error.message);
        if (metaRes.error)  throw new Error(metaRes.error.message);

        const metaRows = (metaRes.data ?? []) as MetaRow[];
        const metaByYear: Record<number, MetaRow> = {};
        metaRows.forEach((m) => { metaByYear[m.year] = m; });

        setStats((statsRes.data ?? []) as SummaryRow[]);
        setMeta(metaByYear);
        setYears(metaRows.map((m) => m.year));
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        log.error("recruit stats load failed", { err: msg });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Pivot stats into a [position][stars][year] lookup. Raw labels are rolled up
  // via POSITION_ALIASES, so multiple source rows can land in the same bucket
  // (e.g. DUAL + PRO → QB) and must be summed rather than assigned.
  const grid = useMemo(() => {
    const g: Record<string, Record<number, Record<number, number>>> = {};
    for (const row of stats) {
      const pos = POSITION_ALIASES[row.position] ?? row.position;
      if (!g[pos]) g[pos] = {};
      if (!g[pos][row.stars]) g[pos][row.stars] = {};
      g[pos][row.stars][row.year] = (g[pos][row.stars][row.year] ?? 0) + row.count;
    }
    return g;
  }, [stats]);

  // Per-year totals across the displayed positions+tiers (footer row).
  const yearTotals = useMemo(() => {
    const t: Record<number, number> = {};
    for (const y of years) {
      let sum = 0;
      for (const pos of POSITIONS) for (const s of STAR_TIERS) {
        sum += grid[pos]?.[s]?.[y] ?? 0;
      }
      t[y] = sum;
    }
    return t;
  }, [grid, years]);

  if (loading) {
    return <div className="text-slate-500 text-sm py-12 text-center">Loading recruit statistics…</div>;
  }
  if (error) {
    return (
      <div className="px-3 py-2 bg-red-900/30 border border-red-800 rounded text-red-300 text-xs">
        {error}
      </div>
    );
  }
  if (years.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400 text-sm font-medium">No recruit data cached yet.</p>
        <p className="text-slate-600 text-xs mt-1">
          Open the <span className="text-indigo-400 font-semibold">Recruits</span> tab and refresh a few years to populate this table.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-white">Recruit Statistics</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Counts of 4★ and 5★ recruits by position, per class year. Source: 247 Composite via CollegeFootballData.
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-slate-800">
        <table className="text-xs border-collapse" style={{ minWidth: "max-content" }}>
          <thead className="bg-slate-950 border-b border-slate-700">
            <tr>
              <th className="px-3 py-2 text-left text-slate-500 font-semibold uppercase tracking-wide sticky left-0 bg-slate-950 z-10 border-r border-slate-800">
                Position
              </th>
              {years.map((y) => (
                <th
                  key={y}
                  className="px-3 py-2 text-center text-slate-400 font-semibold whitespace-nowrap min-w-[60px]"
                  title={`${meta[y]?.total_records ?? 0} total recruits cached for ${y}`}
                >
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-900">
            {POSITIONS.flatMap((pos) =>
              STAR_TIERS.map((stars, i) => {
                const isLastTier = i === STAR_TIERS.length - 1;
                return (
                  <tr key={`${pos}-${stars}`} className={isLastTier ? "border-b border-slate-800" : ""}>
                    <td className={`px-3 py-1.5 sticky left-0 bg-slate-950 z-10 border-r border-slate-800 font-medium whitespace-nowrap`}>
                      <span className={POS_COLOR[pos] ?? "text-slate-400"}>{pos}</span>
                      <span className={`ml-1 ${STAR_TIER_COLORS[stars]}`}>{stars}★</span>
                    </td>
                    {years.map((y) => {
                      const v = grid[pos]?.[stars]?.[y] ?? 0;
                      return (
                        <td
                          key={y}
                          className={`px-3 py-1.5 text-center font-mono ${
                            v === 0 ? "text-slate-700" : "text-slate-200"
                          }`}
                        >
                          {v || "—"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
            {/* Totals footer */}
            <tr className="border-t-2 border-blue-800/60 bg-slate-900/50">
              <td className="px-3 py-2 sticky left-0 bg-slate-900 z-10 border-r border-slate-800 font-bold text-blue-300">
                Total (shown)
              </td>
              {years.map((y) => (
                <td key={y} className="px-3 py-2 text-center font-bold font-mono text-blue-300">
                  {yearTotals[y] || "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-slate-600">
        Hover a year header to see the total cached recruits for that class. Years missing here haven&apos;t been refreshed yet.
      </p>
    </div>
  );
}
