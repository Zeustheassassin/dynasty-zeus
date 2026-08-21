"use client";
import { useState, useEffect } from "react";
import { supabase } from "../../lib/supabaseclient";
import { useAuth } from "../../lib/AuthContext";
import { posBadge } from "./shared";

type NflDraft = { team: string; round: number | null; pick: number | null } | null;

type SnapshotPlayer = {
  player_id: string | null;
  name: string;
  position: string;
  team: string | null;
  rank: number;
  tier: number | null;
  fc_value: number;
  nfl_draft: NflDraft;
};

type Snapshot = {
  id: string;
  name: string;
  saved_at: string;
  snapshot_data: SnapshotPlayer[];
};

export default function HistoricalBigBoards() {
  const { supabaseUser } = useAuth();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [posFilter, setPosFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseUser) return;
    supabase
      .from("big_board_snapshots")
      .select("id,name,saved_at,snapshot_data")
      .eq("user_id", supabaseUser.id)
      .order("saved_at", { ascending: false })
      .then(({ data }) => {
        const snaps = (data ?? []) as Snapshot[];
        setSnapshots(snaps);
        if (snaps.length > 0) setSelectedId(snaps[0].id);
        setLoading(false);
      });
  }, [supabaseUser]);

  async function deleteSnapshot(id: string) {
    const snap = snapshots.find((s) => s.id === id);
    if (!window.confirm(`Delete "${snap?.name ?? "this snapshot"}"? This cannot be undone.`)) return;
    setDeleting(id);
    await supabase.from("big_board_snapshots").delete().eq("id", id);
    const remaining = snapshots.filter((s) => s.id !== id);
    setSnapshots(remaining);
    setDeleting(null);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  }

  const selected = snapshots.find((s) => s.id === selectedId);
  const players = selected
    ? [...selected.snapshot_data]
        .sort((a, b) => a.rank - b.rank)
        .filter((p) => !posFilter || p.position === posFilter)
    : [];

  if (!supabaseUser) {
    return <div className="text-slate-500 text-center py-16 text-sm">Sign in to view saved boards.</div>;
  }

  if (loading) {
    return <div className="text-slate-500 text-center py-16 text-sm">Loading…</div>;
  }


  if (snapshots.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-slate-400 text-sm font-medium">No saved boards yet.</p>
        <p className="text-slate-600 text-xs mt-1">
          Use <span className="text-indigo-400 font-semibold">Save Board</span> on the Rookie Big Board to create a snapshot.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Board selector pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {snapshots.map((s) => (
          <div key={s.id} className="flex items-center gap-1 group">
            <button
              onClick={() => { setSelectedId(s.id); setPosFilter(null); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedId === s.id
                  ? "bg-indigo-600 text-white"
                  : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
              }`}
            >
              {s.name}
            </button>
            <button
              onClick={() => deleteSnapshot(s.id)}
              disabled={deleting === s.id}
              className="text-slate-700 hover:text-red-400 transition text-xs leading-none opacity-0 group-hover:opacity-100"
              title="Delete snapshot"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected && (
        <>
          {/* Header row */}
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-white font-semibold text-sm">{selected.name}</h3>
              <span className="text-[11px] text-slate-500">
                Saved {new Date(selected.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                {" · "}{selected.snapshot_data.length} players
              </span>
            </div>
            {/* Position filter */}
            <div className="flex items-center gap-1.5">
              {(["QB", "RB", "WR", "TE"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosFilter((prev) => prev === pos ? null : pos)}
                  className={`text-[11px] font-bold px-2 py-0.5 rounded border transition ${
                    posFilter === pos
                      ? posBadge[pos] + " border-transparent"
                      : "border-slate-700 text-slate-500 hover:text-white"
                  }`}
                >
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {/* Player list */}
          <div className="space-y-0.5">
            {players.map((p) => {
              const nfl = p.nfl_draft;
              const nflLabel = nfl
                ? [nfl.team || null, nfl.round != null ? `R${nfl.round}` : null, nfl.pick != null ? `#${nfl.pick}` : null]
                    .filter(Boolean).join(" · ")
                : null;
              return (
                <div
                  key={`${p.rank}-${p.name}`}
                  className="flex items-center gap-2 bg-slate-800/70 px-3 py-2 rounded-lg text-sm"
                >
                  <span className="w-7 text-center text-slate-500 text-xs font-mono shrink-0">{p.rank}</span>
                  <span className="font-medium text-white truncate flex-1 min-w-0">{p.name}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${posBadge[p.position] || "bg-slate-700 text-slate-400"}`}>
                    {p.position}
                  </span>
                  {p.team && <span className="text-[10px] text-slate-500 shrink-0">{p.team}</span>}
                  {p.tier != null && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-800/60 text-blue-300 shrink-0">
                      T{p.tier}
                    </span>
                  )}
                  {nflLabel && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900/50 text-indigo-300 font-medium border border-indigo-700/50 shrink-0">
                      {nflLabel}
                    </span>
                  )}
                  {p.fc_value > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">{p.fc_value.toLocaleString()}</span>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
