"use client";
import React from "react";
import { useAuth } from "../../lib/AuthContext";
import { useLeague } from "../../lib/LeagueContext";
import type { SleeperLeague } from "../../lib/types";

interface NotesTabProps {
  leagues: SleeperLeague[];
  leagueNotes: Record<string, string>;
  saveLeagueNote: (leagueId: string, text: string) => void;
  setSelectedLeague: (league: SleeperLeague | null) => void;
}

function NotesTab({
  leagues,
  leagueNotes,
  saveLeagueNote,
  setSelectedLeague,
}: NotesTabProps) {
  const { supabaseUser } = useAuth();
  const { selectedLeague } = useLeague();
  const [lastNoteSavedAt, setLastNoteSavedAt] = React.useState<number | null>(null);

  const noteLeague = selectedLeague ?? leagues[0];
  if (!noteLeague) return <p className="text-sm text-slate-500">No leagues found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <span className="text-sm font-semibold text-slate-300">Notes for:</span>
        <select
          className="bg-slate-800 border border-slate-700 text-sm text-white rounded-lg px-2 py-1 focus:outline-none focus:border-blue-500"
          value={noteLeague.league_id}
          onChange={(e) => {
            const l = leagues.find((lg) => lg.league_id === e.target.value);
            if (l) setSelectedLeague(l);
          }}
        >
          {leagues.map((lg) => <option key={lg.league_id} value={lg.league_id}>{lg.name}</option>)}
        </select>
      </div>
      <textarea
        className="w-full h-96 bg-slate-900 border border-slate-700 rounded-xl p-4 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 resize-none"
        placeholder={`Jot down thoughts, trade ideas, waiver targets for ${noteLeague.name}…`}
        value={leagueNotes[noteLeague.league_id] ?? ""}
        onChange={(e) => { saveLeagueNote(noteLeague.league_id, e.target.value); setLastNoteSavedAt(Date.now()); }}
      />
      <p className="text-[10px] text-slate-600">
        {lastNoteSavedAt ? <span className="text-emerald-600">✓ Saved just now{supabaseUser ? " · syncing across devices" : ""}</span> : supabaseUser ? "Notes sync across your devices." : "Notes save to this browser only."}
      </p>
    </div>
  );
}

export default React.memo(NotesTab);
