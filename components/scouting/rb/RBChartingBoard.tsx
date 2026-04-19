"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../../../lib/supabaseclient";
import type {
  Prospect,
  ScoutingGame,
  RBPlay,
  RBFormation,
  RBRunType,
  ChartingDecision,
} from "../../../lib/types";

const FORMATIONS: { key: RBFormation; label: string }[] = [
  { key: "gun",          label: "Gun" },
  { key: "pistol",       label: "Pistol" },
  { key: "under_center", label: "Under Center" },
];

const GAME_TYPES = ["regular", "bowl", "playoff", "scrimmage"];

const NFL_ROLES = ["Bellcow", "1A/1B", "Lead Back", "Receiving Back", "Change-of-Pace", "Committee", ""];

const CHARTING_DECISIONS: { value: ChartingDecision; label: string }[] = [
  { value: "fully_charted", label: "Fully Charted" },
  { value: "partial_chart", label: "Partial Chart" },
  { value: "charting",      label: "Charting" },
  { value: "pending",       label: "Pending" },
  { value: "not_charting",  label: "Not Charting" },
];

type BoardTab = "overview" | "chart" | "games";

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
  const pct = (n: number, d: number) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null);
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
  const pct = (n: number, d: number) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null);
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

interface Props {
  prospect: Prospect;
  onBack: () => void;
  onDataChanged: () => void;
}

