"use client";
import React from "react";
import type { PlayerWithValue } from "./shared";

export function FinderSearchInput({
  players,
  onSelect,
  placeholder = "Search your roster…",
}: {
  players: PlayerWithValue[];
  onSelect: (playerId: string) => void;
  placeholder?: string;
}) {
  const [inputValue, setInputValue] = React.useState("");
  const matches = inputValue.trim().length >= 2
    ? players.filter((p) => p.full_name.toLowerCase().includes(inputValue.toLowerCase())).slice(0, 6)
    : [];
  return (
    <div className="relative">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
      />
      {matches.length > 0 && (
        <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-700 rounded-lg overflow-hidden shadow-xl">
          {matches.map((p) => (
            <button
              key={p.player_id}
              onClick={() => { setInputValue(""); onSelect(p.player_id); }}
              className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-700 transition text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-white">{p.full_name}</span>
                <span className="text-[10px] text-slate-500 uppercase">{p.position}</span>
              </div>
              <span className="text-xs text-slate-400 font-mono">{p.value.toLocaleString()}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
