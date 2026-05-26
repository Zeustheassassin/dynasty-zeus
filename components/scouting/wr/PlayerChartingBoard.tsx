"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { logger } from "../../../lib/logger";

const log = logger("scouting/PlayerChartingBoard");
import PlayerNotesList from "../PlayerNotesList";
import BulkGameImport from "../BulkGameImport";
import SummaryGameImport from "../SummaryGameImport";
import PlayerCharts from "./PlayerCharts";
import type {
  Prospect,
  ProspectWithStats,
  RoutePlay,
  RouteType,
  Alignment,
} from "../../../lib/types";
import { ROUTE_TYPES } from "../shared/chartingConstants";
import ChartingBoard, { type ChartingBoardConfig } from "../shared/ChartingBoard";
import { useChartingState } from "../shared/hooks/useChartingState";

const COVERAGES: { key: string; label: string }[] = [
  { key: "man", label: "Man" },
  { key: "zone", label: "Zone" },
  { key: "double", label: "Double" },
  { key: "press", label: "Press" },
];
const ALIGNMENTS: { key: Alignment; label: string }[] = [
  { key: "left",      label: "L" },
  { key: "right",     label: "R" },
  { key: "slot",      label: "S" },
  { key: "backfield", label: "B" },
];
const NFL_ROLES = ["X", "Y", "Slot", "X or Y", "Y or Slot", "Slot/Gadget", "Anything", "Sacrificial X", "Target Hog Y or Slot", ""];

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "chart",    label: "Chart Game" },
  { key: "games",    label: "Games" },
  { key: "charts",   label: "Charts" },
];

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
  allProspects: ProspectWithStats[];
}

