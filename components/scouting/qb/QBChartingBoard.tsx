"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { logger } from "../../../lib/logger";

const log = logger("scouting/qb/QBChartingBoard");
import PlayerNotesList from "../PlayerNotesList";
import ChartingBoard from "../shared/ChartingBoard";
import type { ChartingBoardConfig } from "../shared/ChartingBoard";
import { useChartingState } from "../shared/hooks/useChartingState";
import type {
  Prospect,
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
import { computeQBAAEBreakdown } from "../../../lib/scouting/aboveExpected";

const SNAP_POSITIONS: { key: QBSnapPosition; label: string }[] = [
  { key: "shotgun",      label: "Shotgun" },
  { key: "pistol",       label: "Pistol" },
  { key: "under_center", label: "Under Center" },
];

const PLAY_TYPES: { key: QBPlayType; label: string; color: string }[] = [
  { key: "run",  label: "Run",  color: "bg-green-700" },
  { key: "rpo",  label: "RPO",  color: "bg-yellow-700" },
  { key: "pass", label: "Pass", color: "bg-blue-700" },
];

const TIMINGS: { key: QBTiming; label: string }[] = [
  { key: "first_option",  label: "1st Option" },
  { key: "second_option", label: "2nd Option +" },
  { key: "checkdown",     label: "Check Down" },
  { key: "extended_play", label: "Extended Play" },
  { key: "scramble",      label: "Scramble" },
  { key: "sack",          label: "Sack" },
  { key: "throw_away",    label: "Throw Away" },
];

const ACCURACIES: { key: QBAccuracy; label: string; active: string }[] = [
  { key: "on_target",   label: "On Target",   active: "bg-green-600" },
  { key: "high",        label: "High",        active: "bg-red-600" },
  { key: "low",         label: "Low",         active: "bg-red-700" },
  { key: "in_front",    label: "In Front",    active: "bg-orange-600" },
  { key: "behind",      label: "Behind",      active: "bg-orange-700" },
  { key: "tipped_ball", label: "Tipped Ball", active: "bg-yellow-600" },
];

const PLATFORMS: { key: QBPlatform; label: string }[] = [
  { key: "on_platform",  label: "On Platform" },
  { key: "off_platform", label: "Off Platform" },
  { key: "on_the_run",   label: "On the Run" },
];

const PLATFORM_SIDES: { key: QBPlatformSide; label: string }[] = [
  { key: "strong_side", label: "Strong Side" },
  { key: "cross_body",  label: "Cross Body" },
];

// 4-bucket platform breakdown used on the Overview panel. on_the_run is split
// by platform_side; the schema only allows platform_side when platform=on_the_run.
type PlatformBreakdownKey = "on_platform" | "off_platform" | "on_the_run_strong_side" | "on_the_run_cross_body";
const PLATFORM_BREAKDOWN: { key: PlatformBreakdownKey; label: string }[] = [
  { key: "on_platform",            label: "On Platform" },
  { key: "off_platform",           label: "Off Platform" },
  { key: "on_the_run_strong_side", label: "On the Run — Strong Side" },
  { key: "on_the_run_cross_body",  label: "On the Run — Cross Body" },
];

const PRESSURES: { key: QBPressure; label: string; active: string }[] = [
  { key: "clean",      label: "Clean Pocket",   active: "bg-emerald-700" },
  { key: "mid",        label: "Mid Pressure",   active: "bg-amber-700" },
  { key: "backside",   label: "Backside Pressure",  active: "bg-amber-700" },
  { key: "front_side", label: "Front Side Pressure", active: "bg-amber-700" },
];

const PRESSURE_HANDLINGS: { key: QBPressureHandling; label: string }[] = [
  { key: "step_up",          label: "Step Up" },
  { key: "bail_front_side",  label: "Bail Front Side" },
  { key: "bail_backside",    label: "Bail Backside" },
];

// 3×3 depth-zone grid layout: [depth label, loc label, key]
const DEPTH_ROWS: { label: string; short: string; depths: { loc: string; key: QBDepthZone }[] }[] = [
  { label: "20+ (Deep)", short: "D", depths: [
    { loc: "Left",   key: "deep_left"   },
    { loc: "Center", key: "deep_center" },
    { loc: "Right",  key: "deep_right"  },
  ]},
  { label: "10-20 (Mid)", short: "M", depths: [
    { loc: "Left",   key: "mid_left"   },
    { loc: "Center", key: "mid_center" },
    { loc: "Right",  key: "mid_right"  },
  ]},
  { label: "U10 (Short)", short: "S", depths: [
    { loc: "Left",   key: "short_left"   },
    { loc: "Center", key: "short_center" },
    { loc: "Right",  key: "short_right"  },
  ]},
];

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
}

