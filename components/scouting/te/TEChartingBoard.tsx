"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../../lib/supabaseclient";
import type {
  Prospect,
  ScoutingGame,
  TEPlay,
  TELocation,
  TEPositioning,
  TEPlayType,
  TEBlockType,
  TECoverage,
  RouteType,
  ChartingDecision,
} from "../../../lib/types";

const GAME_TYPES = ["regular", "bowl", "playoff", "scrimmage"];

const NFL_ROLES = ["Inline TE", "Move TE", "Receiving TE", "Blocking TE", "F-Back/Flex", ""];

const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Pending" },
  { value: "not_charting",  label: "Not Charting" },
];

const LOCATIONS: { key: TELocation; label: string }[] = [
  { key: "left",      label: "Left" },
  { key: "right",     label: "Right" },
  { key: "backfield", label: "Backfield" },
];

const POSITIONINGS: { key: TEPositioning; label: string }[] = [
  { key: "wide",        label: "Wide" },
  { key: "slot",        label: "Slot" },
  { key: "inline",      label: "Inline" },
  { key: "full_back",   label: "Full Back" },
  { key: "running_back",label: "Running Back" },
];

const ROUTES: RouteType[] = ["nine","post","dig","curl","slant","screen","flat","comeback","out","corner","other"];

const ROUTE_LABELS: Record<RouteType, string> = {
  nine: "Nine", post: "Post", dig: "Dig", curl: "Curl", slant: "Slant",
  screen: "Screen", flat: "Flat", comeback: "Comeback", out: "Out", corner: "Corner", other: "Other",
};

type BoardTab = "overview" | "chart" | "games";
type TargetOutcome = "caught" | "dropped" | "incomplete" | null;

const pct = (n: number, d: number) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null);
const fmtPct = (v: number | null) => (v !== null ? `${v}%` : "—");

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
}

