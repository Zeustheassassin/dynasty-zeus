"use client";
import type { Dispatch, SetStateAction } from "react";
import { posColor, closestPickEquiv, pickEquivColor, toPickSlot } from "../shared";

interface MyPickEntry {
  player_id: string;
  name: string;
  position: string;
  team: string;
  value: number;
  avgPickNo: number;
  timesDrafted: number;
}

type MyPicksSort = { col: "times" | "avgPick" | "value"; dir: "asc" | "desc" };

interface MyPicksTabProps {
  myPicksList: MyPickEntry[];
  filteredDrafts: { season: string }[];
  selectedHistoryYear: string;
  myPicksSort: MyPicksSort;
  setMyPicksSort: Dispatch<SetStateAction<MyPicksSort>>;
  pickFcValues: Record<string, number>;
}

export default function MyPicksTab({
  myPicksList,
  filteredDrafts,
  selectedHistoryYear,
  myPicksSort,
  setMyPicksSort,
  pickFcValues,
}: MyPicksTabProps) {
  if (myPicksList.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/40 p-6 text-sm text-gray-400">
        No picks attributed to your user ID in the loaded drafts.
      </div>
    );
  }

  const toggleSort = (col: "times" | "avgPick" | "value") => {
    setMyPicksSort((prev) =>
      prev.col === col
        ? { col, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { col, dir: col === "avgPick" ? "asc" : "desc" }
    );
  };
  const arrow = (col: "times" | "avgPick" | "value") =>
    myPicksSort.col === col ? (myPicksSort.dir === "desc" ? " ↓" : " ↑") : "";
  const sorted = [...myPicksList].sort((a, b) => {
    const { col, dir } = myPicksSort;
    const val = col === "times"   ? a.timesDrafted - b.timesDrafted
              : col === "avgPick" ? a.avgPickNo - b.avgPickNo
              : a.value - b.value;
    return dir === "desc" ? -val : val;
  });

  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="text-sm font-semibold text-white">Your Draft Picks</div>
        <div className="text-xs text-gray-400 mt-0.5">
          {myPicksList.length} unique players · {filteredDrafts.length} total draft{filteredDrafts.length !== 1 ? "s" : ""} {selectedHistoryYear === "ALL" ? "across all years" : `in ${selectedHistoryYear}`}
        </div>
      </div>
      <div className="px-4 py-2 border-b border-gray-800/60 grid grid-cols-[3rem_1fr_4.5rem_5rem_6rem] gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
        <span>Pos</span>
        <span>Player</span>
        <button onClick={() => toggleSort("times")} className="text-left hover:text-white transition">Times{arrow("times")}</button>
        <button onClick={() => toggleSort("avgPick")} className="text-left hover:text-white transition">Avg Pick{arrow("avgPick")}</button>
        <button onClick={() => toggleSort("value")} className="text-right hover:text-white transition w-full">≈ Pick Val{arrow("value")}</button>
      </div>
      <div className="divide-y divide-gray-800/40">
        {sorted.map((p) => {
          const { label: equivLabel, pickNo: equivPickNo } = closestPickEquiv(p.value, pickFcValues);
          const color = pickEquivColor(equivPickNo, Math.round(p.avgPickNo));
          return (
            <div key={p.player_id} className="grid grid-cols-[3rem_1fr_4.5rem_5rem_6rem] gap-2 items-center px-4 py-1.5">
              <span className={`text-[10px] font-bold ${posColor[p.position] || "text-gray-400"}`}>{p.position}</span>
              <span className="text-sm font-medium text-white truncate">{p.name}</span>
              <span className="text-sm font-semibold text-blue-400">{p.timesDrafted}×</span>
              <span className="text-xs text-white">{toPickSlot(p.avgPickNo)}</span>
              <span className={`text-xs font-semibold text-right ${color}`}>{equivLabel}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
