"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { useAuth } from "../../lib/AuthContext";
import { getFcValuesRaw } from "../../lib/fcValuesStore";
import { useDraftBoardClass } from "../../hooks/useDraftBoardClass";
import { SAMPLE_TIERS } from "../../lib/scouting/sampleTiers";
import {
  DRAFT_BOARD_COLUMNS, DRAFT_BOARD_POSITIONS, sortDraftBoard, nflDraftLabel, latestScoresSavedAt,
  fcClassValues, fcValueFor, draftBoardSnapshotRows, readTiers, readNotes, type DraftBoardProspect,
} from "../../lib/helpers/draftBoard";
import type { BoardScores, SleeperNFLState } from "../../lib/types";
import { posBadge, normalizeRookieName } from "./shared";

const log = logger("components/draftHub/RookieBigBoard");

// The rookie board for the class the Draft Hub is on (useDraftBoardClass):
// the user's Scouting prospects in the Big Board's OVR order, with the scores
// that board saved (lib/helpers/draftBoard.ts). Tiers and notes are the one
// thing edited here, keyed by prospect id on the user's rookie_board_tiers row
// for the class year.

// How long typing must pause before a note saves to the account.
const NOTE_SYNC_DELAY_MS = 800;
const TIER_CHOICES = Array.from({ length: 15 }, (_, i) => i + 1);
const SAMPLE_UNIT: Record<string, string> = { QB: "throws", RB: "runs", WR: "routes", TE: "routes" };

// One grid for the header and every row, so the columns line up:
// OVR · sample dot · player · Dyn · Dyn+ · FC · tier · note.
const GRID =
  "grid grid-cols-[1.5rem_0.625rem_minmax(0,1fr)_2.25rem_2.25rem_2.5rem_2.25rem_1rem] " +
  "sm:grid-cols-[2rem_0.75rem_minmax(0,1fr)_3rem_3rem_3.5rem_3rem_1.5rem] gap-1 sm:gap-2 items-center";

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;

const OVR_TOOLTIP = "OVR: your Scouting Big Board's overall rank for the class. Change it there. Unranked prospects sit below, by Dynasty Score.";
const DYN_TOOLTIP = "Dynasty Score as of your last Scouting Big Board visit (live, without traits, at the sliders' weights then).";
const PLUS_TOOLTIP = "Dynasty Score Plus: Dynasty plus draft capital. Shows once the NFL draft round is set on the Scouting Big Board.";
const FC_TOOLTIP = "FantasyCalc Superflex dynasty value, matched by name to FantasyCalc's rookies of this class. Blank until FantasyCalc lists him.";
const NO_SCORES = "No saved scores yet: open Scouting → Big Board to save them";

interface LoadedBoard {
  /** The load this answers (user, class, reload count). */
  key: string;
  year: number;
  error: boolean;
  rows: DraftBoardProspect[];
  tiers: Record<string, number>;
  notes: Record<string, string>;
}

interface PendingNotes {
  year: number;
  notes: Record<string, string>;
  timer: ReturnType<typeof setTimeout> | null;
}

interface RookieBigBoardProps {
  nflState: SleeperNFLState | null;
  draftedPlayerIds: Set<string>;
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  onOpenScouting: () => void;
}

function sampleDot(pos: string, s: BoardScores["sample"] | undefined) {
  const t = s && SAMPLE_TIERS.find((x) => x.tier === s.tier);
  if (!s || !t) return <span aria-hidden="true" />;
  const how = s.tier === "full" ? "full" : `${Math.floor(s.share * 100)}% of full`;
  const count = s.n == null ? "under the sample floor" : `${s.n} ${SAMPLE_UNIT[pos] ?? "plays"} charted`;
  return (
    <span
      role="img"
      aria-label={`Sample: ${t.label}`}
      title={`Sample ${how}: ${count}`}
      className={`justify-self-center inline-block w-2.5 h-2.5 rounded-full ${t.dot}`}
    />
  );
}

function scoreCell(v: number | null | undefined, title: string) {
  if (v == null) return <span className="text-right text-xs text-slate-600" title={title}>—</span>;
  return (
    <span className={`text-right text-xs font-semibold tabular-nums ${v >= 0 ? "text-emerald-400" : "text-red-400"}`} title={title}>
      {signed(v)}
    </span>
  );
}

