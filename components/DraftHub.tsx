"use client";
import React from "react";
import { supabase } from "../lib/supabaseclient";

// ── Module-level constants (mirrors page.tsx) ──────────────────────────────
const ROOKIE_YEAR = String(new Date().getFullYear());
const ROUNDS = [1, 2, 3, 4];

const normalizeRookieName = (name: string) =>
  (name || "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, "")
    .replace(/[^a-z]/g, "")
    .trim();

const posColor: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

// ── Props ──────────────────────────────────────────────────────────────────
interface DraftHubProps {
  // Navigation
  draftHubSection: "BOARD" | "BIG_BOARD";
  setDraftHubSection: (section: "BOARD" | "BIG_BOARD") => void;

  // My draft slot overrides + inline editor
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (query: string) => void;

  // League + roster
  selectedLeague: any;
  rosters: any[];
  user: any;
  users: any;
  supabaseUser: any;

  // Draft data
  draftSettings: any;
  draftPicks: any[];
  draftOrder: any;
  allPicks: any[];
  players: any;

  // Rookies
  rookies: any[];
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  tempRanks: Record<number, string>;
  setTempRanks: React.Dispatch<React.SetStateAction<Record<number, string>>>;

  // Computed values (useMemos from Home)
  draftedPlayerIds: Set<string>;
  predictedDraftPicks: Record<string, any>;
  topAvailableRookies: any[];

  // Functions
  refreshDraftBoard: () => void;
  loadDraftScout: (userId: string) => void;
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  loadingDraftRefresh: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function DraftHub({
  draftHubSection,
  setDraftHubSection,
  myDraftSlotPicks,
  setMyDraftSlotPicks,
  draftSlotEditing,
  setDraftSlotEditing,
  draftSlotSearchQuery,
  setDraftSlotSearchQuery,
  selectedLeague,
  rosters,
  user,
  users,
  supabaseUser,
  draftSettings,
  draftPicks,
  draftOrder,
  allPicks,
  players,
  rookies,
  rookieSearch,
  setRookieSearch,
  dragIndex,
  setDragIndex,
  tempRanks,
  setTempRanks,
  draftedPlayerIds,
  predictedDraftPicks,
  topAvailableRookies,
  refreshDraftBoard,
  loadDraftScout,
  movePlayer,
  handleRankChange,
  loadingDraftRefresh,
}: DraftHubProps) {

  const myRosterId = rosters.find((r: any) => r.owner_id === user?.user_id)?.roster_id;

  const rosterToName: Record<number, string> = {};
  (rosters as any[]).forEach((r: any) => {
    rosterToName[Number(r.roster_id)] = (users as any)[r.owner_id] || `Team ${r.roster_id}`;
  });

  return (
    <div className="p-4">
      {/* Sub-tab nav */}
      <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
        <div className="flex justify-center gap-6 text-center">
          <button
            onClick={() => setDraftHubSection("BOARD")}
            className={`pb-2 px-1 text-sm font-semibold transition ${
              draftHubSection === "BOARD"
                ? "border-b-2 border-blue-400 text-blue-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Live Draft Board
          </button>
          <button
            onClick={() => setDraftHubSection("BIG_BOARD")}
            className={`pb-2 px-1 text-sm font-semibold transition ${
              draftHubSection === "BIG_BOARD"
                ? "border-b-2 border-blue-400 text-blue-400"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Rookie Big Board
          </button>
        </div>
      </div>

      {/* ── LIVE DRAFT BOARD ── */}
      {draftHubSection === "BOARD" && (
        <div className="flex justify-end gap-2 mb-3">
          {Object.keys(myDraftSlotPicks).length > 0 && (
            <button
              onClick={() => {
                setMyDraftSlotPicks({});
                if (selectedLeague?.league_id) {
                  localStorage.removeItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                  if (supabaseUser) {
                    supabase
                      .from("draft_board_picks")
                      .delete()
                      .eq("user_id", supabaseUser.id)
                      .eq("league_id", selectedLeague.league_id)
                      .eq("season", ROOKIE_YEAR)
                      .then(() => {});
                  }
                }
              }}
              className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
            >
              ✕ Reset Picks
            </button>
          )}
          <button
            onClick={refreshDraftBoard}
            disabled={loadingDraftRefresh}
            className="flex items-center gap-2 px-4 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
          >
            {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh Board"}
          </button>
        </div>
      )}

      {draftHubSection === "BOARD" && !draftSettings && (
        <div className="text-gray-400">No draft data available</div>
      )}

      {draftHubSection === "BOARD" && draftSettings && (
        <div className="overflow-x-auto">
          {/* Legend */}
          <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500 flex-wrap">
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600" />
              My Slots (click to set)
            </span>
            <span className="flex items-center gap-1 italic text-gray-600">Italic gray = AI prediction</span>
            <span className="text-orange-400 font-bold">REACH</span><span>&gt;8 ahead of ADP</span>
            <span className="text-green-400 font-bold">VALUE</span><span>&gt;5 after ADP</span>
          </div>

          {/* Grid */}
          <div
            className="inline-grid min-w-max gap-y-2"
            style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
          >
            {/* Team headers */}
            {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
              const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
              const teamName = (userId && users[userId]) || `Team ${slot}`;
              const r1slot = `1.${String(slot).padStart(2, "0")}`;
              const r1pick = allPicks.find((p: any) => p.slot === r1slot);
              const isMe = r1pick && String(r1pick.owner_id) === String(myRosterId);
              return (
                <button
                  key={slot}
                  onClick={() => userId && loadDraftScout(userId)}
                  className={`min-w-0 min-h-[2.75rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}
                  title={`View ${teamName}'s ${ROOKIE_YEAR} draft picks`}
                >
                  {teamName}{isMe ? " ★" : ""}
                </button>
              );
            })}

            {/* Pick cells */}
            {ROUNDS.flatMap((round) => {
              const roundPicks = Array.from({ length: rosters.length }, (_, i) => {
                const slot = `${round}.${String(i + 1).padStart(2, "0")}`;
                const pick = allPicks.find((p: any) => p.slot === slot);
                return pick || { slot, owner_id: null, roster_id: null };
              });

              return roundPicks.map((pick: any, i: number) => {
                const slotStr = pick.slot as string;
                const playerPick = draftPicks.find(
                  (dp: any) => dp.round === round && dp.roster_id === pick.owner_id
                );
                const actualPlayer = playerPick ? (players as any)[playerPick.player_id] : null;
                const isMySlot = pick.owner_id && String(pick.owner_id) === String(myRosterId);

                const userOverrideId = myDraftSlotPicks[slotStr];
                const userOverride = userOverrideId
                  ? rookies.find((r: any) => r.player_id === userOverrideId || r.name === userOverrideId)
                  : null;
                const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                const overallPick = (round - 1) * rosters.length + (i + 1);
                const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                const predReach = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick < (prediction.poolRank ?? 999) - 7;
                const predValue = isMySlot && prediction && (prediction.poolRank ?? 0) > 0 && overallPick > (prediction.poolRank ?? 0) + 4;
                const isEditing = draftSlotEditing === slotStr;

                return (
                  <div
                    key={`${round}-${i}`}
                    className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                      ${isMySlot && !actualPlayer ? "border-2 border-blue-600 bg-blue-950/40 cursor-pointer hover:bg-blue-900/40" : "border border-gray-700 bg-gray-800"}
                    `}
                    onClick={() => {
                      if (!isMySlot || actualPlayer) return;
                      setDraftSlotEditing(isEditing ? null : slotStr);
                      setDraftSlotSearchQuery("");
                    }}
                  >
                    {actualPlayer ? (
                      <>
                        <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                        <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                        <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                      </>
                    ) : userOverride ? (
                      <>
                        {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                        <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                        <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || "You"}</div>
                        <button
                          className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400"
                          onClick={(e) => {
                            e.stopPropagation();
                            const n = { ...myDraftSlotPicks };
                            delete n[slotStr];
                            setMyDraftSlotPicks(n);
                          }}
                        >✕</button>
                      </>
                    ) : prediction ? (
                      <>
                        {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                        {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                        <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                        <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                        <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || slotStr}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                      </>
                    ) : (
                      <>
                        <div className="text-gray-600 font-semibold text-[10px]">{pick.slot}</div>
                        <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || ""}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                      </>
                    )}

                    {/* Inline player picker */}
                    {isEditing && (
                      <div
                        className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          autoFocus
                          className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500"
                          placeholder="Search rookie…"
                          value={draftSlotSearchQuery}
                          onChange={(e) => setDraftSlotSearchQuery(e.target.value)}
                        />
                        <div className="max-h-44 overflow-y-auto space-y-0.5">
                          {rookies
                            .map((r: any, idx: number) => ({ ...r, boardRank: idx + 1 }))
                            .filter((r: any) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                            .filter((r: any) =>
                              !draftedPlayerIds.has(String(r.player_id)) &&
                              !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && pid === r.player_id)
                            )
                            .slice(0, 15)
                            .map((r: any) => {
                              const reachAmt = typeof r.adp === "number" ? Math.round(overallPick - r.adp) : null;
                              return (
                                <button
                                  key={`${r.boardRank}-${r.player_id || r.name}`}
                                  className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                  onClick={() => {
                                    setMyDraftSlotPicks((prev) => ({ ...prev, [slotStr]: r.player_id || r.name }));
                                    setDraftSlotEditing(null);
                                    setDraftSlotSearchQuery("");
                                  }}
                                >
                                  <span className="text-white text-[10px] truncate">#{r.boardRank} {r.name}</span>
                                  <span className="flex items-center gap-1 shrink-0">
                                    <span className={`text-[9px] ${posColor[r.position] || "text-gray-400"}`}>{r.position}</span>
                                    {reachAmt !== null && reachAmt < -8 && <span className="text-[8px] text-orange-400 font-bold">REACH</span>}
                                    {reachAmt !== null && reachAmt > 5 && <span className="text-[8px] text-green-400">VALUE</span>}
                                  </span>
                                </button>
                              );
                            })}
                        </div>
                        <button
                          className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400"
                          onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}
                        >
                          cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              });
            })}
          </div>
        </div>
      )}

      {/* ── TOP AVAILABLE FROM BIG BOARD ── */}
      {draftHubSection === "BOARD" && (
        <div className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Top 10 Available From Your Big Board</h2>
              <p className="text-sm text-gray-400">
                Automatically removes players after they are drafted in this Sleeper draft.
              </p>
            </div>
            <div className="text-xs text-gray-500">{topAvailableRookies.length} shown</div>
          </div>

          {!rookies.length ? (
            <div className="text-gray-400 text-sm">Your rookie board is still loading from Sleeper.</div>
          ) : topAvailableRookies.length === 0 ? (
            <div className="text-gray-400 text-sm">No ranked rookies are currently available.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topAvailableRookies.map((player: any) => (
                <div
                  key={player.player_id || `${normalizeRookieName(player.name)}-${player.boardRank}`}
                  className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm text-blue-400 font-semibold">#{player.boardRank}</div>
                      <div className="font-medium text-white">{player.name}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-400">{player.team || "FA"}</div>
                      <div className="text-xs text-gray-300">{player.position}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ROOKIE BIG BOARD ── */}
      {draftHubSection === "BIG_BOARD" && (
        <div className="max-w-3xl mx-auto">
          <input
            type="text"
            placeholder="Search rookies..."
            value={rookieSearch}
            onChange={(e) => setRookieSearch(e.target.value)}
            className="w-full mb-3 p-2 rounded bg-gray-800 text-sm"
          />

          <div className="space-y-2">
            {rookies
              .map((p, originalIndex) => ({ p, originalIndex }))
              .filter(({ p }) =>
                p.name &&
                p.name !== "Player Invalid" &&
                p.name.toLowerCase().includes(rookieSearch.toLowerCase())
              )
              .map(({ p, originalIndex }) => (
                <div
                  key={p.player_id || originalIndex}
                  draggable
                  onDragStart={() => setDragIndex(originalIndex)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) {
                      movePlayer(dragIndex, originalIndex);
                      setDragIndex(null);
                    }
                  }}
                  className="flex items-center justify-between bg-gray-800/70 px-3 py-1.5 mb-1 rounded-lg text-sm cursor-move hover:bg-gray-700/70 transition"
                >
                  <div className="flex gap-3 items-center">
                    <input
                      type="number"
                      value={tempRanks[originalIndex] ?? originalIndex + 1}
                      onChange={(e) => {
                        setTempRanks((prev) => ({ ...prev, [originalIndex]: e.target.value }));
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          handleRankChange(originalIndex, String(tempRanks[originalIndex] ?? originalIndex + 1));
                          setTempRanks((prev) => {
                            const updated = { ...prev };
                            delete updated[originalIndex];
                            return updated;
                          });
                        }
                      }}
                      onBlur={() => {
                        if (tempRanks[originalIndex] !== undefined) {
                          handleRankChange(originalIndex, tempRanks[originalIndex]);
                          setTempRanks((prev) => {
                            const updated = { ...prev };
                            delete updated[originalIndex];
                            return updated;
                          });
                        }
                      }}
                      className="w-12 text-center bg-transparent text-gray-400 outline-none"
                    />

                    <div className="flex items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                          p.position === "QB" ? "bg-purple-500/20 text-purple-400"
                          : p.position === "RB" ? "bg-green-500/20 text-green-400"
                          : p.position === "WR" ? "bg-blue-500/20 text-blue-400"
                          : p.position === "TE" ? "bg-orange-500/20 text-orange-400"
                          : "bg-gray-700 text-gray-400"
                        }`}
                      >
                        {p.position}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