export default function TEChartingBoard({ prospect, onBack, onDataChanged }: Props) {
  const [tab, setTab] = useState<BoardTab>("overview");
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [plays, setPlays] = useState<TEPlay[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add game form
  const [showAddGame, setShowAddGame] = useState(false);
  const [newGame, setNewGame] = useState({ year: 2025, opponent: "", type: "regular" });
  const [savingGame, setSavingGame] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);

  // Play logger form
  const [location, setLocation] = useState<TELocation>("left");
  const [positioning, setPositioning] = useState<TEPositioning>("inline");
  const [playType, setPlayType] = useState<TEPlayType>("route_run");
  // Blocking
  const [blockType, setBlockType] = useState<TEBlockType | null>(null);
  const [blockSuccess, setBlockSuccess] = useState<boolean | null>(null);
  // Route
  const [coverage, setCoverage] = useState<TECoverage | null>(null);
  const [routeType, setRouteType] = useState<RouteType | null>(null);
  const [wasOpen, setWasOpen] = useState<boolean | null>(null);
  const [targeted, setTargeted] = useState<boolean | null>(null);
  const [targetOutcome, setTargetOutcome] = useState<TargetOutcome>(null);
  const [contestedTarget, setContestedTarget] = useState<boolean | null>(null);
  const [contestedCatch, setContestedCatch] = useState<boolean | null>(null);
  // Universal
  const [brokenTackle, setBrokenTackle] = useState(false);
  const [playNotes, setPlayNotes] = useState("");
  const [savingPlay, setSavingPlay] = useState(false);
  const [playError, setPlayError] = useState<string | null>(null);

  // Bio edit
  const [editBio, setEditBio] = useState(false);
  const [bio, setBio] = useState<Partial<Prospect>>({});
  const [savingBio, setSavingBio] = useState(false);

  // Notes summary
  const [notesSummary, setNotesSummary] = useState<string | null>(null);
  const [loadingNotesSummary, setLoadingNotesSummary] = useState(false);

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
      const { data: pData } = await supabase
        .from("te_plays")
        .select("*")
        .in("game_id", gList.map((g) => g.id))
        .order("created_at");
      setPlays((pData ?? []) as TEPlay[]);
    } else {
      setPlays([]);
    }
    setLoading(false);
  }, [prospect.id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setBio({
      height: prospect.height, weight: prospect.weight, birthday: prospect.birthday,
      draft_class_year: prospect.draft_class_year, personal_rank: prospect.personal_rank,
      should_play: prospect.should_play, will_play_pre: prospect.will_play_pre,
      will_play_post: prospect.will_play_post, charting_decision: prospect.charting_decision,
      charting_notes: prospect.charting_notes,
    });
    setNotesSummary(null);
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

  // ── Aggregate stats ───────────────────────────────────────────
  const stats = useMemo(() => {
    const routePlays  = plays.filter((p) => p.play_type === "route_run");
    const blockPlays  = plays.filter((p) => p.play_type === "run_block" || p.play_type === "pass_block");
    const runBlocks   = plays.filter((p) => p.play_type === "run_block");
    const passBlocks  = plays.filter((p) => p.play_type === "pass_block");

    const targets       = routePlays.filter((p) => p.targeted === true);
    const catches       = targets.filter((p) => p.caught === true);
    const drops         = targets.filter((p) => p.dropped === true);
    const contestedTgts = targets.filter((p) => p.contested_target === true);
    const contestedCtch = contestedTgts.filter((p) => p.contested_catch === true);
    const openRoutes    = routePlays.filter((p) => p.was_open === true);
    const brokenTackles = plays.filter((p) => p.broken_tackle === true && p.caught === true);

    // Block success rates
    const blockSuc       = blockPlays.filter((p) => p.block_success === true).length;
    const runBlockSuc    = runBlocks.filter((p) => p.block_success === true).length;
    const passBlockSuc   = passBlocks.filter((p) => p.block_success === true).length;

    // Route type breakdown
    const routeBreakdown = ROUTES.map((rt) => {
      const rp  = routePlays.filter((p) => p.route_type === rt);
      const tgt = rp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      const open = rp.filter((p) => p.was_open === true);
      return {
        route: rt,
        attempts: rp.length,
        openPct: pct(open.length, rp.length),
        targetPct: pct(tgt.length, rp.length),
        catchPct: pct(ctch.length, tgt.length),
      };
    }).filter((r) => r.attempts > 0);

    // Coverage breakdown
    const coverageBreakdown = (["man", "zone", "press", "double"] as TECoverage[]).map((cov) => {
      const cp  = routePlays.filter((p) => p.coverage === cov);
      const tgt = cp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      const open = cp.filter((p) => p.was_open === true);
      return {
        coverage: cov,
        attempts: cp.length,
        openPct: pct(open.length, cp.length),
        targetPct: pct(tgt.length, cp.length),
        catchPct: pct(ctch.length, tgt.length),
      };
    }).filter((c) => c.attempts > 0);

    // Positioning breakdown (route runs only)
    const posBreakdown = POSITIONINGS.map(({ key, label }) => {
      const pp  = routePlays.filter((p) => p.positioning === key);
      const tgt = pp.filter((p) => p.targeted === true);
      const ctch = tgt.filter((p) => p.caught === true);
      return {
        positioning: label,
        attempts: pp.length,
        targetPct: pct(tgt.length, pp.length),
        catchPct: pct(ctch.length, tgt.length),
      };
    }).filter((p) => p.attempts > 0);

    return {
      totalPlays: plays.length,
      routeAttempts: routePlays.length,
      blockAttempts: blockPlays.length,
      runBlockAttempts: runBlocks.length,
      passBlockAttempts: passBlocks.length,
      targets: targets.length,
      catches: catches.length,
      drops: drops.length,
      contestedTargets: contestedTgts.length,
      contestedCatches: contestedCtch.length,
      openRoutes: openRoutes.length,
      brokenTackles: brokenTackles.length,
      openPct:   pct(openRoutes.length, routePlays.length),
      targetPct: pct(targets.length, routePlays.length),
      catchPct:  pct(catches.length, targets.length),
      contestedCatchPct: pct(contestedCtch.length, contestedTgts.length),
      blockSuc,
      blockSucPct: pct(blockSuc, blockPlays.length),
      runBlockAttempts2: runBlocks.length,
      runBlockSucPct:  pct(runBlockSuc, runBlocks.length),
      passBlockAttempts2: passBlocks.length,
      passBlockSucPct: pct(passBlockSuc, passBlocks.length),
      runMovementAttempts: runBlocks.filter((p) => p.block_type === "movement").length,
      runMovementSucPct: pct(runBlocks.filter((p) => p.block_type === "movement" && p.block_success).length, runBlocks.filter((p) => p.block_type === "movement").length),
      runInlineAttempts: runBlocks.filter((p) => p.block_type === "inline").length,
      runInlineSucPct: pct(runBlocks.filter((p) => p.block_type === "inline" && p.block_success).length, runBlocks.filter((p) => p.block_type === "inline").length),
      passMovementAttempts: passBlocks.filter((p) => p.block_type === "movement").length,
      passMovementSucPct: pct(passBlocks.filter((p) => p.block_type === "movement" && p.block_success).length, passBlocks.filter((p) => p.block_type === "movement").length),
      passInlineAttempts: passBlocks.filter((p) => p.block_type === "inline").length,
      passInlineSucPct: pct(passBlocks.filter((p) => p.block_type === "inline" && p.block_success).length, passBlocks.filter((p) => p.block_type === "inline").length),
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

  // ── Validation ────────────────────────────────────────────────
  const canLog = useMemo(() => {
    if (!selectedGameId) return false;
    if (playType === "run_block" || playType === "pass_block") {
      return blockType !== null && blockSuccess !== null;
    }
    // route_run
    if (!coverage || !routeType || wasOpen === null || targeted === null) return false;
    if (targeted) {
      if (targetOutcome === null) return false;
      if (contestedTarget === null) return false;
      if (contestedTarget && contestedCatch === null) return false;
    }
    return true;
  }, [selectedGameId, playType, blockType, blockSuccess, coverage, routeType, wasOpen, targeted, targetOutcome, contestedTarget, contestedCatch]);

  async function addGame() {
    if (!newGame.opponent.trim()) return;
    setGameError(null);
    setSavingGame(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setGameError("Not logged in."); setSavingGame(false); return; }
    const slot = games.filter((g) => g.season_year === newGame.year).length + 1;
    const { data, error } = await supabase.from("scouting_games").insert({
      user_id: user.id, prospect_id: prospect.id,
      season_year: newGame.year, opponent: newGame.opponent.trim(),
      game_slot: slot, game_type: newGame.type,
    }).select().single();
    if (error) { setGameError(error.message); }
    else if (data) {
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

  function resetPlayForm() {
    setBlockType(null);
    setBlockSuccess(null);
    setCoverage(null);
    setRouteType(null);
    setWasOpen(null);
    setTargeted(null);
    setTargetOutcome(null);
    setContestedTarget(null);
    setContestedCatch(null);
    setBrokenTackle(false);
    setPlayNotes("");
  }

  async function logPlay() {
    if (!canLog || !selectedGameId) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }

    const isBlock = playType === "run_block" || playType === "pass_block";
    const isTargeted = !isBlock && targeted === true;

    const { data, error } = await supabase.from("te_plays").insert({
      user_id: user.id,
      game_id: selectedGameId,
      location,
      positioning,
      play_type: playType,
      block_type: isBlock ? blockType : null,
      block_success: isBlock ? blockSuccess : null,
      coverage: isBlock ? null : coverage,
      route_type: isBlock ? null : routeType,
      was_open: isBlock ? null : wasOpen,
      targeted: isBlock ? null : targeted,
      caught: isTargeted ? targetOutcome === "caught" : null,
      dropped: isTargeted ? targetOutcome === "dropped" : null,
      contested_target: isTargeted ? contestedTarget : null,
      contested_catch: isTargeted && contestedTarget ? contestedCatch : null,
      broken_tackle: isTargeted && targetOutcome === "caught" ? brokenTackle : false,
      play_notes: playNotes || null,
    }).select().single();

    if (error) { setPlayError(error.message); }
    else if (data) {
      setPlays((prev) => [...prev, data as TEPlay]);
      resetPlayForm();
      onDataChanged();
    }
    setSavingPlay(false);
  }

  async function deletePlay(id: string) {
    await supabase.from("te_plays").delete().eq("id", id);
    setPlays((prev) => prev.filter((p) => p.id !== id));
    onDataChanged();
  }

  async function saveBio() {
    setSavingBio(true);
    await supabase.from("prospects").update({ ...bio, updated_at: new Date().toISOString() }).eq("id", prospect.id);
    setSavingBio(false);
    setEditBio(false);
    onDataChanged();
  }

  async function generateNotesSummary() {
    const notes = plays.map((p) => p.play_notes).filter((n) => n && n.trim());
    if (notes.length === 0) return;
    setLoadingNotesSummary(true);
    try {
      const res = await fetch("/api/scouting/notes-summary", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes, totalPlays: plays.length, position: "TE" }),
      });
      const { summary, error } = await res.json() as { summary?: string; error?: string };
      setNotesSummary(summary ?? error ?? "Failed to generate summary.");
    } catch {
      setNotesSummary("Failed to generate summary.");
    }
    setLoadingNotesSummary(false);
  }

  const tabs: { key: BoardTab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "chart",    label: "Chart Game" },
    { key: "games",    label: "Games" },
  ];

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={onBack} className="mt-0.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0">
          ← Back
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-white truncate">{prospect.name}</h2>
          <p className="text-sm text-gray-400">
            TE · {prospect.school}
            {prospect.conference && ` · ${prospect.conference}`}
            {" · "}<span className="text-green-400">{prospect.draft_class_year} Class</span>
          </p>
        </div>
        <div className="flex-shrink-0 text-right text-xs text-gray-500">
          <div>{stats.totalPlays} plays · {games.length} games</div>
          <div className="text-green-400">{stats.routeAttempts} routes · {stats.blockAttempts} blocks</div>
        </div>
        <button onClick={() => setEditBio((e) => !e)} className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded transition flex-shrink-0">
          {editBio ? "Close" : "Edit Bio"}
        </button>
      </div>

      {/* Bio edit panel */}
      {editBio && (
        <div className="p-4 bg-gray-900 border border-gray-700 rounded-lg">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
            {[
              { label: "Height",        key: "height" as const,        type: "text",   placeholder: '6\'4"' },
              { label: "Weight (lbs)",  key: "weight" as const,        type: "number", placeholder: "250" },
              { label: "Birthday",      key: "birthday" as const,      type: "date",   placeholder: "" },
              { label: "Personal Rank", key: "personal_rank" as const, type: "number", placeholder: "1" },
            ].map((f) => (
              <div key={f.key}>
                <label className="block text-xs text-gray-500 mb-1">{f.label}</label>
                <input type={f.type} placeholder={f.placeholder}
                  className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
                  value={(bio[f.key] as string | number | null | undefined) ?? ""}
                  onChange={(e) => setBio((b) => ({ ...b, [f.key]: f.type === "number" ? (e.target.value ? Number(e.target.value) : null) : (e.target.value || null) }))}
                />
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Draft Class Year</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
                value={bio.draft_class_year ?? 2026} onChange={(e) => setBio((b) => ({ ...b, draft_class_year: Number(e.target.value) }))}>
                {[2026, 2027, 2028, 2029].map((y) => <option key={y}>{y}</option>)}
              </select>
            </div>
            {(["should_play", "will_play_pre", "will_play_post"] as const).map((k) => (
              <div key={k}>
                <label className="block text-xs text-gray-500 mb-1">
                  {k === "should_play" ? "Should Play" : k === "will_play_pre" ? "Will Play (Pre)" : "Will Play (Post)"}
                </label>
                <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
                  value={bio[k] ?? ""} onChange={(e) => setBio((b) => ({ ...b, [k]: e.target.value }))}>
                  {NFL_ROLES.map((r) => <option key={r} value={r}>{r || "—"}</option>)}
                </select>
              </div>
            ))}
            <div>
              <label className="block text-xs text-gray-500 mb-1">Charting Status</label>
              <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-green-500"
                value={bio.charting_decision ?? "pending"} onChange={(e) => setBio((b) => ({ ...b, charting_decision: e.target.value as ChartingDecision }))}>
                {CHARTING_DECISIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-xs text-gray-500 mb-1">Charting Notes</label>
            <textarea rows={2} className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm focus:outline-none focus:border-green-500 resize-none"
              value={bio.charting_notes ?? ""} onChange={(e) => setBio((b) => ({ ...b, charting_notes: e.target.value }))} />
          </div>
          <button onClick={saveBio} disabled={savingBio} className="px-4 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition">
            {savingBio ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition whitespace-nowrap ${
              tab === t.key ? "border-green-500 text-green-400" : "border-transparent text-gray-400 hover:text-white"
            }`}
          >{t.label}</button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
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

              {/* Route rate cards */}
              {stats.routeAttempts > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Open Rate",            value: fmtPct(stats.openPct),             color: "text-green-400" },
                    { label: "Target Rate",          value: fmtPct(stats.targetPct),           color: "text-yellow-400" },
                    { label: "Catch Rate",           value: fmtPct(stats.catchPct),            color: "text-green-300" },
                    { label: "Contested Catch Rate", value: fmtPct(stats.contestedCatchPct),   color: "text-orange-400" },
                  ].map((s) => (
                    <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                      <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                      <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Blocking breakdown */}
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
                      {/* All Blocks total */}
                      <tr className="hover:bg-gray-800/30">
                        <td className="py-2 pr-3 text-white font-medium">All Blocks</td>
                        <td className="py-2 px-2 text-right text-blue-400">{stats.blockAttempts}</td>
                        <td className={`py-2 pl-2 text-right font-semibold ${stats.blockSucPct !== null ? (stats.blockSucPct >= 75 ? "text-green-400" : stats.blockSucPct >= 55 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>{fmtPct(stats.blockSucPct)}</td>
                      </tr>
                      {/* Run Block + sub-rows */}
                      {stats.runBlockAttempts2 > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">Run Block</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.runBlockAttempts2}</td>
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
                      {/* Pass Block + sub-rows */}
                      {stats.passBlockAttempts2 > 0 && (
                        <tr className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">Pass Block</td>
                          <td className="py-2 px-2 text-right text-blue-400">{stats.passBlockAttempts2}</td>
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

              {/* Route type breakdown */}
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

              {/* Coverage breakdown */}
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

              {/* Positioning breakdown */}
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

              {/* Broken Tackle flag */}
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

              {/* Play Notes AI Summary */}
              {plays.some((p) => p.play_notes?.trim()) && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-white">Play Notes Summary</span>
                    <button onClick={generateNotesSummary} disabled={loadingNotesSummary}
                      className="px-3 py-1.5 bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white text-xs rounded transition">
                      {loadingNotesSummary ? "Analyzing…" : notesSummary ? "Regenerate" : "Generate Summary"}
                    </button>
                  </div>
                  {notesSummary ? (
                    <p className="text-sm text-gray-300 leading-relaxed">{notesSummary}</p>
                  ) : (
                    <p className="text-xs text-gray-600">
                      {plays.filter((p) => p.play_notes?.trim()).length} of {plays.length} plays have notes.
                      Click Generate to analyze patterns with AI.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── CHART GAME ── */}
      {tab === "chart" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Game list */}
          <div className="md:col-span-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-300">Games ({games.length})</span>
              <button onClick={() => setShowAddGame((s) => !s)} className="px-2 py-1 bg-green-700 hover:bg-green-600 text-white text-xs rounded transition">+ Add</button>
            </div>
            {showAddGame && (
              <div className="mb-3 p-3 bg-gray-900 border border-gray-700 rounded-lg space-y-2">
                <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.year} onChange={(e) => setNewGame((n) => ({ ...n, year: Number(e.target.value) }))}>
                  {[2023, 2024, 2025, 2026].map((y) => <option key={y}>{y}</option>)}
                </select>
                <input className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500"
                  placeholder="Opponent" value={newGame.opponent} onChange={(e) => setNewGame((n) => ({ ...n, opponent: e.target.value }))} />
                <select className="w-full px-2 py-1.5 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  value={newGame.type} onChange={(e) => setNewGame((n) => ({ ...n, type: e.target.value }))}>
                  {GAME_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <div className="flex gap-2">
                  <button onClick={addGame} disabled={savingGame || !newGame.opponent.trim()}
                    className="flex-1 py-1.5 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded transition">
                    {savingGame ? "…" : "Add Game"}
                  </button>
                  <button onClick={() => setShowAddGame(false)} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition">✕</button>
                </div>
                {gameError && <p className="text-red-400 text-xs">{gameError}</p>}
              </div>
            )}
            <div className="space-y-1">
              {loading ? (
                <div className="text-gray-500 text-xs py-4 text-center">Loading…</div>
              ) : games.length === 0 ? (
                <div className="text-gray-500 text-xs py-4 text-center">No games added yet.</div>
              ) : (
                games.map((g) => (
                  <div key={g.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer border transition ${selectedGameId === g.id ? "bg-green-900/30 border-green-700" : "bg-gray-900 border-gray-800 hover:border-gray-600"}`}
                    onClick={() => setSelectedGameId(g.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium text-white truncate">{g.season_year} {g.opponent}</div>
                      <div className="text-xs text-gray-500 capitalize">{g.game_type}</div>
                    </div>
                    <div className="text-xs text-green-400 flex-shrink-0">{gamePlayCounts[g.id] ?? 0}pl</div>
                    <button onClick={(e) => { e.stopPropagation(); deleteGame(g.id); }} className="text-gray-600 hover:text-red-400 text-xs px-1 flex-shrink-0">✕</button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Play logger */}
          <div className="md:col-span-2">
            {!selectedGame ? (
              <div className="text-gray-500 text-sm text-center py-12">Select or add a game to start logging plays.</div>
            ) : (
              <div className="space-y-4">
                <div className="text-sm font-medium text-gray-300">
                  Logging: <span className="text-white">{selectedGame.season_year} vs {selectedGame.opponent}</span>
                  <span className="ml-2 text-green-400 text-xs">{gamePlays.length} plays</span>
                </div>

                {/* Location */}
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

                {/* Positioning */}
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

                {/* Play Type */}
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
                  </div>
                </div>

                {/* Blocking fields */}
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

                {/* Route fields */}
                {playType === "route_run" && (
                  <div className="space-y-3 p-3 bg-gray-900/60 rounded-lg border border-blue-900/50">
                    <div className="text-xs text-blue-400 font-medium">Route Details</div>

                    {/* Coverage */}
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

                    {/* Route */}
                    <div>
                      <div className="text-xs text-gray-500 mb-2">Route</div>
                      <div className="flex flex-wrap gap-1.5">
                        {ROUTES.map((rt) => (
                          <button key={rt} onClick={() => setRouteType(rt)}
                            className={`px-3 py-1.5 rounded text-xs font-medium transition ${routeType === rt ? "bg-blue-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            {ROUTE_LABELS[rt]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Was Open + Targeted */}
                    <div className="flex flex-wrap gap-4">
                      <div>
                        <div className="text-xs text-gray-500 mb-2">Was He Open?</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setWasOpen(true)}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${wasOpen === true ? "bg-green-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            Yes
                          </button>
                          <button onClick={() => setWasOpen(false)}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${wasOpen === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            No
                          </button>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-2">Targeted?</div>
                        <div className="flex gap-1.5">
                          <button onClick={() => setTargeted(true)}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${targeted === true ? "bg-yellow-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            Yes
                          </button>
                          <button onClick={() => { setTargeted(false); setTargetOutcome(null); setContestedTarget(null); setContestedCatch(null); }}
                            className={`px-4 h-9 rounded text-xs font-medium transition ${targeted === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            No
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Target outcome (only when targeted) */}
                    {targeted === true && (
                      <div className="space-y-3 pl-2 border-l-2 border-yellow-800/50">
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Outcome</div>
                          <div className="flex gap-2">
                            <button onClick={() => setTargetOutcome("caught")}
                              className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "caught" ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                              ✓ Caught
                            </button>
                            <button onClick={() => { setTargetOutcome("dropped"); setBrokenTackle(false); }}
                              className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "dropped" ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                              ✗ Drop
                            </button>
                            <button onClick={() => { setTargetOutcome("incomplete"); setContestedCatch(null); setBrokenTackle(false); }}
                              className={`px-4 py-2 rounded text-xs font-bold transition ${targetOutcome === "incomplete" ? "bg-gray-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                              Incomplete
                            </button>
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500 mb-2">Contested Target?</div>
                          <div className="flex gap-1.5">
                            <button onClick={() => setContestedTarget(true)}
                              className={`px-4 h-9 rounded text-xs font-medium transition ${contestedTarget === true ? "bg-orange-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                              Yes
                            </button>
                            <button onClick={() => { setContestedTarget(false); setContestedCatch(null); }}
                              className={`px-4 h-9 rounded text-xs font-medium transition ${contestedTarget === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                              No
                            </button>
                          </div>
                        </div>
                        {contestedTarget === true && (
                          <div>
                            <div className="text-xs text-gray-500 mb-2">Contested Catch?</div>
                            <div className="flex gap-1.5">
                              <button onClick={() => setContestedCatch(true)}
                                className={`px-4 h-9 rounded text-xs font-medium transition ${contestedCatch === true ? "bg-orange-500 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                                Yes
                              </button>
                              <button onClick={() => setContestedCatch(false)}
                                className={`px-4 h-9 rounded text-xs font-medium transition ${contestedCatch === false ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                                No
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Broken Tackle — only on caught passes */}
                {targetOutcome === "caught" && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Play Flags</div>
                    <button onClick={() => setBrokenTackle((v) => !v)}
                      className={`px-4 py-2 rounded text-sm font-medium transition ${brokenTackle ? "bg-yellow-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      Broken Tackle
                    </button>
                  </div>
                )}

                {/* Notes + log */}
                <div className="flex gap-2">
                  <input className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500"
                    placeholder="Play note (optional)" value={playNotes} onChange={(e) => setPlayNotes(e.target.value)} />
                  <button onClick={logPlay} disabled={savingPlay || !canLog}
                    className="px-5 py-2 bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm rounded font-medium transition">
                    {savingPlay ? "…" : "Log Play"}
                  </button>
                </div>
                {playError && <p className="text-red-400 text-xs">{playError}</p>}

                {/* Recent plays */}
                {gamePlays.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Plays This Game ({gamePlays.length})</div>
                    <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                      {[...gamePlays].reverse().map((pl, i) => {
                        const isBlock = pl.play_type === "run_block" || pl.play_type === "pass_block";
                        const ptLabel = pl.play_type === "run_block" ? "RB" : pl.play_type === "pass_block" ? "PB" : "Route";
                        const posLabel: Record<TEPositioning, string> = {
                          wide: "Wide", slot: "Slot", inline: "Inl",
                          full_back: "FB", running_back: "RB-pos",
                        };
                        const locLabel: Record<TELocation, string> = { left: "L", right: "R", backfield: "BF" };
                        return (
                          <div key={pl.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 rounded text-xs">
                            <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                            <span className="text-gray-400">{locLabel[pl.location]}</span>
                            <span className="text-gray-500">{posLabel[pl.positioning]}</span>
                            <span className={`font-medium ${isBlock ? "text-purple-400" : "text-blue-400"}`}>{ptLabel}</span>
                            {isBlock ? (
                              <>
                                {pl.block_type && <span className="text-gray-400 capitalize">{pl.block_type === "movement" ? "Mov" : "Inl"}</span>}
                                <span className={pl.block_success ? "text-green-400" : "text-red-400"}>{pl.block_success ? "✓" : "✗"}</span>
                              </>
                            ) : (
                              <>
                                {pl.route_type && <span className="text-blue-300 capitalize">{ROUTE_LABELS[pl.route_type]}</span>}
                                {pl.coverage && <span className="text-gray-500 capitalize">{pl.coverage}</span>}
                                {pl.was_open ? <span className="text-green-400">Open</span> : pl.was_open === false ? <span className="text-gray-600">Cvrd</span> : null}
                                {pl.targeted
                                  ? pl.caught ? <span className="text-green-400">✓</span>
                                    : pl.dropped ? <span className="text-red-400">Drop</span>
                                    : <span className="text-gray-400">Inc</span>
                                  : pl.targeted === false ? <span className="text-gray-600">—</span> : null}
                                {pl.contested_target && <span className="text-orange-400">Con</span>}
                              </>
                            )}
                            {pl.broken_tackle && <span className="text-yellow-400">BT</span>}
                            {pl.play_notes && <span className="text-gray-500 truncate">{pl.play_notes}</span>}
                            <button onClick={() => deletePlay(pl.id)} className="ml-auto text-gray-700 hover:text-red-400 flex-shrink-0">✕</button>
                          </div>
                        );
                      })}
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
                    <th className="pb-2 pr-4 text-right">Routes</th>
                    <th className="pb-2 pr-4 text-right">Tgts</th>
                    <th className="pb-2 pr-4 text-right">Blocks</th>
                    <th className="pb-2 text-right">Block Suc%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900">
                  {games.map((g) => {
                    const gp = plays.filter((p) => p.game_id === g.id);
                    const routes = gp.filter((p) => p.play_type === "route_run");
                    const tgts = routes.filter((p) => p.targeted === true).length;
                    const blocks = gp.filter((p) => p.play_type === "run_block" || p.play_type === "pass_block");
                    const bSuc = blocks.filter((p) => p.block_success === true).length;
                    const bSucPct = blocks.length > 0 ? ((bSuc / blocks.length) * 100).toFixed(0) : null;
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
    </div>
  );
}
