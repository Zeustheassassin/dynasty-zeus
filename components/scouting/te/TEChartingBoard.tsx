"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../../lib/supabaseclient";
import { logger } from "../../../lib/logger";

const log = logger("scouting/te/TEChartingBoard");
import PlayerNotesList from "../PlayerNotesList";
import type {
  Prospect,
  TEPlay,
  TELocation,
  TEPositioning,
  TEPlayType,
  TEBlockType,
  TECoverage,
  RouteType,
} from "../../../lib/types";
import { ROUTE_TYPES } from "../shared/chartingConstants";
import { pct, fmtPct } from "../shared/chartingTypes";
import ChartingBoard, { type ChartingBoardConfig } from "../shared/ChartingBoard";
import { useChartingState } from "../shared/hooks/useChartingState";

const NFL_ROLES = ["Inline TE", "Move TE", "Receiving TE", "Blocking TE", "F-Back/Flex", ""];

const LOCATIONS: { key: TELocation; label: string }[] = [
  { key: "left",      label: "Left" },
  { key: "right",     label: "Right" },
  { key: "backfield", label: "Backfield" },
];

const POSITIONINGS: { key: TEPositioning; label: string }[] = [
  { key: "wide",         label: "Wide" },
  { key: "slot",         label: "Slot" },
  { key: "inline",       label: "Inline" },
  { key: "full_back",    label: "Full Back" },
  { key: "running_back", label: "Running Back" },
  { key: "wing_back",    label: "Wing Back" },
];

const ROUTE_LABELS: Record<RouteType, string> = {
  nine: "Nine", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Screen", flat: "Flat", comeback: "Comeback", out: "Out", corner: "Corner", other: "Other",
};

type TargetOutcome = "caught" | "dropped" | "incomplete" | null;

const TE_CONFIG: ChartingBoardConfig = {
  positionLabel: "TE",
  accentColor: "green",
  nflRoles: NFL_ROLES,
};

const tabs = [
  { key: "overview", label: "Overview" },
  { key: "chart",    label: "Chart Game" },
  { key: "games",    label: "Games" },
];

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
}

