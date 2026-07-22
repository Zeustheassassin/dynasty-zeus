"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import { logger } from "../../../lib/logger";

const log = logger("scouting/qb/QBChartingBoard");
import ChartingBoard from "../shared/ChartingBoard";
import type { ChartingBoardConfig } from "../shared/ChartingBoard";
import { useChartingState } from "../shared/hooks/useChartingState";
import QBPlayerCharts from "./QBPlayerCharts";
import { buildQBBaselines, resolveBaselines, computeQBAAEForPlays } from "../../../lib/scouting/aboveExpected";
import type {
  Prospect,
  ProspectWithStats,
  ScoutingGame,
  QBPlay,
  QBSnapPosition,
  QBPlayType,
  QBTiming,
  QBAccuracy,
  QBCompletion,
  QBIntType,
  QBTargetPos,
  QBDepthZone,
  QBPlatform,
  QBPlatformSide,
  QBPressure,
  QBPressureHandling,
  QBTouch,
  RouteType,
} from "../../../lib/types";
import { ROUTE_TYPES } from "../shared/chartingConstants";
import { pct, fmtPct } from "../shared/chartingTypes";
import QBOverviewPanel from "./QBOverviewPanel";
import {
  SNAP_POSITIONS,
  PLAY_TYPES,
  TIMINGS,
  ACCURACIES,
  PLATFORMS,
  PLATFORM_SIDES,
  PRESSURES,
  PRESSURE_HANDLINGS,
  DEPTH_ROWS,
  onTargetColor,
} from "./qbConstants";

const QB_NFL_ROLES = ["Franchise QB", "Starter", "Bridge", "Backup", ""];

const QB_CONFIG: ChartingBoardConfig = {
  positionLabel: "QB",
  accentColor: "blue",
  nflRoles: QB_NFL_ROLES,
};

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
  allProspects: ProspectWithStats[];
  allGames: ScoutingGame[];
}

// Short display labels for the play log
const SNAP_SHORT: Record<QBSnapPosition, string> = { shotgun: "SG", pistol: "PS", under_center: "UC" };
const PLAY_SHORT: Record<QBPlayType, string>     = { run: "RUN", rpo: "RPO", pass: "PASS" };
const TIMING_SHORT: Record<QBTiming, string>     = { first_option: "1st", second_option: "2nd+", checkdown: "CK", extended_play: "EXT", scramble: "SCR", sack: "SCK", throw_away: "TA" };
const ACC_SHORT: Record<QBAccuracy, string>      = { on_target: "OT", high: "HI", low: "LO", in_front: "IF", behind: "BH", tipped_ball: "TIP" };
const DEPTH_SHORT: Record<QBDepthZone, string>   = {
  deep_left: "DL", deep_center: "DC", deep_right: "DR",
  mid_left:  "ML", mid_center:  "MC", mid_right:  "MR",
  short_left:"SL", short_center:"SC", short_right:"SR",
};

