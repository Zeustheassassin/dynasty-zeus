"use client";
import { useState, useEffect, useMemo } from "react";
import type {
  ScoutingGame,
  Prospect,
  ProspectWithStats,
  RBPlay,
  QBPlay,
  TEPlay,
} from "../../lib/types";
import type { GameSnapStatsRow, LoadPositionPlaysFn } from "../ScoutingHub";
import {
  computeRBAboveExpected,
  computeQBAboveExpected,
  computeTEAboveExpected,
} from "../../lib/scouting/aboveExpected";

type SortKey = "player" | "school" | "season_year" | "opponent" | "game_type" | "snaps" | "above_exp";

function Th({ label, k, sortKey, sortDir, onToggle }: {
  label: string; k: SortKey; sortKey: SortKey; sortDir: "asc" | "desc";
  onToggle: (k: SortKey) => void;
}) {
  const active = sortKey === k;
  return (
    <th
      className={`px-3 py-2 text-left text-xs whitespace-nowrap cursor-pointer hover:text-white transition ${active ? "text-blue-400" : "text-gray-500"}`}
      onClick={() => onToggle(k)}
    >
      {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
    </th>
  );
}

interface Props {
  games: ScoutingGame[];
  gameSnapStats: GameSnapStatsRow[];
  prospects: ProspectWithStats[];
  rbPlays: RBPlay[];
  qbPlays: QBPlay[];
  tePlays: TEPlay[];
  loadPositionPlays: LoadPositionPlaysFn;
  loading: boolean;
  onSelectProspect: (p: ProspectWithStats) => void;
}

// Above Expected metric label per position. WR=SAE, RB=SRAE, QB=AAE, TE=TE-SAE.
function aboveExpectedLabel(position: string | null | undefined): string {
  switch (position) {
    case "WR": return "SAE";
    case "RB": return "SRAE";
    case "QB": return "AAE";
    case "TE": return "TE-SAE";
    default: return "—";
  }
}

export default function GamesLog({
  games, gameSnapStats, prospects, rbPlays, qbPlays, tePlays,
  loadPositionPlays, loading, onSelectProspect,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("season_year");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(null);

  // Trigger lazy fetches for all three non-WR positions when this tab
  // mounts. Idempotent — if AnalysisHub already fetched them this session
  // the calls no-op via the parent's cache check.
  useEffect(() => {
    loadPositionPlays("RB");
    loadPositionPlays("QB");
    loadPositionPlays("TE");
  }, [loadPositionPlays]);

  const prospectMap = useMemo(() => {
    const m: Record<string, ProspectWithStats> = {};
    for (const p of prospects) m[p.id] = p;
    return m;
  }, [prospects]);

  const snapsByGame = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of gameSnapStats) m[r.game_id] = r.snaps_charted;
    return m;
  }, [gameSnapStats]);

  // Above Expected per prospect — position-aware. WR comes from
  // ProspectWithStats.adj_success_above_exp (already computed by the
  // server-side aggregate path). RB/QB/TE come from the lazy-loaded raw
  // plays (same math as the Analysis tab — see lib/scouting/aboveExpected.ts).
  const aboveExpectedByProspect = useMemo(() => {
    const m = new Map<string, number | null>();
    const prospectList: Prospect[] = prospects;
    for (const p of prospects) {
      if (p.position === "WR") m.set(p.id, p.adj_success_above_exp ?? null);
    }
    const rb = computeRBAboveExpected(prospectList, games, rbPlays);
    const qb = computeQBAboveExpected(prospectList, games, qbPlays);
    const te = computeTEAboveExpected(prospectList, games, tePlays);
    for (const [id, v] of rb) m.set(id, v);
    for (const [id, v] of qb) m.set(id, v);
    for (const [id, v] of te) m.set(id, v);
    return m;
  }, [prospects, games, rbPlays, qbPlays, tePlays]);

  const years = useMemo(() => {
    const s = new Set(games.map((g) => g.season_year));
    return Array.from(s).sort((a, b) => b - a);
  }, [games]);

  const rows = useMemo(() => {
    let list = games;
    if (yearFilter) list = list.filter((g) => g.season_year === yearFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => {
        const p = prospectMap[g.prospect_id];
        return (
          g.opponent.toLowerCase().includes(q) ||
          p?.name.toLowerCase().includes(q) ||
          p?.school.toLowerCase().includes(q)
        );
      });
    }
    list = [...list].sort((a, b) => {
      const pa = prospectMap[a.prospect_id];
      const pb = prospectMap[b.prospect_id];
      const aeA = aboveExpectedByProspect.get(a.prospect_id);
      const aeB = aboveExpectedByProspect.get(b.prospect_id);

      let va: string | number = 0;
      let vb: string | number = 0;
      if (sortKey === "player") { va = pa?.name ?? ""; vb = pb?.name ?? ""; }
      else if (sortKey === "school") { va = pa?.school ?? ""; vb = pb?.school ?? ""; }
      else if (sortKey === "season_year") { va = a.season_year; vb = b.season_year; }
      else if (sortKey === "opponent") { va = a.opponent; vb = b.opponent; }
      else if (sortKey === "game_type") { va = a.game_type; vb = b.game_type; }
      else if (sortKey === "snaps") { va = snapsByGame[a.id] ?? 0; vb = snapsByGame[b.id] ?? 0; }
      // Sort prospects without an Above Expected value to the bottom by
      // pushing them to -Infinity for desc sorts (and above values).
      else if (sortKey === "above_exp") { va = aeA ?? Number.NEGATIVE_INFINITY; vb = aeB ?? Number.NEGATIVE_INFINITY; }

      if (typeof va === "string")
        return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [games, yearFilter, search, sortKey, sortDir, snapsByGame, prospectMap, aboveExpectedByProspect]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  const totalSnaps = rows.reduce((s, g) => s + (snapsByGame[g.id] ?? 0), 0);

  function fmtAboveExpected(v: number | null | undefined): { text: string; color: string } {
    if (v == null) return { text: "—", color: "text-gray-600" };
    const sign = v > 0 ? "+" : "";
    const color = v >= 2 ? "text-green-400" : v <= -2 ? "text-red-400" : "text-gray-300";
    return { text: `${sign}${v.toFixed(1)}`, color };
  }

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <input
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500 w-48"
          placeholder="Search player / opponent…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <span className="text-sm text-gray-400">Season:</span>
        <button
          onClick={() => setYearFilter(null)}
          className={`px-3 py-1 rounded text-xs font-medium transition ${!yearFilter ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
        >All</button>
        {years.map((y) => (
          <button
            key={y}
            onClick={() => setYearFilter(y)}
            className={`px-3 py-1 rounded text-xs font-medium transition ${yearFilter === y ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
          >{y}</button>
        ))}
        <span className="ml-auto text-xs text-gray-500">{rows.length} games</span>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm text-center py-12">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12">No games charted yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-800">
                <Th label="Player" k="player" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="School" k="school" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="Season" k="season_year" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="Opponent" k="opponent" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="Type" k="game_type" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="Snaps" k="snaps" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                <Th label="Above Exp." k="above_exp" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900">
              {rows.map((g) => {
                const p = prospectMap[g.prospect_id];
                const ae = aboveExpectedByProspect.get(g.prospect_id);
                const aeFmt = fmtAboveExpected(ae);
                const snaps = snapsByGame[g.id] ?? 0;
                return (
                  <tr
                    key={g.id}
                    onClick={() => p && onSelectProspect(p)}
                    className="hover:bg-gray-800/50 cursor-pointer transition"
                  >
                    <td className="px-3 py-2 text-white font-medium whitespace-nowrap">{p?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{p?.school ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-300">{g.season_year}</td>
                    <td className="px-3 py-2 text-gray-200 whitespace-nowrap">{g.opponent}</td>
                    <td className="px-3 py-2 text-gray-500 capitalize">{g.game_type}</td>
                    <td className="px-3 py-2 text-blue-400 font-medium">{snaps}</td>
                    <td className={`px-3 py-2 font-medium ${aeFmt.color}`}>
                      {aeFmt.text}
                      {ae != null && (
                        <span className="ml-1 text-[10px] text-gray-500 font-normal">{aboveExpectedLabel(p?.position)}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                <td colSpan={5} className="px-3 pt-2">Total ({rows.length} games)</td>
                <td className="px-3 pt-2 text-blue-400">{totalSnaps}</td>
                <td className="px-3 pt-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
