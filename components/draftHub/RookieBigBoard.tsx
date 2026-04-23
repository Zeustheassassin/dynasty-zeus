"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "../../lib/supabaseclient";
import { logger } from "../../lib/logger";
import { CURRENT_YEAR as ROOKIE_YEAR } from "../../lib/helpers";
import { useAuth } from "../../lib/AuthContext";
import { useValues } from "../../lib/ValuesContext";
import type { RookieBoardPlayer } from "../../lib/types";
import { posBadge, rookieKey, fuzzyFcLookup } from "./shared";
import { getLocalStorageItem, setLocalStorageItem } from "@/lib/hooks/useLocalStorage";

const log = logger("components/draftHub/RookieBigBoard");

type NflDraftEntry = { team: string; round: number | null; pick: number | null };

interface RookieBigBoardProps {
  rookies: RookieBoardPlayer[];
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  tempRanks: Record<number, string>;
  setTempRanks: Dispatch<SetStateAction<Record<number, string>>>;
  draftedPlayerIds: Set<string>;
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
}

export default function RookieBigBoard({
  rookies, rookieSearch, setRookieSearch,
  dragIndex, setDragIndex, tempRanks, setTempRanks,
  draftedPlayerIds, movePlayer, handleRankChange,
}: RookieBigBoardProps) {
  const { supabaseUser } = useAuth();
  const { fcNameValues } = useValues();

  const [tierLabels, setTierLabels]         = useState<Record<string, number>>({});
  const [playerNotes, setPlayerNotes]       = useState<Record<string, string>>({});
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [posFilter, setPosFilter]           = useState<string | null>(null);

  const [nflDraftInfo, setNflDraftInfo] = useState<Record<string, NflDraftEntry>>(() =>
    getLocalStorageItem<Record<string, NflDraftEntry>>("nflDraftInfo", {})
  );
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [draftTeam, setDraftTeam]   = useState("");
  const [draftRound, setDraftRound] = useState("");
  const [draftPick, setDraftPick]   = useState("");

  const [showSaveModal, setShowSaveModal] = useState(false);
  const [snapshotName, setSnapshotName]   = useState("");
  const [saving, setSaving]               = useState(false);
  const [saveSuccess, setSaveSuccess]     = useState(false);

  const fcVal = useCallback(
    (r: RookieBoardPlayer): number => fuzzyFcLookup(r.name, fcNameValues) || r.fcValue || 0,
    [fcNameValues],
  );

  const fcRanks = useMemo<Record<string, number>>(() => {
    const ranks: Record<string, number> = {};
    [...rookies]
      .filter((r) => fcVal(r) > 0)
      .sort((a, b) => fcVal(b) - fcVal(a))
      .forEach((r, i) => { ranks[rookieKey(r)] = i + 1; });
    return ranks;
  }, [rookies, fcVal]);

  const userFcRanks = useMemo<Record<string, number>>(() => {
    const ranks: Record<string, number> = {};
    rookies
      .filter((r) => fcVal(r) > 0)
      .forEach((r, i) => { ranks[rookieKey(r)] = i + 1; });
    return ranks;
  }, [rookies, fcVal]);

  const filteredRookies = useMemo(
    () =>
      rookies
        .map((p, originalIndex) => ({ p, originalIndex }))
        .filter(
          ({ p }) =>
            p.name &&
            p.name !== "Player Invalid" &&
            p.name.toLowerCase().includes(rookieSearch.toLowerCase()) &&
            (!posFilter || p.position === posFilter),
        ),
    [rookies, rookieSearch, posFilter],
  );

  const bigBoardParentRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/incompatible-library
  const bigBoardVirtualizer = useVirtualizer({
    count: filteredRookies.length,
    getScrollElement: () => bigBoardParentRef.current,
    estimateSize: () => 44,
    overscan: 8,
  });

  useEffect(() => {
    const notes = getLocalStorageItem<Record<string, string> | null>(`draftNotes_${ROOKIE_YEAR}`, null);
    if (notes) setPlayerNotes(notes);
  }, []);

  useEffect(() => {
    const load = async () => {
      if (supabaseUser) {
        try {
          const { data, error } = await supabase
            .from("rookie_board_tiers")
            .select("tiers")
            .eq("user_id", supabaseUser.id)
            .eq("year", ROOKIE_YEAR)
            .single();
          if (!error && data?.tiers && typeof data.tiers === "object") {
            setTierLabels(data.tiers as Record<string, number>);
            setLocalStorageItem(`draftTiersV2_${ROOKIE_YEAR}`, data.tiers);
            return;
          }
        } catch {}
      }
      const tiers = getLocalStorageItem<Record<string, number> | null>(`draftTiersV2_${ROOKIE_YEAR}`, null);
      if (tiers) {
        delete tiers["null"];
        setTierLabels(tiers);
      }
    };
    load();
  }, [supabaseUser]);

  const syncTiersToSupabase = (tiers: Record<string, number>) => {
    if (!supabaseUser) return;
    supabase.from("rookie_board_tiers").upsert(
      { user_id: supabaseUser.id, year: ROOKIE_YEAR, tiers, updated_at: new Date().toISOString() },
      { onConflict: "user_id,year" }
    ).then(({ error }) => {
      if (error) log.error("tier sync failed", { err: error.message });
    });
  };

  const saveTier = (playerId: string, tierNum: number) => {
    const next = { ...tierLabels, [playerId]: tierNum };
    setTierLabels(next);
    setLocalStorageItem(`draftTiersV2_${ROOKIE_YEAR}`, next);
    syncTiersToSupabase(next);
  };

  const removeTier = (playerId: string) => {
    const next = { ...tierLabels };
    delete next[playerId];
    setTierLabels(next);
    setLocalStorageItem(`draftTiersV2_${ROOKIE_YEAR}`, next);
    syncTiersToSupabase(next);
  };

  const saveNote = (playerId: string, text: string) => {
    const next = { ...playerNotes, [playerId]: text };
    setPlayerNotes(next);
    setLocalStorageItem(`draftNotes_${ROOKIE_YEAR}`, next);
  };

  async function saveSnapshot() {
    if (!supabaseUser || !snapshotName.trim()) return;
    setSaving(true);
    const snapshotData = rookies.map((p, i) => {
      const key = p.player_id || `name:${p.name}`;
      return {
        player_id: p.player_id ?? null,
        name: p.name,
        position: p.position,
        team: p.team ?? null,
        rank: i + 1,
        tier: tierLabels[key] ?? null,
        fc_value: fcVal(p),
        nfl_draft: nflDraftInfo[key] ?? null,
      };
    });
    const { error } = await supabase
      .from("big_board_snapshots")
      .upsert(
        { user_id: supabaseUser.id, name: snapshotName.trim(), snapshot_data: snapshotData, saved_at: new Date().toISOString() },
        { onConflict: "user_id,name" }
      );
    setSaving(false);
    if (error) {
      log.error("snapshot save failed", { err: error.message });
    } else {
      setSaveSuccess(true);
      setTimeout(() => { setSaveSuccess(false); setShowSaveModal(false); setSnapshotName(""); }, 1000);
    }
  }

  function openDraftEdit(id: string) {
    const info = nflDraftInfo[id];
    setDraftTeam(info?.team ?? "");
    setDraftRound(info?.round != null ? String(info.round) : "");
    setDraftPick(info?.pick != null ? String(info.pick) : "");
    setEditingDraftId(id);
  }

  function commitDraftEdit(id: string, team: string, round: string, pick: string) {
    const t  = team.trim().toUpperCase().slice(0, 3);
    const rd = parseInt(round, 10);
    const pk = parseInt(pick, 10);
    const updated = { ...nflDraftInfo };
    if (!t && isNaN(rd) && isNaN(pk)) {
      delete updated[id];
    } else {
      updated[id] = { team: t, round: isNaN(rd) ? null : rd, pick: isNaN(pk) ? null : pk };
    }
    setNflDraftInfo(updated);
    setLocalStorageItem("nflDraftInfo", updated);
    setEditingDraftId(null);
  }

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
            className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-sm mx-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="save-board-title" className="text-white font-semibold text-sm mb-1">Save Big Board Snapshot</h2>
            <p className="text-gray-500 text-xs mb-4">
              Give this snapshot a name. Saving with the same name overwrites the previous version.
            </p>
            <input
              autoFocus
              type="text"
              placeholder="e.g. 2026 Pre-Draft"
              value={snapshotName}
              onChange={(e) => setSnapshotName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") saveSnapshot(); }}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:border-indigo-500 mb-4"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowSaveModal(false)}
                disabled={saving}
                className="px-4 py-1.5 text-sm text-gray-400 hover:text-white transition disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={saveSnapshot}
                disabled={saving || !snapshotName.trim()}
                className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition disabled:opacity-50 ${
                  saveSuccess
                    ? "bg-green-600 text-white"
                    : "bg-indigo-600 hover:bg-indigo-500 text-white"
                }`}
              >
                {saveSuccess ? "Saved ✓" : saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Note popup overlay */}
      {expandedNoteId && (() => {
        const np = rookies.find((r) => r.player_id === expandedNoteId);
        return (
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
              className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-md mx-4 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div id="note-popup-title" className="text-sm font-semibold text-white">{np?.name}</div>
                  <div className="text-xs text-gray-500">{np?.position}{np?.team ? ` · ${np.team}` : ""}</div>
                </div>
                <button aria-label="Close note editor" onClick={() => setExpandedNoteId(null)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
              </div>
              <textarea
                autoFocus
                value={playerNotes[expandedNoteId] || ""}
                onChange={(e) => saveNote(expandedNoteId, e.target.value)}
                placeholder="Scouting notes, injury flags, scheme fit..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white resize-none focus:outline-none focus:border-blue-500 placeholder:text-gray-600"
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
        );
      })()}

      <div className="flex items-center gap-3 mb-2">
        <input
          type="text"
          placeholder="Search rookies..."
          value={rookieSearch}
          onChange={(e) => setRookieSearch(e.target.value)}
          className="flex-1 p-2 rounded bg-gray-800 text-sm"
        />
        {rookieSearch && (
          <span className="text-[11px] text-gray-500">Tiers hidden while searching</span>
        )}
        {supabaseUser && (
          <button
            onClick={() => setShowSaveModal(true)}
            className="px-3 py-1.5 text-xs font-semibold bg-indigo-700 hover:bg-indigo-600 text-white rounded-lg transition shrink-0"
          >
            Save Board
          </button>
        )}
      </div>

      {/* ±N vs FC legend */}
      <div className="flex items-center gap-1 text-[10px] text-gray-600 mb-2 px-0.5">
        <span>±N vs FC rank:</span>
        <span className="text-green-500 font-semibold">+N</span>
        <span>you rank higher ·</span>
        <span className="text-red-500 font-semibold">−N</span>
        <span>you rank lower than FantasyCalc</span>
      </div>

      {/* Position filter pills */}
      <div className="flex items-center gap-1.5 mb-3">
        {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
          <button
            key={pos}
            onClick={() => setPosFilter((prev) => prev === pos ? null : pos)}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition ${
              posFilter === pos
                ? posBadge[pos] + " border-transparent"
                : "border-gray-700 text-gray-500 hover:text-white"
            }`}
          >
            {pos}
          </button>
        ))}
        {posFilter && (
          <button
            onClick={() => setPosFilter(null)}
            className="text-[10px] text-gray-500 hover:text-white transition ml-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Virtualized player list */}
      <div
        ref={bigBoardParentRef}
        className="overflow-auto"
        style={{ height: "600px" }}
      >
        <div
          style={{
            height: `${bigBoardVirtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {bigBoardVirtualizer.getVirtualItems().map((virtualItem) => {
            const { p, originalIndex } = filteredRookies[virtualItem.index];
            const displayIndex = virtualItem.index;
            const prevEntry = displayIndex > 0 ? filteredRookies[displayIndex - 1] : null;

            const tierKey     = p.player_id || `name:${p.name}`;
            const prevTierKey = prevEntry
              ? (prevEntry.p.player_id || `name:${prevEntry.p.name}`)
              : null;
            const hasNote  = !!(playerNotes[p.player_id || ""] || "").trim();
            const myTier   = tierLabels[tierKey];
            const prevTier = prevTierKey ? tierLabels[prevTierKey] : undefined;
            const showDivider = !rookieSearch && displayIndex > 0 && myTier !== prevTier;

            const fcRank   = fcRanks[rookieKey(p)];
            const userRank = userFcRanks[rookieKey(p)];
            const gap = fcRank !== undefined && userRank !== undefined
              ? fcRank - userRank
              : null;

            const playerDynVal = fcVal(p);
            const isTaken = draftedPlayerIds.has(String(p.player_id));

            return (
              <div
                key={virtualItem.key}
                data-index={virtualItem.index}
                ref={bigBoardVirtualizer.measureElement}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualItem.start}px)`,
                }}
              >
                {showDivider && (
                  <div className="flex items-center gap-3 my-2 px-1">
                    <div className="flex-1 h-px bg-gray-600/50" />
                    {myTier !== undefined && (
                      <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase">Tier {myTier}</span>
                    )}
                    <div className="flex-1 h-px bg-gray-600/50" />
                  </div>
                )}

                <div
                  draggable={editingDraftId !== tierKey}
                  onDragStart={() => { if (editingDraftId !== tierKey) setDragIndex(originalIndex); }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) {
                      movePlayer(dragIndex, originalIndex);
                      setDragIndex(null);
                    }
                  }}
                  className={`flex items-center justify-between bg-gray-800/70 px-3 py-1.5 mb-0.5 rounded-lg text-sm cursor-move hover:bg-gray-700/70 transition${isTaken ? " opacity-40" : ""}`}
                >
                  <div className="flex gap-3 items-center min-w-0">
                    <input
                      type="number"
                      value={tempRanks[originalIndex] ?? originalIndex + 1}
                      onChange={(e) => setTempRanks((prev) => ({ ...prev, [originalIndex]: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleRankChange(originalIndex, String(tempRanks[originalIndex] ?? originalIndex + 1));
                          setTempRanks((prev) => { const u = { ...prev }; delete u[originalIndex]; return u; });
                        }
                      }}
                      onBlur={() => {
                        if (tempRanks[originalIndex] !== undefined) {
                          handleRankChange(originalIndex, tempRanks[originalIndex]);
                          setTempRanks((prev) => { const u = { ...prev }; delete u[originalIndex]; return u; });
                        }
                      }}
                      className="w-12 text-center bg-transparent text-gray-400 outline-none"
                    />
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium truncate">{p.name}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${posBadge[p.position] || "bg-gray-700 text-gray-400"}`}>
                        {p.position}
                      </span>
                      {p.team && <span className="text-[10px] text-gray-500 shrink-0">{p.team}</span>}
                      {playerDynVal > 0 && <span className="text-[10px] text-gray-400 font-mono shrink-0">{playerDynVal.toLocaleString()}</span>}
                      {/* NFL Draft tag */}
                      {editingDraftId === tierKey ? (
                        <div
                          className="flex items-center gap-1"
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node))
                              commitDraftEdit(tierKey, draftTeam, draftRound, draftPick);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <input
                            autoFocus
                            placeholder="TM"
                            maxLength={3}
                            className="w-9 px-1 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-[10px] focus:outline-none text-center uppercase"
                            value={draftTeam}
                            onChange={(e) => setDraftTeam(e.target.value.toUpperCase())}
                            onKeyDown={(e) => { if (e.key === "Enter") commitDraftEdit(tierKey, draftTeam, draftRound, draftPick); if (e.key === "Escape") setEditingDraftId(null); }}
                          />
                          <input
                            placeholder="Rd"
                            type="number" min={1} max={7}
                            className="w-7 px-0.5 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-[10px] focus:outline-none text-center"
                            value={draftRound}
                            onChange={(e) => setDraftRound(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitDraftEdit(tierKey, draftTeam, draftRound, draftPick); if (e.key === "Escape") setEditingDraftId(null); }}
                          />
                          <input
                            placeholder="#"
                            type="number" min={1}
                            className="w-9 px-0.5 py-0.5 bg-gray-900 border border-indigo-500 rounded text-white text-[10px] focus:outline-none text-center"
                            value={draftPick}
                            onChange={(e) => setDraftPick(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") commitDraftEdit(tierKey, draftTeam, draftRound, draftPick); if (e.key === "Escape") setEditingDraftId(null); }}
                          />
                        </div>
                      ) : (() => {
                        const info = nflDraftInfo[tierKey];
                        const hasInfo = info?.team || info?.round != null || info?.pick != null;
                        const label = hasInfo
                          ? [info.team || null, info.round != null ? `R${info.round}` : null, info.pick != null ? `#${info.pick}` : null].filter(Boolean).join(" · ")
                          : null;
                        return (
                          <button
                            onClick={(e) => { e.stopPropagation(); openDraftEdit(tierKey); }}
                            onMouseDown={(e) => e.stopPropagation()}
                            className="shrink-0"
                            title={hasInfo ? "Edit NFL draft slot" : "Add NFL draft slot"}
                          >
                            {label ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300 font-medium border border-indigo-700/50">
                                {label}
                              </span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-gray-600 text-gray-500 hover:border-indigo-500 hover:text-indigo-400 transition font-medium">
                                + NFL
                              </span>
                            )}
                          </button>
                        );
                      })()}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-2">
                    {isTaken && <span className="text-[9px] font-bold text-gray-500 border border-gray-700 px-1 py-0.5 rounded leading-none">TAKEN</span>}
                    {gap === null ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-gray-400 bg-gray-700/60 border border-gray-600/40" title="Not ranked by FantasyCalc">NR</span>
                    ) : gap === 0 ? (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded text-gray-400 bg-gray-800/40" title="Same rank as FantasyCalc">Even</span>
                    ) : (
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          gap > 0 ? "text-green-400 bg-green-900/20" : "text-red-400 bg-red-900/20"
                        }`}
                        title={gap > 0 ? `You rank them ${gap} spots higher than FantasyCalc` : `You rank them ${Math.abs(gap)} spots lower than FantasyCalc`}
                      >
                        {gap > 0 ? `+${gap}` : `${gap}`}
                      </span>
                    )}

                    <button
                      onClick={(e) => { e.stopPropagation(); setExpandedNoteId(p.player_id); }}
                      className={`text-sm transition ${hasNote ? "text-amber-400 hover:text-amber-300" : "text-gray-600 hover:text-gray-400"}`}
                      title={hasNote ? "View/edit note" : "Add note"}
                    >
                      {hasNote ? "📝" : "○"}
                    </button>

                    {!rookieSearch && (
                      <select
                        value={myTier ?? ""}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val)) saveTier(tierKey, val);
                          else removeTier(tierKey);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className={`text-[10px] font-bold rounded px-1 py-0.5 outline-none cursor-pointer border transition ${
                          myTier !== undefined
                            ? "bg-blue-900/40 border-blue-800/60 text-blue-300"
                            : "bg-gray-700/50 border-gray-700 text-gray-500"
                        }`}
                      >
                        <option value="">Tier</option>
                        {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>T{n}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
