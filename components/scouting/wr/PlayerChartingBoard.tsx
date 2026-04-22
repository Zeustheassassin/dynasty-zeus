"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { logger } from "../../../lib/logger";

const log = logger("scouting/PlayerChartingBoard");
import PlayerSynopsisCard from "../PlayerSynopsisCard";
import BulkGameImport from "../BulkGameImport";
import SummaryGameImport from "../SummaryGameImport";
import PlayerCharts from "./PlayerCharts";
import type {
  Prospect,
  ProspectWithStats,
  ScoutingGame,
  RoutePlay,
  RouteType,
  Alignment,
  ChartingDecision,
} from "../../../lib/types";

const ROUTE_TYPES: RouteType[] = [
  "nine", "post", "dig", "curl", "slant", "screen", "flat", "comeback", "out", "corner", "other",
];
const COVERAGES: { key: string; label: string }[] = [
  { key: "man", label: "Man" },
  { key: "zone", label: "Zone" },
  { key: "double", label: "Double" },
  { key: "press", label: "Press" },
];
const ALIGNMENTS: { key: Alignment; label: string }[] = [
  { key: "left", label: "L" },
  { key: "right", label: "R" },
  { key: "slot", label: "S" },
  { key: "backfield", label: "B" },
];
const GAME_TYPES = ["regular", "bowl", "playoff", "scrimmage"];
const NFL_ROLES = ["X", "Y", "Slot", "X or Y", "Y or Slot", "Slot/Gadget", "Anything", "Sacrificial X", "Target Hog Y or Slot", ""];
const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Pending" },
  { value: "not_charting",  label: "Not Charting" },
];

type BoardTab = "overview" | "chart" | "games" | "charts";

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
  allProspects: ProspectWithStats[];
}

