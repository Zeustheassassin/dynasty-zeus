"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { fetchAllRows } from "../../../lib/scouting/fetchPlays";
import { logger } from "../../../lib/logger";

const log = logger("scouting/rb/RBChartingBoard");
import PlayerNotesList from "../PlayerNotesList";
import ChartingBoard from "../shared/ChartingBoard";
import type { ChartingBoardConfig } from "../shared/ChartingBoard";
import { useChartingState } from "../shared/hooks/useChartingState";
import { pct } from "../shared/chartingTypes";
import RBPlayerCharts from "./RBPlayerCharts";
import type {
  Prospect,
  ProspectWithStats,
  ScoutingGame,
  RBPlay,
  RBFormation,
  RBRunType,
  RBRouteType,
} from "../../../lib/types";

// A "run play" is a designed carry — excludes pass-block, run-block, decoy, and
// pure route plays. Single source of truth so the aggregate Run Att (footer) and
// the per-game Run Att / Suc% can't disagree (they previously used different sets).
const isRunPlay = (p: RBPlay): boolean =>
  p.run_type !== "pass_block" &&
  p.run_type !== "run_block" &&
  p.run_type !== "decoy" &&
  p.run_type !== "route";

const FORMATIONS: { key: RBFormation; label: string }[] = [
  { key: "gun",          label: "Gun" },
  { key: "pistol",       label: "Pistol" },
  { key: "under_center", label: "Under Center" },
];

const NFL_ROLES = ["Bellcow", "1A/1B", "Lead Back", "Receiving Back", "Change-of-Pace", "Committee", ""];

const RB_CONFIG: ChartingBoardConfig = {
  positionLabel: "RB",
  accentColor: "green",
  nflRoles: NFL_ROLES,
};

interface RunTypeStat {
  attempts: number;
  successes: number;
  successPct: number | null;
  loadedBox: number;
  loadedBoxPct: number | null;
  loadedBoxSuccesses: number;
  loadedBoxSuccessPct: number | null;
  unblocked: number;
  unblockedPct: number | null;
  unblockedSuccesses: number;
  unblockedSuccessPct: number | null;
}

function computeRunTypeStat(plays: RBPlay[]): RunTypeStat {
  const attempts = plays.length;
  const successes = plays.filter((p) => p.success === true).length;
  const lb = plays.filter((p) => p.loaded_box);
  const ub = plays.filter((p) => p.unblocked_defender);
  return {
    attempts,
    successes,
    successPct: pct(successes, attempts),
    loadedBox: lb.length,
    loadedBoxPct: pct(lb.length, attempts),
    loadedBoxSuccesses: lb.filter((p) => p.success === true).length,
    loadedBoxSuccessPct: pct(lb.filter((p) => p.success === true).length, lb.length),
    unblocked: ub.length,
    unblockedPct: pct(ub.length, attempts),
    unblockedSuccesses: ub.filter((p) => p.success === true).length,
    unblockedSuccessPct: pct(ub.filter((p) => p.success === true).length, ub.length),
  };
}

function mergeRunTypeStats(a: RunTypeStat, b: RunTypeStat): RunTypeStat {
  const attempts = a.attempts + b.attempts;
  const successes = a.successes + b.successes;
  const lb = a.loadedBox + b.loadedBox;
  const lbSuc = a.loadedBoxSuccesses + b.loadedBoxSuccesses;
  const ub = a.unblocked + b.unblocked;
  const ubSuc = a.unblockedSuccesses + b.unblockedSuccesses;
  return {
    attempts, successes, successPct: pct(successes, attempts),
    loadedBox: lb, loadedBoxPct: pct(lb, attempts),
    loadedBoxSuccesses: lbSuc, loadedBoxSuccessPct: pct(lbSuc, lb),
    unblocked: ub, unblockedPct: pct(ub, attempts),
    unblockedSuccesses: ubSuc, unblockedSuccessPct: pct(ubSuc, ub),
  };
}

