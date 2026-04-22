"use client";
import React from "react";
import { useLeague } from "../lib/LeagueContext";
import { useValues } from "../lib/ValuesContext";
import PickValuesTab from "./draft/PickValuesTab";
import type {
  SleeperLeague, SleeperUser, SleeperDraft, SleeperDraftPick,
  AugmentedPick, RookieBoardPlayer, PredictedPick,
} from "../lib/types";
import DraftHistory from "./draftHub/DraftHistory";
import LiveDraftBoard from "./draftHub/LiveDraftBoard";
import RookieBigBoard from "./draftHub/RookieBigBoard";


// ── Props ──────────────────────────────────────────────────────────────────
interface DraftHubProps {
  draftHubSection: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES";
  setDraftHubSection: (s: "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES") => void;

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
  rookieSearch: string;
  setRookieSearch: (s: string) => void;
  dragIndex: number | null;
  setDragIndex: (i: number | null) => void;
  tempRanks: Record<number, string>;
  setTempRanks: React.Dispatch<React.SetStateAction<Record<number, string>>>;

  draftedPlayerIds: Set<string>;
  predictedDraftPicks: Record<string, PredictedPick>;
  topAvailableRookies: RookieBoardPlayer[];

  refreshDraftBoard: () => void;
  loadDraftScout: (userId: string) => void;
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  loadingDraftRefresh: boolean;

  leagues: SleeperLeague[];
}

// ── Component ──────────────────────────────────────────────────────────────
function DraftHub({
  draftHubSection, setDraftHubSection,
  myDraftSlotPicks, setMyDraftSlotPicks,
  draftSlotEditing, setDraftSlotEditing,
  draftSlotSearchQuery, setDraftSlotSearchQuery,
  user,
  draftSettings, draftPicks, draftOrder, allPicks,
  rookies, rookieSearch, setRookieSearch,
  dragIndex, setDragIndex, tempRanks, setTempRanks,
  draftedPlayerIds, predictedDraftPicks, topAvailableRookies,
  refreshDraftBoard, loadDraftScout, movePlayer, handleRankChange,
  loadingDraftRefresh,
  leagues,
}: DraftHubProps) {
  const { rosters } = useLeague();
  const { pickFcValues } = useValues();

  const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;

  const TABS = [
    { key: "BOARD",       label: "Live Draft Board" },
    { key: "BIG_BOARD",   label: "Rookie Big Board" },
    { key: "PICK_VALUES", label: "Pick Values" },
    { key: "HISTORY",     label: "Draft History" },
  ] as const;

  return (
    <div className="p-4">
      {/* ── Tab nav ── */}
      <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
        <div className="flex gap-6 text-center">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setDraftHubSection(tab.key)}
              className={`pb-2 px-1 text-sm font-semibold whitespace-nowrap transition ${
                draftHubSection === tab.key
                  ? "border-b-2 border-blue-400 text-blue-400"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          LIVE DRAFT BOARD
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "BOARD" && (
        <LiveDraftBoard
          myDraftSlotPicks={myDraftSlotPicks}
          setMyDraftSlotPicks={setMyDraftSlotPicks}
          draftSlotEditing={draftSlotEditing}
          setDraftSlotEditing={setDraftSlotEditing}
          draftSlotSearchQuery={draftSlotSearchQuery}
          setDraftSlotSearchQuery={setDraftSlotSearchQuery}
          user={user}
          draftSettings={draftSettings}
          draftPicks={draftPicks}
          draftOrder={draftOrder}
          allPicks={allPicks}
          rookies={rookies}
          draftedPlayerIds={draftedPlayerIds}
          predictedDraftPicks={predictedDraftPicks}
          topAvailableRookies={topAvailableRookies}
          refreshDraftBoard={refreshDraftBoard}
          loadDraftScout={loadDraftScout}
          loadingDraftRefresh={loadingDraftRefresh}
        />
      )}

      {/* ══════════════════════════════════════════════════════
          ROOKIE BIG BOARD
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "BIG_BOARD" && (
        <RookieBigBoard
          rookies={rookies}
          rookieSearch={rookieSearch}
          setRookieSearch={setRookieSearch}
          dragIndex={dragIndex}
          setDragIndex={setDragIndex}
          tempRanks={tempRanks}
          setTempRanks={setTempRanks}
          draftedPlayerIds={draftedPlayerIds}
          movePlayer={movePlayer}
          handleRankChange={handleRankChange}
        />
      )}

      {/* ══════════════════════════════════════════════════════
          PICK VALUES
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "PICK_VALUES" && (
        <PickValuesTab
          pickFcValues={pickFcValues}
          allPicks={allPicks}
          draftSettings={draftSettings}
          numSlots={rosters.length || 12}
          myRosterId={myRosterId}
        />
      )}

      {/* ══════════════════════════════════════════════════════
          DRAFT HISTORY
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "HISTORY" && (
        <DraftHistory leagues={leagues} user={user} />
      )}
    </div>
  );
}

export default React.memo(DraftHub);