export default function RookieBigBoard({
  nflState, draftedPlayerIds, rookieSearch, setRookieSearch, onOpenScouting,
}: RookieBigBoardProps) {
  const { supabaseUser } = useAuth();
  const userId = supabaseUser?.id ?? null;
  const { classYear, ready } = useDraftBoardClass(nflState);

  const [posFilter, setPosFilter]           = useState<string | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [reloads, setReloads]               = useState(0);
  const [saveFailed, setSaveFailed]         = useState(false);

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [snapshotName, setSnapshotName]   = useState("");
  const [saving, setSaving]               = useState(false);
  const [saveSuccess, setSaveSuccess]     = useState(false);
  const [snapshotError, setSnapshotError] = useState(false);

  // ── Load ────────────────────────────────────────────────────
  // The class's prospects and the year's tiers and notes, fresh on every
  // visit (this mounts each time the board is opened). Waits for the class
  // to settle, so it doesn't load one class and then the other.
  const loadKey = userId && ready ? `${userId}|${classYear}|${reloads}` : null;
  const [loaded, setLoaded] = useState<LoadedBoard | null>(null);
  useEffect(() => {
    if (!loadKey || !userId) return;
    let cancelled = false;
    const year = classYear;
    const fail = (err: string) => {
      if (cancelled) return;
      log.error("draft board load failed", { err });
      setLoaded({ key: loadKey, year, error: true, rows: [], tiers: {}, notes: {} });
    };
    Promise.all([
      supabase
        .from("prospects")
        .select(DRAFT_BOARD_COLUMNS)
        .eq("user_id", userId)
        .eq("draft_class_year", year)
        .in("position", [...DRAFT_BOARD_POSITIONS]),
      supabase
        .from("rookie_board_tiers")
        .select("tiers,notes")
        .eq("user_id", userId)
        .eq("year", String(year))
        .maybeSingle(),
    ]).then(([prospects, saved]) => {
      if (cancelled) return;
      const err = prospects.error ?? saved.error;
      if (err) { fail(err.message); return; }
      setLoaded({
        key: loadKey,
        year,
        error: false,
        rows: sortDraftBoard((prospects.data ?? []) as DraftBoardProspect[]),
        tiers: readTiers(saved.data?.tiers),
        notes: readNotes(saved.data?.notes),
      });
    }, (e: unknown) => fail(String(e)));
    return () => { cancelled = true; };
  }, [loadKey, userId, classYear]);
  const board = loaded && loaded.key === loadKey ? loaded : null;
  const rows = board?.rows;

  // ── FantasyCalc (the shared store; no extra request when it's warm) ──
  const [fcRaw, setFcRaw] = useState<unknown[]>([]);
  useEffect(() => {
    let cancelled = false;
    getFcValuesRaw(2, true).then(
      (data) => { if (!cancelled) setFcRaw(data); },
      (e: unknown) => log.warn("FantasyCalc values unavailable", { err: String(e) }),
    );
    return () => { cancelled = true; };
  }, []);
  const fcMap = useMemo(() => fcClassValues(fcRaw, classYear), [fcRaw, classYear]);
  const fcById = useMemo(() => {
    const out = new Map<string, number>();
    for (const p of rows ?? []) out.set(p.id, fcValueFor(p.name, p.position, fcMap));
    return out;
  }, [rows, fcMap]);

  // ── Saves ───────────────────────────────────────────────────
  // Tiers and notes ride the user's rookie_board_tiers row for the year; an
  // upsert of one column leaves the other alone. One write at a time, so an
  // older map can't land after a newer one.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  const saveYearRow = useCallback((year: number, patch: { tiers?: Record<string, number>; notes?: Record<string, string> }) => {
    if (!userId) return;
    const row = { user_id: userId, year: String(year), ...patch, updated_at: new Date().toISOString() };
    writeChainRef.current = writeChainRef.current
      .then(() => supabase.from("rookie_board_tiers").upsert(row, { onConflict: "user_id,year" }))
      .then(
        ({ error }) => {
          if (error) log.error("draft board save failed", { err: error.message });
          setSaveFailed(!!error);
        },
        (e: unknown) => {
          log.error("draft board save failed", { err: String(e) });
          setSaveFailed(true);
        },
      );
  }, [userId]);

  // Typing saves once it pauses; leaving the board saves anything waiting.
  const pendingNotesRef = useRef<PendingNotes | null>(null);
  const flushNotes = useCallback(() => {
    const pending = pendingNotesRef.current;
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pendingNotesRef.current = null;
    saveYearRow(pending.year, { notes: readNotes(pending.notes) });
  }, [saveYearRow]);
  useEffect(() => () => flushNotes(), [flushNotes]);

  const setTier = (id: string, tier: number | null) => {
    if (!board) return;
    const next = { ...board.tiers };
    if (tier == null) delete next[id];
    else next[id] = tier;
    setLoaded((prev) => (prev && prev.key === board.key ? { ...prev, tiers: next } : prev));
    saveYearRow(board.year, { tiers: next });
  };

  const saveNote = (id: string, text: string) => {
    if (!board) return;
    const next = { ...board.notes, [id]: text };
    setLoaded((prev) => (prev && prev.key === board.key ? { ...prev, notes: next } : prev));
    if (pendingNotesRef.current && pendingNotesRef.current.year !== board.year) flushNotes();
    const pending = pendingNotesRef.current;
    if (pending?.timer) clearTimeout(pending.timer);
    pendingNotesRef.current = { year: board.year, notes: next, timer: setTimeout(flushNotes, NOTE_SYNC_DELAY_MS) };
  };

  async function saveSnapshot() {
    if (!userId || !board || !snapshotName.trim()) return;
    setSaving(true);
    setSnapshotError(false);
    const snapshotData = draftBoardSnapshotRows(board.rows, board.tiers, (p) => fcById.get(p.id) ?? 0);
    try {
      const { error } = await supabase
        .from("big_board_snapshots")
        .upsert(
          { user_id: userId, name: snapshotName.trim(), snapshot_data: snapshotData, saved_at: new Date().toISOString() },
          { onConflict: "user_id,name" }
        );
      if (error) throw new Error(error.message);
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); setShowSaveModal(false); setSnapshotName(""); }, 1000);
    } catch (e: unknown) {
      log.error("snapshot save failed", { err: e instanceof Error ? e.message : String(e) });
      setSnapshotError(true);
    } finally {
      setSaving(false);
    }
  }

  // ── What shows ──────────────────────────────────────────────
  const visible = useMemo(() => {
    const q = rookieSearch.trim().toLowerCase();
    return (rows ?? []).filter((p) =>
      (!posFilter || p.position === posFilter) &&
      (!q || p.name.toLowerCase().includes(q) || (p.school ?? "").toLowerCase().includes(q)));
  }, [rows, rookieSearch, posFilter]);

  const ranked = useMemo(() => (rows ?? []).filter((p) => p.overall_rank != null).length, [rows]);
  const savedAt = useMemo(() => latestScoresSavedAt(rows ?? []), [rows]);
  const unscored = useMemo(() => (rows ?? []).filter((p) => !p.board_scores).length, [rows]);

  if (!supabaseUser) {
    return (
      <div className="text-slate-500 text-center py-16 text-sm">
        Sign in to see your draft board. It lists your Scouting prospects in your Big Board&apos;s order.
      </div>
    );
  }

  if (!board) {
    return <div className="text-slate-500 text-center py-16 text-sm">Loading your draft board…</div>;
  }

  if (board.error) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400 text-sm">Couldn&apos;t load your {board.year} draft board.</p>
        <button
          onClick={() => setReloads((n) => n + 1)}
          className="mt-3 px-3 py-1.5 text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition"
        >
          Try again
        </button>
      </div>
    );
  }

  if (board.rows.length === 0) {
    return (
      <div className="text-center py-16 max-w-md mx-auto px-4">
        <p className="text-slate-300 text-sm font-medium">No {board.year} prospects yet.</p>
        <p className="text-slate-500 text-xs mt-2">
          The draft board lists your Scouting prospects in the {board.year} class, in your Big Board&apos;s OVR
          order. Add them in Scouting, then rank them on the Big Board.
        </p>
        <button
          onClick={onOpenScouting}
          className="mt-4 px-4 py-1.5 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition"
        >
          Open Scouting
        </button>
      </div>
    );
  }

  const searching = !!rookieSearch.trim();
  const noteProspect = expandedNoteId ? board.rows.find((p) => p.id === expandedNoteId) : undefined;

  return (
    <div className="max-w-3xl mx-auto">

      {/* Save Board modal */}
      {showSaveModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => { if (!saving) setShowSaveModal(false); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="save-board-title"
            tabIndex={-1}
            onKeyDown={(e) => { if (e.key === "Escape" && !saving) setShowSaveModal(false); }}
            className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-sm mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="save-board-title" className="text-white font-semibold text-sm mb-1">Save Big Board Snapshot</h2>
            <p className="text-slate-500 text-xs mb-4">
              Give this snapshot a name. Saving with the same name overwrites the previous version.
            </p>
            <input
              autoFocus
              type="text"
              placeholder={`e.g. ${board.year} Pre-Draft`}
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveSnapshot(); }}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500 mb-4"
            />
            {snapshotError && <p role="alert" className="text-red-400 text-xs -mt-2 mb-3">Couldn&apos;t save the snapshot. Try again.</p>}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                disabled={saving}
                className="px-4 py-1.5 text-sm text-slate-400 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveSnapshot}
                disabled={saving || !snapshotName.trim()}
                className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition disabled:opacity-50 ${
                  saveSuccess
                    ? "bg-emerald-600 text-white"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note popup */}
      {noteProspect && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setExpandedNoteId(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-popup-title"
            tabIndex={-1}
            onKeyDown={(e) => { if (e.key === "Escape") setExpandedNoteId(null); }}
            className="bg-slate-900 border border-slate-700 rounded-2xl p-5 w-full max-w-md mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div>
                <div id="note-popup-title" className="text-sm font-semibold text-white">{noteProspect.name}</div>
                <div className="text-xs text-slate-500">{noteProspect.position}{noteProspect.school ? ` · ${noteProspect.school}` : ""}</div>
              </div>
              <button aria-label="Close note editor" onClick={() => setExpandedNoteId(null)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            <textarea
              autoFocus
              aria-label={`Note on ${noteProspect.name}`}
              value={board.notes[noteProspect.id] || ""}
              onChange={(e) => saveNote(noteProspect.id, e.target.value)}
              placeholder="Scouting notes, injury flags, scheme fit..."
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500 placeholder:text-slate-600"
              rows={5}
            />
            <div className="flex justify-end mt-3">
              <button
                onClick={() => setExpandedNoteId(null)}
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-lg transition"
              >Done</button>
            </div>
          </div>
        </div>
      )}

      {/* Class + Save Board */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h2 className="text-white font-semibold text-sm">{board.year} Rookie Class</h2>
          <p className="text-[11px] text-slate-500">
            {ranked} ranked · {board.rows.length - ranked} unranked · order from Scouting → Big Board (OVR)
          </p>
        </div>
        <button
          onClick={() => { setSnapshotError(false); setShowSaveModal(true); }}
          className="px-3 py-1.5 text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition shrink-0"
        >
          Save Board
        </button>
      </div>

      {/* min-w-0 lets the search box shrink on a phone; flex-wrap catches the hint. */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <input
          type="text"
          aria-label="Search prospects"
          placeholder="Search name or school..."
          value={rookieSearch}
          onChange={(e) => setRookieSearch(e.target.value)}
          className="flex-1 min-w-0 p-2 rounded bg-slate-800 text-sm"
        />
        {searching && (
          <span className="text-[11px] text-slate-500">Tier dividers hidden while searching</span>
        )}
      </div>

      {/* Position filter pills */}
      <div className="flex items-center gap-1.5 mb-2">
        {DRAFT_BOARD_POSITIONS.map((pos) => (
          <button
            key={pos}
            onClick={() => setPosFilter((prev) => prev === pos ? null : pos)}
            aria-pressed={posFilter === pos}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition ${
              posFilter === pos
                ? posBadge[pos] + " border-transparent"
                : "border-slate-700 text-slate-500 hover:text-white"
            }`}
          >
            {pos}
          </button>
        ))}
        {posFilter && (
          <button
            onClick={() => setPosFilter(null)}
            className="text-[10px] text-slate-500 hover:text-white transition ml-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Legend: the sample dots, and how fresh the scores are */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500 mb-1 px-0.5">
        <ul aria-label="Sample charted" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <li>Sample:</li>
          {SAMPLE_TIERS.map((t) => (
            <li key={t.tier} className="flex items-center gap-1 whitespace-nowrap">
              <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full ${t.dot}`} />
              {t.label}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-[10px] text-slate-600 mb-3 px-0.5">
        {savedAt
          ? `Scores from your last Big Board visit, ${new Date(savedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`
          : "No saved scores yet."}
        {unscored > 0 && ` ${unscored} without scores: open Scouting → Big Board to save them.`}
      </p>

      {saveFailed && (
        <p role="alert" className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded-lg px-3 py-2 mb-2">
          Couldn&apos;t save your last tier or note change. It&apos;ll try again with your next edit.
        </p>
      )}

      {/* Column headers */}
      <div className={`${GRID} px-2 sm:px-3 mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500`}>
        <span className="text-center" title={OVR_TOOLTIP}>OVR</span>
        <span aria-hidden="true" />
        <span>Player</span>
        <span className="text-right" title={DYN_TOOLTIP}>Dyn</span>
        <span className="text-right" title={PLUS_TOOLTIP}>Dyn+</span>
        <span className="text-right" title={FC_TOOLTIP}>FC</span>
        <span className="text-center">Tier</span>
        <span aria-hidden="true" />
      </div>

      {visible.length === 0 && (
        <p className="text-slate-500 text-center py-8 text-sm">No prospects match.</p>
      )}

      {visible.map((p, i) => {
        const prev = i > 0 ? visible[i - 1] : null;
        const myTier = board.tiers[p.id];
        const unrankedStart = p.overall_rank == null && (!prev || prev.overall_rank != null);
        const showTierDivider = !searching && !!prev && myTier !== board.tiers[prev.id];
        const hasNote = !!(board.notes[p.id] || "").trim();
        const fc = fcById.get(p.id) ?? 0;
        const nfl = nflDraftLabel(p);
        const taken = draftedPlayerIds.has(`name:${normalizeRookieName(p.name)}`);
        const s = p.board_scores;
        const badge = posBadge[p.position] || "bg-slate-700 text-slate-400";
        const dynTitle = !s ? NO_SCORES
          : s.dynasty == null ? "Needs an AE Score first (chart more of him in Scouting)"
          : `${DYN_TOOLTIP} Age ×${s.weights.age}, size ×${s.weights.size}.`;
        const plusTitle = !s ? NO_SCORES
          : s.plus == null ? (s.dynasty == null ? "Needs an AE Score first" : "Shows once the NFL draft round is set on the Scouting Big Board")
          : `Dynasty Score Plus as of your last Big Board visit. Draft capital ×${s.weights.draft}.`;

        return (
          <div key={p.id}>
            {unrankedStart && (
              <div className="flex items-center gap-3 my-2 px-1">
                <div className="flex-1 h-px bg-slate-700/60" />
                <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Unranked · by Dynasty Score</span>
                <div className="flex-1 h-px bg-slate-700/60" />
              </div>
            )}
            {showTierDivider && (
              <div className="flex items-center gap-3 my-2 px-1">
                <div className="flex-1 h-px bg-slate-600/50" />
                {myTier !== undefined && (
                  <span className="text-[10px] font-bold tracking-widest text-slate-500 uppercase">Tier {myTier}</span>
                )}
                <div className="flex-1 h-px bg-slate-600/50" />
              </div>
            )}

            <div className={`${GRID} bg-slate-800/70 px-2 sm:px-3 py-1.5 mb-0.5 rounded-lg text-sm${taken ? " opacity-40" : ""}`}>
              <span className="text-center text-xs font-mono text-slate-400">{p.overall_rank ?? "—"}</span>
              {sampleDot(p.position, s?.sample)}
              {/* On a phone the name gets the whole first line and the
                  position badge drops to the second, beside the school. */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-medium truncate">{p.name}</span>
                  <span className={`hidden sm:inline text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0 ${badge}`}>
                    {p.position}
                  </span>
                </div>
                <div className="text-[10px] truncate">
                  <span className={`sm:hidden mr-1 px-1 rounded font-semibold ${badge}`}>{p.position}</span>
                  {nfl
                    ? <span className="text-indigo-300">{nfl}</span>
                    : <span className="text-slate-500">{p.school || "—"}</span>}
                  {taken && <span className="ml-1.5 font-bold text-slate-400">TAKEN</span>}
                </div>
              </div>
              {scoreCell(s?.dynasty, dynTitle)}
              {scoreCell(s?.plus, plusTitle)}
              <span className="text-right text-[10px] font-mono text-slate-400 tabular-nums" title={FC_TOOLTIP}>
                {fc > 0 ? fc.toLocaleString() : "—"}
              </span>
              <select
                aria-label={`Tier for ${p.name}`}
                value={myTier ?? ""}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setTier(p.id, Number.isNaN(val) ? null : val);
                }}
                className={`w-full appearance-none text-center text-[10px] font-bold rounded px-0.5 py-0.5 outline-none cursor-pointer border transition ${
                  myTier !== undefined
                    ? "bg-blue-900/40 border-blue-800/60 text-blue-300"
                    : "bg-slate-700/50 border-slate-700 text-slate-500"
                }`}
              >
                <option value="">Tier</option>
                {TIER_CHOICES.map((n) => (
                  <option key={n} value={n}>T{n}</option>
                ))}
              </select>
              <button
                onClick={() => setExpandedNoteId(p.id)}
                aria-label={hasNote ? `Edit note on ${p.name}` : `Add note on ${p.name}`}
                title={hasNote ? "View/edit note" : "Add note"}
                className={`text-sm leading-none transition ${hasNote ? "text-amber-400 hover:text-amber-300" : "text-slate-600 hover:text-slate-400"}`}
              >
                {hasNote ? "📝" : "○"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