export default function TEChartingBoard({ prospect, onBack, onDataChanged }: Props) {
  const [plays, setPlays] = useState<TEPlay[]>([]);

  // Play logger form state
  const [location, setLocation]               = useState<TELocation>("left");
  const [positioning, setPositioning]         = useState<TEPositioning>("inline");
  const [playType, setPlayType]               = useState<TEPlayType>("route_run");
  const [blockType, setBlockType]             = useState<TEBlockType | null>(null);
  const [blockSuccess, setBlockSuccess]       = useState<boolean | null>(null);
  const [coverage, setCoverage]               = useState<TECoverage | null>(null);
  const [routeType, setRouteType]             = useState<RouteType | null>(null);
  const [wasOpen, setWasOpen]                 = useState<boolean | null>(null);
  const [targeted, setTargeted]               = useState<boolean | null>(null);
  const [targetOutcome, setTargetOutcome]     = useState<TargetOutcome>(null);
  const [contestedTarget, setContestedTarget] = useState<boolean | null>(null);
  const [contestedCatch, setContestedCatch]   = useState<boolean | null>(null);
  const [brokenTackle, setBrokenTackle]       = useState(false);
  const [playNotes, setPlayNotes]             = useState("");
  const [savingPlay, setSavingPlay]           = useState(false);
  const [playError, setPlayError]             = useState<string | null>(null);
  const [editingPlayId, setEditingPlayId]     = useState<string | null>(null);

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
    supabase.from("te_plays").select("*").in("game_id", ids).order("created_at")
      .then(({ data, error }) => {
        if (error) { log.error("te_plays load failed", { err: error.message }); return; }
        setPlays((data ?? []) as TEPlay[]);
      });
  }, [games]);

  const gamePlays = useMemo(
    () => plays.filter((p) => p.game_id === selectedGameId),
    [plays, selectedGameId],
  );

  const stats = useMemo(() => {
    const routePlays = plays.filter((p) => p.play_type === "route_run");
    const blockPlays = plays.filter((p) => p.play_type === "run_block" || p.play_type === "pass_block");
    const runBlocks  = plays.filter((p) => p.play_type === "run_block");
    const passBlocks = plays.filter((p) => p.play_type === "pass_block");

    const targets       = routePlays.filter((p) => p.targeted === true);
    const catches       = targets.filter((p) => p.caught === true);
    const drops         = targets.filter((p) => p.dropped === true);
    const contestedTgts = targets.filter((p) => p.contested_target === true);
    const contestedCtch = contestedTgts.filter((p) => p.contested_catch === true);
    const openRoutes    = routePlays.filter((p) => p.was_open === true);
    const brokenTackles = plays.filter((p) => p.broken_tackle === true && p.caught === true);

    const blockSuc    = blockPlays.filter((p) => p.block_success === true).length;
    const runBlockSuc = runBlocks.filter((p) => p.block_success === true).length;
    const passBlockSuc= passBlocks.filter((p) => p.block_success === true).length;

    const routeBreakdown = ROUTE_TYPES.map((rt) => {
      const rp   = routePlays.filter((p) => p.route_type === rt);
      const tgt  = rp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      const open = rp.filter((p) => p.was_open === true);
      return { route: rt, attempts: rp.length, openPct: pct(open.length, rp.length), targetPct: pct(tgt.length, rp.length), catchPct: pct(ctch.length, tgt.length) };
    }).filter((r) => r.attempts > 0);

    const coverageBreakdown = (["man", "zone", "press", "double"] as TECoverage[]).map((cov) => {
      // Press is a subtype of Man — fold press routes into Man's bucket for the
      // % calc. Press still appears separately. Total routes are unchanged.
      const cp = cov === "man"
        ? routePlays.filter((p) => p.coverage === "man" || p.coverage === "press")
        : routePlays.filter((p) => p.coverage === cov);
      const tgt  = cp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      const open = cp.filter((p) => p.was_open === true);
      return { coverage: cov, attempts: cp.length, openPct: pct(open.length, cp.length), targetPct: pct(tgt.length, cp.length), catchPct: pct(ctch.length, tgt.length) };
    }).filter((c) => c.attempts > 0);

    const posBreakdown = POSITIONINGS.map(({ key, label }) => {
      const pp   = routePlays.filter((p) => p.positioning === key);
      const tgt  = pp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      return { positioning: label, attempts: pp.length, targetPct: pct(tgt.length, pp.length), catchPct: pct(ctch.length, tgt.length) };
    }).filter((p) => p.attempts > 0);

    return {
      totalPlays: plays.length,
      routeAttempts: routePlays.length,
      blockAttempts: blockPlays.length,
      targets: targets.length,
      catches: catches.length,
      drops: drops.length,
      contestedTargets: contestedTgts.length,
      openRoutes: openRoutes.length,
      brokenTackles: brokenTackles.length,
      openPct:   pct(openRoutes.length, routePlays.length),
      targetPct: pct(targets.length, routePlays.length),
      catchPct:  pct(catches.length, targets.length),
      contestedCatchPct: pct(contestedCtch.length, contestedTgts.length),
      blockSuc,
      blockSucPct:      pct(blockSuc, blockPlays.length),
      runBlockAttempts: runBlocks.length,
      runBlockSucPct:   pct(runBlockSuc, runBlocks.length),
      passBlockAttempts:passBlocks.length,
      passBlockSucPct:  pct(passBlockSuc, passBlocks.length),
      runMovementAttempts: runBlocks.filter((p) => p.block_type === "movement").length,
      runMovementSucPct:   pct(runBlocks.filter((p) => p.block_type === "movement" && p.block_success).length, runBlocks.filter((p) => p.block_type === "movement").length),
      runInlineAttempts:   runBlocks.filter((p) => p.block_type === "inline").length,
      runInlineSucPct:     pct(runBlocks.filter((p) => p.block_type === "inline" && p.block_success).length, runBlocks.filter((p) => p.block_type === "inline").length),
      passMovementAttempts:passBlocks.filter((p) => p.block_type === "movement").length,
      passMovementSucPct:  pct(passBlocks.filter((p) => p.block_type === "movement" && p.block_success).length, passBlocks.filter((p) => p.block_type === "movement").length),
      passInlineAttempts:  passBlocks.filter((p) => p.block_type === "inline").length,
      passInlineSucPct:    pct(passBlocks.filter((p) => p.block_type === "inline" && p.block_success).length, passBlocks.filter((p) => p.block_type === "inline").length),
      routeBreakdown,
      coverageBreakdown,
      posBreakdown,
    };
  }, [plays]);

  const gamePlayCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of plays) map[p.game_id] = (map[p.game_id] ?? 0) + 1;
    return map;
  }, [plays]);

  const canLog = useMemo(() => {
    if (!selectedGameId) return false;
    if (playType === "decoy") return true;
    if (playType === "run_block" || playType === "pass_block") return blockType !== null && blockSuccess !== null;
    if (!coverage || !routeType || wasOpen === null || targeted === null) return false;
    if (targeted) {
      if (targetOutcome === null || contestedTarget === null) return false;
      if (contestedTarget && contestedCatch === null) return false;
    }
    return true;
  }, [selectedGameId, playType, blockType, blockSuccess, coverage, routeType, wasOpen, targeted, targetOutcome, contestedTarget, contestedCatch]);

  function resetPlayForm() {
    setEditingPlayId(null);
    setBlockType(null); setBlockSuccess(null);
    setCoverage(null); setRouteType(null); setWasOpen(null); setTargeted(null);
    setTargetOutcome(null); setContestedTarget(null); setContestedCatch(null);
    setBrokenTackle(false); setPlayNotes("");
  }

  function startEditPlay(pl: TEPlay) {
    setEditingPlayId(pl.id);
    setLocation(pl.location);
    setPositioning(pl.positioning);
    setPlayType(pl.play_type);
    setBlockType(pl.block_type ?? null);
    setBlockSuccess(pl.block_success ?? null);
    setCoverage(pl.coverage ?? null);
    setRouteType(pl.route_type ?? null);
    setWasOpen(pl.was_open ?? null);
    setTargeted(pl.targeted ?? null);
    setTargetOutcome(pl.targeted ? (pl.caught ? "caught" : pl.dropped ? "dropped" : "incomplete") : null);
    setContestedTarget(pl.contested_target ?? null);
    setContestedCatch(pl.contested_catch ?? null);
    setBrokenTackle(pl.broken_tackle ?? false);
    setPlayNotes(pl.play_notes ?? "");
  }

  async function saveEditedPlay() {
    if (!editingPlayId || !canLog) return;
    setPlayError(null); setSavingPlay(true);
    const isBlock    = playType === "run_block" || playType === "pass_block";
    const isRoute    = playType === "route_run";
    const isTargeted = isRoute && targeted === true;
    const { data, error } = await supabase.from("te_plays").update({
      location, positioning, play_type: playType,
      block_type: isBlock ? blockType : null, block_success: isBlock ? blockSuccess : null,
      coverage: isRoute ? coverage : null, route_type: isRoute ? routeType : null,
      was_open: isRoute ? wasOpen : null, targeted: isRoute ? targeted : null,
      caught: isTargeted ? targetOutcome === "caught" : null,
      dropped: isTargeted ? targetOutcome === "dropped" : null,
      contested_target: isTargeted ? contestedTarget : null,
      contested_catch: isTargeted && contestedTarget ? contestedCatch : null,
      broken_tackle: isTargeted && targetOutcome === "caught" ? brokenTackle : false,
      play_notes: playNotes || null,
    }).eq("id", editingPlayId).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) { setPlays((prev) => prev.map((p) => p.id === editingPlayId ? (data as TEPlay) : p)); resetPlayForm(); onDataChanged(); }
    setSavingPlay(false);
  }

  async function logPlay() {
    if (!canLog || !selectedGameId) return;
    setPlayError(null); setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }
    const isBlock    = playType === "run_block" || playType === "pass_block";
    const isRoute    = playType === "route_run";
    const isTargeted = isRoute && targeted === true;
    const { data, error } = await supabase.from("te_plays").insert({
      user_id: user.id, game_id: selectedGameId,
      location, positioning, play_type: playType,
      block_type: isBlock ? blockType : null, block_success: isBlock ? blockSuccess : null,
      coverage: isRoute ? coverage : null, route_type: isRoute ? routeType : null,
      was_open: isRoute ? wasOpen : null, targeted: isRoute ? targeted : null,
      caught: isTargeted ? targetOutcome === "caught" : null,
      dropped: isTargeted ? targetOutcome === "dropped" : null,
      contested_target: isTargeted ? contestedTarget : null,
      contested_catch: isTargeted && contestedTarget ? contestedCatch : null,
      broken_tackle: isTargeted && targetOutcome === "caught" ? brokenTackle : false,
      play_notes: playNotes || null,
    }).select().single();
    if (error) { setPlayError(error.message); }
    else if (data) { setPlays((prev) => [...prev, data as TEPlay]); resetPlayForm(); onDataChanged(); }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    if (editingPlayId === id) resetPlayForm();
    await supabase.from("te_plays").delete().eq("id", id);
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  return (
    <ChartingBoard
      prospect={prospect} config={TE_CONFIG} tabs={tabs} gamePlayCounts={gamePlayCounts}
      tab={tab} games={games} selectedGameId={selectedGameId} loading={loading}
      showAddGame={showAddGame} newGame={newGame} savingGame={savingGame} gameError={gameError}
      editBio={editBio} bio={bio} savingBio={savingBio} onBack={onBack}
      onTabChange={onTabChange} onSelectGame={onSelectGame} onToggleAddGame={onToggleAddGame}
      onNewGameChange={onNewGameChange} onAddGame={onAddGame} onDeleteGame={onDeleteGame} onUpdateGame={onUpdateGame}
      onToggleEditBio={onToggleEditBio} onBioChange={onBioChange} onSaveBio={onSaveBio}
      renderHeaderStats={() => (
        <>
          <div>{stats.totalPlays} plays · {games.length} games</div>
          <div className="text-green-400">{stats.routeAttempts} routes · {stats.blockAttempts} blocks</div>
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
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {[
                  { label: "Total Plays",  value: stats.totalPlays,       color: "text-blue-400" },
                  { label: "Routes",       value: stats.routeAttempts,    color: "text-green-400" },
                  { label: "Blocks",       value: stats.blockAttempts,    color: "text-purple-400" },
                  { label: "Targets",      value: stats.targets,          color: "text-yellow-400" },
                  { label: "Catches",      value: stats.catches,          color: "text-green-300" },
                  { label: "Drops",        value: stats.drops,            color: "text-red-400" },
                  { label: "Contested",    value: stats.contestedTargets, color: "text-orange-400" },
                  { label: "Games",        value: games.length,           color: "text-gray-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {stats.routeAttempts > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Open Rate",            value: fmtPct(stats.openPct),           color: "text-green-400" },
                    { label: "Target Rate",          value: fmtPct(stats.targetPct),         color: "text-yellow-400" },
                    { label: "Catch Rate",           value: fmtPct(stats.catchPct),          color: "text-green-300" },
                    { label: "Contested Catch Rate", value: fmtPct(stats.contestedCatchPct), color: "text-orange-400" },
                  ].map((s) => (
                    <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                      <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {stats.blockAttempts > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Blocking Breakdown</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-xs text-gray-600">
                        <th className="text-left pb-1.5 pr-3">Type</th>
                        <th className="text-right pb-1.5 px-2">Att</th>
                        <th className="text-right pb-1.5 pl-2">Suc%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      <tr className="hover:bg-gray-800/30">
                        <td className="py-2 pr-3 text-white font-medium">All Blocks</td>
                        <td className="py-2 px-2 text-right text-blue-400">{stats.blockAttempts}</td>
                        <td className={`py-2 pl-2 text-right font-semibold ${stats.blockSucPct !== null ? (stats.blockSucPct >= 75 ? "text-green-400" : stats.blockSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.blockSucPct)}</td>
                      </tr>
                      {stats.runBlockAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">Run Block</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.runBlockAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.runBlockSucPct !== null ? (stats.runBlockSucPct >= 75 ? "text-green-400" : stats.runBlockSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.runBlockSucPct)}</td>
                        </tr>
                      )}
                      {stats.runMovementAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 pl-5 text-gray-400 text-xs"><span className="text-gray-600 mr-1">↳</span>Movement</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.runMovementAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.runMovementSucPct !== null ? (stats.runMovementSucPct >= 75 ? "text-green-400" : stats.runMovementSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.runMovementSucPct)}</td>
                        </tr>
                      )}
                      {stats.runInlineAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 pl-5 text-gray-400 text-xs"><span className="text-gray-600 mr-1">↳</span>Inline</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.runInlineAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.runInlineSucPct !== null ? (stats.runInlineSucPct >= 75 ? "text-green-400" : stats.runInlineSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.runInlineSucPct)}</td>
                        </tr>
                      )}
                      {stats.passBlockAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">Pass Block</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.passBlockAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.passBlockSucPct !== null ? (stats.passBlockSucPct >= 75 ? "text-green-400" : stats.passBlockSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.passBlockSucPct)}</td>
                        </tr>
                      )}
                      {stats.passMovementAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 pl-5 text-gray-400 text-xs"><span className="text-gray-600 mr-1">↳</span>Movement</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.passMovementAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.passMovementSucPct !== null ? (stats.passMovementSucPct >= 75 ? "text-green-400" : stats.passMovementSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.passMovementSucPct)}</td>
                        </tr>
                      )}
                      {stats.passInlineAttempts > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 pl-5 text-gray-400 text-xs"><span className="text-gray-600 mr-1">↳</span>Inline</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.passInlineAttempts}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${stats.passInlineSucPct !== null ? (stats.passInlineSucPct >= 75 ? "text-green-400" : stats.passInlineSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.passInlineSucPct)}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {stats.routeBreakdown.length > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Route Type Breakdown</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="border-b border-gray-800 text-xs text-gray-600">
                          <th className="text-left pb-1.5 pr-3">Route</th>
                          <th className="text-right pb-1.5 px-2">Att</th>
                          <th className="text-right pb-1.5 px-2">Open%</th>
                          <th className="text-right pb-1.5 px-2">Tgt%</th>
                          <th className="text-right pb-1.5 pl-2">Catch%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800/60">
                        {stats.routeBreakdown.map((r) => (
                          <tr key={r.route} className="hover:bg-gray-800/30">
                            <td className="py-2 pr-3 text-white font-medium capitalize">{ROUTE_LABELS[r.route]}</td>
                            <td className="py-2 px-2 text-right text-blue-400">{r.attempts}</td>
                            <td className={`py-2 px-2 text-right text-sm ${r.openPct !== null ? (r.openPct >= 50 ? "text-green-400" : "text-yellow-400") : "text-gray-600"}`}>{fmtPct(r.openPct)}</td>
                            <td className="py-2 px-2 text-right text-yellow-400">{fmtPct(r.targetPct)}</td>
                            <td className={`py-2 pl-2 text-right font-semibold ${r.catchPct !== null ? (r.catchPct >= 65 ? "text-green-400" : r.catchPct >= 50 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(r.catchPct)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {stats.coverageBreakdown.length > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Coverage Breakdown</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-xs text-gray-600">
                        <th className="text-left pb-1.5 pr-3">Coverage</th>
                        <th className="text-right pb-1.5 px-2">Att</th>
                        <th className="text-right pb-1.5 px-2">Open%</th>
                        <th className="text-right pb-1.5 px-2">Tgt%</th>
                        <th className="text-right pb-1.5 pl-2">Catch%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {stats.coverageBreakdown.map((c) => (
                        <tr key={c.coverage} className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium capitalize">{c.coverage}</td>
                          <td className="py-2 px-2 text-right text-blue-400">{c.attempts}</td>
                          <td className={`py-2 px-2 text-right text-sm ${c.openPct !== null ? (c.openPct >= 50 ? "text-green-400" : "text-yellow-400") : "text-gray-600"}`}>{fmtPct(c.openPct)}</td>
                          <td className="py-2 px-2 text-right text-yellow-400">{fmtPct(c.targetPct)}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${c.catchPct !== null ? (c.catchPct >= 65 ? "text-green-400" : c.catchPct >= 50 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(c.catchPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {stats.posBreakdown.length > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Positioning Breakdown (Routes)</div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-800 text-xs text-gray-600">
                        <th className="text-left pb-1.5 pr-3">Positioning</th>
                        <th className="text-right pb-1.5 px-2">Routes</th>
                        <th className="text-right pb-1.5 px-2">Tgt%</th>
                        <th className="text-right pb-1.5 pl-2">Catch%</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-800/60">
                      {stats.posBreakdown.map((p) => (
                        <tr key={p.positioning} className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">{p.positioning}</td>
                          <td className="py-2 px-2 text-right text-blue-400">{p.attempts}</td>
                          <td className="py-2 px-2 text-right text-yellow-400">{fmtPct(p.targetPct)}</td>
                          <td className={`py-2 pl-2 text-right font-semibold ${p.catchPct !== null ? (p.catchPct >= 65 ? "text-green-400" : p.catchPct >= 50 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(p.catchPct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {stats.totalPlays > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Play Flags</div>
                  <div className="flex gap-4">
                    <div className="p-3 bg-gray-800/50 rounded-lg text-center min-w-[100px]">
                      <div className="text-xs text-gray-500 mb-1">Broken Tackles</div>
                      <div className="text-xl font-bold text-yellow-400">{stats.brokenTackles}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{fmtPct(pct(stats.brokenTackles, stats.catches))} of catches</div>
                    </div>
                  </div>
                </div>
              )}

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
              <span className="ml-2 text-green-400 text-xs">{gamePlays.length} plays</span>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">Location</div>
              <div className="flex gap-2">
                {LOCATIONS.map((l) => (
                  <button key={l.key} onClick={() => setLocation(l.key)}
                    className={`flex-1 py-2 rounded text-sm font-medium transition ${location === l.key ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">Positioning</div>
              <div className="flex flex-wrap gap-2">
                {POSITIONINGS.map((p) => (
                  <button key={p.key} onClick={() => setPositioning(p.key)}
                    className={`px-3 py-2 rounded text-sm font-medium transition ${positioning === p.key ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">Play Type</div>
              <div className="flex gap-2">
                <button onClick={() => { setPlayType("run_block"); setBlockType(null); setBlockSuccess(null); }}
                  className={`flex-1 py-2 rounded text-sm font-medium transition ${playType === "run_block" ? "bg-purple-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  Run Block
                </button>
                <button onClick={() => { setPlayType("pass_block"); setBlockType(null); setBlockSuccess(null); }}
                  className={`flex-1 py-2 rounded text-sm font-medium transition ${playType === "pass_block" ? "bg-purple-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  Pass Block
                </button>
                <button onClick={() => { setPlayType("route_run"); setBlockType(null); setBlockSuccess(null); }}
                  className={`flex-1 py-2 rounded text-sm font-medium transition ${playType === "route_run" ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  Route Run
                </button>
                <button onClick={() => {
                  setPlayType("decoy");
                  setBlockType(null); setBlockSuccess(null);
                  setCoverage(null); setRouteType(null); setWasOpen(null); setTargeted(null);
                  setTargetOutcome(null); setContestedTarget(null); setContestedCatch(null); setBrokenTackle(false);
                }}
                  className={`flex-1 py-2 rounded text-sm font-medium transition ${playType === "decoy" ? "bg-yellow-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  Decoy
                </button>
              </div>
            </div>

            {playType === "decoy" && (
              <div className="p-3 bg-gray-900/60 rounded-lg border border-gray-700/50 text-xs text-gray-500">
                Decoy — no additional options. Click Log Play to record.
              </div>
            )}

            {(playType === "run_block" || playType === "pass_block") && (
              <div className="space-y-3 p-3 bg-gray-900/60 rounded-lg border border-purple-900/50">
                <div className="text-xs text-purple-400 font-medium">Block Details</div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Block Type</div>
                    <div className="flex gap-2">
                      {(["movement", "inline"] as TEBlockType[]).map((bt) => (
                        <button key={bt} onClick={() => setBlockType(bt)}
                          className={`px-4 py-2 rounded text-sm font-medium transition capitalize ${blockType === bt ? "bg-purple-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                          {bt.charAt(0).toUpperCase() + bt.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Outcome</div>
                    <div className="flex gap-2">
                      <button onClick={() => setBlockSuccess(true)}
                        className={`px-4 py-2 rounded text-sm font-bold transition ${blockSuccess === true ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        ✓ Success
                      </button>
                      <button onClick={() => setBlockSuccess(false)}
                        className={`px-4 py-2 rounded text-sm font-bold transition ${blockSuccess === false ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        ✗ Fail
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {playType === "route_run" && (
              <div className="space-y-3 p-3 bg-gray-900/60 rounded-lg border border-blue-900/50">
                <div className="text-xs text-blue-400 font-medium">Route Details</div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Coverage</div>
                  <div className="flex gap-2">
                    {(["man", "zone", "press", "double"] as TECoverage[]).map((cov) => (
                      <button key={cov} onClick={() => setCoverage(cov)}
                        className={`flex-1 py-2 rounded text-xs font-medium transition capitalize ${coverage === cov ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {cov.charAt(0).toUpperCase() + cov.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-500 mb-2">Route</div>
                  <div className="flex flex-wrap gap-1.5">
                    {ROUTE_TYPES.map((rt) => (
                      <button key={rt} onClick={() => setRouteType(rt)}
                        className={`px-3 py-1.5 rounded text-xs font-medium transition ${routeType === rt ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {ROUTE_LABELS[rt]}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-4">
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Was He Open?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setWasOpen(true)}
                        className={`px-4 h-9 rounded text-xs font-medium transition ${wasOpen === true ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                      <button onClick={() => setWasOpen(false)}
                        className={`px-4 h-9 rounded text-xs font-medium transition ${wasOpen === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Targeted?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setTargeted(true)}
                        className={`px-4 h-9 rounded text-xs font-medium transition ${targeted === true ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                      <button onClick={() => { setTargeted(false); setTargetOutcome(null); setContestedTarget(null); setContestedCatch(null); }}
                        className={`px-4 h-9 rounded text-xs font-medium transition ${targeted === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                    </div>
                  </div>
                </div>
                {targeted === true && (
                  <div className="space-y-3 pl-2 border-l-2 border-yellow-800/50">
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Outcome</div>
                      <div className="flex gap-2">
                        <button onClick={() => setTargetOutcome("caught")}
                          className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "caught" ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>✓ Caught</button>
                        <button onClick={() => { setTargetOutcome("dropped"); setBrokenTackle(false); }}
                          className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "dropped" ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>✗ Drop</button>
                        <button onClick={() => { setTargetOutcome("incomplete"); setContestedCatch(null); setBrokenTackle(false); }}
                          className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "incomplete" ? "bg-gray-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Incomplete</button>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Contested Target?</div>
                      <div className="flex gap-1.5">
                        <button onClick={() => setContestedTarget(true)}
                          className={`px-4 h-9 rounded text-xs font-medium transition ${contestedTarget === true ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                        <button onClick={() => { setContestedTarget(false); setContestedCatch(null); }}
                          className={`px-4 h-9 rounded text-xs font-medium transition ${contestedTarget === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                      </div>
                    </div>
                    {contestedTarget === true && (
                      <div>
                        <div className="text-xs text-gray-500 mb-2">Contested Catch?</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setContestedCatch(true)}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${contestedCatch === true ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                          <button onClick={() => setContestedCatch(false)}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${contestedCatch === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {targetOutcome === "caught" && (
              <div>
                <div className="text-xs text-gray-500 mb-2">Play Flags</div>
                <button onClick={() => setBrokenTackle((v) => !v)}
                  className={`px-4 py-2 rounded text-sm font-medium transition ${brokenTackle ? "bg-yellow-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                  Broken Tackle
                </button>
              </div>
            )}

            {editingPlayId && (
              <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded text-xs text-yellow-300">
                <span>✎</span><span>Editing play — make changes above then save</span>
                <button onClick={resetPlayForm} className="ml-auto text-yellow-400 hover:text-white transition">Cancel</button>
              </div>
            )}
            <div className="flex gap-2">
              <input className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500"
                placeholder="Play note (optional)" value={playNotes} onChange={(e) => setPlayNotes(e.target.value)} />
              {editingPlayId ? (
                <button onClick={saveEditedPlay} disabled={savingPlay || !canLog}
                  className="px-5 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-white text-sm rounded font-medium transition whitespace-nowrap">
                  {savingPlay ? "…" : "Save Edit"}
                </button>
              ) : (
                <button onClick={logPlay} disabled={savingPlay || !canLog}
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
                  {[...gamePlays].reverse().map((pl, i) => {
                    const isBlock = pl.play_type === "run_block" || pl.play_type === "pass_block";
                    const isDecoy = pl.play_type === "decoy";
                    const ptLabel = pl.play_type === "run_block" ? "RB" : pl.play_type === "pass_block" ? "PB" : pl.play_type === "decoy" ? "Dcy" : "Route";
                    const posLabel: Record<TEPositioning, string> = { wide: "Wide", slot: "Slot", inline: "Inl", full_back: "FB", running_back: "RB-pos", wing_back: "WB" };
                    const locLabel: Record<TELocation, string>    = { left: "L", right: "R", backfield: "BF" };
                    return (
                      <div key={pl.id} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs transition ${editingPlayId === pl.id ? "bg-yellow-900/40 border border-yellow-700/60" : "bg-gray-900 border border-transparent"}`}>
                        <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                        <span className="text-gray-400">{locLabel[pl.location]}</span>
                        <span className="text-gray-500">{posLabel[pl.positioning]}</span>
                        <span className={`font-medium ${isBlock ? "text-purple-400" : isDecoy ? "text-yellow-400" : "text-blue-400"}`}>{ptLabel}</span>
                        {isBlock ? (
                          <>
                            {pl.block_type && <span className="text-gray-400">{pl.block_type === "movement" ? "Mov" : "Inl"}</span>}
                            <span className={pl.block_success ? "text-green-400" : "text-red-400"}>{pl.block_success ? "✓" : "✗"}</span>
                          </>
                        ) : isDecoy ? null : (
                          <>
                            {pl.route_type && <span className="text-blue-300">{ROUTE_LABELS[pl.route_type]}</span>}
                            {pl.coverage && <span className="text-gray-500 capitalize">{pl.coverage}</span>}
                            {pl.was_open ? <span className="text-green-400">Open</span> : pl.was_open === false ? <span className="text-gray-600">Cvrd</span> : null}
                            {pl.targeted
                              ? pl.caught ? <span className="text-green-400">✓</span> : pl.dropped ? <span className="text-red-400">Drop</span> : <span className="text-gray-400">Inc</span>
                              : pl.targeted === false ? <span className="text-gray-600">—</span> : null}
                            {pl.contested_target && <span className="text-orange-400">Con</span>}
                          </>
                        )}
                        {pl.broken_tackle && <span className="text-yellow-400">BT</span>}
                        {pl.play_notes && <span className="text-gray-500 truncate">{pl.play_notes}</span>}
                        <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => editingPlayId === pl.id ? resetPlayForm() : startEditPlay(pl)}
                            className={`px-2 py-0.5 rounded text-xs transition ${editingPlayId === pl.id ? "text-yellow-400 hover:text-white" : "text-gray-600 hover:text-yellow-400"}`}>✎</button>
                          <button onClick={() => deletePlay(pl.id)} className="text-gray-700 hover:text-red-400">✕</button>
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
            <div className="text-gray-500 text-sm text-center py-8">Loading…</div>
          ) : games.length === 0 ? (
            <div className="text-gray-500 text-sm text-center py-8">No games charted yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
                    <th className="pb-2 pr-4">Season</th><th className="pb-2 pr-4">Opponent</th>
                    <th className="pb-2 pr-4">Type</th><th className="pb-2 pr-4 text-right">Plays</th>
                    <th className="pb-2 pr-4 text-right">Routes</th><th className="pb-2 pr-4 text-right">Tgts</th>
                    <th className="pb-2 pr-4 text-right">Blocks</th><th className="pb-2 text-right">Block Suc%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900">
                  {games.map((g) => {
                    const gp     = plays.filter((p) => p.game_id === g.id);
                    const routes = gp.filter((p) => p.play_type === "route_run");
                    const tgts   = routes.filter((p) => p.targeted === true).length;
                    const blocks = gp.filter((p) => p.play_type === "run_block" || p.play_type === "pass_block");
                    const bSuc   = blocks.filter((p) => p.block_success === true).length;
                    const bSucPct= blocks.length > 0 ? ((bSuc / blocks.length) * 100).toFixed(0) : null;
                    return (
                      <tr key={g.id} className="hover:bg-gray-900/50 transition">
                        <td className="py-2 pr-4 text-gray-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-gray-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gp.length}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{routes.length || "—"}</td>
                        <td className="py-2 pr-4 text-right text-yellow-400">{tgts || "—"}</td>
                        <td className="py-2 pr-4 text-right text-purple-400">{blocks.length || "—"}</td>
                        <td className={`py-2 text-right font-medium ${bSucPct !== null ? (parseInt(bSucPct) >= 75 ? "text-green-400" : parseInt(bSucPct) >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>
                          {bSucPct !== null ? `${bSucPct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{stats.totalPlays}</td>
                    <td className="pt-2 text-right text-green-400">{stats.routeAttempts}</td>
                    <td className="pt-2 text-right text-yellow-400">{stats.targets}</td>
                    <td className="pt-2 text-right text-purple-400">{stats.blockAttempts}</td>
                    <td className="pt-2 text-right text-gray-400">{fmtPct(stats.blockSucPct)}</td>
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
