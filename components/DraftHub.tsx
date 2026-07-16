"use client";
import React, { useState } from "react";
import { useLeague } from "../lib/LeagueContext";
import { useValues } from "../lib/ValuesContext";
import PickValuesTab from "./draft/PickValuesTab";
import type {
  SleeperLeague, SleeperUser, SleeperDraft, SleeperDraftPick,
  AugmentedPick, RookieBoardPlayer, PredictedPick, DraftPoolRanks,
} from "../lib/types";
import DraftHistory from "./draftHub/DraftHistory";
import LiveDraftBoard from "./draftHub/LiveDraftBoard";
import RookieBigBoard from "./draftHub/RookieBigBoard";
import HistoricalBigBoards from "./draftHub/HistoricalBigBoards";
import HistoricalLeagueDrafts from "./draftHub/HistoricalLeagueDrafts";

type HistoricalView = "BIG_BOARDS" | "LEAGUE_DRAFTS";

function HistoricalSection() {
  const [view, setView] = useState<HistoricalView>("BIG_BOARDS");
  return (
    <div>
      <div className="flex justify-center gap-2 mb-6">
        {(["BIG_BOARDS", "LEAGUE_DRAFTS"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
              view === v ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {v === "BIG_BOARDS" ? "Big Boards" : "League Drafts"}
          </button>
        ))}
      </div>
      {view === "BIG_BOARDS" ? <HistoricalBigBoards /> : <HistoricalLeagueDrafts />}
    </div>
  );
}


// ── Props ──────────────────────────────────────────────────────────────────
// HISTORICAL_BOARDS + HISTORICAL_LEAGUE_DRAFTS were merged into one "HISTORICAL"
// section with an in-page type toggle (Phase B4/R4) — HISTORY (this league's own
// past drafts, DraftHistory.tsx) is a separate, unrelated tab and is untouched.
type DraftSection = "BOARD" | "BIG_BOARD" | "HISTORY" | "PICK_VALUES" | "HISTORICAL";

interface DraftHubProps {
  draftHubSection: DraftSection;
  setDraftHubSection: (s: DraftSection) => void;

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
  draftPoolRanks: DraftPoolRanks;
  topAvailableRookies: RookieBoardPlayer[];

  refreshDraftBoard: () => void;
  loadDraftScout: (userId: string) => void;
  movePlayer: (fromIndex: number, toIndex: number) => void;
  handleRankChange: (currentIndex: number, newRank: string) => void;
  addRookie: (name: string, position: string) => void;
  editRookieName: (originalName: string, newName: string) => void;
  removeAddedRookie: (name: string) => void;
  clearNameEdit: (originalName: string) => void;
  rookieOverrides: { added: { name: string; position: string }[]; nameEdits: Record<string, string> };
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
  rookies,
  draftedPlayerIds, predictedDraftPicks, draftPoolRanks, topAvailableRookies,
  refreshDraftBoard, loadDraftScout, movePlayer, handleRankChange,
  addRookie, editRookieName, removeAddedRookie, clearNameEdit, rookieOverrides,
  loadingDraftRefresh,
  leagues,
}: DraftHubProps) {
  const { rosters } = useLeague();
  const { pickFcValues } = useValues();
  const [rookieSearch, setRookieSearch] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [tempRanks, setTempRanks] = useState<Record<number, string>>({});

  const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;

  const TABS: { key: DraftSection; label: string }[] = [
    { key: "BOARD",       label: "Live Draft Board" },
    { key: "BIG_BOARD",   label: "Rookie Big Board" },
    { key: "PICK_VALUES", label: "Pick Values" },
    { key: "HISTORY",     label: "Draft History" },
    { key: "HISTORICAL",  label: "Historical Boards & Drafts" },
  ];

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
          draftPoolRanks={draftPoolRanks}
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
          addRookie={addRookie}
          editRookieName={editRookieName}
          removeAddedRookie={removeAddedRookie}
          clearNameEdit={clearNameEdit}
          rookieOverrides={rookieOverrides}
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

      {/* ══════════════════════════════════════════════════════
          HISTORICAL BOARDS & DRAFTS (merged, Phase B4/R4)
         ══════════════════════════════════════════════════════ */}
      {draftHubSection === "HISTORICAL" && (
        <HistoricalSection />
      )}
    </div>
  );
}

export default React.memo(DraftHub);