export default function QBChartingBoard({ prospect, onBack, onDataChanged, allProspects, allGames }: Props) {
  // Position-specific play state
  const [plays, setPlays]                   = useState<QBPlay[]>([]);
  // League-wide QB plays (across all charted prospects) — used to build the
  // baselines for the per-dimension AAE breakdown panel. Fetched once when
  // the board mounts; small (~MB-scale at full league) and not in a hot path.
  const [leaguePlays, setLeaguePlays]       = useState<QBPlay[]>([]);
  const [snapPos, setSnapPos]               = useState<QBSnapPosition>("shotgun");
  const [playType, setPlayType]             = useState<QBPlayType>("pass");
  const [timing, setTiming]                 = useState<QBTiming | null>(null);
  const [accuracy, setAccuracy]             = useState<QBAccuracy | null>(null);
  const [completion, setCompletion]         = useState<QBCompletion | null>(null);
  const [intType, setIntType]               = useState<QBIntType | null>(null);
  const [targetPos, setTargetPos]           = useState<QBTargetPos | null>(null);
  const [depthZone, setDepthZone]           = useState<QBDepthZone | null>(null);
  const [routeType, setRouteType]           = useState<RouteType | null>(null);
  const [coverage, setCoverage]             = useState<"man" | "zone" | null>(null);
  const [platform, setPlatform]             = useState<QBPlatform | null>(null);
  const [platformSide, setPlatformSide]     = useState<QBPlatformSide | null>(null);
  const [pressure, setPressure]             = useState<QBPressure | null>(null);
  const [pressureHandling, setPressureHandling] = useState<QBPressureHandling | null>(null);
  // Default "correct" so the charter only clicks when something's off — saves
  // a click on every throw. Resets back to "correct" after each log.
  const [touch, setTouch]                   = useState<QBTouch>("correct");
  const [playNotes, setPlayNotes]           = useState("");
  const [savingPlay, setSavingPlay]         = useState(false);
  const [playError, setPlayError]           = useState<string | null>(null);
  const [editingPlayId, setEditingPlayId]   = useState<string | null>(null);

  // Shared state via hook
  const cs = useChartingState(prospect, {
    onDataChanged,
    onDeleteGamePlays: (id) => setPlays((p) => p.filter((pl) => pl.game_id !== id)),
  });
  const { tab, games, selectedGameId, loading, showAddGame, newGame, savingGame, gameError,
          editBio, bio, savingBio,
          onTabChange, onSelectGame, onToggleAddGame, onNewGameChange,
          onAddGame, onDeleteGame, onUpdateGame, onToggleEditBio, onBioChange, onSaveBio } = cs;

  // Load plays when games change (paginated past the 1000-row PostgREST cap).
  useEffect(() => {
    if (games.length === 0) return;
    const ids = games.map((g) => g.id);
    fetchAllRows<QBPlay>((from, to) =>
      supabase.from("qb_plays").select("*").in("game_id", ids).order("created_at").range(from, to)
    )
      .then((rows) => setPlays(rows))
      .catch((err) => log.error("qb_plays load failed", { err: String(err) }));
  }, [games]);

  // Load league-wide QB plays ONCE on mount for the AAE breakdown baselines,
  // paginated past the 1000-row cap. Previously this re-downloaded the entire
  // qb_plays table on every play logged ([plays.length] dep) for almost no
  // accuracy gain — one prospect's throw barely moves a league-wide mean.
  useEffect(() => {
    fetchAllRows<QBPlay>((from, to) =>
      supabase.from("qb_plays").select("*").order("created_at").range(from, to)
    )
      .then((rows) => setLeaguePlays(rows))
      .catch((err) => log.error("qb_plays league load failed", { err: String(err) }));
  }, []);

  const gamePlays    = useMemo(() => plays.filter((p) => p.game_id === selectedGameId), [plays, selectedGameId]);

  // Header + games-log-footer stats. The full Overview computation now lives
  // inside QBOverviewPanel; this minimal memo only keeps what the surrounding
  // chrome (header bar, games log totals row) still reads.
  const headerStats = useMemo(() => {
    const passRpoPlays = plays.filter((p) => p.play_type !== "run");
    const thrownPlays  = passRpoPlays.filter((p) => p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away");
    const gradedThrows = thrownPlays.filter((p) => p.accuracy !== "tipped_ball");
    const onTargetCt   = gradedThrows.filter((p) => p.accuracy === "on_target").length;
    return {
      totalPlays: plays.length,
      thrown: thrownPlays.length,
      onTargetPct: pct(onTargetCt, gradedThrows.length),
    };
  }, [plays]);

  // Per-game play counts
  const gamePlayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plays) map[p.game_id] = (map[p.game_id] ?? 0) + 1;
    return map;
  }, [plays]);

  // Per-game accuracy by field depth (short/mid/deep). Mirrors headerStats'
  // "thrownPlays" population (play_type !== run, excludes scramble/sack/throw_away)
  // so the per-game and career numbers agree.
  const gameStats = useMemo(() => {
    const empty = () => ({ short: { count: 0, onTarget: 0 }, mid: { count: 0, onTarget: 0 }, deep: { count: 0, onTarget: 0 } });
    const map: Record<string, ReturnType<typeof empty>> = {};
    for (const p of plays) {
      if (p.play_type === "run") continue;
      if (p.timing === "scramble" || p.timing === "sack" || p.timing === "throw_away") continue;
      if (!p.depth_zone) continue;
      const zone = p.depth_zone.split("_")[0] as "short" | "mid" | "deep";
      if (!map[p.game_id]) map[p.game_id] = empty();
      map[p.game_id][zone].count++;
      if (p.accuracy === "on_target") map[p.game_id][zone].onTarget++;
    }
    return map;
  }, [plays]);

  // Per-game AAE (Accuracy Above Expected) — a quick "this game looked
  // good/bad" read. Deliberately ungated (no QB_MIN_SAMPLE floor): single-game
  // samples are always small, that's expected here. Resolved baselines are
  // built once from leaguePlays (already fetched for the Overview AAE panel)
  // and reused for every game.
  const qbResolvedBaselines = useMemo(() => resolveBaselines(buildQBBaselines(leaguePlays)), [leaguePlays]);
  const perGameAae = useMemo(() => {
    const map: Record<string, number | null> = {};
    for (const g of games) {
      const gp = plays.filter((p) => p.game_id === g.id);
      map[g.id] = computeQBAAEForPlays(gp, qbResolvedBaselines);
    }
    return map;
  }, [plays, games, qbResolvedBaselines]);

  const needPassFields = playType === "rpo" || playType === "pass";
  const noThrowTimings: QBTiming[] = ["scramble", "sack", "throw_away"];
  const needThrowFields = needPassFields && timing !== null && !noThrowTimings.includes(timing);
  // Pressure is required for every pass/rpo play once a timing is picked; Clean
  // Pocket is one of the options, so charters must always declare the rush picture.
  const needPressureFields = needPassFields && timing !== null;
  // Handling sub-section is only required when there actually was pressure.
  const needPressureHandling = needPressureFields && pressure !== null && pressure !== "clean";
  // Platform applies only to plays that ended with a throw; sacks/scrambles/throw-aways
  // don't have a meaningful platform read.
  const needPlatformFields = needThrowFields;
  const needPlatformSide = needPlatformFields && platform === "on_the_run";
  const canLog =
    !savingPlay &&
    selectedGameId !== null &&
    (!needPassFields || timing !== null) &&
    (!needThrowFields || (accuracy !== null && depthZone !== null && routeType !== null && coverage !== null)) &&
    (!needPressureFields || pressure !== null) &&
    (!needPressureHandling || pressureHandling !== null) &&
    (!needPlatformFields || platform !== null) &&
    (!needPlatformSide || platformSide !== null);

  function resetForm() {
    setEditingPlayId(null);
    setTiming(null);
    setAccuracy(null);
    setCompletion(null);
    setIntType(null);
    setTargetPos(null);
    setDepthZone(null);
    setRouteType(null);
    setCoverage(null);
    setPlatform(null);
    setPlatformSide(null);
    setPressure(null);
    setPressureHandling(null);
    setTouch("correct");
    setPlayNotes("");
  }

  function startEditPlay(pl: QBPlay) {
    setEditingPlayId(pl.id);
    setSnapPos(pl.snap_position);
    setPlayType(pl.play_type);
    setTiming(pl.timing);
    setAccuracy(pl.accuracy);
    setCompletion(pl.completion);
    setIntType(pl.int_type);
    setTargetPos(pl.target_pos);
    setDepthZone(pl.depth_zone);
    setRouteType(pl.route_type);
    setCoverage(pl.coverage);
    setPlatform(pl.platform);
    setPlatformSide(pl.platform_side);
    setPressure(pl.pressure);
    setPressureHandling(pl.pressure_handling);
    // Backfill old NULLs to "correct" — same default behaviour as a new play —
    // so editing an old row doesn't silently flip its touch reading once saved.
    setTouch(pl.touch ?? "correct");
    setPlayNotes(pl.play_notes ?? "");
  }

  function handlePlayTypeChange(pt: QBPlayType) {
    // Pass and RPO share the same downstream fields, so toggling between them
    // preserves the bottom section. Only crossing the run boundary resets it.
    const crossesRun = pt === "run" || playType === "run";
    setPlayType(pt);
    if (crossesRun) {
      setTiming(null);
      setAccuracy(null);
      setCompletion(null);
      setIntType(null);
      setTargetPos(null);
      setDepthZone(null);
      setRouteType(null);
      setCoverage(null);
      setPlatform(null);
      setPlatformSide(null);
      setPressure(null);
      setPressureHandling(null);
    }
  }

  function handleTimingChange(t: QBTiming) {
    setTiming(t);
    if (noThrowTimings.includes(t)) {
      setAccuracy(null);
      setCompletion(null);
      setIntType(null);
      setTargetPos(null);
      setDepthZone(null);
      setRouteType(null);
      setCoverage(null);
      // Platform only applies to throws, so clear when we move into a non-throw timing.
      setPlatform(null);
      setPlatformSide(null);
    }
    // Pressure is required for all timings — carry the previously-chosen value forward.
  }

  function handlePressureChange(p: QBPressure) {
    setPressure((prev) => (prev === p ? null : p));
    // Switching to (or unselecting) Clean Pocket implies no handling action; clear it
    // so the DB CHECK constraint stays satisfied and the sub-section hides cleanly.
    if (p === "clean" || pressure === p) setPressureHandling(null);
  }

  function handlePlatformChange(p: QBPlatform) {
    setPlatform((prev) => (prev === p ? null : p));
    // Any move away from "on_the_run" — or unselecting it — clears the side sub-pick.
    if (p !== "on_the_run" || platform === p) setPlatformSide(null);
  }

  async function logPlay() {
    if (!selectedGameId || !canLog) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }

    const isPass = needPassFields;
    const isThrow = needThrowFields;

    const { data, error } = await supabase.from("qb_plays").insert({
      user_id: user.id,
      game_id: selectedGameId,
      snap_position: snapPos,
      play_type: playType,
      timing:     isPass  ? timing    : null,
      accuracy:   isThrow ? accuracy   : null,
      completion: isThrow ? completion : null,
      int_type:   isThrow ? intType    : null,
      target_pos: isThrow ? targetPos  : null,
      depth_zone: isThrow ? depthZone  : null,
      route_type: isThrow ? routeType : null,
      coverage:   isThrow ? coverage  : null,
      platform:           isThrow ? platform : null,
      platform_side:      isThrow && platform === "on_the_run" ? platformSide : null,
      pressure:           isPass  ? pressure : null,
      pressure_handling:  isPass && pressure && pressure !== "clean" ? pressureHandling : null,
      touch:              isThrow ? touch : null,
      play_notes: playNotes || null,
    }).select().single();

    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => [...prev, data as QBPlay]);
      resetForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function saveEditedPlay() {
    if (!editingPlayId || !canLog) return;
    setPlayError(null);
    setSavingPlay(true);
    const isPass = needPassFields;
    const isThrow = needThrowFields;
    const { data, error } = await supabase.from("qb_plays").update({
      snap_position: snapPos,
      play_type: playType,
      timing:     isPass  ? timing     : null,
      accuracy:   isThrow ? accuracy   : null,
      completion: isThrow ? completion : null,
      int_type:   isThrow ? intType    : null,
      target_pos: isThrow ? targetPos  : null,
      depth_zone: isThrow ? depthZone  : null,
      route_type: isThrow ? routeType  : null,
      coverage:   isThrow ? coverage   : null,
      platform:           isThrow ? platform : null,
      platform_side:      isThrow && platform === "on_the_run" ? platformSide : null,
      pressure:           isPass  ? pressure : null,
      pressure_handling:  isPass && pressure && pressure !== "clean" ? pressureHandling : null,
      touch:              isThrow ? touch : null,
      play_notes: playNotes || null,
    }).eq("id", editingPlayId).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => prev.map((p) => p.id === editingPlayId ? data as QBPlay : p));
      resetForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    if (editingPlayId === id) resetForm();
    const { error } = await supabase.from("qb_plays").delete().eq("id", id);
    if (error) {
      log.error("qb_plays delete failed", { err: error.message });
      setPlayError("Couldn't delete that play — please try again.");
      return;
    }
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "chart",    label: "Chart Game" },
    { key: "games",    label: "Games" },
    { key: "charts",   label: "Charts" },
  ];

  return (
    <ChartingBoard
      prospect={prospect}
      config={QB_CONFIG}
      tabs={tabs}
      gamePlayCounts={gamePlayCounts}
      tab={tab} games={games} selectedGameId={selectedGameId} loading={loading}
      showAddGame={showAddGame} newGame={newGame} savingGame={savingGame} gameError={gameError}
      editBio={editBio} bio={bio} savingBio={savingBio}
      onBack={onBack}
      onTabChange={onTabChange} onSelectGame={onSelectGame} onToggleAddGame={onToggleAddGame}
      onNewGameChange={onNewGameChange} onAddGame={onAddGame} onDeleteGame={onDeleteGame} onUpdateGame={onUpdateGame}
      onToggleEditBio={onToggleEditBio} onBioChange={onBioChange} onSaveBio={onSaveBio}
      renderGameBadge={(g) => {
        const zs = gameStats[g.id];
        const hasStats = !!zs && (["short", "mid", "deep"] as const).some((k) => zs[k].count > 0);
        const aae = perGameAae[g.id] ?? null;
        return (
          <div className="flex items-center gap-3">
            {hasStats && (
              <div className="hidden md:flex items-center gap-3 text-[10px] whitespace-nowrap">
                {(["short", "mid", "deep"] as const).map((zone) => {
                  const s = zs![zone];
                  return (
                    <div key={zone} className="flex flex-col items-center">
                      <span className="text-slate-500 capitalize">
                        {zone} <span className="text-slate-300 font-medium">
                          {s.count > 0 ? `${Math.round((s.onTarget / s.count) * 100)}%` : "—"}
                        </span>
                      </span>
                      <span className="text-slate-600">{s.count > 0 ? `${s.onTarget}/${s.count}` : "—"}</span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className={`text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${aae == null ? "text-slate-600" : aae >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              AAE {aae == null ? "—" : `${aae >= 0 ? "+" : ""}${aae.toFixed(1)}`}
            </div>
            <div className="text-xs text-blue-400 flex-shrink-0">{gamePlayCounts[g.id] ?? 0}pl</div>
          </div>
        );
      }}
      renderHeaderStats={() => (
        <>
          <div>{headerStats.totalPlays} plays · {games.length} games</div>
          {headerStats.onTargetPct !== null && (
            <div className={onTargetColor(headerStats.onTargetPct)}>
              {headerStats.onTargetPct}% on target
            </div>
          )}
        </>
      )}
      renderOverview={() => (
        <QBOverviewPanel
          plays={plays}
          leaguePlays={leaguePlays}
          gamesCount={games.length}
          loading={loading}
        />
      )}
      renderPlayLogger={(sg) => (
        !sg ? (
          <div className="text-slate-500 text-sm text-center py-12">Select or add a game to start logging plays.</div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm font-medium text-slate-300">
              Logging: <span className="text-white">{sg.season_year} vs {sg.opponent}</span>
              <span className="ml-2 text-blue-400 text-xs">{gamePlays.length} plays</span>
            </div>

            {/* 1. Snap Position */}
            <div>
              <div className="text-xs text-slate-500 mb-2">Snap Position</div>
              <div className="flex gap-2">
                {SNAP_POSITIONS.map(({ key, label }) => (
                  <button key={key} onClick={() => setSnapPos(key)}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${snapPos === key ? "bg-blue-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Play Type */}
            <div>
              <div className="text-xs text-slate-500 mb-2">Play Type</div>
              <div className="flex gap-2">
                {PLAY_TYPES.map(({ key, label, color }) => (
                  <button key={key} onClick={() => handlePlayTypeChange(key)}
                    className={`flex-1 py-2 rounded text-sm font-bold transition ${playType === key ? `${color} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Timing — only for RPO / Pass */}
            {needPassFields && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Timing</div>
                <div className="flex flex-wrap gap-2">
                  {TIMINGS.map(({ key, label }) => (
                    <button key={key} onClick={() => handleTimingChange(key)}
                      className={`px-4 py-2 rounded text-sm font-medium transition ${
                        timing === key
                          ? key === "scramble" ? "bg-orange-600 text-white" : "bg-blue-600 text-white"
                          : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Pressure — required for every pass/rpo timing */}
            {needPressureFields && (
              <div className="space-y-3 p-4 bg-slate-900/60 rounded-lg border border-amber-900/40">
                <div>
                  <div className="text-xs text-slate-500 mb-2">Pressure</div>
                  <div className="flex flex-wrap gap-2">
                    {PRESSURES.map(({ key, label, active }) => (
                      <button key={key} onClick={() => handlePressureChange(key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${pressure === key ? `${active} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {needPressureHandling && (
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Pressure Handling</div>
                    <div className="flex flex-wrap gap-2">
                      {PRESSURE_HANDLINGS.map(({ key, label }) => (
                        <button key={key} onClick={() => setPressureHandling((h) => h === key ? null : key)}
                          className={`px-4 py-2 rounded text-sm font-medium transition ${pressureHandling === key ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 5-8. Throw details — only when timing is set and not scramble */}
            {needThrowFields && (
              <div className="space-y-4 p-4 bg-slate-900/60 rounded-lg border border-blue-900/40">
                {/* Platform */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Platform</div>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map(({ key, label }) => (
                      <button key={key} onClick={() => handlePlatformChange(key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${platform === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {needPlatformSide && (
                    <div className="mt-3">
                      <div className="text-xs text-slate-500 mb-2">Run Direction</div>
                      <div className="flex gap-2">
                        {PLATFORM_SIDES.map(({ key, label }) => (
                          <button key={key} onClick={() => setPlatformSide((s) => s === key ? null : key)}
                            className={`px-4 py-1.5 rounded text-xs font-medium transition ${platformSide === key ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accuracy */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Accuracy</div>
                  <div className="flex flex-wrap gap-2">
                    {ACCURACIES.map(({ key, label, active }) => (
                      <button key={key} onClick={() => setAccuracy((a) => a === key ? null : key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${accuracy === key ? `${active} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Touch — feathered vs fastball read. Defaults to "correct";
                    flip to "incorrect" when the velocity didn't fit the throw. */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Touch</div>
                  <div className="flex gap-2">
                    {([
                      { key: "correct",   label: "Correct",   cls: "bg-emerald-600" },
                      { key: "incorrect", label: "Incorrect", cls: "bg-red-700" },
                    ] as { key: QBTouch; label: string; cls: string }[]).map(({ key, label, cls }) => (
                      <button key={key} onClick={() => setTouch(key)}
                        className={`px-5 py-2 rounded text-sm font-medium transition ${touch === key ? `${cls} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Completion */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Result</div>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { key: "caught",       label: "Caught",       cls: "bg-emerald-600" },
                      { key: "incomplete",   label: "Incomplete",   cls: "bg-slate-600" },
                      { key: "interception", label: "Interception", cls: "bg-red-700" },
                    ] as { key: QBCompletion; label: string; cls: string }[]).map(({ key, label, cls }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setCompletion((c) => c === key ? null : key);
                          if (key !== "interception") setIntType(null);
                        }}
                        className={`px-5 py-2 rounded text-sm font-semibold transition ${
                          completion === key ? `${cls} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* INT sub-type */}
                  {completion === "interception" && (
                    <div className="mt-3">
                      <div className="text-xs text-slate-500 mb-2">INT Type</div>
                      <div className="flex gap-2 flex-wrap">
                        {([
                          { key: "bad_throw",    label: "Bad Throw" },
                          { key: "bad_decision", label: "Bad Decision" },
                          { key: "fifty_fifty",  label: "50/50 Ball" },
                          { key: "tipped",       label: "Tipped Ball" },
                        ] as { key: QBIntType; label: string }[]).map(({ key, label }) => (
                          <button
                            key={key}
                            onClick={() => setIntType((t) => t === key ? null : key)}
                            className={`px-4 py-1.5 rounded text-xs font-medium transition ${
                              intType === key ? "bg-orange-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Target Position */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Target Position</div>
                  <div className="flex gap-2">
                    {(["rb", "wr", "te"] as QBTargetPos[]).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setTargetPos((p) => p === pos ? null : pos)}
                        className={`px-6 py-2 rounded text-sm font-semibold uppercase transition ${
                          targetPos === pos ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                        }`}
                      >
                        {pos.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Depth / Location 3×3 grid */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Depth / Location</div>
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th className="pr-2 pb-1 text-slate-700 font-normal text-left" />
                        {["Left", "Center", "Right"].map((l) => (
                          <th key={l} className="px-1 pb-1 text-slate-500 font-medium text-center">{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DEPTH_ROWS.map(({ label, depths }) => (
                        <tr key={label}>
                          <td className="pr-2 py-1 text-slate-500 whitespace-nowrap text-right">{label}</td>
                          {depths.map(({ key, loc }) => (
                            <td key={key} className="px-1 py-1">
                              <button
                                onClick={() => setDepthZone((d) => d === key ? null : key)}
                                className={`w-full py-2 px-3 rounded text-xs font-medium transition whitespace-nowrap ${
                                  depthZone === key ? "bg-blue-600 text-white ring-1 ring-blue-400" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
                                }`}
                              >
                                {loc}
                              </button>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Route Type */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Route Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROUTE_TYPES.map((rt) => (
                      <button key={rt} onClick={() => setRouteType((r) => r === rt ? null : rt)}
                        className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition ${routeType === rt ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {rt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Coverage */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Coverage</div>
                  <div className="flex gap-2">
                    {(["man", "zone"] as const).map((cvg) => (
                      <button key={cvg} onClick={() => setCoverage((c) => c === cvg ? null : cvg)}
                        className={`px-6 py-2 rounded text-sm font-medium capitalize transition ${coverage === cvg ? "bg-purple-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {cvg}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Notes + Log / Save */}
            {editingPlayId && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded text-xs text-amber-300">
                <span>✎</span>
                <span>Editing play — make changes above then save</span>
                <button onClick={resetForm} className="ml-auto text-amber-400 hover:text-white transition">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <input
                className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-blue-500"
                placeholder="Play note (optional)"
                value={playNotes}
                onChange={(e) => setPlayNotes(e.target.value)}
              />
              {editingPlayId ? (
                <button onClick={saveEditedPlay} disabled={!canLog}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Save Edit"}
                </button>
              ) : (
                <button onClick={logPlay} disabled={!canLog}
                  className="px-5 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Log Play"}
                </button>
              )}
            </div>
            {playError && <p className="text-red-400 text-xs">{playError}</p>}

            {/* Logged plays for this game */}
            {gamePlays.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Plays This Game ({gamePlays.length})</div>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {[...gamePlays].reverse().map((pl, i) => (
                    <div key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${
                      editingPlayId === pl.id
                        ? "bg-amber-900/40 border border-amber-700/60"
                        : "bg-slate-900 border border-transparent"
                    }`}>
                      <span className="text-slate-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                      <span className="text-slate-500 font-medium">{SNAP_SHORT[pl.snap_position]}</span>
                      <span className={`font-bold ${pl.play_type === "run" ? "text-emerald-400" : pl.play_type === "rpo" ? "text-amber-400" : "text-blue-400"}`}>
                        {PLAY_SHORT[pl.play_type]}
                      </span>
                      {pl.timing && (
                        <span className={pl.timing === "scramble" ? "text-orange-400" : "text-slate-400"}>
                          {TIMING_SHORT[pl.timing]}
                        </span>
                      )}
                      {pl.accuracy && (
                        <span className={
                          pl.accuracy === "on_target" ? "text-emerald-400"
                          : pl.accuracy === "tipped_ball" ? "text-amber-400"
                          : "text-red-400"
                        }>
                          {ACC_SHORT[pl.accuracy]}
                        </span>
                      )}
                      {pl.target_pos && <span className="text-cyan-400 font-semibold uppercase">{pl.target_pos}</span>}
                      {pl.completion === "caught"       && <span className="text-emerald-400 font-bold">C</span>}
                      {pl.completion === "incomplete"   && <span className="text-slate-400 font-bold">INC</span>}
                      {pl.completion === "interception" && (
                        <span className="text-red-400 font-bold">
                          INT{pl.int_type ? ` (${pl.int_type === "bad_throw" ? "BT" : pl.int_type === "bad_decision" ? "BD" : pl.int_type === "fifty_fifty" ? "50" : "TP"})` : ""}
                        </span>
                      )}
                      {pl.depth_zone && <span className="text-blue-300">{DEPTH_SHORT[pl.depth_zone]}</span>}
                      {pl.route_type && <span className="text-slate-300 capitalize">{pl.route_type}</span>}
                      {pl.coverage && <span className="text-purple-400 capitalize">{pl.coverage}</span>}
                      {pl.play_notes && <span className="text-slate-500 truncate">{pl.play_notes}</span>}
                      <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => editingPlayId === pl.id ? resetForm() : startEditPlay(pl)}
                          className={`px-2 py-0.5 rounded text-xs transition ${
                            editingPlayId === pl.id
                              ? "text-amber-400 hover:text-white"
                              : "text-slate-600 hover:text-amber-400"
                          }`}
                        >
                          ✎
                        </button>
                        <button onClick={() => deletePlay(pl.id)} className="text-slate-600 hover:text-red-400">✕</button>
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
            <div className="text-slate-500 text-sm text-center py-8">Loading…</div>
          ) : games.length === 0 ? (
            <div className="text-slate-500 text-sm text-center py-8">No games charted yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-left text-xs text-slate-500">
                    <th className="pb-2 pr-4">Season</th>
                    <th className="pb-2 pr-4">Opponent</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4 text-right">Plays</th>
                    <th className="pb-2 pr-4 text-right">Throws</th>
                    <th className="pb-2 text-right">On-Target%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {games.map((g) => {
                    const gp       = plays.filter((p) => p.game_id === g.id);
                    // Match the aggregate `thrownPlays` filter — sacks and throw-aways
                    // have null accuracy and would otherwise drag on-target% down.
                    const thrown   = gp.filter((p) => p.play_type !== "run" && p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away");
                    const graded   = thrown.filter((p) => p.accuracy !== "tipped_ball");
                    const onTgt    = graded.filter((p) => p.accuracy === "on_target").length;
                    const otPct    = pct(onTgt, graded.length);
                    return (
                      <tr key={g.id} className="hover:bg-slate-900/50 transition">
                        <td className="py-2 pr-4 text-slate-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-slate-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gp.length}</td>
                        <td className="py-2 pr-4 text-right text-slate-300">{thrown.length}</td>
                        <td className={`py-2 text-right font-medium ${onTargetColor(otPct)}`}>
                          {fmtPct(otPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700 text-xs text-slate-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{headerStats.totalPlays}</td>
                    <td className="pt-2 text-right text-slate-300">{headerStats.thrown}</td>
                    <td className={`pt-2 text-right font-medium ${onTargetColor(headerStats.onTargetPct)}`}>
                      {fmtPct(headerStats.onTargetPct)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      renderExtraTab={() => (
        <QBPlayerCharts prospect={prospect} allProspects={allProspects} allGames={allGames} leaguePlays={leaguePlays} />
      )}
    />
  );
}
