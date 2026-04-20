"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseclient";

interface Props {
  prospectId: string;
  prospectName: string;
  position: string;
  totalPlays: number;
  notes: string[];
}

export default function PlayerSynopsisCard({ prospectId, prospectName, position, totalPlays, notes }: Props) {
  const [synopsis, setSynopsis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadSaved() {
      const { data } = await supabase.from("prospects").select("synopsis").eq("id", prospectId).single();
      if (data?.synopsis) setSynopsis(data.synopsis);
    }
    loadSaved();
  }, [prospectId]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/scouting/synopsis", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prospectName, position, totalPlays, notes }),
      });
      const json = (await res.json()) as { synopsis?: string; error?: string };
      if (json.error) {
        setError(json.error);
      } else {
        const text = json.synopsis ?? "";
        setSynopsis(text);
        setSaving(true);
        await supabase.from("prospects").update({ synopsis: text }).eq("id", prospectId);
        setSaving(false);
      }
    } catch {
      setError("Failed to generate summary.");
    }
    setLoading(false);
  }

  return (
    <div className="p-4 bg-indigo-950/40 rounded-lg border border-indigo-800/50">
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-sm font-semibold text-indigo-200">Notes Summary</span>
          <span className="ml-2 text-xs text-indigo-500">{notes.length} notes across {totalPlays} plays</span>
          {saving && <span className="ml-2 text-xs text-indigo-400">Saving…</span>}
        </div>
        <button
          onClick={generate}
          disabled={loading || notes.length === 0}
          className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-600 disabled:opacity-50 text-white text-xs rounded transition font-medium"
        >
          {loading ? "Summarizing…" : synopsis ? "Regenerate" : "Summarize Notes"}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {synopsis ? (
        <p className="text-sm text-gray-200 leading-relaxed">{synopsis}</p>
      ) : (
        <p className="text-xs text-indigo-600/70">
          {notes.length === 0
            ? "No play notes recorded yet."
            : "Click Summarize to get an AI summary of your play notes."}
        </p>
      )}
    </div>
  );
}