function StatRow({ label, s, indent }: { label: string; s: RunTypeStat; indent?: boolean }) {
  const successColor = s.successPct !== null
    ? s.successPct >= 55 ? "text-emerald-400" : s.successPct >= 40 ? "text-amber-400" : "text-red-400"
    : "text-slate-600";
  return (
    <tr className="border-b border-slate-800/60 hover:bg-slate-800/30">
      <td className={`py-2 pr-2 text-sm font-medium ${indent ? "pl-5 text-slate-400 text-xs" : "text-white"}`}>
        {indent && <span className="text-slate-600 mr-1">↳</span>}{label}
      </td>
      <td className="py-2 px-2 text-right text-sm text-blue-400">{s.attempts || "—"}</td>
      <td className={`py-2 px-2 text-right text-sm font-semibold ${successColor}`}>
        {s.successPct !== null ? `${s.successPct}%` : "—"}
      </td>
      <td className="py-2 px-2 text-right text-xs text-slate-400">
        {s.loadedBox > 0 ? `${s.loadedBox}` : "—"}
        {s.loadedBoxPct !== null && <span className="text-slate-600 ml-1">({s.loadedBoxPct}%)</span>}
      </td>
      <td className={`py-2 px-2 text-right text-xs font-medium ${s.loadedBoxSuccessPct !== null ? (s.loadedBoxSuccessPct >= 50 ? "text-emerald-400" : "text-red-400") : "text-slate-600"}`}>
        {s.loadedBoxSuccessPct !== null ? `${s.loadedBoxSuccessPct}%` : "—"}
      </td>
      <td className="py-2 px-2 text-right text-xs text-slate-400">
        {s.unblocked > 0 ? `${s.unblocked}` : "—"}
        {s.unblockedPct !== null && <span className="text-slate-600 ml-1">({s.unblockedPct}%)</span>}
      </td>
      <td className={`py-2 pl-2 text-right text-xs font-medium ${s.unblockedSuccessPct !== null ? (s.unblockedSuccessPct >= 50 ? "text-emerald-400" : "text-red-400") : "text-slate-600"}`}>
        {s.unblockedSuccessPct !== null ? `${s.unblockedSuccessPct}%` : "—"}
      </td>
    </tr>
  );
}

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
  allProspects: ProspectWithStats[];
  allGames: ScoutingGame[];
  leaguePlays: RBPlay[];
}

