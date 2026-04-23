"use client";
import React from "react";
import { CURRENT_YEAR } from "../../lib/helpers";
import { removeLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import { useAuth } from "../../lib/AuthContext";
import { useLeague } from "../../lib/LeagueContext";
import { usePlayers } from "../../lib/PlayersContext";
import { supabase } from "../../lib/supabaseclient";
import type {
  SleeperUser,
  SleeperTradedPick,
  SleeperDraftPick,
  SleeperDraft,
  RookieBoardPlayer,
} from "../../lib/types";
import type { PredictedPick } from "./leagueHubTypes";

const ROOKIE_YEAR = CURRENT_YEAR;

interface DraftBoardTabProps {
  user: SleeperUser | null;
  allPicks: SleeperTradedPick[];
  draftPicks: SleeperDraftPick[];
  draftOrder: Record<string, number>;
  draftSettings: SleeperDraft | null;
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (q: string) => void;
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL_BOARDS";
  predictedDraftPicks: Record<string, PredictedPick>;
  loadingDraftRefresh: boolean;
  rookies: RookieBoardPlayer[];
  draftedPlayerIds: Set<string>;
  refreshDraftBoard: () => Promise<void>;
  loadDraftScout: (userId: string) => void;
}

function DraftBoardTab({
  user,
  allPicks,
  draftPicks,
  draftOrder,
  draftSettings,
  myDraftSlotPicks,
  setMyDraftSlotPicks,
  draftSlotEditing,
  setDraftSlotEditing,
  draftSlotSearchQuery,
  setDraftSlotSearchQuery,
  draftHubSection,
  predictedDraftPicks,
  loadingDraftRefresh,
  rookies,
  draftedPlayerIds,
  refreshDraftBoard,
  loadDraftScout,
}: DraftBoardTabProps) {
  const { supabaseUser } = useAuth();
  const { selectedLeague, rosters, users } = useLeague();
  const players = usePlayers();

  if (!selectedLeague) return (
    <p className="text-sm text-gray-500">Select a league first to view the draft board.</p>
  );

  const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;
  const mySlots = allPicks.filter((p) => Number(p.owner_id ?? 0) === Number(myRosterId) && p.slot && /^\d+\.\d+$/.test(String(p.slot))).map((p) => p.slot as string);

  const projectedMyPicks: string[] = [];
  mySlots.forEach(slot => {
    const pred = predictedDraftPicks[slot];
    const pid = myDraftSlotPicks[slot] || pred?.player_id || pred?.name;
    if (pid) projectedMyPicks.push(pid);
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-white">{ROOKIE_YEAR} Rookie Draft Board</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {mySlots.length > 0 ? `Your picks: ${mySlots.join(", ")}` : "Loading your draft slots…"}
            {" · "}Ghost picks = AI prediction based on your big board + team needs
          </p>
        </div>
        <div className="flex items-center gap-2">
          {Object.keys(myDraftSlotPicks).length > 0 && (
            <button
              onClick={() => {
                if (!window.confirm("Clear all your draft picks? This cannot be undone.")) return;
                setMyDraftSlotPicks({});
                if (selectedLeague?.league_id) {
                  removeLocalStorageItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
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
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white rounded-lg transition"
            >
              ✕ Reset Picks
            </button>
          )}
          <button
            onClick={refreshDraftBoard}
            disabled={loadingDraftRefresh}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition"
          >
            {loadingDraftRefresh ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>
      </div>

      {!draftSettings ? (
        <div className="text-gray-400 text-sm">
          No draft found for this league. The draft board will appear once Sleeper creates the {ROOKIE_YEAR} draft.
        </div>
      ) : (
        <>
          {draftHubSection === "BOARD" && draftSettings && (() => {
            const slotOwnerMap: Record<string, number> = {};
            allPicks.forEach((p) => { if (p.slot) slotOwnerMap[p.slot] = Number(p.owner_id ?? p.roster_id ?? 0); });
            const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
            const rosterToName: Record<number, string> = {};
            rosters.forEach((r) => {
              rosterToName[Number(r.roster_id)] = users[r.owner_id] || `Team ${r.roster_id}`;
            });
            return (
              <div className="overflow-x-auto lg:overflow-x-visible">
                <div className="flex items-center gap-4 mb-3 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-blue-900 border border-blue-600"/>My Slots (click to set)</span>
                  <span className="flex items-center gap-1 italic text-gray-600">Italic = predicted</span>
                  <span className="flex items-center gap-1"><span className="text-orange-400 font-bold">REACH</span> = &gt;8 ahead of ADP</span>
                  <span className="flex items-center gap-1"><span className="text-green-400 font-bold">VALUE</span> = &gt;5 after ADP</span>
                </div>
                <div
                  className="grid w-full gap-y-1.5 gap-x-1.5"
                  style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(9rem, 1fr))` }}
                >
                  {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
                    const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
                    const slotRosterId = slotOwnerMap[`1.${String(slot).padStart(2,"0")}`] || null;
                    const isMe = slotRosterId === Number(myRosterId);
                    const teamName = (userId && users[userId]) || `Team ${slot}`;
                    return (
                      <button key={slot} onClick={() => userId && loadDraftScout(userId)}
                        className={`min-w-0 min-h-[2.5rem] px-2 text-center text-xs cursor-pointer whitespace-normal break-words leading-tight ${isMe ? "text-blue-300 font-bold" : "text-blue-400 hover:text-blue-300"}`}>
                        {teamName}{isMe ? " ★" : ""}
                      </button>
                    );
                  })}
                  {Array.from({ length: Number(draftSettings?.settings?.rounds) || 4 }, (_, i) => i + 1).flatMap((round) =>
                    Array.from({ length: rosters.length }, (_, i) => i + 1).map((slotNum) => {
                      const slotStr = `${round}.${String(slotNum).padStart(2, "0")}`;
                      const slotOwner = slotOwnerMap[slotStr];
                      const isMySlot = slotOwner === Number(myRosterId);
                      const playerPick = draftPicks.find((dp) => dp.round === round && Number(dp.roster_id ?? dp.picked_by) === slotOwner);
                      const actualPlayer = playerPick ? players[playerPick.player_id] : null;
                      const userOverrideId = myDraftSlotPicks[slotStr];
                      const userOverride = userOverrideId ? rookies.find((r) => r.player_id === userOverrideId || r.name === userOverrideId) : null;
                      const prediction = !actualPlayer && !userOverrideId ? predictedDraftPicks[slotStr] : null;
                      const overallPick = (round - 1) * rosters.length + slotNum;
                      const isReach = userOverride && typeof userOverride.adp === "number" && overallPick < userOverride.adp - 8;
                      const predReach = isMySlot && prediction && prediction.poolRank > 0 && overallPick < (prediction.poolRank ?? 999) - 8;
                      const predValue = isMySlot && prediction && prediction.poolRank > 0 && overallPick > (prediction.poolRank ?? 0) + 5;
                      const isEditing = draftSlotEditing === slotStr;
                      return (
                        <div key={slotStr}
                          className={`relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 transition
                            ${isMySlot ? "border-2 border-blue-600 bg-blue-950/40" : "border border-gray-700 bg-gray-800"}
                            ${isMySlot && !actualPlayer ? "cursor-pointer hover:bg-blue-900/40" : ""}
                          `}
                          onClick={() => { if (!isMySlot || actualPlayer) return; setDraftSlotEditing(isEditing ? null : slotStr); setDraftSlotSearchQuery(""); }}
                        >
                          {actualPlayer ? (
                            <>
                              <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{actualPlayer.full_name}</div>
                              <div className={`text-[9px] ${posColor[actualPlayer.position] || "text-gray-400"}`}>{actualPlayer.position} · {actualPlayer.team}</div>
                              <div className="text-[9px] text-gray-400 truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                            </>
                          ) : userOverride ? (
                            <>
                              {isReach && <span className="absolute top-0.5 right-1 text-[8px] font-bold text-orange-400">REACH</span>}
                              <div className="text-center w-full text-white font-semibold whitespace-normal break-words leading-tight text-[10px]">{userOverride.name}</div>
                              <div className={`text-[9px] ${posColor[userOverride.position] || "text-gray-400"}`}>{userOverride.position}</div>
                              <div className="text-[9px] text-blue-300 truncate w-full text-center">{rosterToName[slotOwner] || "You"}</div>
                              <button className="absolute bottom-0.5 right-1 text-[8px] text-gray-500 hover:text-red-400" onClick={(e) => { e.stopPropagation(); const n = {...myDraftSlotPicks}; delete n[slotStr]; setMyDraftSlotPicks(n); }}>✕</button>
                            </>
                          ) : prediction ? (
                            <>
                              {predReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                              {predValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                              <div className="text-center w-full text-gray-400 italic whitespace-normal break-words leading-tight text-[10px]">{prediction.name}</div>
                              <div className={`text-[9px] ${posColor[prediction.position] || "text-gray-500"} opacity-70`}>{prediction.position}</div>
                              <div className="text-[9px] text-gray-500 italic truncate w-full text-center">{rosterToName[slotOwner] || slotStr}</div>
                              {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                            </>
                          ) : (
                            <>
                              <div className="text-gray-600 font-semibold text-[10px]">{slotStr}</div>
                              <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[slotOwner] || ""}</div>
                              {isMySlot && <div className="text-[8px] text-blue-500">tap to set</div>}
                            </>
                          )}
                          {isEditing && (
                            <div className="absolute top-full left-0 z-50 w-64 bg-gray-900 border border-blue-600 rounded-xl shadow-2xl p-2 mt-1" onClick={(e) => e.stopPropagation()}>
                              <input autoFocus className="w-full bg-gray-800 text-white text-xs rounded px-2 py-1 mb-2 border border-gray-700 focus:outline-none focus:border-blue-500" placeholder="Search rookie…" value={draftSlotSearchQuery} onChange={(e) => setDraftSlotSearchQuery(e.target.value)} />
                              <div className="max-h-44 overflow-y-auto space-y-0.5">
                                {rookies.map((r, idx) => ({...r, boardRank: idx + 1}))
                                  .filter((r) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                                  .filter((r) => !Array.from(draftedPlayerIds).includes(String(r.player_id)) && !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && (pid === r.player_id || pid === r.name)))
                                  .slice(0, 15)
                                  .map((r) => {
                                    const pickNum = (round - 1) * rosters.length + slotNum;
                                    const reachAmt = typeof r.adp === "number" ? Math.round(pickNum - r.adp) : null;
                                    return (
                                      <button key={`${r.boardRank}-${r.player_id || r.name}`} className="w-full text-left px-2 py-1 rounded hover:bg-gray-800 flex items-center justify-between gap-1"
                                        onClick={() => { setMyDraftSlotPicks(prev => ({...prev, [slotStr]: r.player_id || r.name})); setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>
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
                              <button className="mt-1 w-full text-[9px] text-gray-600 hover:text-gray-400" onClick={() => { setDraftSlotEditing(null); setDraftSlotSearchQuery(""); }}>cancel</button>
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })()}

          {projectedMyPicks.length > 0 && (
            <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-white mb-2">Projected Rookie Haul</h3>
              <p className="text-[10px] text-gray-500 mb-3">Based on your set picks + AI predictions for remaining slots. Save to Supabase automatically.</p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {projectedMyPicks.map((pid) => {
                  const r = rookies.find((rk) => rk.player_id === pid || rk.name === pid);
                  if (!r) return null;
                  const idx = rookies.indexOf(r);
                  const posColor: Record<string, string> = { QB: "text-red-400", RB: "text-green-400", WR: "text-blue-400", TE: "text-yellow-400" };
                  return (
                    <div key={pid} className="bg-gray-800 rounded-lg px-3 py-2 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-white font-medium">{r.name}</div>
                        <div className={`text-[10px] ${posColor[r.position] || "text-gray-400"}`}>{r.position} · {r.team || "FA"}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-400">#{idx + 1}</div>
                        <div className="text-[9px] text-gray-600">ADP {Math.round(r.adp ?? 99)}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default React.memo(DraftBoardTab);
