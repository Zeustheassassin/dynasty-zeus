"use client";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../../lib/supabaseclient";
import { useAuth } from "../../lib/AuthContext";
import { useLeague } from "../../lib/LeagueContext";
import { logger } from "../../lib/logger";
import type { LeagueDraftSnapshot } from "../../lib/types";
import { posColor } from "./shared";

const log = logger("HistoricalLeagueDrafts");

export default function HistoricalLeagueDrafts() {
  const { supabaseUser } = useAuth();
  const { selectedLeague } = useLeague();
  const [snapshots, setSnapshots] = useState<LeagueDraftSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!supabaseUser) return;
    supabase
      .from("league_draft_snapshots")
      .select("id,name,saved_at,snapshot_data")
      .eq("user_id", supabaseUser.id)
      .order("saved_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { log.error("snapshot load failed", { err: error.message }); }
        const snaps = (data ?? []) as LeagueDraftSnapshot[];
        setSnapshots(snaps);
        setLoading(false);
      });
  }, [supabaseUser]);

  const leagueSnapshots = useMemo(
    () => snapshots.filter((s) => s.snapshot_data.leagueId === selectedLeague?.league_id),
    [snapshots, selectedLeague?.league_id]
  );

  // When the active league changes (or the filtered list changes), make sure
  // the selected pill still belongs to this league.
  useEffect(() => {
    if (leagueSnapshots.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (!leagueSnapshots.some((s) => s.id === selectedId)) {
      setSelectedId(leagueSnapshots[0].id);
    }
  }, [leagueSnapshots, selectedId]);

  async function deleteSnapshot(id: string) {
    setDeleting(id);
    await supabase.from("league_draft_snapshots").delete().eq("id", id);
    setSnapshots((prev) => prev.filter((s) => s.id !== id));
    setDeleting(null);
  }

  const selected = leagueSnapshots.find((s) => s.id === selectedId);

  if (!supabaseUser) {
    return <div className="text-gray-500 text-center py-16 text-sm">Sign in to view saved drafts.</div>;
  }
  if (loading) {
    return <div className="text-gray-500 text-center py-16 text-sm">Loading…</div>;
  }
  if (!selectedLeague) {
    return <div className="text-gray-500 text-center py-16 text-sm">Select a league to view its saved drafts.</div>;
  }
  if (leagueSnapshots.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-400 text-sm font-medium">No saved drafts for {selectedLeague.name} yet.</p>
        <p className="text-gray-600 text-xs mt-1">
          Once a rookie draft completes, hit <span className="text-indigo-400 font-semibold">Save Snapshot</span> on the Live Draft Board to freeze it here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Snapshot selector pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {leagueSnapshots.map((s) => (
          <div key={s.id} className="flex items-center gap-1 group">
            <button
              onClick={() => setSelectedId(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                selectedId === s.id
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white"
              }`}
            >
              {s.name}
            </button>
            <button
              onClick={() => deleteSnapshot(s.id)}
              disabled={deleting === s.id}
              className="text-gray-700 hover:text-red-400 transition text-xs leading-none opacity-0 group-hover:opacity-100"
              title="Delete snapshot"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      {selected && <SnapshotGrid snapshot={selected} />}
    </div>
  );
}

function SnapshotGrid({ snapshot }: { snapshot: LeagueDraftSnapshot }) {
  const data = snapshot.snapshot_data;
  const numTeams = data.numTeams || 12;
  const numRounds = data.numRounds || 4;

  // Index picks by overall pick number for fast lookup.
  const picksByPickNo = new Map<number, typeof data.picks[number]>();
  data.picks.forEach((p) => picksByPickNo.set(p.pickNo, p));

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-white font-semibold text-sm">{snapshot.name}</h3>
          <span className="text-[11px] text-gray-500">
            {data.leagueName ? `${data.leagueName} · ` : ""}
            {data.season} Rookie Draft · Saved {new Date(snapshot.saved_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[10px] text-gray-500 flex-wrap">
          <span className="text-orange-400 font-bold">REACH</span><span>&gt;7 ahead of pool rank</span>
          <span className="text-green-400 font-bold">VALUE</span><span>&gt;4 after pool rank</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div
          className="grid w-full gap-y-2 gap-x-1"
          style={{ gridTemplateColumns: `repeat(${numTeams}, minmax(4rem, 1fr))` }}
        >
          {/* Team headers — original drafters, frozen at save time */}
          {data.headers.map((h) => (
            <div
              key={h.slot}
              className="min-w-0 min-h-[2.75rem] px-2 text-center text-xs whitespace-normal break-words leading-tight text-blue-400"
            >
              {h.username}
            </div>
          ))}

          {/* Pick cells, in linear pick-number order */}
          {Array.from({ length: numRounds }, (_, ri) => ri + 1).flatMap((round) =>
            Array.from({ length: numTeams }, (_, i) => i + 1).map((slotInRound) => {
              const overallPickNo = (round - 1) * numTeams + slotInRound;
              const pick = picksByPickNo.get(overallPickNo);
              const isReach = !!pick && pick.poolRank > 0 && overallPickNo < pick.poolRank - 7;
              const isValue = !!pick && pick.poolRank > 0 && overallPickNo > pick.poolRank + 4;
              return (
                <div
                  key={`${round}-${slotInRound}`}
                  className="relative min-w-0 h-20 rounded-md flex flex-col justify-center items-center text-xs px-2 gap-0.5 border border-gray-700 bg-gray-800"
                >
                  {pick ? (
                    <>
                      {isReach && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-orange-400">REACH</span>}
                      {isValue && <span className="absolute top-0.5 left-1 text-[8px] font-bold text-green-400">VALUE</span>}
                      <div className="text-center w-full text-white font-medium whitespace-normal break-words leading-tight text-[10px]">{pick.name}</div>
                      <div className={`text-[9px] ${posColor[pick.position] || "text-gray-400"}`}>
                        {pick.position}{pick.team ? ` · ${pick.team}` : ""}
                      </div>
                      <div className="text-[9px] text-gray-400 truncate w-full text-center">
                        {pick.drafterName || pick.slot}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="text-gray-600 font-semibold text-[10px]">{`${round}.${String(slotInRound).padStart(2, "0")}`}</div>
                      <div className="text-[9px] text-gray-600">—</div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