export default function RBChartingBoard({ prospect, onBack, onDataChanged, allProspects, allGames, leaguePlays }: Props) {
  // Position-specific play state
  const [plays, setPlays]                         = useState<RBPlay[]>([]);
  const [formation, setFormation]                 = useState<RBFormation>("gun");
  const [runType, setRunType]                     = useState<RBRunType>("outside_zone");
  const [success, setSuccess]                     = useState<boolean | null>(null);
  const [loadedBox, setLoadedBox]                 = useState(false);
  const [unblockedDefender, setUnblockedDefender] = useState(false);
  const [brokenTackle, setBrokenTackle]           = useState(false);
  const [explosivePlay, setExplosivePlay]         = useState(false);
  const [runStuff, setRunStuff]                   = useState(false);
  const [alignedAsWr, setAlignedAsWr]             = useState(false);
  const [rbRouteType, setRbRouteType]             = useState<RBRouteType | null>(null);
  const [rbWasOpen, setRbWasOpen]                 = useState(false);
  const [rbTargeted, setRbTargeted]               = useState(false);
  const [rbOutcome, setRbOutcome]                 = useState<"caught" | "drop" | "incomplete" | null>(null);
  const [playNotes, setPlayNotes]                 = useState("");
  const [savingPlay, setSavingPlay]               = useState(false);
  const [playError, setPlayError]                 = useState<string | null>(null);
  const [editingPlayId, setEditingPlayId]         = useState<string | null>(null);

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
    fetchAllRows<RBPlay>((from, to) =>
      supabase.from("rb_plays").select("*").in("game_id", ids).order("created_at").range(from, to)
    )
      .then((rows) => setPlays(rows))
      .catch((err) => log.error("rb_plays load failed", { err: String(err) }));
  }, [games]);

  const gamePlays = useMemo(() => plays.filter((p) => p.game_id === selectedGameId), [plays, selectedGameId]);

  // ── Aggregate stats ───────────────────────────────────────────
  const stats = useMemo(() => {
    const runPlays = plays.filter(isRunPlay);
    const routeRuns = plays.filter((p) => p.run_type === "route");
    const runAttempts = runPlays.length;

    // Formation breakdown (run plays only, not block/decoy/route plays)
    const formationStats = (["gun", "pistol", "under_center"] as RBFormation[]).reduce((acc, f) => {
      const fp = plays.filter((p) => p.formation === f && isRunPlay(p));
      const suc = fp.filter((p) => p.success === true).length;
      acc[f] = { attempts: fp.length, successes: suc, successPct: pct(suc, fp.length) };
      return acc;
    }, {} as Record<RBFormation, { attempts: number; successes: number; successPct: number | null }>);

    // Run type breakdown
    const outsideManGap = computeRunTypeStat(plays.filter((p) => p.run_type === "outside_man_gap"));
    const insideManGap  = computeRunTypeStat(plays.filter((p) => p.run_type === "inside_man_gap"));
    const outsideZone   = computeRunTypeStat(plays.filter((p) => p.run_type === "outside_zone"));
    const insideZone    = computeRunTypeStat(plays.filter((p) => p.run_type === "inside_zone"));
    const passBlock     = computeRunTypeStat(plays.filter((p) => p.run_type === "pass_block"));
    const runBlock      = computeRunTypeStat(plays.filter((p) => p.run_type === "run_block"));
    const decoyPlays    = plays.filter((p) => p.run_type === "decoy");
    const manGap        = mergeRunTypeStats(outsideManGap, insideManGap);
    const zoneAttempt   = mergeRunTypeStats(outsideZone, insideZone);

    // Post-play flags (% of run attempts only)
    const brokenTackle  = runPlays.filter((p) => p.broken_tackle).length;
    const explosivePlay = runPlays.filter((p) => p.explosive_play).length;
    const runStuff      = runPlays.filter((p) => p.run_stuff).length;

    // Route run stats
    const routeTargets  = routeRuns.filter((p) => p.targeted).length;
    const routeCatches  = routeRuns.filter((p) => p.targeted && p.success === true).length;
    const routeDrops    = routeRuns.filter((p) => p.targeted && p.success === false).length;
    const routeOpen     = routeRuns.filter((p) => p.was_open).length;

    // Route type breakdown
    const routeByType = (["mid_curl", "flats", "big_boy_route"] as RBRouteType[]).reduce((acc, rt) => {
      const rp = routeRuns.filter((p) => p.route_type === rt);
      acc[rt] = {
        routes:  rp.length,
        open:    rp.filter((p) => p.was_open).length,
        targets: rp.filter((p) => p.targeted).length,
        catches: rp.filter((p) => p.targeted && p.success === true).length,
      };
      return acc;
    }, {} as Record<RBRouteType, { routes: number; open: number; targets: number; catches: number }>);

    return {
      totalPlays: plays.length,
      runAttempts,
      passBlockAttempts: passBlock.attempts,
      runBlockAttempts: runBlock.attempts,
      decoyAttempts: decoyPlays.length,
      routeAttempts: routeRuns.length,
      routeTargets,
      routeCatches,
      routeDrops,
      routeOpen,
      routeByType,
      formationStats,
      runTypes: { outsideManGap, insideManGap, outsideZone, insideZone, passBlock, runBlock },
      manGap,
      zoneAttempt,
      flags: {
        brokenTackle:  { count: brokenTackle,  pct: pct(brokenTackle,  runAttempts) },
        explosivePlay: { count: explosivePlay, pct: pct(explosivePlay, runAttempts) },
        runStuff:      { count: runStuff,      pct: pct(runStuff,      runAttempts) },
      },
    };
  }, [plays]);

  // Per-game play counts
  const gamePlayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plays) map[p.game_id] = (map[p.game_id] ?? 0) + 1;
    return map;
  }, [plays]);

  function resetPlayForm() {
    setEditingPlayId(null);
    setFormation("gun");
    setRunType("outside_zone");
    setSuccess(null);
    setLoadedBox(false);
    setUnblockedDefender(false);
    setBrokenTackle(false);
    setExplosivePlay(false);
    setRunStuff(false);
    setAlignedAsWr(false);
    setRbRouteType(null);
    setRbWasOpen(false);
    setRbTargeted(false);
    setRbOutcome(null);
    setPlayNotes("");
  }

  async function logPlay() {
    if (!selectedGameId) return;
    const isRoute = runType === "route";
    const isDecoy = runType === "decoy";
    const isBlockPlay = runType === "pass_block" || runType === "run_block";
    // decoy needs no success; everything else does
    if (!isRoute && !isDecoy && success === null) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }
    const { data, error } = await supabase.from("rb_plays").insert({
      user_id: user.id, game_id: selectedGameId,
      formation, run_type: runType,
      success: isRoute ? (rbTargeted ? (rbOutcome === "caught" ? true : rbOutcome === "drop" ? false : null) : null) : isDecoy ? null : success,
      targeted: isRoute ? rbTargeted : false,
      aligned_as_wr: isRoute ? alignedAsWr : false,
      route_type: isRoute ? (rbRouteType ?? null) : null,
      was_open: isRoute ? rbWasOpen : false,
      loaded_box: (isRoute || isBlockPlay || isDecoy) ? false : loadedBox,
      unblocked_defender: (isRoute || isBlockPlay || isDecoy) ? false : unblockedDefender,
      broken_tackle: (isRoute || isBlockPlay || isDecoy) ? false : brokenTackle,
      explosive_play: (isRoute || isBlockPlay || isDecoy) ? false : explosivePlay,
      run_stuff: (isRoute || isBlockPlay || isDecoy) ? false : runStuff,
      play_notes: playNotes || null,
    }).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => [...prev, data as RBPlay]);
      resetPlayForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  function startEditPlay(pl: RBPlay) {
    setEditingPlayId(pl.id);
    setFormation(pl.formation);
    setRunType(pl.run_type);
    setSuccess(pl.run_type !== "route" ? pl.success : null);
    setLoadedBox(pl.loaded_box ?? false);
    setUnblockedDefender(pl.unblocked_defender ?? false);
    setBrokenTackle(pl.broken_tackle ?? false);
    setExplosivePlay(pl.explosive_play ?? false);
    setRunStuff(pl.run_stuff ?? false);
    setAlignedAsWr(pl.aligned_as_wr ?? false);
    setRbRouteType(pl.route_type ?? null);
    setRbWasOpen(pl.was_open ?? false);
    setRbTargeted(pl.targeted ?? false);
    setRbOutcome(
      pl.run_type === "route" && pl.targeted
        ? pl.success === true ? "caught" : pl.success === false ? "drop" : "incomplete"
        : null
    );
    setPlayNotes(pl.play_notes ?? "");
  }

  async function saveEditedPlay() {
    if (!editingPlayId) return;
    const isRoute = runType === "route";
    const isDecoy = runType === "decoy";
    const isBlockPlay = runType === "pass_block" || runType === "run_block";
    if (!isRoute && !isDecoy && success === null) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data, error } = await supabase.from("rb_plays").update({
      formation, run_type: runType,
      success: isRoute ? (rbTargeted ? (rbOutcome === "caught" ? true : rbOutcome === "drop" ? false : null) : null) : isDecoy ? null : success,
      targeted: isRoute ? rbTargeted : false,
      aligned_as_wr: isRoute ? alignedAsWr : false,
      route_type: isRoute ? (rbRouteType ?? null) : null,
      was_open: isRoute ? rbWasOpen : false,
      loaded_box: (isRoute || isBlockPlay || isDecoy) ? false : loadedBox,
      unblocked_defender: (isRoute || isBlockPlay || isDecoy) ? false : unblockedDefender,
      broken_tackle: (isRoute || isBlockPlay || isDecoy) ? false : brokenTackle,
      explosive_play: (isRoute || isBlockPlay || isDecoy) ? false : explosivePlay,
      run_stuff: (isRoute || isBlockPlay || isDecoy) ? false : runStuff,
      play_notes: playNotes || null,
    }).eq("id", editingPlayId).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => prev.map((p) => p.id === editingPlayId ? (data as RBPlay) : p));
      resetPlayForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    if (editingPlayId === id) resetPlayForm();
    const { error } = await supabase.from("rb_plays").delete().eq("id", id);
    if (error) {
      log.error("rb_plays delete failed", { err: error.message });
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
      config={RB_CONFIG}
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
          <div className="text-green-400">{stats.runAttempts} runs · {stats.routeAttempts} routes</div>
        </>
      )}
      renderOverview={() => (
        <div className="space-y-5">
          {loading ? (
            <div className="text-slate-500 text-sm text-center py-8">Loading…</div>
          ) : stats.totalPlays === 0 ? (
            <div className="text-slate-500 text-sm text-center py-8">
              No plays charted yet. Go to &quot;Chart Game&quot; to start logging.
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: "Total Plays",  value: stats.totalPlays,        color: "text-blue-400" },
                  { label: "Run Attempts", value: stats.runAttempts,       color: "text-green-400" },
                  { label: "Pass Block",   value: stats.passBlockAttempts, color: "text-purple-400" },
                  { label: "Run Block",    value: stats.runBlockAttempts,  color: "text-orange-400" },
                  { label: "Decoy",        value: stats.decoyAttempts,     color: "text-amber-500" },
                  { label: "Routes",       value: stats.routeAttempts,     color: "text-blue-300" },
                  { label: "Open",         value: stats.routeOpen,         color: "text-emerald-300" },
                  { label: "Targeted",     value: stats.routeTargets,      color: "text-amber-400" },
                  { label: "Catches",      value: stats.routeCatches,      color: "text-emerald-400" },
                  { label: "Games",        value: games.length,            color: "text-slate-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-slate-900 rounded-lg border border-slate-800">
                    <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Formation breakdown */}
              <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-500 mb-3">Formation Breakdown</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800 text-xs text-slate-600">
                      <th className="text-left pb-1.5 pr-3">Formation</th>
                      <th className="text-right pb-1.5 px-2">Att</th>
                      <th className="text-right pb-1.5 px-2">Suc</th>
                      <th className="text-right pb-1.5 pl-2">Suc%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {FORMATIONS.map(({ key, label }) => {
                      const f = stats.formationStats[key];
                      const color = f.successPct !== null
                        ? f.successPct >= 55 ? "text-emerald-400" : f.successPct >= 40 ? "text-amber-400" : "text-red-400"
                        : "text-slate-600";
                      return (
                        <tr key={key} className="hover:bg-slate-800/30">
                          <td className="py-2 pr-3 text-white font-medium">{label}</td>
                          <td className="py-2 px-2 text-right text-blue-400">{f.attempts || "—"}</td>
                          <td className="py-2 px-2 text-right text-slate-300">{f.successes || "—"}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${color}`}>
                            {f.successPct !== null ? `${f.successPct}%` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Run type matrix */}
              <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                <div className="text-xs text-slate-500 mb-3">Run Type Breakdown</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-600">
                        <th className="text-left pb-1.5 pr-2">Run Type</th>
                        <th className="text-right pb-1.5 px-2">Att</th>
                        <th className="text-right pb-1.5 px-2">Suc%</th>
                        <th className="text-right pb-1.5 px-2 text-teal-600">LB (n%)</th>
                        <th className="text-right pb-1.5 px-2 text-teal-600">LB Suc%</th>
                        <th className="text-right pb-1.5 px-2 text-orange-700">UB (n%)</th>
                        <th className="text-right pb-1.5 pl-2 text-orange-700">UB Suc%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <StatRow label="Man Gap"         s={stats.manGap} />
                      <StatRow label="Outside Man Gap" s={stats.runTypes.outsideManGap} indent />
                      <StatRow label="Inside Man Gap"  s={stats.runTypes.insideManGap}  indent />
                      <StatRow label="Zone Attempt"    s={stats.zoneAttempt} />
                      <StatRow label="Outside Zone"    s={stats.runTypes.outsideZone} indent />
                      <StatRow label="Inside Zone"     s={stats.runTypes.insideZone}  indent />
                      <StatRow label="Pass Block"      s={stats.runTypes.passBlock} />
                      <StatRow label="Run Block"       s={stats.runTypes.runBlock} />
                    </tbody>
                  </table>
                  <div className="mt-2 flex gap-4 text-[10px] text-slate-600">
                    <span><span className="text-teal-600">LB</span> = Loaded Box</span>
                    <span><span className="text-orange-700">UB</span> = Unblocked Defender</span>
                    <span>Suc% = success / attempts</span>
                  </div>
                </div>
              </div>

              {/* Route Type Breakdown */}
              {stats.routeAttempts > 0 && (
                <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="text-xs text-slate-500 mb-3">Route Type Breakdown</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-800 text-xs text-slate-600">
                        <th className="text-left pb-1.5 pr-2">Route</th>
                        <th className="text-right pb-1.5 px-2">Routes</th>
                        <th className="text-right pb-1.5 px-2 text-emerald-600">Open</th>
                        <th className="text-right pb-1.5 px-2 text-amber-600">Targeted</th>
                        <th className="text-right pb-1.5 pl-2 text-blue-400">Catches</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {([
                        { key: "mid_curl" as RBRouteType, label: "Mid Curl" },
                        { key: "flats" as RBRouteType, label: "Flats" },
                        { key: "big_boy_route" as RBRouteType, label: "Big Boy Route" },
                      ]).map(({ key, label }) => {
                        const r = stats.routeByType[key];
                        const catchPct = r.targets > 0 ? ((r.catches / r.targets) * 100).toFixed(0) : null;
                        return (
                          <tr key={key} className="hover:bg-slate-800/30">
                            <td className="py-2 pr-2 text-sm font-medium text-white">{label}</td>
                            <td className="py-2 px-2 text-right text-sm text-blue-400">{r.routes || "—"}</td>
                            <td className="py-2 px-2 text-right text-sm text-emerald-400">{r.open > 0 ? r.open : "—"}</td>
                            <td className="py-2 px-2 text-right text-sm text-amber-400">{r.targets > 0 ? r.targets : "—"}</td>
                            <td className="py-2 pl-2 text-right text-sm">
                              {r.catches > 0 ? (
                                <span className="text-blue-400 font-semibold">
                                  {r.catches}
                                  {catchPct !== null && <span className="text-slate-500 font-normal ml-1">({catchPct}%)</span>}
                                </span>
                              ) : "—"}
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total row */}
                      <tr className="border-t border-slate-700 text-xs text-slate-500 font-medium">
                        <td className="pt-2 pr-2">Total</td>
                        <td className="pt-2 px-2 text-right text-blue-400">{stats.routeAttempts}</td>
                        <td className="pt-2 px-2 text-right text-emerald-400">{stats.routeOpen > 0 ? stats.routeOpen : "—"}</td>
                        <td className="pt-2 px-2 text-right text-amber-400">{stats.routeTargets > 0 ? stats.routeTargets : "—"}</td>
                        <td className="pt-2 pl-2 text-right text-blue-400">{stats.routeCatches > 0 ? stats.routeCatches : "—"}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              {/* Play outcome flags */}
              {stats.runAttempts > 0 && (
                <div className="p-4 bg-slate-900 rounded-lg border border-slate-800">
                  <div className="text-xs text-slate-500 mb-3">Play Outcome Flags <span className="text-slate-700">(% of {stats.runAttempts} run attempts)</span></div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Broken Tackle",  f: stats.flags.brokenTackle,  color: "text-amber-400" },
                      { label: "Explosive Play", f: stats.flags.explosivePlay, color: "text-emerald-400" },
                      { label: "Run Stuff",      f: stats.flags.runStuff,      color: "text-red-400" },
                    ].map(({ label, f, color }) => (
                      <div key={label} className="p-3 bg-slate-800/50 rounded-lg text-center">
                        <div className="text-xs text-slate-500 mb-1">{label}</div>
                        <div className={`text-xl font-bold ${color}`}>{f.count}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{f.pct !== null ? `${f.pct}%` : "—"}</div>
                      </div>
                    ))}
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
          <div className="text-slate-500 text-sm text-center py-12">Select or add a game to start logging plays.</div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm font-medium text-slate-300">
              Logging: <span className="text-white">{sg.season_year} vs {sg.opponent}</span>
              <span className="ml-2 text-green-400 text-xs">{gamePlays.length} plays</span>
            </div>

            {/* Formation */}
            <div>
              <div className="text-xs text-slate-500 mb-2">Formation</div>
              <div className="flex gap-2">
                {FORMATIONS.map((f) => (
                  <button key={f.key} onClick={() => setFormation(f.key)}
                    className={`px-4 py-2 rounded text-sm font-medium transition ${formation === f.key ? "bg-green-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Run Type */}
            <div>
              <div className="text-xs text-slate-500 mb-2">Run Type</div>
              <div className="space-y-2">
                {/* Man Gap group */}
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-600 mb-1.5 font-medium uppercase tracking-wider">Man Gap</div>
                  <div className="flex gap-2">
                    {(["outside_man_gap", "inside_man_gap"] as RBRunType[]).map((rt) => (
                      <button key={rt} onClick={() => setRunType(rt)}
                        className={`flex-1 py-2 rounded text-xs font-medium transition ${runType === rt ? "bg-green-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {rt === "outside_man_gap" ? "Outside" : "Inside"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Zone group */}
                <div className="p-2 bg-slate-900 border border-slate-800 rounded-lg">
                  <div className="text-xs text-slate-600 mb-1.5 font-medium uppercase tracking-wider">Zone Attempt</div>
                  <div className="flex gap-2">
                    {(["outside_zone", "inside_zone"] as RBRunType[]).map((rt) => (
                      <button key={rt} onClick={() => setRunType(rt)}
                        className={`flex-1 py-2 rounded text-xs font-medium transition ${runType === rt ? "bg-green-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {rt === "outside_zone" ? "Outside" : "Inside"}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Pass block / Run block / Decoy */}
                <div className="flex gap-2">
                  <button onClick={() => setRunType("pass_block")}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${runType === "pass_block" ? "bg-purple-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    Pass Block
                  </button>
                  <button onClick={() => setRunType("run_block")}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${runType === "run_block" ? "bg-orange-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    Run Block
                  </button>
                  <button onClick={() => setRunType("decoy")}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${runType === "decoy" ? "bg-amber-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    Decoy
                  </button>
                </div>
                {/* Route run */}
                <button onClick={() => { setRunType("route"); setSuccess(null); setRbOutcome(null); }}
                  className={`w-full py-2 rounded text-sm font-medium transition ${runType === "route" ? "bg-blue-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                  Route Run
                </button>
              </div>
            </div>

            {/* Route play UI */}
            {runType === "route" ? (
              <div className="space-y-3 p-3 bg-slate-900/60 rounded-lg border border-blue-900/50">
                <div className="text-xs text-blue-400 font-medium">Route Run Options</div>
                <div className="flex flex-wrap gap-4">
                  {/* Route Type */}
                  <div className="w-full">
                    <div className="text-xs text-slate-500 mb-2">Route Type</div>
                    <div className="flex gap-2">
                      {([
                        { key: "mid_curl" as RBRouteType, label: "Mid Curl" },
                        { key: "flats" as RBRouteType, label: "Flats" },
                        { key: "big_boy_route" as RBRouteType, label: "Big Boy Route" },
                      ]).map(({ key, label }) => (
                        <button key={key} onClick={() => setRbRouteType(rbRouteType === key ? null : key)}
                          className={`flex-1 py-2 rounded text-xs font-medium transition ${rbRouteType === key ? "bg-blue-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Aligned at Snap</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setAlignedAsWr(false)}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${!alignedAsWr ? "bg-green-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        RB
                      </button>
                      <button onClick={() => setAlignedAsWr(true)}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${alignedAsWr ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        WR Split Out
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Targeted?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setRbTargeted(true)}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${rbTargeted ? "bg-amber-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        Yes
                      </button>
                      <button onClick={() => { setRbTargeted(false); setRbOutcome(null); }}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${!rbTargeted ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        No
                      </button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Open on Play?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setRbWasOpen(true)}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${rbWasOpen ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        Yes
                      </button>
                      <button onClick={() => setRbWasOpen(false)}
                        className={`px-3 h-9 rounded text-xs font-medium transition ${!rbWasOpen ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        No
                      </button>
                    </div>
                  </div>
                  {rbTargeted && (
                    <div>
                      <div className="text-xs text-slate-500 mb-2">Outcome</div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setRbOutcome("caught")}
                          className={`px-4 h-9 rounded text-xs font-bold transition ${rbOutcome === "caught" ? "bg-green-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                          Caught ✓
                        </button>
                        <button onClick={() => setRbOutcome("drop")}
                          className={`px-4 h-9 rounded text-xs font-bold transition ${rbOutcome === "drop" ? "bg-red-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                          Drop ✗
                        </button>
                        <button onClick={() => setRbOutcome("incomplete")}
                          className={`px-4 h-9 rounded text-xs font-bold transition ${rbOutcome === "incomplete" ? "bg-slate-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                          Incomplete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : runType === "pass_block" || runType === "run_block" ? (
              /* Pass Block / Run Block — Success/Fail only */
              <div>
                <div className="text-xs text-slate-500 mb-2">Result</div>
                <div className="flex gap-3">
                  <button onClick={() => setSuccess(true)}
                    className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === true ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    ✓ SUCCESS
                  </button>
                  <button onClick={() => setSuccess(false)}
                    className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === false ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                    ✗ FAIL
                  </button>
                </div>
              </div>
            ) : runType === "decoy" ? (
              <div className="p-3 bg-slate-900/60 rounded-lg border border-slate-700/50 text-xs text-slate-500">
                Decoy — no additional options. Click Log Play to record.
              </div>
            ) : (
              <>
                {/* Context toggles — run plays only */}
                <div className="flex flex-wrap gap-3">
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Loaded Box?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setLoadedBox(true)} className={`px-3 h-9 rounded text-xs font-medium transition ${loadedBox ? "bg-teal-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>Yes</button>
                      <button onClick={() => setLoadedBox(false)} className={`px-3 h-9 rounded text-xs font-medium transition ${!loadedBox ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>No</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-2">Unblocked Defender?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setUnblockedDefender(true)} className={`px-3 h-9 rounded text-xs font-medium transition ${unblockedDefender ? "bg-orange-700 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>Yes</button>
                      <button onClick={() => setUnblockedDefender(false)} className={`px-3 h-9 rounded text-xs font-medium transition ${!unblockedDefender ? "bg-slate-600 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>No</button>
                    </div>
                  </div>
                </div>

                {/* Success / Fail */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Result</div>
                  <div className="flex gap-3">
                    <button onClick={() => setSuccess(true)}
                      className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === true ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                      ✓ SUCCESS
                    </button>
                    <button onClick={() => setSuccess(false)}
                      className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === false ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                      ✗ FAIL
                    </button>
                  </div>
                </div>

                {/* Post-play flags */}
                <div>
                  <div className="text-xs text-slate-500 mb-2">Play Flags <span className="text-slate-700">(select if yes)</span></div>
                  <div className="flex gap-2">
                    {[
                      { label: "Broken Tackle", val: brokenTackle, set: setBrokenTackle, color: "bg-amber-700" },
                      { label: "Explosive Play", val: explosivePlay, set: setExplosivePlay, color: "bg-emerald-800" },
                      { label: "Run Stuff", val: runStuff, set: setRunStuff, color: "bg-red-800" },
                    ].map(({ label, val, set, color }) => (
                      <button key={label} onClick={() => set(!val)}
                        className={`flex-1 py-2 rounded text-xs font-medium transition ${val ? `${color} text-white` : "bg-slate-800 text-slate-400 hover:bg-slate-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Notes + log */}
            {editingPlayId && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/30 border border-amber-700/50 rounded text-xs text-amber-300">
                <span>✎</span>
                <span>Editing play — make changes above then save</span>
                <button onClick={resetPlayForm} className="ml-auto text-amber-400 hover:text-white transition">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <input className="flex-1 px-3 py-2 bg-slate-800 border border-slate-700 rounded text-white text-sm placeholder-slate-500 focus:outline-none focus:border-green-500"
                placeholder="Play note (optional)" value={playNotes} onChange={(e) => setPlayNotes(e.target.value)} />
              {editingPlayId ? (
                <button onClick={saveEditedPlay}
                  disabled={savingPlay || (runType !== "route" && runType !== "decoy" && success === null) || (runType === "route" && rbTargeted && rbOutcome === null)}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Save Edit"}
                </button>
              ) : (
                <button onClick={logPlay}
                  disabled={savingPlay || (runType !== "route" && runType !== "decoy" && success === null) || (runType === "route" && rbTargeted && rbOutcome === null)}
                  className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition">
                  {savingPlay ? "…" : "Log Play"}
                </button>
              )}
            </div>
            {playError && <p className="text-red-400 text-xs">{playError}</p>}

            {/* Recent plays */}
            {gamePlays.length > 0 && (
              <div>
                <div className="text-xs text-slate-500 mb-2">Plays This Game ({gamePlays.length})</div>
                <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                  {[...gamePlays].reverse().map((pl, i) => {
                    const rtLabel: Record<RBRunType, string> = {
                      outside_man_gap: "OG", inside_man_gap: "IG",
                      outside_zone: "OZ", inside_zone: "IZ",
                      pass_block: "PB", run_block: "RB", decoy: "DCY", route: "Route",
                    };
                    const fLabel: Record<RBFormation, string> = { gun: "Gun", pistol: "Pst", under_center: "UC" };
                    const isRoute = pl.run_type === "route";
                    return (
                      <div key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${
                        editingPlayId === pl.id
                          ? "bg-amber-900/40 border border-amber-700/60"
                          : "bg-slate-900 border border-transparent"
                      }`}>
                        <span className="text-slate-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                        <span className="text-slate-400">{fLabel[pl.formation]}</span>
                        <span className={`font-medium ${isRoute ? "text-blue-400" : "text-white"}`}>{rtLabel[pl.run_type]}</span>
                        {isRoute ? (
                          <>
                            {pl.route_type && (
                              <span className="text-blue-300 text-[10px]">
                                {pl.route_type === "mid_curl" ? "Curl" : pl.route_type === "flats" ? "Flat" : "BBR"}
                              </span>
                            )}
                            {pl.aligned_as_wr && <span className="text-blue-300">WR</span>}
                            {pl.was_open && <span className="text-emerald-300">Open</span>}
                            {pl.targeted
                              ? pl.success === true ? <span className="text-emerald-400">✓</span>
                                : pl.success === false ? <span className="text-red-400">Drop</span>
                                : <span className="text-slate-400">Inc</span>
                              : <span className="text-slate-600">—</span>}
                          </>
                        ) : (
                          <>
                            {pl.loaded_box && <span className="text-teal-400">LB</span>}
                            {pl.unblocked_defender && <span className="text-orange-400">UB</span>}
                            <span className={pl.success ? "text-emerald-400" : "text-red-400"}>{pl.success ? "✓" : "✗"}</span>
                            {pl.broken_tackle && <span className="text-amber-400">BT</span>}
                            {pl.explosive_play && <span className="text-emerald-300">EXP</span>}
                            {pl.run_stuff && <span className="text-red-300">STF</span>}
                          </>
                        )}
                        {pl.play_notes && <span className="text-slate-500 truncate">{pl.play_notes}</span>}
                        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                          <button
                            onClick={() => editingPlayId === pl.id ? resetPlayForm() : startEditPlay(pl)}
                            className={`px-2 py-0.5 rounded text-xs transition ${editingPlayId === pl.id ? "text-amber-400 hover:text-white" : "text-slate-600 hover:text-amber-400"}`}
                          >✎</button>
                          <button onClick={() => deletePlay(pl.id)} className="text-slate-700 hover:text-red-400">✕</button>
                        </div>
                      </div>
                    );
                  })}
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
                    <th className="pb-2 pr-4 text-right">Run Att</th>
                    <th className="pb-2 pr-4 text-right">Routes</th>
                    <th className="pb-2 text-right">Suc%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900">
                  {games.map((g) => {
                    const gPlays = plays.filter((p) => p.game_id === g.id);
                    const runs = gPlays.filter(isRunPlay);
                    const routes = gPlays.filter((p) => p.run_type === "route");
                    const suc = runs.filter((p) => p.success === true).length;
                    const sucPct = runs.length > 0 ? ((suc / runs.length) * 100).toFixed(0) : null;
                    return (
                      <tr key={g.id} className="hover:bg-slate-900/50 transition">
                        <td className="py-2 pr-4 text-slate-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-slate-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gPlays.length}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{runs.length}</td>
                        {routes.length > 0
                          ? <td className="py-2 pr-4 text-right text-blue-300">{routes.length} routes</td>
                          : <td className="py-2 pr-4 text-right text-slate-700">—</td>}
                        <td className={`py-2 text-right font-medium ${sucPct !== null ? (parseInt(sucPct) >= 55 ? "text-emerald-400" : parseInt(sucPct) >= 40 ? "text-amber-400" : "text-red-400") : "text-slate-600"}`}>
                          {sucPct !== null ? `${sucPct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-700 text-xs text-slate-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{stats.totalPlays}</td>
                    <td className="pt-2 text-right text-green-400">{stats.runAttempts}</td>
                    <td className="pt-2 text-right text-slate-400">—</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      )}
      renderExtraTab={() => (
        <RBPlayerCharts prospect={prospect} allProspects={allProspects} allGames={allGames} leaguePlays={leaguePlays} />
      )}
    />
  );
}