export default function PlayerChartingBoard({ prospect, onBack, onDataChanged, allProspects }: Props) {
  const [plays, setPlays] = useState<RoutePlay[]>([]);

  // Import panel state
  const [showBulkImport, setShowBulkImport]       = useState(false);
  const [showSummaryImport, setShowSummaryImport] = useState(false);

  // Play form state
  const [noRouteRun, setNoRouteRun]   = useState(false);
  const [routeType, setRouteType]     = useState<RouteType>("curl");
  const [alignment, setAlignment]     = useState<Alignment>("right");
  const [onLine, setOnLine]           = useState(true);
  const [coverage, setCoverage]       = useState("");
  const [wasOpen, setWasOpen]         = useState(false);
  const [targeted, setTargeted]       = useState(false);
  const [playOutcome, setPlayOutcome] = useState<"caught" | "drop" | "incomplete" | null>(null);
  const [contested, setContested]     = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);
  const [yards, setYards]             = useState("");
  const [playNotes, setPlayNotes]     = useState("");
  const [savingPlay, setSavingPlay]   = useState(false);
  const [playError, setPlayError]     = useState<string | null>(null);

  const wrConfig: ChartingBoardConfig = {
    positionLabel: prospect.position ?? "WR",
    accentColor: "blue",
    nflRoles: NFL_ROLES,
  };

  const cs = useChartingState(prospect, {
    onDataChanged,
    onDeleteGamePlays: (id) => setPlays((p) => p.filter((pl) => pl.game_id !== id)),
  });
  const { tab, games, selectedGameId, loading, showAddGame, newGame, savingGame, gameError,
          editBio, bio, savingBio, onTabChange, onSelectGame, onToggleAddGame, onNewGameChange,
          onAddGame, onDeleteGame, onUpdateGame, onToggleEditBio, onBioChange, onSaveBio } = cs;

  useEffect(() => {
    if (games.length === 0) return;
    const ids = games.map((g) => g.id);
    (async () => {
      const allPlays: RoutePlay[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data } = await supabase.from("route_plays").select("*").in("game_id", ids).order("created_at").range(from, from + PAGE - 1);
        allPlays.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      setPlays(allPlays);
    })();
  }, [games]);

  const gamePlays = useMemo(
    () => plays.filter((p) => p.game_id === selectedGameId),
    [plays, selectedGameId],
  );

  const stats = useMemo(() => {
    const routePlays  = plays.filter((p) => !p.no_route_run);
    const totalSnaps  = plays.length;
    const totalRoutes = routePlays.length;

    let tgt = 0, ctch = 0, drops = 0, contested = 0, contestedCatches = 0;
    for (const g of games) {
      if (g.summary_targets != null) {
        tgt += g.summary_targets;
        ctch += g.summary_catches ?? 0;
        drops += g.summary_drops ?? 0;
        contested += g.summary_contested ?? 0;
        contestedCatches += g.summary_contested_catches ?? 0;
      } else {
        const gPlays = routePlays.filter((p) => p.game_id === g.id);
        tgt += gPlays.filter((p) => p.targeted).length;
        ctch += gPlays.filter((p) => p.targeted && p.success).length;
        drops += gPlays.filter((p) => p.targeted && p.success === false).length;
        contested += gPlays.filter((p) => p.contested).length;
        contestedCatches += gPlays.filter((p) => p.contested && p.success === true).length;
      }
    }

    const leftN   = plays.filter((p) => p.alignment === "left").length;
    const rightN  = plays.filter((p) => p.alignment === "right").length;
    const slotN   = plays.filter((p) => p.alignment === "slot").length;
    const bfN     = plays.filter((p) => p.alignment === "backfield").length;
    const onLineN = plays.filter((p) => p.on_line).length;
    const totalOpen = routePlays.filter((p) => p.was_open).length;

    const routeStats: Partial<Record<RouteType, { count: number; open: number; targets: number; catches: number; successRate: string | null }>> = {};
    for (const rt of ROUTE_TYPES) {
      const rtPlays = routePlays.filter((p) => p.route_type === rt);
      if (rtPlays.length === 0) continue;
      const rtOpen = rtPlays.filter((p) => p.was_open).length;
      const rtTgt  = rtPlays.filter((p) => p.targeted).length;
      const rtCtch = rtPlays.filter((p) => p.targeted && p.success).length;
      routeStats[rt] = { count: rtPlays.length, open: rtOpen, targets: rtTgt, catches: rtCtch, successRate: ((rtOpen / rtPlays.length) * 100).toFixed(0) + "%" };
    }

    const cvgStats = (["man", "zone", "double", "press"] as const).map((cvg) => {
      // Press is a subtype of Man — fold press routes into Man's count and
      // open/target/catch totals so the Man% reflects all man-style coverage.
      // Press still appears as its own bucket. Total route count is unchanged
      // (press is counted once in routePlays.length).
      const cvgPlays = cvg === "man"
        ? routePlays.filter((p) => p.coverage === "man" || p.coverage === "press")
        : routePlays.filter((p) => p.coverage === cvg);
      const cvgOpen  = cvgPlays.filter((p) => p.was_open).length;
      const cvgTgt   = cvgPlays.filter((p) => p.targeted).length;
      const cvgCtch  = cvgPlays.filter((p) => p.targeted && p.success).length;
      return {
        label: cvg === "double" ? "Double" : cvg.charAt(0).toUpperCase() + cvg.slice(1),
        count: cvgPlays.length, open: cvgOpen, targets: cvgTgt, catches: cvgCtch,
        successRate: cvgPlays.length > 0 ? ((cvgOpen / cvgPlays.length) * 100).toFixed(0) + "%" : null,
      };
    }).filter((c) => c.count > 0);

    const snapPct  = (n: number) => (totalSnaps  > 0 ? ((n / totalSnaps)  * 100).toFixed(1) : null);
    const routePct = (n: number) => (totalRoutes > 0 ? ((n / totalRoutes) * 100).toFixed(1) : null);
    const openRate  = totalRoutes > 0 ? ((totalOpen / totalRoutes) * 100).toFixed(1) : null;
    const catchRate = tgt > 0 ? ((ctch / tgt) * 100).toFixed(1) : null;

    return {
      totalSnaps, totalRoutes, total: totalRoutes,
      targets: tgt, catches: ctch, drops, contested, contestedCatches,
      openRate, catchRate, successRate: openRate,
      targetRate: routePct(tgt),
      pctLeft: snapPct(leftN), pctRight: snapPct(rightN), pctSlot: snapPct(slotN), pctBf: snapPct(bfN),
      pctOnLine: snapPct(onLineN),
      pctOffLine: totalSnaps > 0 ? (((totalSnaps - onLineN) / totalSnaps) * 100).toFixed(1) : null,
      routeStats, cvgStats,
    };
  }, [plays, games]);

  const gameStats = useMemo(() => {
    const map: Record<string, { snaps: number; routes: number; targets: number; catches: number; yards: number }> = {};
    for (const p of plays) {
      if (!map[p.game_id]) map[p.game_id] = { snaps: 0, routes: 0, targets: 0, catches: 0, yards: 0 };
      map[p.game_id].snaps++;
      if (!p.no_route_run) {
        map[p.game_id].routes++;
        if (p.targeted) map[p.game_id].targets++;
        if (p.targeted && p.success) map[p.game_id].catches++;
        if (p.yards) map[p.game_id].yards += p.yards;
      }
    }
    return map;
  }, [plays]);

  const gamePlayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plays) map[p.game_id] = (map[p.game_id] ?? 0) + 1;
    return map;
  }, [plays]);

  async function logPlay() {
    if (!selectedGameId) return;
    setPlayError(null); setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }
    const { data, error } = await supabase.from("route_plays").insert({
      user_id: user.id, game_id: selectedGameId,
      no_route_run: noRouteRun,
      route_type: noRouteRun ? "other" : routeType,
      alignment, on_line: onLine,
      coverage: noRouteRun ? "" : coverage,
      was_open: noRouteRun ? false : wasOpen,
      targeted: noRouteRun ? false : targeted,
      success: (!noRouteRun && targeted) ? (playOutcome === "caught" ? true : playOutcome === "drop" ? false : null) : null,
      contested: (!noRouteRun && targeted) ? contested : false,
      yards: (!noRouteRun && targeted && playOutcome === "caught" && yards) ? parseInt(yards, 10) : null,
      play_notes: playNotes,
    }).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => [...prev, data as RoutePlay]);
      setWasOpen(false); setTargeted(false); setPlayOutcome(null); setContested(false); setYards(""); setPlayNotes("");
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function handleBulkImport(parsedPlays: { route_type: RouteType; alignment: Alignment; on_line: boolean; targeted: boolean; success: boolean | null; yards: number | null; play_notes: string; no_route_run?: boolean }[]) {
    if (!selectedGameId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rows = parsedPlays.map((pl) => ({ ...pl, game_id: selectedGameId, user_id: user.id }));
    const { data, error } = await supabase.from("route_plays").insert(rows).select();
    if (!error && data) { setPlays((prev) => [...prev, ...(data as RoutePlay[])]); onDataChanged(); }
    setShowBulkImport(false);
  }

  async function handleSummaryImport(
    reconstructedPlays: { route_type: RouteType; alignment: Alignment; on_line: boolean; coverage: string; targeted: boolean; success: boolean | null; contested: boolean; yards: number | null; play_notes: string; no_route_run: boolean }[],
    totals: import("../SummaryGameImport").SummaryTotals,
  ) {
    if (!selectedGameId) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rows = reconstructedPlays.map((pl) => ({ ...pl, game_id: selectedGameId, user_id: user.id }));
    const [{ data, error }, { error: gErr }] = await Promise.all([
      supabase.from("route_plays").insert(rows).select(),
      supabase.from("scouting_games").update({
        summary_targets: totals.targets, summary_catches: totals.catches,
        summary_drops: totals.drops, summary_contested: totals.contested,
        summary_contested_catches: totals.contestedCatches,
      }).eq("id", selectedGameId),
    ]);
    if (!error && data) { setPlays((prev) => [...prev, ...(data as RoutePlay[])]); }
    if (gErr) log.error("summary totals save", { err: gErr.message });
    onDataChanged();
    setShowSummaryImport(false);
  }

  function resetForm() {
    setEditingPlayId(null); setNoRouteRun(false); setRouteType("curl"); setAlignment("right");
    setOnLine(true); setCoverage(""); setWasOpen(false); setTargeted(false);
    setPlayOutcome(null); setContested(false); setYards(""); setPlayNotes("");
  }

  function startEditPlay(pl: RoutePlay) {
    setEditingPlayId(pl.id); setNoRouteRun(pl.no_route_run); setRouteType(pl.route_type);
    setAlignment(pl.alignment); setOnLine(pl.on_line); setCoverage(pl.coverage ?? "");
    setWasOpen(pl.was_open); setTargeted(pl.targeted);
    setPlayOutcome(pl.targeted ? (pl.success === true ? "caught" : pl.success === false ? "drop" : "incomplete") : null);
    setContested(pl.contested ?? false); setYards(pl.yards != null ? String(pl.yards) : ""); setPlayNotes(pl.play_notes ?? "");
  }

  async function saveEditedPlay() {
    if (!editingPlayId) return;
    setPlayError(null); setSavingPlay(true);
    const { data, error } = await supabase.from("route_plays").update({
      no_route_run: noRouteRun, route_type: noRouteRun ? "other" : routeType,
      alignment, on_line: onLine, coverage: noRouteRun ? "" : coverage,
      was_open: noRouteRun ? false : wasOpen, targeted: noRouteRun ? false : targeted,
      success: (!noRouteRun && targeted) ? (playOutcome === "caught" ? true : playOutcome === "drop" ? false : null) : null,
      contested: (!noRouteRun && targeted) ? contested : false,
      yards: (!noRouteRun && targeted && playOutcome === "caught" && yards) ? parseInt(yards, 10) : null,
      play_notes: playNotes,
    }).eq("id", editingPlayId).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) { setPlays((prev) => prev.map((p) => p.id === editingPlayId ? (data as RoutePlay) : p)); resetForm(); onDataChanged(); }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    if (editingPlayId === id) resetForm();
    await supabase.from("route_plays").delete().eq("id", id);
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  return (
    <ChartingBoard
      prospect={prospect} config={wrConfig} tabs={tabs} gamePlayCounts={gamePlayCounts}
      tab={tab} games={games} selectedGameId={selectedGameId} loading={loading}
      showAddGame={showAddGame} newGame={newGame} savingGame={savingGame} gameError={gameError}
      editBio={editBio} bio={bio} savingBio={savingBio} onBack={onBack}
      onTabChange={onTabChange} onSelectGame={onSelectGame} onToggleAddGame={onToggleAddGame}
      onNewGameChange={onNewGameChange} onAddGame={onAddGame} onDeleteGame={onDeleteGame} onUpdateGame={onUpdateGame}
      onToggleEditBio={onToggleEditBio} onBioChange={onBioChange} onSaveBio={onSaveBio}
      renderGameBadge={(g) => {
        const gs = gameStats[g.id] ?? { routes: 0, targets: 0, catches: 0 };
        return (
          <div className="text-right">
            <div className="text-xs text-blue-400">{gs.routes}r</div>
            <div className="text-xs text-gray-600">{gs.catches}/{gs.targets}</div>
          </div>
        );
      }}
      renderHeaderStats={() => (
        <>
          <div>{stats.totalSnaps} snaps · {stats.totalRoutes} routes · {games.length} games</div>
          {stats.successRate && <div className="text-green-400">{stats.successRate}% open</div>}
        </>
      )}
      renderOverview={() => (
        <div className="space-y-4">
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : stats.total === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              No routes charted yet. Go to &quot;Chart Game&quot; to start logging plays.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: "Snaps",      value: stats.totalSnaps,       color: "text-gray-300" },
                  { label: "Routes",     value: stats.totalRoutes,      color: "text-blue-400" },
                  { label: "Games",      value: games.length,           color: "text-gray-300" },
                  { label: "Targets",    value: stats.targets,          color: "text-yellow-400" },
                  { label: "Catches",    value: stats.catches,          color: "text-green-400" },
                  { label: "Drops",      value: stats.drops,            color: "text-red-400" },
                  { label: "Contested",  value: stats.contested,        color: "text-purple-400" },
                  { label: "Cont. Catch",value: stats.contestedCatches, color: "text-purple-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">Open Rate (SRVC)</div>
                  <div className="text-xl font-bold text-green-400">{stats.openRate ? `${stats.openRate}%` : "—"}</div>
                  <div className="text-xs text-gray-600 mt-0.5">got open / total routes</div>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">Catch Rate</div>
                  <div className="text-xl font-bold text-blue-400">{stats.catchRate ? `${stats.catchRate}%` : "—"}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{stats.catches} caught / {stats.targets} targeted</div>
                </div>
                <div className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-1">Target Rate</div>
                  <div className="text-xl font-bold text-yellow-400">{stats.targetRate ? `${stats.targetRate}%` : "—"}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{stats.targets} / {stats.totalRoutes} routes</div>
                </div>
              </div>

              <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-xs text-gray-500 mb-3">Route Breakdown — Att · Times Open · Open% (SRVC)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-800 text-gray-600">
                        <th className="text-left pb-1.5 pr-3">Route</th>
                        <th className="text-right pb-1.5 px-2">Att</th>
                        <th className="text-right pb-1.5 px-2">Open</th>
                        <th className="text-right pb-1.5 px-2">Tgt</th>
                        <th className="text-right pb-1.5 px-2">Rec</th>
                        <th className="text-right pb-1.5 px-2">Open%</th>
                        <th className="text-right pb-1.5 pl-2">% of Routes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-900">
                      {ROUTE_TYPES
                        .filter((rt) => stats.routeStats[rt])
                        .sort((a, b) => (stats.routeStats[b]?.count ?? 0) - (stats.routeStats[a]?.count ?? 0))
                        .map((rt) => {
                          const rs = stats.routeStats[rt]!;
                          return (
                            <tr key={rt} className="hover:bg-gray-800/40">
                              <td className="py-1.5 pr-3 text-white font-medium capitalize">{rt}</td>
                              <td className="py-1.5 px-2 text-right text-blue-400">{rs.count}</td>
                              <td className="py-1.5 px-2 text-right text-green-300">{rs.open || "—"}</td>
                              <td className="py-1.5 px-2 text-right text-yellow-400">{rs.targets || "—"}</td>
                              <td className="py-1.5 px-2 text-right text-gray-300">{rs.catches || "—"}</td>
                              <td className="py-1.5 px-2 text-right font-medium">
                                {rs.successRate
                                  ? <span className={parseInt(rs.successRate) >= 55 ? "text-green-400" : "text-red-400"}>{rs.successRate}</span>
                                  : <span className="text-gray-600">—</span>}
                              </td>
                              <td className="py-1.5 pl-2 text-right text-gray-500">
                                {stats.total > 0 ? ((rs.count / stats.total) * 100).toFixed(0) : 0}%
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {stats.cvgStats.length > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Coverage Breakdown — Routes · Open · Open% (SRVC)</div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {stats.cvgStats.map((c) => (
                      <div key={c.label} className="p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-xs text-orange-400 font-medium mb-2">vs. {c.label}</div>
                        <div className="space-y-1 text-xs">
                          <div className="flex justify-between"><span className="text-gray-500">Routes</span><span className="text-gray-300">{c.count}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Times Open</span><span className="text-green-300">{c.open || "—"}</span></div>
                          <div className="flex justify-between"><span className="text-gray-500">Targets</span><span className="text-yellow-400">{c.targets || "—"}</span></div>
                          <div className="flex justify-between border-t border-gray-700 pt-1">
                            <span className="text-gray-500">Open%</span>
                            <span className={`font-medium ${c.successRate ? (parseInt(c.successRate) >= 55 ? "text-green-400" : "text-red-400") : "text-gray-600"}`}>{c.successRate ?? "—"}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(() => {
                const pws = allProspects.find((p) => p.id === prospect.id);
                const chartedPlays = plays.filter((p) => !p.no_route_run);
                function alignCounts(al: string, lineFilter?: boolean) {
                  const subset = chartedPlays.filter((p) => p.alignment === al && (lineFilter === undefined || p.on_line === lineFilter));
                  return { routes: subset.length, open: subset.filter((p) => p.was_open).length };
                }
                const openRows = [
                  { label: "Slot",      bfOnly: false, total: pws?.open_pct_slot  ?? null, onLinePct: pws?.open_pct_slot_on_line  ?? null, offLinePct: pws?.open_pct_slot_off_line  ?? null, onLine: alignCounts("slot",  true), offLine: alignCounts("slot",  false), all: alignCounts("slot")      },
                  { label: "Right",     bfOnly: false, total: pws?.open_pct_right ?? null, onLinePct: pws?.open_pct_right_on_line ?? null, offLinePct: pws?.open_pct_right_off_line ?? null, onLine: alignCounts("right", true), offLine: alignCounts("right", false), all: alignCounts("right")     },
                  { label: "Left",      bfOnly: false, total: pws?.open_pct_left  ?? null, onLinePct: pws?.open_pct_left_on_line  ?? null, offLinePct: pws?.open_pct_left_off_line  ?? null, onLine: alignCounts("left",  true), offLine: alignCounts("left",  false), all: alignCounts("left")      },
                  { label: "Backfield", bfOnly: true,  total: pws?.open_pct_backfield ?? null, onLinePct: null, offLinePct: null, onLine: { routes: 0, open: 0 }, offLine: { routes: 0, open: 0 }, all: alignCounts("backfield") },
                ];
                const hasAnyOpen = openRows.some((r) => r.total !== null);
                return (
                  <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-3">Alignment &amp; Depth</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                      {[
                        { label: "LWR (Left)", value: stats.pctLeft },
                        { label: "RWR (Right)", value: stats.pctRight },
                        { label: "Slot", value: stats.pctSlot },
                        { label: "Backfield", value: stats.pctBf },
                      ].map((a) => (
                        <div key={a.label}>
                          <div className="text-xs text-gray-500 mb-1">{a.label}</div>
                          <div className="text-sm font-semibold text-white">{a.value ? `${a.value}%` : "—"}</div>
                          {a.value && (
                            <div className="mt-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${a.value}%` }} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 border-t border-gray-800 pt-3">
                      <div><div className="text-xs text-gray-500">On the Line</div><div className="text-sm font-semibold text-white">{stats.pctOnLine ? `${stats.pctOnLine}%` : "—"}</div></div>
                      <div><div className="text-xs text-gray-500">Off the Line</div><div className="text-sm font-semibold text-white">{stats.pctOffLine ? `${stats.pctOffLine}%` : "—"}</div></div>
                    </div>
                    {hasAnyOpen && (
                      <div className="mt-4 border-t border-gray-800 pt-3">
                        <div className="text-xs text-gray-500 mb-3">Open% by Alignment <span className="text-gray-700">(charted plays only)</span></div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          {openRows.map((r) => (
                            <div key={r.label} className="p-3 bg-gray-800/50 rounded-lg">
                              <div className="text-xs text-orange-400 font-medium mb-2">{r.label}</div>
                              <div className="space-y-1 text-xs">
                                {r.bfOnly ? (
                                  <>
                                    <div className="flex justify-between"><span className="text-gray-500">Routes</span><span className="text-gray-300">{r.all.routes || "—"}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Times Open</span><span className="text-green-300">{r.all.open || "—"}</span></div>
                                    <div className="flex justify-between border-t border-gray-700 pt-1">
                                      <span className="text-gray-500">Open%</span>
                                      <span className={`font-medium ${r.total !== null ? (r.total >= 55 ? "text-green-400" : r.total >= 40 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{r.total !== null ? `${r.total}%` : "—"}</span>
                                    </div>
                                  </>
                                ) : (
                                  <>
                                    <div className="flex justify-between"><span className="text-gray-400 font-medium">On Line Routes</span><span className="text-gray-300">{r.onLine.routes || "—"}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Times Open</span><span className="text-green-300">{r.onLine.open || "—"}</span></div>
                                    <div className="flex justify-between border-t border-gray-700 pt-1 mb-2">
                                      <span className="text-gray-500">Open%</span>
                                      <span className={`font-medium ${r.onLinePct !== null ? (r.onLinePct >= 55 ? "text-green-400" : r.onLinePct >= 40 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{r.onLinePct !== null ? `${r.onLinePct}%` : "—"}</span>
                                    </div>
                                    <div className="flex justify-between"><span className="text-gray-400 font-medium">Off Line Routes</span><span className="text-gray-300">{r.offLine.routes || "—"}</span></div>
                                    <div className="flex justify-between"><span className="text-gray-500">Times Open</span><span className="text-green-300">{r.offLine.open || "—"}</span></div>
                                    <div className="flex justify-between border-t border-gray-700 pt-1">
                                      <span className="text-gray-500">Open%</span>
                                      <span className={`font-medium ${r.offLinePct !== null ? (r.offLinePct >= 55 ? "text-green-400" : r.offLinePct >= 40 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{r.offLinePct !== null ? `${r.offLinePct}%` : "—"}</span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}

              {games.some((g) => g.notes?.trim()) && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Game Notes</div>
                  <div className="space-y-3">
                    {games.filter((g) => g.notes?.trim()).map((g) => (
                      <div key={g.id} className="border-l-2 border-gray-700 pl-3">
                        <div className="text-xs text-gray-500 mb-0.5">{g.season_year} vs {g.opponent}</div>
                        <div className="text-sm text-gray-300 whitespace-pre-wrap">{g.notes}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <PlayerNotesList
                totalPlays={stats.totalSnaps}
                notes={plays.map((p) => p.play_notes).filter((n): n is string => !!(n?.trim()))}
              />
            </>
          )}
        </div>
      )}
      renderPlayLogger={(sg) => (
        !sg ? (
          <div className="text-gray-500 text-sm text-center py-12">Select or add a game to start logging routes.</div>
        ) : showSummaryImport ? (
          <SummaryGameImport
            gameLabel={`${sg.season_year} vs ${sg.opponent}`}
            onImport={handleSummaryImport}
            onCancel={() => setShowSummaryImport(false)}
          />
        ) : showBulkImport ? (
          <BulkGameImport
            gameLabel={`${sg.season_year} vs ${sg.opponent}`}
            onImport={handleBulkImport}
            onCancel={() => setShowBulkImport(false)}
          />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium text-gray-300">
                Logging: <span className="text-white">{sg.season_year} vs {sg.opponent}</span>
                <span className="ml-2 text-gray-400 text-xs">{gamePlays.length} snaps · {gamePlays.filter((p) => !p.no_route_run).length} routes</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setShowSummaryImport(true)}
                  className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded font-medium transition">
                  Paste Summary
                </button>
                <button onClick={() => setShowBulkImport(true)}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded font-medium transition">
                  Paste Play-by-Play
                </button>
              </div>
            </div>

            <div>
              <button onClick={() => setNoRouteRun((v) => !v)}
                className={`w-full py-2 rounded text-sm font-semibold transition ${noRouteRun ? "bg-amber-700 text-white ring-2 ring-amber-500" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                {noRouteRun ? "✓ No Route Run (Aligned Only — run play / blocking)" : "No Route Run"}
              </button>
              {noRouteRun && <p className="text-xs text-amber-400/70 mt-1">Counts as a snap on field. Only alignment and line are recorded.</p>}
            </div>

            {!noRouteRun && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Route Type</div>
                <div className="flex flex-wrap gap-1.5">
                  {ROUTE_TYPES.map((rt) => (
                    <button key={rt} onClick={() => setRouteType(rt)}
                      className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition ${routeType === rt ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      {rt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-4">
              <div>
                <div className="text-xs text-gray-500 mb-2">Alignment</div>
                <div className="flex gap-1.5">
                  {ALIGNMENTS.map((a) => (
                    <button key={a.key} onClick={() => setAlignment(a.key)}
                      className={`w-10 h-10 rounded font-bold text-sm transition ${alignment === a.key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-2">Line</div>
                <div className="flex gap-1.5">
                  <button onClick={() => setOnLine(true)}
                    className={`px-3 h-10 rounded text-xs font-medium transition ${onLine ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>On</button>
                  <button onClick={() => setOnLine(false)}
                    className={`px-3 h-10 rounded text-xs font-medium transition ${!onLine ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Off</button>
                </div>
              </div>
              {!noRouteRun && (
                <div>
                  <div className="text-xs text-gray-500 mb-2">Coverage</div>
                  <div className="flex gap-1.5">
                    {COVERAGES.map((cv) => (
                      <button key={cv.key} onClick={() => setCoverage((c) => c === cv.key ? "" : cv.key)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${coverage === cv.key ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {cv.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {!noRouteRun && (
                <div>
                  <div className="text-xs text-gray-500 mb-2">Got Open?</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setWasOpen(true)}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${wasOpen ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                    <button onClick={() => setWasOpen(false)}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${!wasOpen ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                  </div>
                </div>
              )}
              {!noRouteRun && (
                <div>
                  <div className="text-xs text-gray-500 mb-2">Targeted?</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setTargeted(true)}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${targeted ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                    <button onClick={() => { setTargeted(false); setPlayOutcome(null); setContested(false); setYards(""); }}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${!targeted ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                  </div>
                </div>
              )}
            </div>

            {!noRouteRun && targeted && (
              <div className="flex flex-wrap gap-4 p-3 bg-gray-900/60 rounded-lg border border-gray-800">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Outcome</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setPlayOutcome("caught")}
                      className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "caught" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Caught ✓</button>
                    <button onClick={() => { setPlayOutcome("drop"); setYards(""); }}
                      className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "drop" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Drop ✗</button>
                    <button onClick={() => { setPlayOutcome("incomplete"); setYards(""); }}
                      className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "incomplete" ? "bg-gray-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Incomplete</button>
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Contested?</div>
                  <div className="flex gap-1.5">
                    <button onClick={() => setContested(true)}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${contested ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                    <button onClick={() => setContested(false)}
                      className={`px-3 h-10 rounded text-xs font-medium transition ${!contested ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                  </div>
                </div>
                {playOutcome === "caught" && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Yards</div>
                    <input type="number"
                      className="w-20 h-10 px-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                      placeholder="0" value={yards} onChange={(e) => setYards(e.target.value)} />
                  </div>
                )}
              </div>
            )}

            {editingPlayId && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded text-xs text-yellow-300">
                <span>✎</span><span>Editing play — make changes above then save</span>
                <button onClick={resetForm} className="ml-auto text-yellow-400 hover:text-white transition">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <input className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                placeholder="Play note (optional)" value={playNotes} onChange={(e) => setPlayNotes(e.target.value)} />
              {editingPlayId ? (
                <button onClick={saveEditedPlay} disabled={savingPlay || (!noRouteRun && targeted && playOutcome === null)}
                  className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Save Edit"}
                </button>
              ) : (
                <button onClick={logPlay} disabled={savingPlay || (!noRouteRun && targeted && playOutcome === null)}
                  className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition">
                  {savingPlay ? "…" : "Log Play"}
                </button>
              )}
            </div>
            {playError && <p className="text-red-400 text-xs">{playError}</p>}

            {gamePlays.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Plays This Game ({gamePlays.length})</div>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {[...gamePlays].reverse().map((pl, i) => (
                    <div key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${editingPlayId === pl.id ? "bg-yellow-900/40 border border-yellow-700/60" : "bg-gray-900 border border-transparent"}`}>
                      <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                      {pl.no_route_run
                        ? <span className="text-amber-500 font-medium">aligned</span>
                        : <span className="text-white capitalize font-medium">{pl.route_type}</span>}
                      <span className="text-gray-500 uppercase text-xs">{pl.alignment[0]}</span>
                      <span className="text-gray-600">{pl.on_line ? "OL" : "Off"}</span>
                      {!pl.no_route_run && pl.coverage && (
                        <span className="text-purple-300 capitalize" title={`Coverage: ${pl.coverage}`}>
                          {pl.coverage === "double" ? "Dbl" : pl.coverage === "press" ? "Prs" : pl.coverage}
                        </span>
                      )}
                      {!pl.no_route_run && (
                        <span className={pl.was_open ? "text-emerald-400" : "text-gray-600"} title={pl.was_open ? "Got open" : "Covered"}>
                          {pl.was_open ? "Open" : "Cvrd"}
                        </span>
                      )}
                      {!pl.no_route_run && (pl.targeted ? (
                        pl.success === true ? <span className="text-green-400" title="Targeted: caught">Tgt ✓ {pl.yards ?? 0}yds</span>
                          : pl.success === false ? <span className="text-red-400" title="Targeted: drop">Tgt ✗</span>
                          : <span className="text-gray-400" title="Targeted: incomplete">Tgt inc</span>
                      ) : <span className="text-gray-600" title="Not targeted">Not Tgt</span>)}
                      {pl.play_notes && <span className="text-gray-500 truncate">{pl.play_notes}</span>}
                      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => editingPlayId === pl.id ? resetForm() : startEditPlay(pl)}
                          className={`px-2 py-0.5 rounded text-xs transition ${editingPlayId === pl.id ? "text-yellow-400 hover:text-white" : "text-gray-600 hover:text-yellow-400"}`}>✎</button>
                        <button onClick={() => deletePlay(pl.id)} className="text-gray-700 hover:text-red-400">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      )}
      renderGamesTable={() => (
        <div>
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : games.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">No games charted yet. Go to &quot;Chart Game&quot; to add one.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">Season</th><th className="pb-2 pr-4">Opponent</th>
                    <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4 text-right">Routes</th>
                    <th className="pb-2 pr-4 text-right">Targets</th><th className="pb-2 pr-4 text-right">Catches</th>
                    <th className="pb-2 text-right">Yards</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900">
                  {games.map((g) => {
                    const gs = gameStats[g.id] ?? { routes: 0, targets: 0, catches: 0, yards: 0 };
                    return (
                      <tr key={g.id} className="hover:bg-gray-900/50 transition">
                        <td className="py-2 pr-4 text-gray-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-gray-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gs.routes}</td>
                        <td className="py-2 pr-4 text-right text-gray-300">{gs.targets}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{gs.catches}</td>
                        <td className="py-2 text-right text-gray-300">{gs.yards}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{stats.total}</td>
                    <td className="pt-2 text-right text-gray-300">{stats.targets}</td>
                    <td className="pt-2 text-right text-green-400">{stats.catches}</td>
                    <td className="pt-2 text-right text-gray-300">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      renderExtraTab={() => {
        const current = allProspects.find((p) => p.id === prospect.id);
        if (!current) return <div className="text-gray-500 text-sm text-center py-12">Loading prospect data…</div>;
        return <PlayerCharts prospect={current} allProspects={allProspects} />;
      }}
    />
  );
}