export default function PlayerChartingBoard({ prospect, onBack, onDataChanged, allProspects }: Props) {
  const [tab, setTab] = useState<BoardTab>("overview");
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [plays, setPlays] = useState<RoutePlay[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add game form
  const [showAddGame, setShowAddGame] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showSummaryImport, setShowSummaryImport] = useState(false);
  const [newGame, setNewGame] = useState({ year: 2025, opponent: "", type: "regular" });
  const [savingGame, setSavingGame] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);
  const [playError, setPlayError] = useState<string | null>(null);

  // Route play form
  const [noRouteRun, setNoRouteRun] = useState(false);
  const [routeType, setRouteType] = useState<RouteType>("curl");
  const [alignment, setAlignment] = useState<Alignment>("right");
  const [onLine, setOnLine] = useState(true);
  const [coverage, setCoverage] = useState("");
  const [wasOpen, setWasOpen] = useState(false);
  const [targeted, setTargeted] = useState(false);
  const [playOutcome, setPlayOutcome] = useState<"caught" | "drop" | "incomplete" | null>(null);
  const [contested, setContested] = useState(false);
  const [editingPlayId, setEditingPlayId] = useState<string | null>(null);
  const [yards, setYards] = useState("");
  const [playNotes, setPlayNotes] = useState("");
  const [savingPlay, setSavingPlay] = useState(false);

  // Bio edit
  const [editBio, setEditBio] = useState(false);
  const [bio, setBio] = useState<Partial<Prospect>>({});
  const [savingBio, setSavingBio] = useState(false);

  // Notes summary

  const load = useCallback(async () => {
    setLoading(true);
    const { data: gData } = await supabase
      .from("scouting_games")
      .select("*")
      .eq("prospect_id", prospect.id)
      .order("season_year", { ascending: false })
      .order("game_slot");
    const gList: ScoutingGame[] = gData ?? [];
    setGames(gList);

    if (gList.length > 0) {
      const gameIds = gList.map((g) => g.id);
      const allPlays: RoutePlay[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("route_plays")
          .select("*")
          .in("game_id", gameIds)
          .order("created_at")
          .range(from, from + PAGE - 1);
        allPlays.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
        from += PAGE;
      }
      setPlays(allPlays);
    } else {
      setPlays([]);
    }
    setLoading(false);
  }, [prospect.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setBio({
      height: prospect.height,
      weight: prospect.weight,
      birthday: prospect.birthday,
      draft_class_year: prospect.draft_class_year,
      personal_rank: prospect.personal_rank,
      should_play: prospect.should_play,
      will_play_pre: prospect.will_play_pre,
      will_play_post: prospect.will_play_post,
      charting_decision: prospect.charting_decision,
      charting_notes: prospect.charting_notes,
      draft_round: prospect.draft_round, draft_pick: prospect.draft_pick, draft_team: prospect.draft_team,
    });

  }, [prospect.id, load, prospect.height, prospect.weight, prospect.birthday,
    prospect.draft_class_year, prospect.personal_rank,
    prospect.should_play, prospect.will_play_pre, prospect.will_play_post,
    prospect.charting_decision, prospect.charting_notes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!selectedGameId && games.length > 0) setSelectedGameId(games[0].id);
  }, [games, selectedGameId]);

  const selectedGame = games.find((g) => g.id === selectedGameId);
  const gamePlays = useMemo(() => plays.filter((p) => p.game_id === selectedGameId), [plays, selectedGameId]);

  // Aggregate stats across all games
  const stats = useMemo(() => {
    const routePlays = plays.filter((p) => !p.no_route_run);
    const totalSnaps = plays.length;
    const totalRoutes = routePlays.length;

    // For games with stored summary totals (imported), use those; otherwise compute from plays
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
    // Alignment % from all snaps
    const leftN = plays.filter((p) => p.alignment === "left").length;
    const rightN = plays.filter((p) => p.alignment === "right").length;
    const slotN = plays.filter((p) => p.alignment === "slot").length;
    const bfN = plays.filter((p) => p.alignment === "backfield").length;
    const onLineN = plays.filter((p) => p.on_line).length;

    const totalOpen = routePlays.filter((p) => p.was_open).length;
    const routeCounts: Partial<Record<RouteType, number>> = {};
    for (const p of routePlays) routeCounts[p.route_type] = (routeCounts[p.route_type] ?? 0) + 1;

    // Per-route stats — success rate = was_open / count (SRVC, not catch rate)
    const routeStats: Partial<Record<RouteType, { count: number; open: number; targets: number; catches: number; successRate: string | null }>> = {};
    for (const rt of ROUTE_TYPES) {
      const rtPlays = routePlays.filter((p) => p.route_type === rt);
      if (rtPlays.length === 0) continue;
      const rtOpen = rtPlays.filter((p) => p.was_open).length;
      const rtTgt = rtPlays.filter((p) => p.targeted).length;
      const rtCtch = rtPlays.filter((p) => p.targeted && p.success).length;
      routeStats[rt] = {
        count: rtPlays.length,
        open: rtOpen,
        targets: rtTgt,
        catches: rtCtch,
        successRate: rtPlays.length > 0 ? ((rtOpen / rtPlays.length) * 100).toFixed(0) + "%" : null,
      };
    }

    // Per-coverage stats — success rate = was_open / count (SRVC)
    const cvgStats = (["man", "zone", "double", "press"] as const).map((cvg) => {
      const cvgPlays = routePlays.filter((p) => p.coverage === cvg);
      const cvgOpen = cvgPlays.filter((p) => p.was_open).length;
      const cvgTgt = cvgPlays.filter((p) => p.targeted).length;
      const cvgCtch = cvgPlays.filter((p) => p.targeted && p.success).length;
      return {
        label: cvg === "double" ? "Double" : cvg.charAt(0).toUpperCase() + cvg.slice(1),
        count: cvgPlays.length,
        open: cvgOpen,
        targets: cvgTgt,
        catches: cvgCtch,
        successRate: cvgPlays.length > 0 ? ((cvgOpen / cvgPlays.length) * 100).toFixed(0) + "%" : null,
      };
    }).filter((c) => c.count > 0);

    const snapPct = (n: number) => (totalSnaps > 0 ? ((n / totalSnaps) * 100).toFixed(1) : null);
    const routePct = (n: number) => (totalRoutes > 0 ? ((n / totalRoutes) * 100).toFixed(1) : null);
    const openRate = totalRoutes > 0 ? ((totalOpen / totalRoutes) * 100).toFixed(1) : null;
    const catchRate = tgt > 0 ? ((ctch / tgt) * 100).toFixed(1) : null;
    return {
      totalSnaps, totalRoutes,
      total: totalRoutes,  // keep for backwards compat with any remaining refs
      targets: tgt, catches: ctch, drops, contested, contestedCatches,
      openRate, catchRate,
      successRate: openRate,
      targetRate: routePct(tgt),
      pctLeft: snapPct(leftN), pctRight: snapPct(rightN), pctSlot: snapPct(slotN), pctBf: snapPct(bfN),
      pctOnLine: snapPct(onLineN),
      pctOffLine: totalSnaps > 0 ? (((totalSnaps - onLineN) / totalSnaps) * 100).toFixed(1) : null,
      adjSuccessAboveExp: tgt > 0 ? (((ctch / tgt) - 0.55) * 100).toFixed(2) : null,
      routeCounts,
      routeStats,
      cvgStats,
    };
  }, [plays, games]);

  // Per-game stats
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

  async function addGame() {
    if (!newGame.opponent.trim()) return;
    setGameError(null);
    setSavingGame(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGameError("Not logged in."); setSavingGame(false); return; }
    const slot = games.filter((g) => g.season_year === newGame.year).length + 1;
    const { data, error } = await supabase
      .from("scouting_games")
      .insert({
        user_id: user.id,
        prospect_id: prospect.id,
        season_year: newGame.year,
        opponent: newGame.opponent.trim(),
        game_slot: slot,
        game_type: newGame.type,
      })
      .select()
      .single();
    if (error) {
      setGameError(error.message);
    } else if (data) {
      setGames((prev) => [...prev, data as ScoutingGame]);
      setSelectedGameId(data.id as string);
      setNewGame((n) => ({ ...n, opponent: "" }));
      setShowAddGame(false);
      onDataChanged();
    }
    setSavingGame(false);
  }

  async function deleteGame(id: string) {
    await supabase.from("scouting_games").delete().eq("id", id);
    setGames((prev) => prev.filter((g) => g.id !== id));
    setPlays((prev) => prev.filter((p) => p.game_id !== id));
    if (selectedGameId === id) setSelectedGameId(games.find((g) => g.id !== id)?.id ?? null);
    onDataChanged();
  }

  async function logPlay() {
    if (!selectedGameId) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }
    const { data, error } = await supabase
      .from("route_plays")
      .insert({
        user_id: user.id,
        game_id: selectedGameId,
        no_route_run: noRouteRun,
        route_type: noRouteRun ? "other" : routeType,
        alignment,
        on_line: onLine,
        coverage: noRouteRun ? "" : coverage,
        was_open: noRouteRun ? false : wasOpen,
        targeted: noRouteRun ? false : targeted,
        success: (!noRouteRun && targeted) ? (playOutcome === "caught" ? true : playOutcome === "drop" ? false : null) : null,
        contested: (!noRouteRun && targeted) ? contested : false,
        yards: (!noRouteRun && targeted && playOutcome === "caught" && yards) ? parseInt(yards, 10) : null,
        play_notes: playNotes,
      })
      .select()
      .single();
    if (error) {
      setPlayError(error.message);
    } else if (data) {
      setPlays((prev) => [...prev, data as RoutePlay]);
      setWasOpen(false);
      setTargeted(false);
      setPlayOutcome(null);
      setContested(false);
      setYards("");
      setPlayNotes("");
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
    if (!error && data) {
      setPlays((prev) => [...prev, ...(data as RoutePlay[])]);
      onDataChanged();
    }
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
        summary_targets: totals.targets,
        summary_catches: totals.catches,
        summary_drops: totals.drops,
        summary_contested: totals.contested,
        summary_contested_catches: totals.contestedCatches,
      }).eq("id", selectedGameId),
    ]);
    if (!error && data) {
      setPlays((prev) => [...prev, ...(data as RoutePlay[])]);
    }
    if (gErr) log.error("summary totals save", { err: gErr.message });
    onDataChanged();
    setShowSummaryImport(false);
  }

  function resetForm() {
    setEditingPlayId(null);
    setNoRouteRun(false);
    setRouteType("curl");
    setAlignment("right");
    setOnLine(true);
    setCoverage("");
    setWasOpen(false);
    setTargeted(false);
    setPlayOutcome(null);
    setContested(false);
    setYards("");
    setPlayNotes("");
  }

  function startEditPlay(pl: RoutePlay) {
    setEditingPlayId(pl.id);
    setNoRouteRun(pl.no_route_run);
    setRouteType(pl.route_type);
    setAlignment(pl.alignment);
    setOnLine(pl.on_line);
    setCoverage(pl.coverage ?? "");
    setWasOpen(pl.was_open);
    setTargeted(pl.targeted);
    setPlayOutcome(
      pl.targeted
        ? pl.success === true ? "caught" : pl.success === false ? "drop" : "incomplete"
        : null
    );
    setContested(pl.contested ?? false);
    setYards(pl.yards != null ? String(pl.yards) : "");
    setPlayNotes(pl.play_notes ?? "");
  }

  async function saveEditedPlay() {
    if (!editingPlayId) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data, error } = await supabase
      .from("route_plays")
      .update({
        no_route_run: noRouteRun,
        route_type: noRouteRun ? "other" : routeType,
        alignment,
        on_line: onLine,
        coverage: noRouteRun ? "" : coverage,
        was_open: noRouteRun ? false : wasOpen,
        targeted: noRouteRun ? false : targeted,
        success: (!noRouteRun && targeted) ? (playOutcome === "caught" ? true : playOutcome === "drop" ? false : null) : null,
        contested: (!noRouteRun && targeted) ? contested : false,
        yards: (!noRouteRun && targeted && playOutcome === "caught" && yards) ? parseInt(yards, 10) : null,
        play_notes: playNotes,
      })
      .eq("id", editingPlayId)
      .select()
      .single();
    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => prev.map((p) => p.id === editingPlayId ? (data as RoutePlay) : p));
      resetForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    if (editingPlayId === id) resetForm();
    await supabase.from("route_plays").delete().eq("id", id);
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  async function saveBio() {
    setSavingBio(true);
    await supabase
      .from("prospects")
      .update({ ...bio, updated_at: new Date().toISOString() })
      .eq("id", prospect.id);
    setSavingBio(false);
    setEditBio(false);
    onDataChanged();
  }


  const tabs: { key: BoardTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "chart", label: "Chart Game" },
    { key: "games", label: "Games" },
    { key: "charts", label: "Charts" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={onBack}
          className="mt-0.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0"
        >
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-bold text-white truncate">{prospect.name}</h2>
            {prospect.draft_round && (
              <span className="px-2 py-0.5 bg-yellow-600/20 border border-yellow-600/40 rounded text-xs font-semibold text-yellow-400">
                Rd {prospect.draft_round}{prospect.draft_pick ? `, Pick ${prospect.draft_pick}` : ""}{prospect.draft_team ? ` · ${prospect.draft_team}` : ""}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {prospect.position} · {prospect.school}
            {prospect.conference && ` · ${prospect.conference}`}
            {" · "}
            <span className="text-blue-400">{prospect.draft_class_year} Class</span>
          </p>
        </div>
        <div className="flex-shrink-0 text-right text-xs text-gray-500">
          <div>{stats.totalSnaps} snaps · {stats.totalRoutes} routes · {games.length} games</div>
          {stats.successRate && <div className="text-green-400">{stats.successRate}% open</div>}
        </div>
        <button
          onClick={() => setEditBio((e) => !e)}
          className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0"
        >
          {editBio ? "Close" : "Edit Bio"}
        </button>
      </div>

      {/* Bio edit panel */}
      {editBio && (
        <div className="p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Height</label>
              <input className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder='6&apos;2"' value={bio.height ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, height: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Weight (lbs)</label>
              <input type="number" className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="205" value={bio.weight ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, weight: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Birthday</label>
              <input type="date" className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.birthday ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, birthday: e.target.value || null }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Class Year</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.draft_class_year ?? 2026}
                onChange={(e) => setBio((b) => ({ ...b, draft_class_year: Number(e.target.value) }))}>
                {[2026, 2027, 2028, 2029].map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Personal Rank</label>
              <input type="number" className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                placeholder="1" value={bio.personal_rank ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, personal_rank: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Should Play</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.should_play ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, should_play: e.target.value }))}>
                {NFL_ROLES.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Will Play (Pre)</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.will_play_pre ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, will_play_pre: e.target.value }))}>
                {NFL_ROLES.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Will Play (Post)</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.will_play_post ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, will_play_post: e.target.value }))}>
                {NFL_ROLES.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Charting Status</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.charting_decision ?? "pending"}
                onChange={(e) => setBio((b) => ({ ...b, charting_decision: e.target.value as ChartingDecision }))}>
                {CHARTING_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Charting Notes</label>
            <textarea rows={2}
              className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500 resize-none"
              value={bio.charting_notes ?? ""}
              onChange={(e) => setBio((b) => ({ ...b, charting_notes: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Round</label>
              <input type="number" min={1} max={7} placeholder="e.g. 1"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.draft_round ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, draft_round: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Pick #</label>
              <input type="number" min={1} placeholder="e.g. 14"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.draft_pick ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, draft_pick: e.target.value ? Number(e.target.value) : null }))} />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Team</label>
              <input type="text" placeholder="e.g. NYG"
                className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                value={bio.draft_team ?? ""}
                onChange={(e) => setBio((b) => ({ ...b, draft_team: e.target.value || null }))} />
            </div>
          </div>
          <button onClick={saveBio} disabled={savingBio}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded font-medium transition">
            {savingBio ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Board tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t.key ? "border-blue-500 text-blue-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : stats.total === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              No routes charted yet. Go to &quot;Chart Game&quot; to start logging plays.
            </div>
          ) : (
            <>
              {/* Key stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: "Snaps", value: stats.totalSnaps, color: "text-gray-300" },
                  { label: "Routes", value: stats.totalRoutes, color: "text-blue-400" },
                  { label: "Games", value: games.length, color: "text-gray-300" },
                  { label: "Targets", value: stats.targets, color: "text-yellow-400" },
                  { label: "Catches", value: stats.catches, color: "text-green-400" },
                  { label: "Drops", value: stats.drops, color: "text-red-400" },
                  { label: "Contested", value: stats.contested, color: "text-purple-400" },
                  { label: "Cont. Catch", value: stats.contestedCatches, color: "text-purple-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Rates row */}
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

              {/* Route success rates — SRVC (got open) */}
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

              {/* Coverage breakdown — SRVC (got open) */}
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
                            <span className={`font-medium ${c.successRate ? (parseInt(c.successRate) >= 55 ? "text-green-400" : "text-red-400") : "text-gray-600"}`}>
                              {c.successRate ?? "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alignment breakdown */}
              {(() => {
                const pws = allProspects.find((p) => p.id === prospect.id);
                const chartedPlays = plays.filter((p) => !p.no_route_run);
                function alignCounts(al: string, lineFilter?: boolean) {
                  const subset = chartedPlays.filter((p) => p.alignment === al && (lineFilter === undefined || p.on_line === lineFilter));
                  return { routes: subset.length, open: subset.filter((p) => p.was_open).length };
                }
                const openRows = [
                  { label: "Slot",      bfOnly: false, total: pws?.open_pct_slot  ?? null, onLinePct: pws?.open_pct_slot_on_line  ?? null, offLinePct: pws?.open_pct_slot_off_line  ?? null, onLine: alignCounts("slot", true),  offLine: alignCounts("slot", false),  all: alignCounts("slot")  },
                  { label: "Right",     bfOnly: false, total: pws?.open_pct_right ?? null, onLinePct: pws?.open_pct_right_on_line ?? null, offLinePct: pws?.open_pct_right_off_line ?? null, onLine: alignCounts("right", true), offLine: alignCounts("right", false), all: alignCounts("right") },
                  { label: "Left",      bfOnly: false, total: pws?.open_pct_left  ?? null, onLinePct: pws?.open_pct_left_on_line  ?? null, offLinePct: pws?.open_pct_left_off_line  ?? null, onLine: alignCounts("left", true),  offLine: alignCounts("left", false),  all: alignCounts("left")  },
                  { label: "Backfield", bfOnly: true,  total: pws?.open_pct_backfield ?? null, onLinePct: null, offLinePct: null,                                                              onLine: { routes: 0, open: 0 },    offLine: { routes: 0, open: 0 },      all: alignCounts("backfield") },
                ];
                const hasAnyOpen = openRows.some((r) => r.total !== null);
                return (
                  <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-3">Alignment & Depth</div>
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

              {/* Game notes */}
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

              {/* Notes Summary */}
              <PlayerSynopsisCard
                prospectId={prospect.id}
                prospectName={prospect.name}
                position={prospect.position ?? "WR"}
                totalPlays={stats.totalSnaps}
                notes={plays.map((p) => p.play_notes).filter((n): n is string => !!(n?.trim()))}
              />
            </>
          )}
        </div>
      )}

      {/* ── CHART GAME ── */}
      {tab === "chart" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Left: game list */}
          <div className="md:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Games ({games.length})</span>
              <button
                onClick={() => setShowAddGame((s) => !s)}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded transition"
              >
                + Add
              </button>
            </div>

            {showAddGame && (
              <div className="mb-3 p-3 bg-gray-900 border border-gray-700 rounded-lg space-y-2">
                <select
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.year}
                  onChange={(e) => setNewGame((n) => ({ ...n, year: Number(e.target.value) }))}
                >
                  {[2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
                </select>
                <input
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500"
                  placeholder="Opponent (e.g. Ohio State)"
                  value={newGame.opponent}
                  onChange={(e) => setNewGame((n) => ({ ...n, opponent: e.target.value }))}
                />
                <select
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.type}
                  onChange={(e) => setNewGame((n) => ({ ...n, type: e.target.value }))}
                >
                  {GAME_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={addGame}
                    disabled={savingGame || !newGame.opponent.trim()}
                    className="flex-1 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded transition"
                  >
                    {savingGame ? "…" : "Add Game"}
                  </button>
                  <button
                    onClick={() => setShowAddGame(false)}
                    className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition"
                  >
                    ✕
                  </button>
                </div>
                {gameError && (
                  <p className="text-red-400 text-xs mt-1">{gameError}</p>
                )}
              </div>
            )}

            <div className="space-y-1">
              {loading ? (
                <div className="text-gray-500 text-xs py-4 text-center">Loading…</div>
              ) : games.length === 0 ? (
                <div className="text-gray-500 text-xs py-4 text-center">No games added yet.</div>
              ) : (
                games.map((g) => {
                  const gs = gameStats[g.id] ?? { routes: 0, targets: 0, catches: 0, yards: 0 };
                  return (
                    <div
                      key={g.id}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition ${
                        selectedGameId === g.id
                          ? "bg-blue-900/40 border-blue-700"
                          : "bg-gray-900 border-gray-800 hover:border-gray-600"
                      }`}
                      onClick={() => setSelectedGameId(g.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-white truncate">
                          {g.season_year} {g.opponent}
                        </div>
                        <div className="text-xs text-gray-500 capitalize">{g.game_type}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-xs text-blue-400">{gs.routes}r</div>
                        <div className="text-xs text-gray-600">{gs.catches}/{gs.targets}</div>
                      </div>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteGame(g.id); }}
                        className="text-gray-600 hover:text-red-400 text-xs px-1 flex-shrink-0"
                      >
                        ✕
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: route play logger */}
          <div className="md:col-span-2">
            {!selectedGame ? (
              <div className="text-gray-500 text-sm text-center py-12">
                Select or add a game to start logging routes.
              </div>
            ) : showSummaryImport ? (
              <SummaryGameImport
                gameLabel={`${selectedGame.season_year} vs ${selectedGame.opponent}`}
                onImport={handleSummaryImport}
                onCancel={() => setShowSummaryImport(false)}
              />
            ) : showBulkImport ? (
              <BulkGameImport
                gameLabel={`${selectedGame.season_year} vs ${selectedGame.opponent}`}
                onImport={handleBulkImport}
                onCancel={() => setShowBulkImport(false)}
              />
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium text-gray-300">
                    Logging: <span className="text-white">{selectedGame.season_year} vs {selectedGame.opponent}</span>
                    <span className="ml-2 text-gray-400 text-xs">{gamePlays.length} snaps · {gamePlays.filter((p) => !p.no_route_run).length} routes</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowSummaryImport(true)}
                      className="px-3 py-1.5 bg-purple-700 hover:bg-purple-600 text-white text-xs rounded font-medium transition"
                    >
                      Paste Summary
                    </button>
                    <button
                      onClick={() => setShowBulkImport(true)}
                      className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded font-medium transition"
                    >
                      Paste Play-by-Play
                    </button>
                  </div>
                </div>

                {/* No Route Run toggle */}
                <div>
                  <button
                    onClick={() => setNoRouteRun((v) => !v)}
                    className={`w-full py-2 rounded text-sm font-semibold transition ${
                      noRouteRun
                        ? "bg-amber-700 text-white ring-2 ring-amber-500"
                        : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                    }`}
                  >
                    {noRouteRun ? "✓ No Route Run (Aligned Only — run play / blocking)" : "No Route Run"}
                  </button>
                  {noRouteRun && (
                    <p className="text-xs text-amber-400/70 mt-1">
                      Counts as a snap on field. Only alignment and line are recorded.
                    </p>
                  )}
                </div>

                {/* Route type selector — hidden when no-route-run */}
                {!noRouteRun && <div>
                  <div className="text-xs text-gray-500 mb-2">Route Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROUTE_TYPES.map((rt) => (
                      <button
                        key={rt}
                        onClick={() => setRouteType(rt)}
                        className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition ${
                          routeType === rt ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {rt}
                      </button>
                    ))}
                  </div>
                </div>}

                {/* Alignment + Line + Coverage */}
                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Alignment</div>
                    <div className="flex gap-1.5">
                      {ALIGNMENTS.map((a) => (
                        <button
                          key={a.key}
                          onClick={() => setAlignment(a.key)}
                          className={`w-10 h-10 rounded font-bold text-sm transition ${
                            alignment === a.key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                          }`}
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Line</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setOnLine(true)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${onLine ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        On
                      </button>
                      <button
                        onClick={() => setOnLine(false)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${!onLine ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        Off
                      </button>
                    </div>
                  </div>
                  {!noRouteRun && <div>
                    <div className="text-xs text-gray-500 mb-2">Coverage</div>
                    <div className="flex gap-1.5">
                      {COVERAGES.map((cv) => (
                        <button
                          key={cv.key}
                          onClick={() => setCoverage((c) => c === cv.key ? "" : cv.key)}
                          className={`px-3 h-10 rounded text-xs font-medium transition ${
                            coverage === cv.key ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                          }`}
                        >
                          {cv.label}
                        </button>
                      ))}
                    </div>
                  </div>}
                  {!noRouteRun && <div>
                    <div className="text-xs text-gray-500 mb-2">Got Open?</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setWasOpen(true)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${wasOpen ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setWasOpen(false)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${!wasOpen ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        No
                      </button>
                    </div>
                  </div>}
                  {!noRouteRun && <div>
                    <div className="text-xs text-gray-500 mb-2">Targeted?</div>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => setTargeted(true)}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${targeted ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => { setTargeted(false); setPlayOutcome(null); setContested(false); setYards(""); }}
                        className={`px-3 h-10 rounded text-xs font-medium transition ${!targeted ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                      >
                        No
                      </button>
                    </div>
                  </div>}
                </div>

                {/* Targeted outcome */}
                {!noRouteRun && targeted && (
                  <div className="flex flex-wrap gap-4 p-3 bg-gray-900/60 rounded-lg border border-gray-800">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Outcome</div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setPlayOutcome("caught")}
                          className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "caught" ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                        >
                          Caught ✓
                        </button>
                        <button
                          onClick={() => { setPlayOutcome("drop"); setYards(""); }}
                          className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "drop" ? "bg-red-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                        >
                          Drop ✗
                        </button>
                        <button
                          onClick={() => { setPlayOutcome("incomplete"); setYards(""); }}
                          className={`px-4 h-10 rounded text-xs font-bold transition ${playOutcome === "incomplete" ? "bg-gray-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                        >
                          Incomplete
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Contested?</div>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => setContested(true)}
                          className={`px-3 h-10 rounded text-xs font-medium transition ${contested ? "bg-purple-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setContested(false)}
                          className={`px-3 h-10 rounded text-xs font-medium transition ${!contested ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}
                        >
                          No
                        </button>
                      </div>
                    </div>
                    {playOutcome === "caught" && (
                      <div>
                        <div className="text-xs text-gray-500 mb-2">Yards</div>
                        <input
                          type="number"
                          className="w-20 h-10 px-2 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-blue-500"
                          placeholder="0"
                          value={yards}
                          onChange={(e) => setYards(e.target.value)}
                        />
                      </div>
                    )}
                  </div>
                )}

                {/* Notes + log button */}
                {editingPlayId && (
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded text-xs text-yellow-300">
                    <span>✎</span>
                    <span>Editing play — make changes above then save</span>
                    <button onClick={resetForm} className="ml-auto text-yellow-400 hover:text-white transition">Cancel</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    placeholder="Play note (optional)"
                    value={playNotes}
                    onChange={(e) => setPlayNotes(e.target.value)}
                  />
                  {editingPlayId ? (
                    <button
                      onClick={saveEditedPlay}
                      disabled={savingPlay || (!noRouteRun && targeted && playOutcome === null)}
                      className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded font-medium transition whitespace-nowrap"
                    >
                      {savingPlay ? "…" : "Save Edit"}
                    </button>
                  ) : (
                    <button
                      onClick={logPlay}
                      disabled={savingPlay || (!noRouteRun && targeted && playOutcome === null)}
                      className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition"
                    >
                      {savingPlay ? "…" : "Log Play"}
                    </button>
                  )}
                </div>
                {playError && (
                  <p className="text-red-400 text-xs">{playError}</p>
                )}

                {/* Logged plays for this game */}
                {gamePlays.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Plays This Game ({gamePlays.length})</div>
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {[...gamePlays].reverse().map((pl, i) => (
                        <div
                          key={pl.id}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${
                            editingPlayId === pl.id
                              ? "bg-yellow-900/40 border border-yellow-700/60"
                              : "bg-gray-900 border border-transparent"
                          }`}
                        >
                          <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                          {pl.no_route_run
                            ? <span className="text-amber-500 font-medium">aligned</span>
                            : <span className="text-white capitalize font-medium">{pl.route_type}</span>
                          }
                          <span className="text-gray-500 uppercase text-xs">{pl.alignment[0]}</span>
                          <span className="text-gray-600">{pl.on_line ? "OL" : "Off"}</span>
                          {!pl.no_route_run && (pl.targeted ? (
                            pl.success === true ? (
                              <span className="text-green-400">✓ {pl.yards ?? 0}yds</span>
                            ) : pl.success === false ? (
                              <span className="text-red-400">✗</span>
                            ) : (
                              <span className="text-gray-400">inc</span>
                            )
                          ) : (
                            <span className="text-gray-600">—</span>
                          ))}
                          {pl.play_notes && <span className="text-gray-500 truncate">{pl.play_notes}</span>}
                          <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => editingPlayId === pl.id ? resetForm() : startEditPlay(pl)}
                              className={`px-2 py-0.5 rounded text-xs transition ${
                                editingPlayId === pl.id
                                  ? "text-yellow-400 hover:text-white"
                                  : "text-gray-600 hover:text-yellow-400"
                              }`}
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => deletePlay(pl.id)}
                              className="text-gray-700 hover:text-red-400"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── GAMES ── */}
      {tab === "games" && (
        <div>
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : games.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              No games charted yet. Go to &quot;Chart Game&quot; to add one.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">Season</th>
                    <th className="pb-2 pr-4">Opponent</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4 text-right">Routes</th>
                    <th className="pb-2 pr-4 text-right">Targets</th>
                    <th className="pb-2 pr-4 text-right">Catches</th>
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


      {/* ── CHARTS ── */}
      {tab === "charts" && (() => {
        const current = allProspects.find((p) => p.id === prospect.id);
        if (!current) return (
          <div className="text-gray-500 text-sm text-center py-12">
            Loading prospect data…
          </div>
        );
        return <PlayerCharts prospect={current} allProspects={allProspects} />;
      })()}
    </div>
  );
}