function onTargetColor(p: number | null): string {
  if (p === null) return "text-gray-600";
  if (p >= 65) return "text-green-400";
  if (p >= 50) return "text-yellow-400";
  return "text-red-400";
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

export default function QBChartingBoard({ prospect, onBack, onDataChanged }: Props) {
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

  // Load plays when games change
  useEffect(() => {
    if (games.length === 0) return;
    const ids = games.map((g) => g.id);
    supabase.from("qb_plays").select("*").in("game_id", ids).order("created_at")
      .then(({ data, error }) => {
        if (error) { log.error("qb_plays load failed", { err: error.message }); return; }
        setPlays((data ?? []) as QBPlay[]);
      });
  }, [games]);

  // Load league-wide QB plays once for the AAE breakdown baselines. Refresh
  // whenever this prospect's plays change so the QB's own contributions are
  // up-to-date as the user backfills.
  useEffect(() => {
    supabase.from("qb_plays").select("*")
      .then(({ data, error }) => {
        if (error) { log.error("qb_plays league load failed", { err: error.message }); return; }
        setLeaguePlays((data ?? []) as QBPlay[]);
      });
  }, [plays.length]);

  const gamePlays    = useMemo(() => plays.filter((p) => p.game_id === selectedGameId), [plays, selectedGameId]);

  // Per-dimension AAE for this prospect, using full-league plays as the
  // baseline. Same math as the aggregate AAE in QBStatsTable — the totals match.
  const aaeBreakdown = useMemo(
    () => computeQBAAEBreakdown(plays, leaguePlays),
    [plays, leaguePlays],
  );

  // ── Aggregate stats ──────────────────────────────────────────
  const stats = useMemo(() => {
    const totalPlays    = plays.length;
    const runPlays      = plays.filter((p) => p.play_type === "run");
    const passRpoPlays  = plays.filter((p) => p.play_type !== "run");
    const thrownPlays   = passRpoPlays.filter((p) => p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away");
    // Tipped balls don't grade the QB — exclude from every accuracy denominator.
    const gradedThrows  = thrownPlays.filter((p) => p.accuracy !== "tipped_ball");
    const scramblePlays = passRpoPlays.filter((p) => p.timing === "scramble");

    // Snap position counts
    const snapCounts = (["shotgun", "pistol", "under_center"] as QBSnapPosition[]).reduce((acc, s) => {
      acc[s] = plays.filter((p) => p.snap_position === s).length;
      return acc;
    }, {} as Record<QBSnapPosition, number>);

    // Play type counts
    const typeCounts = (["run", "rpo", "pass"] as QBPlayType[]).reduce((acc, t) => {
      acc[t] = plays.filter((p) => p.play_type === t).length;
      return acc;
    }, {} as Record<QBPlayType, number>);

    // Timing counts (of pass+rpo plays). Extended Play has accuracy data now,
    // so include it — otherwise the Overview tab's Extended Play card renders
    // as "NaN%" because the count is undefined.
    const timingCounts = (["first_option", "second_option", "checkdown", "extended_play", "scramble", "sack", "throw_away"] as QBTiming[]).reduce((acc, t) => {
      acc[t] = passRpoPlays.filter((p) => p.timing === t).length;
      return acc;
    }, {} as Record<QBTiming, number>);

    // Accuracy counts (of graded thrown plays — tipped balls excluded)
    const accCounts = (["on_target", "high", "low", "in_front", "behind", "tipped_ball"] as QBAccuracy[]).reduce((acc, a) => {
      acc[a] = thrownPlays.filter((p) => p.accuracy === a).length;
      return acc;
    }, {} as Record<QBAccuracy, number>);
    const onTargetPct = pct(accCounts.on_target, gradedThrows.length);
    const compTracked   = thrownPlays.filter((p) => p.completion !== null).length;
    const caughtPlays   = thrownPlays.filter((p) => p.completion === "caught").length;
    const incompletePlays = thrownPlays.filter((p) => p.completion === "incomplete").length;
    const intPlays      = thrownPlays.filter((p) => p.completion === "interception").length;
    const catchPct      = pct(caughtPlays, compTracked);
    const intPct        = pct(intPlays, compTracked);
    // INT type breakdown
    const intTypeCounts: Record<QBIntType, number> = {
      bad_throw: thrownPlays.filter((p) => p.int_type === "bad_throw").length,
      bad_decision: thrownPlays.filter((p) => p.int_type === "bad_decision").length,
      fifty_fifty: thrownPlays.filter((p) => p.int_type === "fifty_fifty").length,
      tipped: thrownPlays.filter((p) => p.int_type === "tipped").length,
    };

    // Touch tracking — share of graded throws marked as "correct" velocity / feel.
    // Plays charted before migration 034 have touch=null and are ignored here
    // (kept out of both numerator and denominator) so backfill happens gradually.
    const touchTracked = gradedThrows.filter((p) => p.touch != null);
    const touchCorrect = touchTracked.filter((p) => p.touch === "correct").length;
    const touchPct = pct(touchCorrect, touchTracked.length);

    // Accuracy × depth tier — collapses the 9-zone grid into Short / Mid / Deep
    // so the Overview panel can show miss patterns at a glance (e.g. "high on
    // short" vs "behind on deep"). Tipped balls already excluded via gradedThrows.
    type DepthTier = "short" | "mid" | "deep";
    const tierOf = (z: QBDepthZone | null | undefined): DepthTier | null =>
      !z ? null : z.startsWith("short_") ? "short" : z.startsWith("mid_") ? "mid" : "deep";
    type ScoringAccuracy = Exclude<QBAccuracy, "tipped_ball">;
    const SCORING_ACCURACIES: ScoringAccuracy[] = ["on_target", "high", "low", "in_front", "behind"];
    const accByDepth = SCORING_ACCURACIES.reduce((acc, a) => {
      acc[a] = { short: 0, mid: 0, deep: 0 };
      return acc;
    }, {} as Record<ScoringAccuracy, Record<DepthTier, number>>);
    const depthTierTotals: Record<DepthTier, number> = { short: 0, mid: 0, deep: 0 };
    for (const pl of gradedThrows) {
      if (!pl.accuracy || pl.accuracy === "tipped_ball") continue;
      const tier = tierOf(pl.depth_zone);
      if (!tier) continue;
      accByDepth[pl.accuracy][tier]++;
      depthTierTotals[tier]++;
    }

    // Depth zone stats (count + on-target%)
    type ZoneStat = { count: number; onTarget: number; onTargetPct: number | null };
    const zoneStat = (key: QBDepthZone): ZoneStat => {
      const zp = gradedThrows.filter((p) => p.depth_zone === key);
      const ot = zp.filter((p) => p.accuracy === "on_target").length;
      return { count: zp.length, onTarget: ot, onTargetPct: pct(ot, zp.length) };
    };
    const zoneStats = (["deep_left","deep_center","deep_right","mid_left","mid_center","mid_right","short_left","short_center","short_right"] as QBDepthZone[])
      .reduce((acc, k) => { acc[k] = zoneStat(k); return acc; }, {} as Record<QBDepthZone, ZoneStat>);

    // Route type stats: attempts + on-target by man/zone
    type RouteStat = { total: number; onTarget: number; man: number; manOT: number; zone: number; zoneOT: number };
    const routeStats: Partial<Record<RouteType, RouteStat>> = {};
    for (const rt of ROUTE_TYPES) {
      const rp = gradedThrows.filter((p) => p.route_type === rt);
      if (rp.length === 0) continue;
      const manP  = rp.filter((p) => p.coverage === "man");
      const zoneP = rp.filter((p) => p.coverage === "zone");
      routeStats[rt] = {
        total: rp.length,
        onTarget: rp.filter((p) => p.accuracy === "on_target").length,
        man: manP.length,
        manOT: manP.filter((p) => p.accuracy === "on_target").length,
        zone: zoneP.length,
        zoneOT: zoneP.filter((p) => p.accuracy === "on_target").length,
      };
    }

    // Coverage stats
    const manP  = gradedThrows.filter((p) => p.coverage === "man");
    const zoneP = gradedThrows.filter((p) => p.coverage === "zone");
    const cvgStats = {
      man:  { count: manP.length,  onTarget: manP.filter((p) => p.accuracy === "on_target").length },
      zone: { count: zoneP.length, onTarget: zoneP.filter((p) => p.accuracy === "on_target").length },
    };

    // Platform breakdown — splits on_the_run into strong_side / cross_body so the
    // Overview panel can surface footwork patterns. Plays charted before
    // migration 032 have platform=null and don't fall into any bucket.
    const platformBreakdown = PLATFORM_BREAKDOWN.reduce((acc, { key }) => {
      acc[key] = { n: 0, ot: 0 };
      return acc;
    }, {} as Record<PlatformBreakdownKey, { n: number; ot: number }>);
    for (const pl of gradedThrows) {
      let k: PlatformBreakdownKey | null = null;
      if (pl.platform === "on_platform")  k = "on_platform";
      else if (pl.platform === "off_platform") k = "off_platform";
      else if (pl.platform === "on_the_run") {
        if (pl.platform_side === "strong_side") k = "on_the_run_strong_side";
        else if (pl.platform_side === "cross_body")  k = "on_the_run_cross_body";
      }
      if (!k) continue;
      platformBreakdown[k].n++;
      if (pl.accuracy === "on_target") platformBreakdown[k].ot++;
    }
    const platformCharted = PLATFORM_BREAKDOWN.reduce((s, { key }) => s + platformBreakdown[key].n, 0);
    const platformMissing = gradedThrows.length - platformCharted;

    // Pressure breakdown — for each of the 4 pressure types, count total plays,
    // outcomes (sack / throw-away / scramble), and on-target% among graded throws
    // in that bucket. Denominator for share% is all pass/RPO plays. Plays
    // charted before pressure existed have pressure=null and don't contribute.
    const PRESSURE_KEYS = ["clean", "mid", "backside", "front_side"] as const;
    type PressureKey = (typeof PRESSURE_KEYS)[number];
    const pressureBreakdown = PRESSURE_KEYS.reduce((acc, k) => {
      acc[k] = { total: 0, sacks: 0, throwAways: 0, scrambles: 0, gradedThrows: 0, onTarget: 0 };
      return acc;
    }, {} as Record<PressureKey, { total: number; sacks: number; throwAways: number; scrambles: number; gradedThrows: number; onTarget: number }>);
    for (const pl of passRpoPlays) {
      if (!pl.pressure) continue;
      const b = pressureBreakdown[pl.pressure];
      b.total++;
      if (pl.timing === "sack") b.sacks++;
      else if (pl.timing === "throw_away") b.throwAways++;
      else if (pl.timing === "scramble") b.scrambles++;
      else if (pl.accuracy != null && pl.accuracy !== "tipped_ball") {
        b.gradedThrows++;
        if (pl.accuracy === "on_target") b.onTarget++;
      }
    }
    const pressureCharted = PRESSURE_KEYS.reduce((s, k) => s + pressureBreakdown[k].total, 0);
    const pressureMissing = passRpoPlays.length - pressureCharted;

    return {
      totalPlays, runPlays: runPlays.length, passRpo: passRpoPlays.length,
      thrown: thrownPlays.length, graded: gradedThrows.length, scrambles: scramblePlays.length,
      snapCounts, typeCounts, timingCounts, accCounts, onTargetPct,
      compTracked, caughtPlays, incompletePlays, intPlays, catchPct, intPct, intTypeCounts,
      touchTracked: touchTracked.length, touchCorrect, touchPct,
      accByDepth, depthTierTotals,
      zoneStats, routeStats, cvgStats,
      platformBreakdown, platformCharted, platformMissing,
      pressureBreakdown, pressureCharted, pressureMissing,
    };
  }, [plays]);

  // Per-game play counts
  const gamePlayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plays) map[p.game_id] = (map[p.game_id] ?? 0) + 1;
    return map;
  }, [plays]);

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
    await supabase.from("qb_plays").delete().eq("id", id);
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "chart",    label: "Chart Game" },
    { key: "games",    label: "Games" },
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
      renderHeaderStats={() => (
        <>
          <div>{stats.totalPlays} plays · {games.length} games</div>
          {stats.onTargetPct !== null && (
            <div className={onTargetColor(stats.onTargetPct)}>
              {stats.onTargetPct}% on target
            </div>
          )}
        </>
      )}
      renderOverview={() => (
        <div className="space-y-5">
          {loading ? (
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : stats.totalPlays === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">
              No plays charted yet. Go to &quot;Chart Game&quot; to start logging.
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
                {[
                  { label: "Total Plays",  value: stats.totalPlays,  color: "text-blue-400" },
                  { label: "Runs",         value: stats.runPlays,    color: "text-green-400" },
                  { label: "Pass/RPO",     value: stats.passRpo,     color: "text-yellow-400" },
                  { label: "Throws",       value: stats.thrown,      color: "text-blue-300" },
                  { label: "Scrambles",    value: stats.scrambles,   color: "text-orange-400" },
                  { label: "Games",        value: games.length,      color: "text-gray-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Snap Position + Play Type side by side */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Snap Position */}
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Snap Position</div>
                  <div className="space-y-2">
                    {SNAP_POSITIONS.map(({ key, label }) => {
                      const n = stats.snapCounts[key];
                      const p2 = pct(n, stats.totalPlays);
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-24 flex-shrink-0">{label}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className="h-full bg-blue-600 rounded-full" style={{ width: `${p2 ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-300 w-16 text-right flex-shrink-0">
                            {n} <span className="text-gray-600">({fmtPct(p2)})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Play Type */}
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Play Type</div>
                  <div className="space-y-2">
                    {PLAY_TYPES.map(({ key, label }) => {
                      const n = stats.typeCounts[key];
                      const p2 = pct(n, stats.totalPlays);
                      const barColor = key === "run" ? "bg-green-600" : key === "rpo" ? "bg-yellow-600" : "bg-blue-600";
                      return (
                        <div key={key} className="flex items-center gap-2">
                          <span className="text-xs text-gray-400 w-10 flex-shrink-0">{label}</span>
                          <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} rounded-full`} style={{ width: `${p2 ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-gray-300 w-16 text-right flex-shrink-0">
                            {n} <span className="text-gray-600">({fmtPct(p2)})</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Timing */}
              {stats.passRpo > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Timing <span className="text-gray-700">({stats.passRpo} pass/RPO plays)</span></div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {TIMINGS.map(({ key, label }) => {
                      const n = stats.timingCounts[key];
                      const p2 = pct(n, stats.passRpo);
                      const color = key === "sack" ? "text-red-400" : key === "throw_away" ? "text-yellow-400" : key === "scramble" ? "text-orange-400" : "text-blue-300";
                      return (
                        <div key={key} className="p-3 bg-gray-800/50 rounded-lg text-center">
                          <div className="text-xs text-gray-500 mb-1">{label}</div>
                          <div className={`text-xl font-bold ${color}`}>{n}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{fmtPct(p2)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Accuracy + Catch% */}
              {stats.thrown > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3 flex flex-wrap items-center gap-3">
                    <span>
                      Accuracy <span className="text-gray-700">({stats.graded} graded throws)</span>
                      {stats.accCounts.tipped_ball > 0 && (
                        <span className="text-yellow-500/80 ml-2">+ {stats.accCounts.tipped_ball} tipped</span>
                      )}
                    </span>
                    {stats.onTargetPct !== null && (
                      <span className={`font-semibold ${onTargetColor(stats.onTargetPct)}`}>
                        {stats.onTargetPct}% on target
                      </span>
                    )}
                    {stats.compTracked > 0 && (
                      <span className={`font-semibold ${stats.catchPct !== null && stats.catchPct >= 60 ? "text-green-400" : stats.catchPct !== null && stats.catchPct >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                        {fmtPct(stats.catchPct)} catch rate
                        <span className="text-gray-600 font-normal ml-1">({stats.compTracked} tracked)</span>
                      </span>
                    )}
                    {stats.touchTracked > 0 && (
                      <span className={`font-semibold ${stats.touchPct !== null && stats.touchPct >= 80 ? "text-green-400" : stats.touchPct !== null && stats.touchPct >= 65 ? "text-yellow-400" : "text-red-400"}`}>
                        {fmtPct(stats.touchPct)} touch
                        <span className="text-gray-600 font-normal ml-1">({stats.touchCorrect}/{stats.touchTracked} correct)</span>
                      </span>
                    )}
                    {stats.intPlays > 0 && (
                      <span className="font-semibold text-red-400">
                        {stats.intPlays} INT{stats.intPlays !== 1 ? "s" : ""}
                        {stats.intPct !== null && <span className="text-red-400/70 font-normal ml-1">({stats.intPct}%)</span>}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {ACCURACIES.filter(({ key }) => key !== "tipped_ball").map(({ key, label }) => {
                      const n = stats.accCounts[key];
                      const p2 = pct(n, stats.graded);
                      const color = key === "on_target" ? "text-green-400" : "text-red-400";
                      return (
                        <div key={key} className="p-3 bg-gray-800/50 rounded-lg text-center">
                          <div className="text-xs text-gray-500 mb-1">{label}</div>
                          <div className={`text-xl font-bold ${color}`}>{n}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{fmtPct(p2)}</div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Accuracy × depth-tier breakdown — surfaces "high on short" or
                      "behind on deep" patterns the totals row collapses together. */}
                  {(stats.depthTierTotals.short + stats.depthTierTotals.mid + stats.depthTierTotals.deep) > 0 && (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-gray-500">
                            <th className="text-left font-medium pb-1.5 pr-3">By Depth</th>
                            {(["short", "mid", "deep"] as const).map((tier) => (
                              <th key={tier} className="text-right font-medium pb-1.5 pl-3">
                                <span className="capitalize">{tier === "short" ? "Short (U10)" : tier === "mid" ? "Mid (10–20)" : "Deep (20+)"}</span>
                                <span className="ml-1.5 text-gray-700 font-normal">{stats.depthTierTotals[tier]}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-800/60">
                          {ACCURACIES.filter(({ key }) => key !== "tipped_ball").map(({ key, label }) => {
                            const row = stats.accByDepth[key as Exclude<QBAccuracy, "tipped_ball">];
                            const isOnTarget = key === "on_target";
                            return (
                              <tr key={key}>
                                <td className={`py-1.5 pr-3 ${isOnTarget ? "text-green-400" : "text-gray-400"}`}>{label}</td>
                                {(["short", "mid", "deep"] as const).map((tier) => {
                                  const n = row[tier];
                                  const denom = stats.depthTierTotals[tier];
                                  const p2 = pct(n, denom);
                                  const cellColor =
                                    n === 0 ? "text-gray-700" :
                                    isOnTarget ? "text-green-400" :
                                    "text-red-400";
                                  return (
                                    <td key={tier} className={`py-1.5 pl-3 text-right font-mono ${cellColor}`}>
                                      {n}
                                      {n > 0 && (
                                        <span className="text-gray-600 font-normal ml-1">({fmtPct(p2)})</span>
                                      )}
                                    </td>
                                  );
                                })}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-gray-600 mt-1.5">Percentages are within each depth tier — e.g., 30% high in &quot;Mid&quot; means 30% of mid-depth throws were high.</p>
                    </div>
                  )}

                  {stats.compTracked > 0 && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-3">
                        <div className="flex-1 p-2.5 bg-green-900/20 border border-green-800/40 rounded-lg flex items-center justify-between">
                          <span className="text-xs text-gray-400">Caught</span>
                          <span className="text-sm font-bold text-green-400">{stats.caughtPlays} <span className="text-xs font-normal text-gray-500">/ {stats.compTracked}</span></span>
                        </div>
                        <div className="flex-1 p-2.5 bg-gray-800/50 rounded-lg flex items-center justify-between">
                          <span className="text-xs text-gray-400">Incomplete</span>
                          <span className="text-sm font-bold text-gray-300">{stats.incompletePlays}</span>
                        </div>
                        <div className="flex-1 p-2.5 bg-red-900/20 border border-red-800/40 rounded-lg flex items-center justify-between">
                          <span className="text-xs text-gray-400">INT</span>
                          <span className="text-sm font-bold text-red-400">{stats.intPlays}</span>
                        </div>
                        <div className="flex-1 p-2.5 bg-gray-800/50 rounded-lg flex items-center justify-between">
                          <span className="text-xs text-gray-400">Catch%</span>
                          <span className={`text-sm font-bold ${onTargetColor(stats.catchPct)}`}>{fmtPct(stats.catchPct)}</span>
                        </div>
                      </div>
                      {stats.intPlays > 0 && (
                        <div className="flex gap-2">
                          {([
                            { key: "bad_throw",    label: "Bad Throw" },
                            { key: "bad_decision", label: "Bad Decision" },
                            { key: "fifty_fifty",  label: "50/50 Ball" },
                            { key: "tipped",       label: "Tipped Ball" },
                          ] as { key: QBIntType; label: string }[]).map(({ key, label }) => {
                            const n = stats.intTypeCounts[key];
                            return (
                              <div key={key} className="flex-1 p-2 bg-orange-900/20 border border-orange-800/30 rounded text-center">
                                <div className="text-xs text-gray-500 mb-0.5">{label}</div>
                                <div className="text-sm font-bold text-orange-300">{n || "—"}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Platform breakdown — count + share of throws + on-target% per bucket */}
              {stats.platformCharted > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3 flex flex-wrap items-baseline gap-3">
                    <span>
                      Platform <span className="text-gray-700">({stats.platformCharted} of {stats.graded} graded throws charted)</span>
                    </span>
                    {stats.platformMissing > 0 && (
                      <span className="text-yellow-500/70 text-[10px]">{stats.platformMissing} missing platform data</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {PLATFORM_BREAKDOWN.map(({ key, label }) => {
                      const b = stats.platformBreakdown[key];
                      const sharePct = pct(b.n, stats.graded);
                      const otPct = pct(b.ot, b.n);
                      return (
                        <div key={key} className="p-3 bg-gray-800/50 rounded-lg text-center">
                          <div className="text-xs text-gray-500 mb-1">{label}</div>
                          <div className="text-xl font-bold text-blue-300">{b.n}</div>
                          <div className="text-xs text-gray-600 mt-0.5">{fmtPct(sharePct)} of throws</div>
                          <div className={`text-xs font-semibold mt-1 ${onTargetColor(otPct)}`}>{fmtPct(otPct)} on target</div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-3">
                    Share % uses all {stats.graded} graded throws as the denominator, so the four buckets may sum to less than 100% when older plays lack platform data. On-target % is within each bucket.
                  </p>
                </div>
              )}

              {/* Pressure breakdown — sacks / TAs / scrambles + on-target% per bucket */}
              {stats.pressureCharted > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3 flex flex-wrap items-baseline gap-3">
                    <span>
                      Pressure <span className="text-gray-700">({stats.pressureCharted} of {stats.passRpo} pass/RPO plays charted)</span>
                    </span>
                    {stats.pressureMissing > 0 && (
                      <span className="text-yellow-500/70 text-[10px]">{stats.pressureMissing} missing pressure data</span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {PRESSURES.map(({ key, label }) => {
                      const b = stats.pressureBreakdown[key];
                      const sharePct = pct(b.total, stats.passRpo);
                      const otPct = pct(b.onTarget, b.gradedThrows);
                      const titleColor = key === "clean" ? "text-emerald-300" : "text-amber-300";
                      return (
                        <div key={key} className="p-3 bg-gray-800/50 rounded-lg">
                          <div className="text-xs text-gray-500 mb-1 text-center">{label}</div>
                          <div className={`text-xl font-bold text-center ${titleColor}`}>{b.total}</div>
                          <div className="text-xs text-gray-600 mt-0.5 text-center">{fmtPct(sharePct)} of pass/RPO</div>
                          <div className={`text-xs font-semibold mt-2 text-center ${onTargetColor(otPct)}`}>
                            {fmtPct(otPct)} on target
                            <span className="block text-gray-600 font-normal text-[10px]">({b.gradedThrows} graded)</span>
                          </div>
                          <div className="mt-2 pt-2 border-t border-gray-700/40 grid grid-cols-3 gap-1 text-[10px] text-center">
                            <div>
                              <div className="text-gray-500">Sacks</div>
                              <div className="text-red-400 font-semibold">{b.sacks}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">T.A.</div>
                              <div className="text-yellow-400 font-semibold">{b.throwAways}</div>
                            </div>
                            <div>
                              <div className="text-gray-500">Scr.</div>
                              <div className="text-orange-400 font-semibold">{b.scrambles}</div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-3">
                    Share % uses all {stats.passRpo} pass/RPO plays as the denominator. On-target % is within each pressure bucket, computed from graded throws only (sacks, throw-aways, scrambles, and tipped balls excluded).
                  </p>
                </div>
              )}

              {/* Per-Dimension AAE Breakdown */}
              {stats.graded > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3 flex flex-wrap items-baseline gap-3">
                    <span>AAE Breakdown <span className="text-gray-700">— vs league baseline, by dimension</span></span>
                    {aaeBreakdown.total !== null ? (
                      <span className={`text-sm font-bold ${aaeBreakdown.total > 0 ? "text-green-400" : aaeBreakdown.total < 0 ? "text-red-400" : "text-gray-400"}`}>
                        {aaeBreakdown.total > 0 ? "+" : ""}{aaeBreakdown.total.toFixed(2)} pp
                      </span>
                    ) : (
                      <span className="text-xs text-gray-600">no comparable league data yet</span>
                    )}
                    <span className="text-xs text-gray-600 ml-auto">{aaeBreakdown.ratedPasses} graded throws</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    {aaeBreakdown.dims.map(({ key, label, aae, n }) => {
                      const isLowN = n > 0 && n < 5;
                      const color =
                        aae === null ? "text-gray-600" :
                        aae > 0 ? "text-green-400" :
                        aae < 0 ? "text-red-400" :
                        "text-gray-400";
                      return (
                        <div key={key} className="p-3 bg-gray-800/50 rounded-lg flex items-baseline justify-between gap-2">
                          <span className="text-xs text-gray-400">{label}</span>
                          <div className="flex items-baseline gap-2">
                            <span className={`text-sm font-bold ${color}`}>
                              {aae === null ? "—" : `${aae > 0 ? "+" : ""}${aae.toFixed(1)} pp`}
                            </span>
                            <span className={`text-[10px] ${isLowN ? "text-yellow-500/70" : "text-gray-600"}`} title={isLowN ? "Low sample — interpret cautiously" : undefined}>
                              {n}p
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-gray-600 mt-3">
                    Each dimension compares this QB&apos;s on-target% to the league baseline weighted by his mix in that dimension. Null (&quot;—&quot;) means no plays had that dimension filled, or no league plays exist yet for those buckets. The overall AAE up top is the mean of the non-null rows.
                  </p>
                </div>
              )}

              {/* Depth Zone Grid */}
              {stats.thrown > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Accuracy by Depth &amp; Location <span className="text-gray-700">— Att · On-Target%</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[320px]">
                      <thead>
                        <tr className="text-gray-600">
                          <th className="text-left pb-2 pr-2 font-medium">Depth</th>
                          {["Left", "Center", "Right"].map((l) => (
                            <th key={l} className="text-center pb-2 px-2 font-medium">{l}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {DEPTH_ROWS.map(({ label, depths }) => (
                          <tr key={label} className="border-t border-gray-800">
                            <td className="py-2 pr-2 text-gray-500 whitespace-nowrap">{label}</td>
                            {depths.map(({ key }) => {
                              const z = stats.zoneStats[key];
                              return (
                                <td key={key} className="py-2 px-2 text-center">
                                  {z.count > 0 ? (
                                    <div>
                                      <div className="text-gray-400">{z.count} att</div>
                                      <div className={`font-semibold ${onTargetColor(z.onTargetPct)}`}>
                                        {fmtPct(z.onTargetPct)}
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="text-gray-700">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Route Type × Coverage accuracy */}
              {Object.keys(stats.routeStats).length > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Accuracy by Route Type &amp; Coverage <span className="text-gray-700">— Att · On-Target%</span></div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs min-w-[500px]">
                      <thead>
                        <tr className="border-b border-gray-800 text-gray-600">
                          <th className="text-left pb-1.5 pr-3 font-medium">Route</th>
                          <th className="text-right pb-1.5 px-2">Total</th>
                          <th className="text-right pb-1.5 px-2">OT%</th>
                          <th className="text-right pb-1.5 px-2 text-purple-500">Man</th>
                          <th className="text-right pb-1.5 px-2 text-purple-500">M OT%</th>
                          <th className="text-right pb-1.5 px-2 text-teal-500">Zone</th>
                          <th className="text-right pb-1.5 pl-2 text-teal-500">Z OT%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {ROUTE_TYPES
                          .filter((rt) => stats.routeStats[rt])
                          .sort((a, b) => (stats.routeStats[b]?.total ?? 0) - (stats.routeStats[a]?.total ?? 0))
                          .map((rt) => {
                            const rs = stats.routeStats[rt]!;
                            const otPct   = pct(rs.onTarget, rs.total);
                            const manOTPct  = pct(rs.manOT,  rs.man);
                            const zoneOTPct = pct(rs.zoneOT, rs.zone);
                            return (
                              <tr key={rt} className="hover:bg-gray-800/40">
                                <td className="py-1.5 pr-3 text-white font-medium capitalize">{rt}</td>
                                <td className="py-1.5 px-2 text-right text-blue-400">{rs.total}</td>
                                <td className={`py-1.5 px-2 text-right font-semibold ${onTargetColor(otPct)}`}>
                                  {fmtPct(otPct)}
                                </td>
                                <td className="py-1.5 px-2 text-right text-gray-400">{rs.man || "—"}</td>
                                <td className={`py-1.5 px-2 text-right ${onTargetColor(manOTPct)}`}>
                                  {rs.man > 0 ? fmtPct(manOTPct) : "—"}
                                </td>
                                <td className="py-1.5 px-2 text-right text-gray-400">{rs.zone || "—"}</td>
                                <td className={`py-1.5 pl-2 text-right ${onTargetColor(zoneOTPct)}`}>
                                  {rs.zone > 0 ? fmtPct(zoneOTPct) : "—"}
                                </td>
                              </tr>
                            );
                          })}
                      </tbody>
                    </table>
                    <div className="mt-2 flex gap-4 text-[10px] text-gray-600">
                      <span><span className="text-purple-500">M</span> = Man coverage</span>
                      <span><span className="text-teal-500">Z</span> = Zone coverage</span>
                      <span>OT% = on-target percentage</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Coverage summary */}
              {stats.thrown > 0 && (stats.cvgStats.man.count > 0 || stats.cvgStats.zone.count > 0) && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Accuracy by Coverage</div>
                  <div className="grid grid-cols-2 gap-4">
                    {(["man", "zone"] as const).map((cvg) => {
                      const c = stats.cvgStats[cvg];
                      const otPct = pct(c.onTarget, c.count);
                      return (
                        <div key={cvg} className="p-3 bg-gray-800/50 rounded-lg">
                          <div className="text-xs text-gray-400 font-medium mb-2 capitalize">vs. {cvg}</div>
                          <div className="space-y-1 text-xs">
                            <div className="flex justify-between"><span className="text-gray-500">Throws</span><span className="text-gray-300">{c.count}</span></div>
                            <div className="flex justify-between"><span className="text-gray-500">On Target</span><span className="text-green-300">{c.onTarget || "—"}</span></div>
                            <div className="flex justify-between border-t border-gray-700 pt-1">
                              <span className="text-gray-500">On Target%</span>
                              <span className={`font-semibold ${onTargetColor(otPct)}`}>{fmtPct(otPct)}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Play Notes */}
              <PlayerNotesList
                totalPlays={stats.totalPlays}
                notes={plays.map((p) => p.play_notes).filter((n): n is string => !!(n?.trim()))}
              />
            </>
          )}
        </div>
      )}
      renderPlayLogger={(sg) => (
        !sg ? (
          <div className="text-gray-500 text-sm text-center py-12">Select or add a game to start logging plays.</div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm font-medium text-gray-300">
              Logging: <span className="text-white">{sg.season_year} vs {sg.opponent}</span>
              <span className="ml-2 text-blue-400 text-xs">{gamePlays.length} plays</span>
            </div>

            {/* 1. Snap Position */}
            <div>
              <div className="text-xs text-gray-500 mb-2">Snap Position</div>
              <div className="flex gap-2">
                {SNAP_POSITIONS.map(({ key, label }) => (
                  <button key={key} onClick={() => setSnapPos(key)}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${snapPos === key ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Play Type */}
            <div>
              <div className="text-xs text-gray-500 mb-2">Play Type</div>
              <div className="flex gap-2">
                {PLAY_TYPES.map(({ key, label, color }) => (
                  <button key={key} onClick={() => handlePlayTypeChange(key)}
                    className={`flex-1 py-2 rounded text-sm font-bold transition ${playType === key ? `${color} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Timing — only for RPO / Pass */}
            {needPassFields && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Timing</div>
                <div className="flex flex-wrap gap-2">
                  {TIMINGS.map(({ key, label }) => (
                    <button key={key} onClick={() => handleTimingChange(key)}
                      className={`px-4 py-2 rounded text-sm font-medium transition ${
                        timing === key
                          ? key === "scramble" ? "bg-orange-600 text-white" : "bg-blue-600 text-white"
                          : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                      }`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Pressure — required for every pass/rpo timing */}
            {needPressureFields && (
              <div className="space-y-3 p-4 bg-gray-900/60 rounded-lg border border-amber-900/40">
                <div>
                  <div className="text-xs text-gray-500 mb-2">Pressure</div>
                  <div className="flex flex-wrap gap-2">
                    {PRESSURES.map(({ key, label, active }) => (
                      <button key={key} onClick={() => handlePressureChange(key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${pressure === key ? `${active} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {needPressureHandling && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Pressure Handling</div>
                    <div className="flex flex-wrap gap-2">
                      {PRESSURE_HANDLINGS.map(({ key, label }) => (
                        <button key={key} onClick={() => setPressureHandling((h) => h === key ? null : key)}
                          className={`px-4 py-2 rounded text-sm font-medium transition ${pressureHandling === key ? "bg-amber-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
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
              <div className="space-y-4 p-4 bg-gray-900/60 rounded-lg border border-blue-900/40">
                {/* Platform */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Platform</div>
                  <div className="flex flex-wrap gap-2">
                    {PLATFORMS.map(({ key, label }) => (
                      <button key={key} onClick={() => handlePlatformChange(key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${platform === key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {needPlatformSide && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-500 mb-2">Run Direction</div>
                      <div className="flex gap-2">
                        {PLATFORM_SIDES.map(({ key, label }) => (
                          <button key={key} onClick={() => setPlatformSide((s) => s === key ? null : key)}
                            className={`px-4 py-1.5 rounded text-xs font-medium transition ${platformSide === key ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Accuracy */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Accuracy</div>
                  <div className="flex flex-wrap gap-2">
                    {ACCURACIES.map(({ key, label, active }) => (
                      <button key={key} onClick={() => setAccuracy((a) => a === key ? null : key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${accuracy === key ? `${active} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Touch — feathered vs fastball read. Defaults to "correct";
                    flip to "incorrect" when the velocity didn't fit the throw. */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Touch</div>
                  <div className="flex gap-2">
                    {([
                      { key: "correct",   label: "Correct",   cls: "bg-green-600" },
                      { key: "incorrect", label: "Incorrect", cls: "bg-red-700" },
                    ] as { key: QBTouch; label: string; cls: string }[]).map(({ key, label, cls }) => (
                      <button key={key} onClick={() => setTouch(key)}
                        className={`px-5 py-2 rounded text-sm font-medium transition ${touch === key ? `${cls} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Completion */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Result</div>
                  <div className="flex gap-2 flex-wrap">
                    {([
                      { key: "caught",       label: "Caught",       cls: "bg-green-600" },
                      { key: "incomplete",   label: "Incomplete",   cls: "bg-gray-600" },
                      { key: "interception", label: "Interception", cls: "bg-red-700" },
                    ] as { key: QBCompletion; label: string; cls: string }[]).map(({ key, label, cls }) => (
                      <button
                        key={key}
                        onClick={() => {
                          setCompletion((c) => c === key ? null : key);
                          if (key !== "interception") setIntType(null);
                        }}
                        className={`px-5 py-2 rounded text-sm font-semibold transition ${
                          completion === key ? `${cls} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* INT sub-type */}
                  {completion === "interception" && (
                    <div className="mt-3">
                      <div className="text-xs text-gray-500 mb-2">INT Type</div>
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
                              intType === key ? "bg-orange-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
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
                  <div className="text-xs text-gray-500 mb-2">Target Position</div>
                  <div className="flex gap-2">
                    {(["rb", "wr", "te"] as QBTargetPos[]).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setTargetPos((p) => p === pos ? null : pos)}
                        className={`px-6 py-2 rounded text-sm font-semibold uppercase transition ${
                          targetPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                        }`}
                      >
                        {pos.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Depth / Location 3×3 grid */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Depth / Location</div>
                  <table className="text-xs">
                    <thead>
                      <tr>
                        <th className="pr-2 pb-1 text-gray-700 font-normal text-left" />
                        {["Left", "Center", "Right"].map((l) => (
                          <th key={l} className="px-1 pb-1 text-gray-500 font-medium text-center">{l}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DEPTH_ROWS.map(({ label, depths }) => (
                        <tr key={label}>
                          <td className="pr-2 py-1 text-gray-500 whitespace-nowrap text-right">{label}</td>
                          {depths.map(({ key, loc }) => (
                            <td key={key} className="px-1 py-1">
                              <button
                                onClick={() => setDepthZone((d) => d === key ? null : key)}
                                className={`w-full py-2 px-3 rounded text-xs font-medium transition whitespace-nowrap ${
                                  depthZone === key ? "bg-blue-600 text-white ring-1 ring-blue-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"
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
                  <div className="text-xs text-gray-500 mb-2">Route Type</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROUTE_TYPES.map((rt) => (
                      <button key={rt} onClick={() => setRouteType((r) => r === rt ? null : rt)}
                        className={`px-3 py-1.5 rounded text-xs font-medium capitalize transition ${routeType === rt ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {rt}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Coverage */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Coverage</div>
                  <div className="flex gap-2">
                    {(["man", "zone"] as const).map((cvg) => (
                      <button key={cvg} onClick={() => setCoverage((c) => c === cvg ? null : cvg)}
                        className={`px-6 py-2 rounded text-sm font-medium capitalize transition ${coverage === cvg ? "bg-purple-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {cvg}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Notes + Log / Save */}
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
                <button onClick={saveEditedPlay} disabled={!canLog}
                  className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-40 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Save Edit"}
                </button>
              ) : (
                <button onClick={logPlay} disabled={!canLog}
                  className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Log Play"}
                </button>
              )}
            </div>
            {playError && <p className="text-red-400 text-xs">{playError}</p>}

            {/* Logged plays for this game */}
            {gamePlays.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Plays This Game ({gamePlays.length})</div>
                <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                  {[...gamePlays].reverse().map((pl, i) => (
                    <div key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${
                      editingPlayId === pl.id
                        ? "bg-yellow-900/40 border border-yellow-700/60"
                        : "bg-gray-900 border border-transparent"
                    }`}>
                      <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                      <span className="text-gray-500 font-medium">{SNAP_SHORT[pl.snap_position]}</span>
                      <span className={`font-bold ${pl.play_type === "run" ? "text-green-400" : pl.play_type === "rpo" ? "text-yellow-400" : "text-blue-400"}`}>
                        {PLAY_SHORT[pl.play_type]}
                      </span>
                      {pl.timing && (
                        <span className={pl.timing === "scramble" ? "text-orange-400" : "text-gray-400"}>
                          {TIMING_SHORT[pl.timing]}
                        </span>
                      )}
                      {pl.accuracy && (
                        <span className={
                          pl.accuracy === "on_target" ? "text-green-400"
                          : pl.accuracy === "tipped_ball" ? "text-yellow-400"
                          : "text-red-400"
                        }>
                          {ACC_SHORT[pl.accuracy]}
                        </span>
                      )}
                      {pl.target_pos && <span className="text-cyan-400 font-semibold uppercase">{pl.target_pos}</span>}
                      {pl.completion === "caught"       && <span className="text-green-400 font-bold">C</span>}
                      {pl.completion === "incomplete"   && <span className="text-gray-400 font-bold">INC</span>}
                      {pl.completion === "interception" && (
                        <span className="text-red-400 font-bold">
                          INT{pl.int_type ? ` (${pl.int_type === "bad_throw" ? "BT" : pl.int_type === "bad_decision" ? "BD" : pl.int_type === "fifty_fifty" ? "50" : "TP"})` : ""}
                        </span>
                      )}
                      {pl.depth_zone && <span className="text-blue-300">{DEPTH_SHORT[pl.depth_zone]}</span>}
                      {pl.route_type && <span className="text-gray-300 capitalize">{pl.route_type}</span>}
                      {pl.coverage && <span className="text-purple-400 capitalize">{pl.coverage}</span>}
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
                        <button onClick={() => deletePlay(pl.id)} className="text-gray-600 hover:text-red-400">✕</button>
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
            <div className="text-gray-500 text-sm text-center py-8">No games charted yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">Season</th>
                    <th className="pb-2 pr-4">Opponent</th>
                    <th className="pb-2 pr-4">Type</th>
                    <th className="pb-2 pr-4 text-right">Plays</th>
                    <th className="pb-2 pr-4 text-right">Throws</th>
                    <th className="pb-2 text-right">On-Target%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900">
                  {games.map((g) => {
                    const gp       = plays.filter((p) => p.game_id === g.id);
                    // Match the aggregate `thrownPlays` filter — sacks and throw-aways
                    // have null accuracy and would otherwise drag on-target% down.
                    const thrown   = gp.filter((p) => p.play_type !== "run" && p.timing !== "scramble" && p.timing !== "sack" && p.timing !== "throw_away");
                    const graded   = thrown.filter((p) => p.accuracy !== "tipped_ball");
                    const onTgt    = graded.filter((p) => p.accuracy === "on_target").length;
                    const otPct    = pct(onTgt, graded.length);
                    return (
                      <tr key={g.id} className="hover:bg-gray-900/50 transition">
                        <td className="py-2 pr-4 text-gray-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-gray-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gp.length}</td>
                        <td className="py-2 pr-4 text-right text-gray-300">{thrown.length}</td>
                        <td className={`py-2 text-right font-medium ${onTargetColor(otPct)}`}>
                          {fmtPct(otPct)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{stats.totalPlays}</td>
                    <td className="pt-2 text-right text-gray-300">{stats.thrown}</td>
                    <td className={`pt-2 text-right font-medium ${onTargetColor(stats.onTargetPct)}`}>
                      {fmtPct(stats.onTargetPct)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
    />
  );
}
