"use client";
import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import type { HistoricalSnapshot } from "../../lib/types";
import { sellColor, buyColor, injuryBadge, ageColor, POS_COLOR } from "./dataHubHelpers";
import type { ShareEntry } from "./dataHubTypes";

interface RankingsTabProps {
  dynastyRankPos: string;
  setDynastyRankPos: (pos: string) => void;
  loadingCalcValues: boolean;
  loadingRedraft: boolean;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  savePlayerDisposition: (playerId: string, sell: string, buy: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  shares: Record<string, ShareEntry>;
  historicalSnapshot: HistoricalSnapshot | null;
}

export default function RankingsTab({
  dynastyRankPos, setDynastyRankPos,
  loadingCalcValues, loadingRedraft,
  playerDispositions, savePlayerDisposition, setPlayerProfileId,
  shares, historicalSnapshot,
}: RankingsTabProps) {
  const players = usePlayers();
  const { leagueAdjustedFcValues: calcFcValues, leagueAdjustedRedraftValues: redraftValues } = useValues();

  const [rankView, setRankView] = React.useState<"DYNASTY" | "REDRAFT" | "COMPARE">("DYNASTY");
  const [rankSearch, setRankSearch] = React.useState("");

  const fcVal = React.useCallback((id: string) => calcFcValues[id] ?? 0, [calcFcValues]);
  const rdVal = React.useCallback((id: string) => redraftValues[id] ?? 0, [redraftValues]);

  const ranked = React.useMemo(
    () =>
      Object.values(players)
        .filter((p) => ["QB", "RB", "WR", "TE"].includes(p.position))
        .filter((p) =>
          rankView === "REDRAFT" ? rdVal(p.player_id) > 0 : fcVal(p.player_id) > 0
        )
        .filter((p) => dynastyRankPos === "ALL" || p.position === dynastyRankPos)
        .filter(
          (p) =>
            !rankSearch.trim() ||
            p.full_name?.toLowerCase().includes(rankSearch.trim().toLowerCase())
        )
        .sort((a, b) =>
          rankView === "REDRAFT"
            ? rdVal(b.player_id) - rdVal(a.player_id)
            : fcVal(b.player_id) - fcVal(a.player_id)
        ),
    [players, rankView, dynastyRankPos, rankSearch, fcVal, rdVal]
  );

  const ranksParentRef = React.useRef<HTMLDivElement>(null);
  const ranksVirtualizer = useVirtualizer({
    count: ranked.length,
    getScrollElement: () => ranksParentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  return (
    <>
      {(loadingCalcValues || loadingRedraft) && <p className="text-sm text-blue-400 mb-4">Loading values…</p>}
      {/* Pos filter + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="flex gap-2">
          {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
            <button
              key={pos}
              onClick={() => setDynastyRankPos(pos)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${dynastyRankPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
          {(["DYNASTY", "REDRAFT", "COMPARE"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setRankView(v)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${rankView === v ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {v === "DYNASTY" ? "Dynasty" : v === "REDRAFT" ? "Redraft" : "Compare"}
            </button>
          ))}
        </div>
      </div>
      {/* Player search */}
      <input
        className="w-full p-2 mb-3 rounded bg-gray-800 text-sm placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
        placeholder="Search player…"
        value={rankSearch}
        onChange={(e) => setRankSearch(e.target.value)}
      />
      {/* Column headers */}
      <div className="flex items-center gap-2 px-2 mb-1">
        <span className="w-5 shrink-0" />
        <span className="w-6 shrink-0" />
        <span className="flex-1 text-[10px] text-gray-600 uppercase tracking-wider">Player</span>
        <span className="w-7 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Age</span>
        {rankView === "COMPARE" ? (
          <>
            <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Dyn</span>
            <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Rdft</span>
            <span className="w-12 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Gap</span>
          </>
        ) : (
          <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
        )}
        <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Sell</span>
        <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Buy</span>
        <span className="w-4 shrink-0" />
      </div>
      {ranked.length === 0 && !loadingCalcValues && !loadingRedraft && (
        <p className="text-gray-400 text-sm">
          {Object.keys(calcFcValues).length === 0 ? "Load a league to populate player values." : "No players match your filter."}
        </p>
      )}
      <div
        ref={ranksParentRef}
        className="overflow-y-auto"
        style={{ height: "calc(100vh - 330px)", minHeight: "400px" }}
      >
        <div style={{ height: ranksVirtualizer.getTotalSize(), position: "relative" }}>
          {ranksVirtualizer.getVirtualItems().map((vRow) => {
            const p = ranked[vRow.index];
            const idx = vRow.index;
            const disp = playerDispositions[p.player_id] ?? { sell: "Neutral", buy: "Neutral" };
            const dyn = fcVal(p.player_id);
            const red = rdVal(p.player_id);
            const gap = dyn - red;
            const gapPct = dyn > 0 ? (gap / dyn) * 100 : 0;
            const displayVal = rankView === "REDRAFT" ? red : dyn;
            const isOwned = (shares[p.player_id]?.count ?? 0) > 0;
            const snapDynVal = rankView === "DYNASTY" ? Number(historicalSnapshot?.players[p.player_id]?.value ?? 0) : 0;
            const rawVal = rankView === "DYNASTY" ? (players[p.player_id]?.value ?? 0) : 0;
            const trendPct = snapDynVal > 0 && rawVal > 0 ? ((rawVal - snapDynVal) / snapDynVal) * 100 : null;
            return (
              <div
                key={p.player_id}
                style={{
                  position: "absolute",
                  top: vRow.start,
                  left: 0,
                  right: 0,
                  height: vRow.size,
                }}
                className="flex items-center gap-2 bg-gray-800/70 hover:bg-gray-800 rounded-lg px-2 py-1.5 transition"
              >
                <span className="text-[10px] text-gray-600 w-5 text-right shrink-0">{idx + 1}</span>
                <span className={`text-[10px] font-bold w-6 shrink-0 ${POS_COLOR[p.position] ?? "text-gray-400"}`}>{p.position}</span>
                <span className="text-xs flex-1 truncate min-w-0 flex items-center gap-1">
                  {isOwned && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="On your roster" />}
                  <span className={isOwned ? "text-blue-200" : "text-white"}>{p.full_name}</span>
                  {injuryBadge(p.injury_status)}
                </span>
                <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(p.age ?? undefined, p.position)}`}>{p.age || "—"}</span>
                {rankView === "COMPARE" ? (
                  <>
                    <span className="text-[10px] text-gray-300 font-mono w-14 text-right shrink-0">{dyn.toLocaleString()}</span>
                    <span className="text-[10px] text-gray-500 font-mono w-14 text-right shrink-0">{red > 0 ? red.toLocaleString() : "—"}</span>
                    <span className={`text-[10px] font-mono w-12 text-right shrink-0 ${gapPct > 15 ? "text-green-400" : gapPct < -10 ? "text-red-400" : "text-gray-500"}`}>
                      {red > 0 ? `${gap > 0 ? "+" : ""}${gap.toLocaleString()}` : "—"}
                    </span>
                  </>
                ) : (
                  <span className="flex flex-col items-end w-14 shrink-0">
                    <span className="text-[10px] text-gray-400 font-mono">{displayVal.toLocaleString()}</span>
                    {trendPct !== null && (
                      <span className={`text-[8px] font-semibold leading-none ${trendPct > 0 ? "text-green-500" : "text-red-500"}`}>
                        {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
                      </span>
                    )}
                  </span>
                )}
                <select
                  value={disp.sell}
                  onChange={(e) => savePlayerDisposition(p.player_id, e.target.value, disp.buy)}
                  className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${sellColor(disp.sell)}`}
                >
                  <option value="Not Willing to Trade">No Trade</option>
                  <option value="Will Trade but Higher than Market">↑ Price</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Lower than Market">↓ Price</option>
                  <option value="Trade at All Costs">Must Go</option>
                </select>
                <select
                  value={disp.buy}
                  onChange={(e) => savePlayerDisposition(p.player_id, disp.sell, e.target.value)}
                  className={`w-20 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[10px] shrink-0 focus:outline-none focus:border-blue-500 ${buyColor(disp.buy)}`}
                >
                  <option value="Buy Over Market">Pay Up</option>
                  <option value="Buy at Market">At Mkt</option>
                  <option value="Neutral">Neutral</option>
                  <option value="Buy Low">Buy Low</option>
                  <option value="Zero Interest">Skip</option>
                </select>
                <button onClick={() => setPlayerProfileId(p.player_id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
