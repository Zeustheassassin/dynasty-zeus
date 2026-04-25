"use client";
import { useEffect } from "react";
import { supabase } from "../../lib/supabaseclient";
import { usePlayers } from "../../lib/PlayersContext";
import { useAuth } from "../../lib/AuthContext";
import { useLeague } from "../../lib/LeagueContext";
import { CURRENT_YEAR as ROOKIE_YEAR } from "../../lib/helpers";
import { removeLocalStorageItem } from "@/lib/hooks/useLocalStorage";
import type {
  SleeperUser, SleeperDraft, SleeperDraftPick,
  AugmentedPick, RookieBoardPlayer, PredictedPick,
} from "../../lib/types";
import { posColor, normalizeRookieName } from "./shared";
import type { GridPick } from "./shared";

const MAX_ROUNDS = 6;
const ROUNDS = Array.from({ length: MAX_ROUNDS }, (_, i) => i + 1);

interface LiveDraftBoardProps {
  myDraftSlotPicks: Record<string, string>;
  setMyDraftSlotPicks: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  draftSlotEditing: string | null;
  setDraftSlotEditing: (slot: string | null) => void;
  draftSlotSearchQuery: string;
  setDraftSlotSearchQuery: (query: string) => void;
  user: SleeperUser | null;
  draftSettings: SleeperDraft | null;
  draftPicks: SleeperDraftPick[];
  draftOrder: Record<string, number>;
  allPicks: AugmentedPick[];
  rookies: RookieBoardPlayer[];
  draftedPlayerIds: Set<string>;
  predictedDraftPicks: Record<string, PredictedPick>;
  topAvailableRookies: RookieBoardPlayer[];
  refreshDraftBoard: () => void;
  loadDraftScout: (userId: string) => void;
  loadingDraftRefresh: boolean;
}

