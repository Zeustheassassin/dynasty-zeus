"use client";
import { useState, useMemo } from "react";
import type { ScoutingGame, ProspectWithStats, RoutePlay } from "../../lib/types";

type SortKey = "player" | "school" | "season_year" | "opponent" | "game_type" | "routes" | "targets" | "catches" | "man_pct" | "zone_pct";

interface Props {
  games: ScoutingGame[];
  plays: RoutePlay[];
  prospects: ProspectWithStats[];
  loading: boolean;
  onSelectProspect: (p: ProspectWithStats) => void;
}

export default function GamesLog({ games, plays, prospects, loading, onSelectProspect }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("season_year");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [yearFilter, setYearFilter] = useState<number | null>(null);

  const prospectMap = useMemo(() => {
    const m: Record<string, ProspectWithStats> = {};
    for (const p of prospects) m[p.id] = p;
    return m;
  }, [prospects]);

  const gameStats = useMemo(() => {
    const playsByGame: Record<string, RoutePlay[]> = {};
    for (const pl of plays) {
      if (!playsByGame[pl.game_id]) playsByGame[pl.game_id] = [];
      playsByGame[pl.game_id].push(pl);
    }

    const m: Record<string, { routes: number; targets: number; catches: number; manPct: number | null; zonePct: number | null }> = {};
    for (const g of games) {
      const gPlays = playsByGame[g.id] ?? [];
      const routes = gPlays.length;

      // Use stored summary totals when available, otherwise compute from plays
      const targets = g.summary_targets ?? gPlays.filter((p) => p.targeted).length;
      const catches = g.summary_catches ?? gPlays.filter((p) => p.targeted && p.success).length;

      // Man% and Zone% = was_open rate per coverage (factual from plays)
      const manPlays = gPlays.filter((p) => p.coverage === "man");
      const zonePlays = gPlays.filter((p) => p.coverage === "zone");
      const manPct = manPlays.length > 0 ? Math.round((manPlays.filter((p) => p.was_open).length / manPlays.length) * 100) : null;
      const zonePct = zonePlays.length > 0 ? Math.round((zonePlays.filter((p) => p.was_open).length / zonePlays.length) * 100) : null;

      m[g.id] = { routes, targets, catches, manPct, zonePct };
    }
    return m;
  }, [plays, games]);

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
      const gsa = gameStats[a.id] ?? { routes: 0, targets: 0, catches: 0, manPct: null, zonePct: null };
      const gsb = gameStats[b.id] ?? { routes: 0, targets: 0, catches: 0, manPct: null, zonePct: null };
      const pa = prospectMap[a.prospect_id];
      const pb = prospectMap[b.prospect_id];

      let va: string | number = 0;
      let vb: string | number = 0;
      if (sortKey === "player") { va = pa?.name ?? ""; vb = pb?.name ?? ""; }
      else if (sortKey === "school") { va = pa?.school ?? ""; vb = pb?.school ?? ""; }
      else if (sortKey === "season_year") { va = a.season_year; vb = b.season_year; }
      else if (sortKey === "opponent") { va = a.opponent; vb = b.opponent; }
      else if (sortKey === "game_type") { va = a.game_type; vb = b.game_type; }
      else if (sortKey === "routes") { va = gsa.routes; vb = gsb.routes; }
      else if (sortKey === "targets") { va = gsa.targets; vb = gsb.targets; }
      else if (sortKey === "catches") { va = gsa.catches; vb = gsb.catches; }
      else if (sortKey === "man_pct") { va = gsa.manPct ?? -1; vb = gsb.manPct ?? -1; }
      else if (sortKey === "zone_pct") { va = gsa.zonePct ?? -1; vb = gsb.zonePct ?? -1; }

      if (typeof va === "string")
        return sortDir === "asc" ? va.localeCompare(vb as string) : (vb as string).localeCompare(va);
      return sortDir === "asc" ? va - (vb as number) : (vb as number) - va;
    });
    return list;
  }, [games, yearFilter, search, sortKey, sortDir, gameStats, prospectMap]);

  function toggleSort(k: SortKey) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  }

  function Th({ label, k }: { label: string; k: SortKey }) {
    const active = sortKey === k;
    return (
      <th
        className={`px-3 py-2 text-left text-xs whitespace-nowrap cursor-pointer hover:text-white transition ${active ? "text-blue-400" : "text-gray-500"}`}
        onClick={() => toggleSort(k)}
      >
        {label}{active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
      </th>
    );
  }

  const totalRoutes = rows.reduce((s, g) => s + (gameStats[g.id]?.routes ?? 0), 0);
  const totalTargets = rows.reduce((s, g) => s + (gameStats[g.id]?.targets ?? 0), 0);
  const totalCatches = rows.reduce((s, g) => s + (gameStats[g.id]?.catches ?? 0), 0);

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
                <Th label="Player" k="player" />
                <Th label="School" k="school" />
                <Th label="Season" k="season_year" />
                <Th label="Opponent" k="opponent" />
                <Th label="Type" k="game_type" />
                <Th label="Routes" k="routes" />
                <Th label="Targets" k="targets" />
                <Th label="Catches" k="catches" />
                <Th label="Man%" k="man_pct" />
                <Th label="Zone%" k="zone_pct" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-900">
              {rows.map((g) => {
                const gs = gameStats[g.id] ?? { routes: 0, targets: 0, catches: 0, manPct: null, zonePct: null };
                const p = prospectMap[g.prospect_id];
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
                    <td className="px-3 py-2 text-blue-400 font-medium">{gs.routes}</td>
                    <td className="px-3 py-2 text-yellow-400">{gs.targets}</td>
                    <td className="px-3 py-2 text-green-400">{gs.catches}</td>
                    <td className="px-3 py-2 text-orange-400">{gs.manPct != null ? `${gs.manPct}%` : "—"}</td>
                    <td className="px-3 py-2 text-orange-400">{gs.zonePct != null ? `${gs.zonePct}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                <td colSpan={5} className="px-3 pt-2">Total ({rows.length} games)</td>
                <td className="px-3 pt-2 text-blue-400">{totalRoutes}</td>
                <td className="px-3 pt-2 text-yellow-400">{totalTargets}</td>
                <td className="px-3 pt-2 text-green-400">{totalCatches}</td>
                <td colSpan={2} className="px-3 pt-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
