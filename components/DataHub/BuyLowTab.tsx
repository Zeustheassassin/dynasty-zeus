"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import type { ProjectionRow } from "../../lib/types";
import { ageColor, POS_COLOR } from "./dataHubHelpers";

interface BuyLowTabProps {
  projectionData: ProjectionRow[];
  setPlayerProfileId: (id: string | null) => void;
}

function BuyLowTab({ projectionData, setPlayerProfileId }: BuyLowTabProps) {
  const players = usePlayers();
  const { leagueAdjustedFcValues: calcFcValues, leagueAdjustedRedraftValues: redraftValues } = useValues();

  const [buyLowPos, setBuyLowPos] = React.useState<"ALL" | "QB" | "RB" | "WR" | "TE">("ALL");

  // ── Age multiplier by position ──────────────────────────────────────
  // Younger players with depressed production have more recovery runway,
  // so the same rank gap scores higher for a 23-year-old than a 31-year-old.
  const getAgeMult = (age: number, pos: string): number => {
    if (!age) return 0.8;
    if (pos === "QB") {
      if (age <= 25) return 1.5;
      if (age <= 28) return 1.2;
      if (age <= 31) return 0.85;
      return 0.5;
    }
    if (pos === "RB") {
      if (age <= 22) return 1.6;
      if (age <= 24) return 1.3;
      if (age <= 26) return 0.9;
      return 0.4;
    }
    if (pos === "WR") {
      if (age <= 24) return 1.5;
      if (age <= 27) return 1.2;
      if (age <= 30) return 0.85;
      return 0.5;
    }
    // TE
    if (age <= 25) return 1.5;
    if (age <= 27) return 1.2;
    if (age <= 30) return 0.85;
    return 0.5;
  };

  // Minimum dynasty value to be in the qualified pool — filters out stashes
  // and deep bench players that no one is realistically buying.
  const MIN_DYN_VAL: Record<string, number> = { QB: 500, RB: 350, WR: 350, TE: 350 };

  const projBySleeperID = new Map<string, number>(
    projectionData.map((r) => [String(r.sleeperId), Number(r.fpts || 0)])
  );
  const projectionsLoaded = projectionData.length > 0;

  const allBuyLowRows: {
    player_id: string; full_name: string; pos: string; age: number; team: string;
    dynVal: number; dynRank: number; projRank: number; gap: number;
    ageMult: number; score: number; usingFallback: boolean;
  }[] = [];

  for (const pos of ["QB", "RB", "WR", "TE"] as const) {
    const minVal = MIN_DYN_VAL[pos];
    const pool = Object.values(players)
      .filter((p) => p.position === pos && (calcFcValues[p.player_id] ?? 0) >= minVal)
      .map((p) => {
        const hasFpts = projBySleeperID.has(p.player_id);
        const projFpts = hasFpts
          ? projBySleeperID.get(p.player_id)!
          : (redraftValues[p.player_id] ?? 0);
        return {
          player_id: p.player_id,
          full_name: p.full_name,
          pos,
          age: Number(p.age || 0),
          team: p.team || "",
          status: p.injury_status || null,
          dynVal: calcFcValues[p.player_id] ?? 0,
          projFpts,
          usingFallback: !hasFpts,
        };
      });

    const n = pool.length;
    if (n < 2) continue;

    const dynSorted  = [...pool].sort((a, b) => b.dynVal - a.dynVal);
    const projSorted = [...pool].sort((a, b) => b.projFpts - a.projFpts);
    const dynRankMap  = new Map(dynSorted.map((p, i) => [p.player_id, i + 1]));
    const projRankMap = new Map(projSorted.map((p, i) => [p.player_id, i + 1]));

    for (const p of pool) {
      const dynRank  = dynRankMap.get(p.player_id)!;
      const projRank = projRankMap.get(p.player_id)!;
      // Buy low = dynasty rank is WORSE (higher number) than production rank.
      // e.g. dynasty rank 15, proj rank 6 → gap = 15 - 6 = +9 → underpriced, buy them.
      // e.g. dynasty rank 6, proj rank 26 → gap = 6 - 26 = -20 → overpriced, skip.
      const gap = dynRank - projRank;
      const normalizedGap = gap / n;
      const ageMult = getAgeMult(p.age, pos);
      // Boost toward players producing well relative to their price — confirms the
      // buy low thesis isn't just random noise but real, measurable output.
      const projPctile = (n - projRank) / Math.max(n - 1, 1);
      const raw = Math.max(0, normalizedGap) * ageMult * (0.55 + 0.45 * projPctile);
      allBuyLowRows.push({
        ...p, dynRank, projRank, gap, ageMult, score: raw, usingFallback: p.usingFallback,
      });
    }
  }

  // Normalize raw scores to 0–100
  const maxRaw = Math.max(...allBuyLowRows.filter((r) => !r.usingFallback).map((r) => r.score), 0.001);
  const scored = allBuyLowRows
    .map((r) => ({ ...r, score: r.usingFallback ? 0 : Math.round((r.score / maxRaw) * 100) }))
    .filter((r) => r.gap > 0)
    .sort((a, b) => {
      // Players with real projections first, sorted by score desc.
      // Fallback players sorted to the bottom, by gap desc within that group.
      if (a.usingFallback !== b.usingFallback) return a.usingFallback ? 1 : -1;
      if (!a.usingFallback) return b.score - a.score;
      return b.gap - a.gap;
    });

  const visible = buyLowPos === "ALL" ? scored : scored.filter((r) => r.pos === buyLowPos);

  const scoreColor = (s: number) =>
    s >= 70 ? "bg-green-700 text-green-100" :
    s >= 45 ? "bg-yellow-700/80 text-yellow-100" :
    "bg-gray-700 text-gray-300";

  const scoreBorder = (s: number) =>
    s >= 70 ? "border-green-800" :
    s >= 45 ? "border-yellow-800/60" :
    "border-gray-800";

  return (
    <>
      {/* Header */}
      <div className="mb-4 space-y-1">
        <p className="text-xs text-gray-400">
          Players whose <span className="text-white font-medium">projected points rank</span> is better than their <span className="text-white font-medium">dynasty market rank</span> — they produce more than their price tag suggests. High gap + young age = high-conviction buy low.
        </p>
        {!projectionsLoaded && (
          <p className="text-[11px] text-amber-400">
            Projections not loaded — using redraft consensus as the production proxy.
            Load projections from the Projections tab for a more accurate read.
          </p>
        )}
      </div>

      {/* Position filter */}
      <div className="flex gap-2 mb-4">
        {(["ALL", "QB", "RB", "WR", "TE"] as const).map((pos) => (
          <button
            key={pos}
            onClick={() => setBuyLowPos(pos)}
            className={`px-3 py-1 rounded text-sm font-medium transition ${
              buyLowPos === pos ? "bg-green-700 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
            }`}
          >
            {pos}
          </button>
        ))}
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-gray-600">
        <span className="w-6 text-right shrink-0">#</span>
        <span className="w-6 shrink-0">Pos</span>
        <span className="flex-1">Player</span>
        <span className="w-8 text-center shrink-0">Age</span>
        <span className="w-14 text-center shrink-0">Dyn Rank</span>
        <span className="w-14 text-center shrink-0">Proj Rank</span>
        <span className="w-10 text-center shrink-0">Gap</span>
        <span className="w-12 text-center shrink-0">Score</span>
      </div>

      {/* Rows */}
      <div className="space-y-1">
        {visible.length === 0 ? (
          <p className="text-sm text-gray-500 px-3 py-4">
            {Object.keys(calcFcValues).length === 0
              ? "Load a league to populate dynasty values."
              : "No buy low candidates found for this filter."}
          </p>
        ) : (
          visible.map((r, idx) => (
            <div
              key={r.player_id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${r.usingFallback ? "border-gray-800 opacity-40" : scoreBorder(r.score)} bg-gray-900/60`}
            >
              <span className="text-xs text-gray-600 font-mono w-6 text-right shrink-0">{idx + 1}</span>
              <span className={`text-[10px] font-bold w-6 shrink-0 ${r.usingFallback ? "text-gray-600" : (POS_COLOR[r.pos] ?? "text-gray-400")}`}>
                {r.pos}
              </span>
              <button
                className={`flex-1 text-left text-sm truncate transition ${r.usingFallback ? "text-gray-500 cursor-default" : "text-white hover:text-blue-300"}`}
                onClick={() => !r.usingFallback && setPlayerProfileId(r.player_id)}
              >
                {r.full_name}
                {r.team && (
                  <span className="ml-1.5 text-[10px] text-gray-600 font-normal">{r.team}</span>
                )}
              </button>
              <span className={`text-[10px] font-mono w-8 text-center shrink-0 ${r.usingFallback ? "text-gray-700" : ageColor(r.age, r.pos)}`}>
                {r.age || "—"}
              </span>
              <span className="text-[11px] text-gray-600 font-mono w-14 text-center shrink-0">
                #{r.dynRank}
              </span>
              {r.usingFallback ? (
                <span className="text-[10px] text-gray-700 italic w-14 text-center shrink-0">no proj</span>
              ) : (
                <span className="text-[11px] text-gray-500 font-mono w-14 text-center shrink-0">
                  #{r.projRank}
                </span>
              )}
              <span className="text-[11px] text-gray-700 w-10 text-center shrink-0">
                {r.usingFallback ? "—" : `+${r.gap}`}
              </span>
              <span className={`text-[11px] font-bold w-12 text-center shrink-0 rounded px-1.5 py-0.5 ${r.usingFallback ? "bg-gray-800 text-gray-600" : scoreColor(r.score)}`}>
                {r.usingFallback ? "—" : r.score}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Legend */}
      {visible.length > 0 && (
        <div className="mt-4 pt-3 border-t border-gray-800 flex flex-wrap gap-4 text-[10px] text-gray-500">
          <span><span className="font-bold text-green-400">Green score (70+)</span> — strong conviction buy low</span>
          <span><span className="font-bold text-yellow-400">Yellow (45–69)</span> — moderate opportunity</span>
          <span><span className="font-bold text-gray-400">Gray (&lt;45)</span> — slight dip, less actionable</span>
          <span><span className="text-amber-500">+Gap</span> — how many ranks better their production is vs. their dynasty price</span>
          <span><span className="text-gray-600">Dimmed rows</span> — no projection data yet (rookies/unsigned FAs); sorted to the bottom</span>
        </div>
      )}
    </>
  );
}

export default React.memo(BuyLowTab);