export default function LiveDraftBoard({
  myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing,
  draftSlotSearchQuery, setDraftSlotSearchQuery,
  user,
  draftSettings, draftPicks, draftOrder, allPicks,
  rookies, draftedPlayerIds, predictedDraftPicks, topAvailableRookies,
  refreshDraftBoard, loadDraftScout, loadingDraftRefresh,
}: LiveDraftBoardProps) {
  const players = usePlayers();
  const { supabaseUser } = useAuth();
  const { selectedLeague, rosters, users } = useLeague();

  const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;
  const rosterToName: Record<number, string> = {};
  rosters.forEach((r) => {
    rosterToName[Number(r.roster_id)] = users[r.owner_id] || `Team ${r.roster_id}`;
  });

  // Auto-cleanup: drop placeholder picks for slots that now have actual draft picks,
  // and drop placeholders whose player has been drafted elsewhere. Runs whenever the
  // Sleeper draft data changes. The save effect persists the cleanup to Supabase.
  useEffect(() => {
    if (!Object.keys(myDraftSlotPicks).length) return;
    setMyDraftSlotPicks((prev) => {
      const cleaned: Record<string, string> = {};
      let changed = false;
      for (const [slot, playerId] of Object.entries(prev)) {
        // Placeholder values can be either a Sleeper player_id OR a raw name. Check both forms
        // so name-only placeholders (e.g. unmatched FantasyCalc names) get cleaned when picked.
        if (draftedPlayerIds.has(String(playerId))) { changed = true; continue; }
        if (draftedPlayerIds.has(`name:${normalizeRookieName(String(playerId))}`)) { changed = true; continue; }
        const m = slot.match(/^(\d+)\.(\d+)$/);
        if (m) {
          const round = Number(m[1]);
          const slotNum = Number(m[2]);
          // Match by overall pick_no — placeholder slot 2.05 means "5th pick of round 2"
          // (linear display), not "team at draft_slot 5's round-2 pick" which differs in snake.
          const overallPickNo = (round - 1) * rosters.length + slotNum;
          const hasActualPick = draftPicks.some((dp) => dp.pick_no === overallPickNo);
          if (hasActualPick) { changed = true; continue; }
        }
        cleaned[slot] = playerId;
      }
      return changed ? cleaned : prev;
    });
  }, [draftPicks, draftedPlayerIds, rosters, myDraftSlotPicks, setMyDraftSlotPicks]);

  return (
    <>
      {/* Toolbar: Reset Picks + Refresh */}
      <div className="flex justify-end gap-2 mb-3">
        {Object.keys(myDraftSlotPicks).length > 0 && (
          <button
            onClick={() => {
              setMyDraftSlotPicks({});
              if (selectedLeague?.league_id) {
                removeLocalStorageItem(`draftPicks_${selectedLeague.league_id}_${ROOKIE_YEAR}`);
                if (supabaseUser) {
                  supabase.from("draft_board_picks").delete()
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

      {!draftSettings && (
        <div className="text-gray-400">No draft data available</div>
      )}

      {draftSettings && (
        <div className="overflow-x-auto">
          {(() => {
          const activeRounds = ROUNDS.slice(
            0,
            Number(draftSettings?.settings?.rounds ?? draftSettings?.rounds ?? 4)
          );
          return (
          <>
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

          {/* ── Positional Scarcity Tracker ── */}
          {draftPicks.length > 0 && (
            <div className="mb-4 p-3 bg-gray-800/50 rounded-xl">
              <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                Positions Drafted — {draftPicks.length} of {(rosters.length || 12) * activeRounds.length} picks made
              </div>
              <div className="flex flex-wrap gap-2">
                {(["QB", "RB", "WR", "TE"] as const).map((pos) => {
                  const taken = draftPicks.filter((dp) => players[dp.player_id]?.position === pos).length;
                  const avail = rookies.filter((r) => r.position === pos && !draftedPlayerIds.has(String(r.player_id))).length;
                  const pctTaken = draftPicks.length > 0 ? Math.round((taken / draftPicks.length) * 100) : 0;
                  const barColors: Record<string, string> = { QB: "bg-red-500", RB: "bg-green-500", WR: "bg-blue-500", TE: "bg-yellow-500" };
                  return (
                    <div key={pos} className="flex-1 min-w-[90px] rounded-lg border border-gray-700 bg-gray-900 px-3 py-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`text-xs font-bold ${posColor[pos]}`}>{pos}</span>
                        <span className="text-[10px] text-gray-500">{avail} left</span>
                      </div>
                      <div className="h-1 rounded-full bg-gray-700 mb-1.5">
                        <div className={`h-1 rounded-full ${barColors[pos]}`} style={{ width: `${Math.min(100, pctTaken)}%` }} />
                      </div>
                      <div className="text-xs font-semibold text-white">{taken} <span className="text-gray-500 font-normal">taken ({pctTaken}%)</span></div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Draft grid */}
          <div className="w-full">
          <div
            className="grid w-full gap-y-2 gap-x-1"
            style={{ gridTemplateColumns: `repeat(${rosters.length}, minmax(4rem, 1fr))` }}
          >
            {/* Team headers */}
            {Array.from({ length: rosters.length }, (_, i) => i + 1).map((slot) => {
              const userId = Object.keys(draftOrder).find((uid) => draftOrder[uid] === slot);
              const teamName = (userId && users[userId]) || `Team ${slot}`;
              const r1slot = `1.${String(slot).padStart(2, "0")}`;
              const r1pick = allPicks.find((p) => p.slot === r1slot);
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
            {activeRounds.flatMap((round) => {
              const roundPicks: GridPick[] = Array.from({ length: rosters.length }, (_, i) => {
                const slot = `${round}.${String(i + 1).padStart(2, "0")}`;
                const pick = allPicks.find((p) => p.slot === slot);
                return pick ? { slot: pick.slot ?? slot, owner_id: pick.owner_id ?? null, roster_id: pick.roster_id } : { slot, owner_id: null, roster_id: null };
              });

              return roundPicks.map((pick, i) => {
                const slotStr = pick.slot;
                // Match by overall pick_no so cells display in linear pick-number order
                // regardless of snake vs linear draft format. In a snake draft, Sleeper's
                // draft_slot reflects the team's permanent column — using it would push
                // round-2 picks to the right side of the board (the user's complaint).
                const overallPickNo = (round - 1) * rosters.length + (i + 1);
                const playerPick = draftPicks.find((dp) => dp.pick_no === overallPickNo);
                const actualPlayer = playerPick ? players[playerPick.player_id] : null;
                const isMySlot = pick.owner_id && String(pick.owner_id) === String(myRosterId);
                const userOverrideId = myDraftSlotPicks[slotStr];
                const userOverride = userOverrideId
                  ? rookies.find((r) => r.player_id === userOverrideId || r.name === userOverrideId)
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
                        {isMySlot && <div className="text-[8px] text-blue-500">click to set</div>}
                      </>
                    ) : (
                      <>
                        <div className="text-gray-600 font-semibold text-[10px]">{pick.slot}</div>
                        <div className="text-[9px] text-gray-600 truncate w-full text-center">{rosterToName[Number(pick.owner_id)] || ""}</div>
                        {isMySlot && <div className="text-[8px] text-blue-500">click to set</div>}
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
                          {(rookies
                            .map((r, idx) => ({ ...r, boardRank: idx + 1 })) as Array<RookieBoardPlayer & { boardRank: number }>)
                            .filter((r) => r.name && (!draftSlotSearchQuery || r.name.toLowerCase().includes(draftSlotSearchQuery.toLowerCase())))
                            .filter((r) =>
                              !draftedPlayerIds.has(String(r.player_id)) &&
                              !Object.entries(myDraftSlotPicks).some(([s, pid]) => s !== slotStr && pid === r.player_id)
                            )
                            .slice(0, 15)
                            .map((r) => {
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
          </> ); })()}
        </div>
      )}

      {/* Top Available */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">Top Available Rookies From Your Big Board</h2>
            <p className="text-sm text-gray-400">
              Automatically removes players after they are drafted in this Sleeper draft.
            </p>
          </div>
        </div>
        {!rookies.length ? (
          <div className="text-gray-400 text-sm">Your rookie board is still loading from Sleeper.</div>
        ) : topAvailableRookies.length === 0 ? (
          <div className="text-gray-400 text-sm">No ranked rookies are currently available.</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {topAvailableRookies.map((player) => (
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
    </>
  );
}