export default function RBChartingBoard({ prospect, onBack, onDataChanged }: Props) {
  const [tab, setTab] = useState<BoardTab>("overview");
  const [games, setGames] = useState<ScoutingGame[]>([]);
  const [plays, setPlays] = useState<RBPlay[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Add game form
  const [showAddGame, setShowAddGame] = useState(false);
  const [newGame, setNewGame] = useState({ year: 2025, opponent: "", type: "regular" });
  const [savingGame, setSavingGame] = useState(false);
  const [gameError, setGameError] = useState<string | null>(null);

  // Play logger form
  const [formation, setFormation] = useState<RBFormation>("gun");
  const [runType, setRunType] = useState<RBRunType>("outside_zone");
  const [success, setSuccess] = useState<boolean | null>(null);
  const [loadedBox, setLoadedBox] = useState(false);
  const [unblockedDefender, setUnblockedDefender] = useState(false);
  const [brokenTackle, setBrokenTackle] = useState(false);
  const [explosivePlay, setExplosivePlay] = useState(false);
  const [runStuff, setRunStuff] = useState(false);
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
      const gameIds = gList.map((g) => g.id);
      const { data: pData } = await supabase
        .from("rb_plays")
        .select("*")
        .in("game_id", gameIds)
        .order("created_at");
      setPlays((pData ?? []) as RBPlay[]);
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
    const pct = (n: number, d: number) => (d > 0 ? parseFloat(((n / d) * 100).toFixed(1)) : null);

    const runPlays = plays.filter((p) => p.run_type !== "pass_block");
    const runAttempts = runPlays.length;

    // Formation breakdown (all plays)
    const formationStats = (["gun", "pistol", "under_center"] as RBFormation[]).reduce((acc, f) => {
      const fp = plays.filter((p) => p.formation === f);
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
    const manGap        = mergeRunTypeStats(outsideManGap, insideManGap);
    const zoneAttempt   = mergeRunTypeStats(outsideZone, insideZone);

    // Post-play flags (% of run attempts only)
    const brokenTackle  = runPlays.filter((p) => p.broken_tackle).length;
    const explosivePlay = runPlays.filter((p) => p.explosive_play).length;
    const runStuff      = runPlays.filter((p) => p.run_stuff).length;

    return {
      totalPlays: plays.length,
      runAttempts,
      passBlockAttempts: passBlock.attempts,
      formationStats,
      runTypes: { outsideManGap, insideManGap, outsideZone, insideZone, passBlock },
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
    setSuccess(null);
    setLoadedBox(false);
    setUnblockedDefender(false);
    setBrokenTackle(false);
    setExplosivePlay(false);
    setRunStuff(false);
    setPlayNotes("");
  }

  async function logPlay() {
    if (!selectedGameId || success === null) return;
    setPlayError(null);
    setSavingPlay(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setPlayError("Not logged in."); setSavingPlay(false); return; }
    const { data, error } = await supabase.from("rb_plays").insert({
      user_id: user.id, game_id: selectedGameId,
      formation, run_type: runType, success,
      loaded_box: loadedBox, unblocked_defender: unblockedDefender,
      broken_tackle: brokenTackle, explosive_play: explosivePlay, run_stuff: runStuff,
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

  async function deletePlay(id: string) {
    await supabase.from("rb_plays").delete().eq("id", id);
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
        body: JSON.stringify({ notes, totalPlays: plays.length, position: "RB" }),
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

  // ── Run type stats table row helper ──────────────────────────
  function StatRow({ label, s, indent }: { label: string; s: RunTypeStat; indent?: boolean }) {
    const successColor = s.successPct !== null
      ? s.successPct >= 55 ? "text-green-400" : s.successPct >= 40 ? "text-yellow-400" : "text-red-400"
      : "text-gray-600";
    return (
      <tr className="border-b border-gray-800/60 hover:bg-gray-800/30">
        <td className={`py-2 pr-2 text-sm font-medium ${indent ? "pl-5 text-gray-400 text-xs" : "text-white"}`}>
          {indent && <span className="text-gray-600 mr-1">↳</span>}{label}
        </td>
        <td className="py-2 px-2 text-right text-sm text-blue-400">{s.attempts || "—"}</td>
        <td className={`py-2 px-2 text-right text-sm font-semibold ${successColor}`}>
          {s.successPct !== null ? `${s.successPct}%` : "—"}
        </td>
        <td className="py-2 px-2 text-right text-xs text-gray-400">
          {s.loadedBox > 0 ? `${s.loadedBox}` : "—"}
          {s.loadedBoxPct !== null && <span className="text-gray-600 ml-1">({s.loadedBoxPct}%)</span>}
        </td>
        <td className={`py-2 px-2 text-right text-xs font-medium ${s.loadedBoxSuccessPct !== null ? (s.loadedBoxSuccessPct >= 50 ? "text-green-400" : "text-red-400") : "text-gray-600"}`}>
          {s.loadedBoxSuccessPct !== null ? `${s.loadedBoxSuccessPct}%` : "—"}
        </td>
        <td className="py-2 px-2 text-right text-xs text-gray-400">
          {s.unblocked > 0 ? `${s.unblocked}` : "—"}
          {s.unblockedPct !== null && <span className="text-gray-600 ml-1">({s.unblockedPct}%)</span>}
        </td>
        <td className={`py-2 pl-2 text-right text-xs font-medium ${s.unblockedSuccessPct !== null ? (s.unblockedSuccessPct >= 50 ? "text-green-400" : "text-red-400") : "text-gray-600"}`}>
          {s.unblockedSuccessPct !== null ? `${s.unblockedSuccessPct}%` : "—"}
        </td>
      </tr>
    );
  }

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
            RB · {prospect.school}
            {prospect.conference && ` · ${prospect.conference}`}
            {" · "}<span className="text-green-400">{prospect.draft_class_year} Class</span>
          </p>
        </div>
        <div className="flex-shrink-0 text-right text-xs text-gray-500">
          <div>{stats.totalPlays} plays · {games.length} games</div>
          <div className="text-green-400">{stats.runAttempts} run att</div>
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
              { label: "Height",        key: "height" as const,        type: "text",   placeholder: '6\'0"' },
              { label: "Weight (lbs)",  key: "weight" as const,        type: "number", placeholder: "210" },
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
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: "Total Plays",    value: stats.totalPlays,       color: "text-blue-400" },
                  { label: "Run Attempts",   value: stats.runAttempts,      color: "text-green-400" },
                  { label: "Pass Blocks",    value: stats.passBlockAttempts,color: "text-purple-400" },
                  { label: "Games",          value: games.length,           color: "text-gray-300" },
                ].map((s) => (
                  <div key={s.label} className="p-3 bg-gray-900 rounded-lg border border-gray-800">
                    <div className="text-xs text-gray-500 mb-1">{s.label}</div>
                    <div className={`text-xl font-bold ${s.color}`}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Formation breakdown */}
              <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-xs text-gray-500 mb-3">Formation Breakdown</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 text-xs text-gray-600">
                      <th className="text-left pb-1.5 pr-3">Formation</th>
                      <th className="text-right pb-1.5 px-2">Att</th>
                      <th className="text-right pb-1.5 px-2">Suc</th>
                      <th className="text-right pb-1.5 pl-2">Suc%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800/60">
                    {FORMATIONS.map(({ key, label }) => {
                      const f = stats.formationStats[key];
                      const color = f.successPct !== null
                        ? f.successPct >= 55 ? "text-green-400" : f.successPct >= 40 ? "text-yellow-400" : "text-red-400"
                        : "text-gray-600";
                      return (
                        <tr key={key} className="hover:bg-gray-800/30">
                          <td className="py-2 pr-3 text-white font-medium">{label}</td>
                          <td className="py-2 px-2 text-right text-blue-400">{f.attempts || "—"}</td>
                          <td className="py-2 px-2 text-right text-gray-300">{f.successes || "—"}</td>
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
              <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                <div className="text-xs text-gray-500 mb-3">Run Type Breakdown</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[620px]">
                    <thead>
                      <tr className="border-b border-gray-800 text-xs text-gray-600">
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
                    </tbody>
                  </table>
                  <div className="mt-2 flex gap-4 text-[10px] text-gray-600">
                    <span><span className="text-teal-600">LB</span> = Loaded Box</span>
                    <span><span className="text-orange-700">UB</span> = Unblocked Defender</span>
                    <span>Suc% = success / attempts</span>
                  </div>
                </div>
              </div>

              {/* Play outcome flags */}
              {stats.runAttempts > 0 && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="text-xs text-gray-500 mb-3">Play Outcome Flags <span className="text-gray-700">(% of {stats.runAttempts} run attempts)</span></div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { label: "Broken Tackle",  f: stats.flags.brokenTackle,  color: "text-yellow-400" },
                      { label: "Explosive Play", f: stats.flags.explosivePlay, color: "text-green-400" },
                      { label: "Run Stuff",      f: stats.flags.runStuff,      color: "text-red-400" },
                    ].map(({ label, f, color }) => (
                      <div key={label} className="p-3 bg-gray-800/50 rounded-lg text-center">
                        <div className="text-xs text-gray-500 mb-1">{label}</div>
                        <div className={`text-xl font-bold ${color}`}>{f.count}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{f.pct !== null ? `${f.pct}%` : "—"}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Play Notes AI Summary */}
              {plays.some((p) => p.play_notes?.trim()) && (
                <div className="p-4 bg-gray-900 rounded-lg border border-gray-800">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-medium text-white">Play Notes Summary</span>
                    <button
                      onClick={generateNotesSummary}
                      disabled={loadingNotesSummary}
                      className="px-3 py-1.5 bg-green-800 hover:bg-green-700 disabled:opacity-50 text-white text-xs rounded transition"
                    >
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

                {/* Formation */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Formation</div>
                  <div className="flex gap-2">
                    {FORMATIONS.map((f) => (
                      <button key={f.key} onClick={() => setFormation(f.key)}
                        className={`px-4 py-2 rounded text-sm font-medium transition ${formation === f.key ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Run Type */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Run Type</div>
                  <div className="space-y-2">
                    {/* Man Gap group */}
                    <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1.5 font-medium uppercase tracking-wider">Man Gap</div>
                      <div className="flex gap-2">
                        {(["outside_man_gap", "inside_man_gap"] as RBRunType[]).map((rt) => (
                          <button key={rt} onClick={() => setRunType(rt)}
                            className={`flex-1 py-2 rounded text-xs font-medium transition ${runType === rt ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            {rt === "outside_man_gap" ? "Outside" : "Inside"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Zone group */}
                    <div className="p-2 bg-gray-900 border border-gray-800 rounded-lg">
                      <div className="text-xs text-gray-600 mb-1.5 font-medium uppercase tracking-wider">Zone Attempt</div>
                      <div className="flex gap-2">
                        {(["outside_zone", "inside_zone"] as RBRunType[]).map((rt) => (
                          <button key={rt} onClick={() => setRunType(rt)}
                            className={`flex-1 py-2 rounded text-xs font-medium transition ${runType === rt ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                            {rt === "outside_zone" ? "Outside" : "Inside"}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* Pass block */}
                    <button onClick={() => setRunType("pass_block")}
                      className={`w-full py-2 rounded text-sm font-medium transition ${runType === "pass_block" ? "bg-purple-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      Pass Block Attempt
                    </button>
                  </div>
                </div>

                {/* Context toggles */}
                <div className="flex flex-wrap gap-3">
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Loaded Box?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setLoadedBox(true)} className={`px-3 h-9 rounded text-xs font-medium transition ${loadedBox ? "bg-teal-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                      <button onClick={() => setLoadedBox(false)} className={`px-3 h-9 rounded text-xs font-medium transition ${!loadedBox ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-2">Unblocked Defender?</div>
                    <div className="flex gap-1.5">
                      <button onClick={() => setUnblockedDefender(true)} className={`px-3 h-9 rounded text-xs font-medium transition ${unblockedDefender ? "bg-orange-700 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>Yes</button>
                      <button onClick={() => setUnblockedDefender(false)} className={`px-3 h-9 rounded text-xs font-medium transition ${!unblockedDefender ? "bg-gray-600 text-white" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>No</button>
                    </div>
                  </div>
                </div>

                {/* Success / Fail */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Result</div>
                  <div className="flex gap-3">
                    <button onClick={() => setSuccess(true)}
                      className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === true ? "bg-green-600 text-white ring-2 ring-green-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      ✓ SUCCESS
                    </button>
                    <button onClick={() => setSuccess(false)}
                      className={`flex-1 py-3 rounded-lg text-sm font-bold transition ${success === false ? "bg-red-600 text-white ring-2 ring-red-400" : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                      ✗ FAIL
                    </button>
                  </div>
                </div>

                {/* Post-play flags */}
                <div>
                  <div className="text-xs text-gray-500 mb-2">Play Flags <span className="text-gray-700">(select if yes)</span></div>
                  <div className="flex gap-2">
                    {[
                      { label: "Broken Tackle", val: brokenTackle, set: setBrokenTackle, color: "bg-yellow-700" },
                      { label: "Explosive Play", val: explosivePlay, set: setExplosivePlay, color: "bg-green-800" },
                      { label: "Run Stuff", val: runStuff, set: setRunStuff, color: "bg-red-800" },
                    ].map(({ label, val, set, color }) => (
                      <button key={label} onClick={() => set(!val)}
                        className={`flex-1 py-2 rounded text-xs font-medium transition ${val ? `${color} text-white` : "bg-gray-800 text-gray-400 hover:bg-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Notes + log */}
                <div className="flex gap-2">
                  <input className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-green-500"
                    placeholder="Play note (optional)" value={playNotes} onChange={(e) => setPlayNotes(e.target.value)} />
                  <button onClick={logPlay} disabled={savingPlay || success === null}
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
                        const rtLabel: Record<RBRunType, string> = {
                          outside_man_gap: "OG", inside_man_gap: "IG",
                          outside_zone: "OZ", inside_zone: "IZ", pass_block: "PB",
                        };
                        const fLabel: Record<RBFormation, string> = { gun: "Gun", pistol: "Pst", under_center: "UC" };
                        return (
                          <div key={pl.id} className="flex items-center gap-2 px-3 py-1.5 bg-gray-900 rounded text-xs">
                            <span className="text-gray-500 w-5 flex-shrink-0">{gamePlays.length - i}</span>
                            <span className="text-gray-400">{fLabel[pl.formation]}</span>
                            <span className="text-white font-medium">{rtLabel[pl.run_type]}</span>
                            {pl.loaded_box && <span className="text-teal-400">LB</span>}
                            {pl.unblocked_defender && <span className="text-orange-400">UB</span>}
                            <span className={pl.success ? "text-green-400" : "text-red-400"}>{pl.success ? "✓" : "✗"}</span>
                            {pl.broken_tackle && <span className="text-yellow-400">BT</span>}
                            {pl.explosive_play && <span className="text-green-300">EXP</span>}
                            {pl.run_stuff && <span className="text-red-300">STF</span>}
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
                    <th className="pb-2 pr-4 text-right">Run Att</th>
                    <th className="pb-2 text-right">Suc%</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900">
                  {games.map((g) => {
                    const gPlays = plays.filter((p) => p.game_id === g.id);
                    const runs = gPlays.filter((p) => p.run_type !== "pass_block");
                    const suc = runs.filter((p) => p.success === true).length;
                    const sucPct = runs.length > 0 ? ((suc / runs.length) * 100).toFixed(0) : null;
                    return (
                      <tr key={g.id} className="hover:bg-gray-900/50 transition">
                        <td className="py-2 pr-4 text-gray-300">{g.season_year}</td>
                        <td className="py-2 pr-4 text-white font-medium">{g.opponent}</td>
                        <td className="py-2 pr-4 text-gray-400 capitalize">{g.game_type}</td>
                        <td className="py-2 pr-4 text-right text-blue-400">{gPlays.length}</td>
                        <td className="py-2 pr-4 text-right text-green-400">{runs.length}</td>
                        <td className={`py-2 text-right font-medium ${sucPct !== null ? (parseInt(sucPct) >= 55 ? "text-green-400" : parseInt(sucPct) >= 40 ? "text-yellow-400" : "text-red-400") : "text-gray-600"}`}>
                          {sucPct !== null ? `${sucPct}%` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-700 text-xs text-gray-500 font-medium">
                    <td colSpan={3} className="pt-2">Total ({games.length} games)</td>
                    <td className="pt-2 text-right text-blue-400">{stats.totalPlays}</td>
                    <td className="pt-2 text-right text-green-400">{stats.runAttempts}</td>
                    <td className="pt-2 text-right text-gray-400">—</td>
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
