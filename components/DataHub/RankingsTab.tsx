"use client";
import React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import type { HistoricalSnapshot } from "../../lib/types";
import { injuryBadge, ageColor, POS_COLOR, PERSONAL_SIGNAL_META } from "./dataHubHelpers";
import { MiniSparkline } from "../charts/MiniSparkline";
import type { ShareEntry } from "./dataHubTypes";
import {
  reconcilePersonalOrdering,
  derivePersonalSignal,
  moveInOrdering,
  buildConsensusOrder,
  sortRangeByMarket,
} from "../../lib/helpers/personalRankings";

type RankView = "DYNASTY" | "REDRAFT" | "COMPARE" | "PERSONAL";

interface RankingsTabProps {
  dynastyRankPos: string;
  setDynastyRankPos: (pos: string) => void;
  loadingCalcValues: boolean;
  loadingRedraft: boolean;
  personalOrdering: string[];
  savePersonalOrdering: (next: string[]) => void;
  setPlayerProfileId: (id: string | null) => void;
  shares: Record<string, ShareEntry>;
  historicalSnapshot: HistoricalSnapshot | null;
}

function RankingsTab({
  dynastyRankPos, setDynastyRankPos,
  loadingCalcValues, loadingRedraft,
  personalOrdering, savePersonalOrdering, setPlayerProfileId,
  shares, historicalSnapshot,
}: RankingsTabProps) {
  const players = usePlayers();
  const { leagueAdjustedFcValues: calcFcValues, leagueAdjustedRedraftValues: redraftValues } = useValues();

  const [rankView, setRankView] = React.useState<RankView>("DYNASTY");
  const [rankSearch, setRankSearch] = React.useState("");

  const fcVal = React.useCallback((id: string) => calcFcValues[id] ?? 0, [calcFcValues]);
  const rdVal = React.useCallback((id: string) => redraftValues[id] ?? 0, [redraftValues]);

  const isPersonal = rankView === "PERSONAL";

  // ── Consensus universe (dynasty market) — drives the Personal view ──────────
  // Best-to-worst dynasty player_ids; index+1 = consensus rank. This is the
  // market board the user's personal order is reconciled against and compared to.
  const consensusOrder = React.useMemo(
    () => buildConsensusOrder(players, fcVal),
    [players, fcVal]
  );

  const consensusRankMap = React.useMemo(() => {
    const m = new Map<string, number>();
    consensusOrder.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [consensusOrder]);

  // Reconciled personal order (seeds from consensus on first use, splices in
  // newcomers, drops players who have left the universe). Pure helper.
  const personalOrder = React.useMemo(
    () => reconcilePersonalOrdering(personalOrdering, consensusOrder),
    [personalOrdering, consensusOrder]
  );

  // Display rows for the Personal view: overall personal rank is preserved even
  // when the board is filtered to a single position.
  const personalRows = React.useMemo(() => {
    const q = rankSearch.trim().toLowerCase();
    return personalOrder
      .map((id, i) => ({ id, personalRank: i + 1 }))
      .filter(({ id }) => {
        const p = players[id];
        if (!p) return false;
        if (dynastyRankPos !== "ALL" && p.position !== dynastyRankPos) return false;
        if (q && !p.full_name?.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [personalOrder, players, dynastyRankPos, rankSearch]);

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

  // ── Personal reorder: drag-to-reorder + type-to-rank ────────────────────────
  const [editingRankId, setEditingRankId] = React.useState<string | null>(null);
  const [rankInput, setRankInput] = React.useState("");
  const [draggingId, setDraggingId] = React.useState<string | null>(null);
  const [dragOverId, setDragOverId] = React.useState<string | null>(null);
  const [confirmReset, setConfirmReset] = React.useState(false);
  const [rangeFrom, setRangeFrom] = React.useState("");
  const [rangeTo, setRangeTo] = React.useState("");

  const sortRangeToMarket = React.useCallback(() => {
    const from = parseInt(rangeFrom, 10);
    const to = parseInt(rangeTo, 10);
    if (!rangeFrom || !rangeTo || isNaN(from) || isNaN(to) || from < 1 || to < 1) return;
    savePersonalOrdering(sortRangeByMarket(personalOrder, consensusRankMap, from, to));
  }, [rangeFrom, rangeTo, personalOrder, consensusRankMap, savePersonalOrdering]);

  const commitPersonalRank = React.useCallback(
    (id: string) => {
      const nr = parseInt(rankInput, 10);
      setEditingRankId(null);
      if (!rankInput || isNaN(nr) || nr < 1) return;
      savePersonalOrdering(moveInOrdering(personalOrder, id, nr));
    },
    [rankInput, personalOrder, savePersonalOrdering]
  );

  const handlePersonalDrop = React.useCallback(
    (targetId: string) => {
      const dragged = draggingId;
      setDraggingId(null);
      setDragOverId(null);
      if (!dragged || dragged === targetId) return;
      const targetRank = personalOrder.indexOf(targetId) + 1;
      if (targetRank < 1) return;
      savePersonalOrdering(moveInOrdering(personalOrder, dragged, targetRank));
    },
    [draggingId, personalOrder, savePersonalOrdering]
  );

  const rowCount = isPersonal ? personalRows.length : ranked.length;

  const ranksParentRef = React.useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/incompatible-library
  const ranksVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => ranksParentRef.current,
    estimateSize: () => 36,
    overscan: 8,
  });

  const RANK_VIEWS: { id: RankView; label: string }[] = [
    { id: "DYNASTY", label: "Dynasty" },
    { id: "REDRAFT", label: "Redraft" },
    { id: "COMPARE", label: "Compare" },
    { id: "PERSONAL", label: "Personal" },
  ];

  const noValues = Object.keys(calcFcValues).length === 0;

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
          {RANK_VIEWS.map((v) => (
            <button
              key={v.id}
              onClick={() => setRankView(v.id)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${rankView === v.id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      {/* Personal-view help + reset */}
      {isPersonal && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <p className="text-[11px] text-gray-500">
            Your board vs. the market. Drag a row or click its rank to set your own order — the gap drives the Trade Finder.
          </p>
          <span className="flex items-center gap-1 text-[11px] shrink-0">
            <span className="text-gray-500">Sort ranks</span>
            <input
              type="number"
              min={1}
              placeholder="280"
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              className="w-14 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <span className="text-gray-500">to</span>
            <input
              type="number"
              min={1}
              placeholder="350"
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              className="w-14 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-200 text-[11px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={sortRangeToMarket}
              disabled={!rangeFrom || !rangeTo}
              title="Re-sort just this rank range into market-value order, in place"
              className="px-2 py-0.5 rounded font-medium bg-gray-800 text-gray-400 hover:text-white transition disabled:opacity-40 disabled:hover:text-gray-400"
            >
              by market
            </button>
          </span>
          {confirmReset ? (
            <span className="flex items-center gap-2 text-[11px]">
              <span className="text-gray-400">Reset to market order?</span>
              <button
                onClick={() => { savePersonalOrdering([]); setConfirmReset(false); }}
                className="px-2 py-0.5 rounded bg-red-700 hover:bg-red-600 text-white font-semibold"
              >
                Reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-200"
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="px-2 py-0.5 rounded text-[11px] font-medium bg-gray-800 text-gray-400 hover:text-white transition shrink-0"
            >
              Reset to market
            </button>
          )}
        </div>
      )}
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
        {isPersonal ? (
          <>
            <span className="w-12 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Mkt</span>
            <span className="w-12 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">vs Mkt</span>
            <span className="w-20 text-center text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Signal</span>
            <span className="w-4 shrink-0" />
          </>
        ) : rankView === "COMPARE" ? (
          <>
            <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Dyn</span>
            <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Rdft</span>
            <span className="w-12 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Gap</span>
          </>
        ) : (
          <span className="w-14 text-right text-[10px] text-gray-600 uppercase tracking-wider shrink-0">Value</span>
        )}
        <span className="w-4 shrink-0" />
      </div>
      {rowCount === 0 && !loadingCalcValues && !loadingRedraft && (
        <p className="text-gray-400 text-sm">
          {noValues ? "Load a league to populate player values." : "No players match your filter."}
        </p>
      )}
      <div
        ref={ranksParentRef}
        className="overflow-y-auto"
        style={{ height: "calc(100vh - 330px)", minHeight: "400px" }}
      >
        <div style={{ height: ranksVirtualizer.getTotalSize(), position: "relative" }}>
          {ranksVirtualizer.getVirtualItems().map((vRow) => {
            if (isPersonal) {
              const { id, personalRank } = personalRows[vRow.index];
              const p = players[id];
              const consensusRank = consensusRankMap.get(id) ?? personalRank;
              const vsMkt = consensusRank - personalRank; // >0 = you're higher than market (buy)
              const signal = derivePersonalSignal(personalRank, consensusRank);
              const meta = PERSONAL_SIGNAL_META[signal];
              const isOwned = (shares[id]?.count ?? 0) > 0;
              const isDragOver = dragOverId === id;
              return (
                <div
                  key={id}
                  draggable
                  onDragStart={() => setDraggingId(id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(id); }}
                  onDragLeave={() => setDragOverId((cur) => (cur === id ? null : cur))}
                  onDrop={() => handlePersonalDrop(id)}
                  onDragEnd={() => { setDraggingId(null); setDragOverId(null); }}
                  style={{ position: "absolute", top: vRow.start, left: 0, right: 0, height: vRow.size }}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 transition ${draggingId === id ? "opacity-40" : ""} ${isDragOver ? "bg-blue-900/40 border-t-2 border-blue-500" : "bg-gray-800/70 hover:bg-gray-800"}`}
                >
                  <span
                    className="w-5 text-right shrink-0 cursor-text"
                    onClick={() => { setEditingRankId(id); setRankInput(`${personalRank}`); }}
                    title="Click to set rank"
                  >
                    {editingRankId === id ? (
                      <input
                        autoFocus
                        type="number"
                        min={1}
                        className="w-10 px-0.5 py-0.5 bg-gray-900 border border-blue-500 rounded text-yellow-400 font-bold text-[10px] focus:outline-none text-right"
                        value={rankInput}
                        onChange={(e) => setRankInput(e.target.value)}
                        onBlur={() => commitPersonalRank(id)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitPersonalRank(id); if (e.key === "Escape") setEditingRankId(null); }}
                      />
                    ) : (
                      <span className="text-[10px] text-yellow-400/80 font-mono hover:text-yellow-300">{personalRank}</span>
                    )}
                  </span>
                  <span className={`text-[10px] font-bold w-6 shrink-0 cursor-grab active:cursor-grabbing ${POS_COLOR[p.position] ?? "text-gray-400"}`} title="Drag to reorder">{p.position}</span>
                  <span className="text-xs flex-1 truncate min-w-0 flex items-center gap-1">
                    {isOwned && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" title="On your roster" />}
                    <span className={isOwned ? "text-blue-200" : "text-white"}>{p.full_name}</span>
                    {injuryBadge(p.injury_status)}
                  </span>
                  <span className={`text-[10px] font-mono w-7 text-center shrink-0 ${ageColor(p.age ?? undefined, p.position)}`}>{p.age || "—"}</span>
                  <span className="text-[10px] text-gray-500 font-mono w-12 text-right shrink-0">{consensusRank}</span>
                  <span className={`text-[10px] font-mono w-12 text-right shrink-0 ${vsMkt > 0 ? "text-green-400" : vsMkt < 0 ? "text-red-400" : "text-gray-600"}`}>
                    {vsMkt > 0 ? "+" : ""}{vsMkt}
                  </span>
                  <span className="w-20 text-center shrink-0">
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] ${meta.cls}`}>{meta.label}</span>
                  </span>
                  <button
                    onClick={() => savePersonalOrdering(moveInOrdering(personalOrder, id, consensusRank))}
                    disabled={vsMkt === 0}
                    className={`text-xs transition shrink-0 w-4 ${vsMkt === 0 ? "text-gray-800 cursor-default" : "text-gray-600 hover:text-yellow-400"}`}
                    title={vsMkt === 0 ? "Already at market rank" : `Reset to market rank (${consensusRank})`}
                  >
                    ↺
                  </button>
                  <button onClick={() => setPlayerProfileId(id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
                </div>
              );
            }
            const p = ranked[vRow.index];
            const idx = vRow.index;
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
                  <span className="flex items-center gap-1 shrink-0">
                    {trendPct !== null && <MiniSparkline from={snapDynVal} to={rawVal} />}
                    <span className="flex flex-col items-end w-14 shrink-0">
                      <span className="text-[10px] text-gray-400 font-mono">{displayVal.toLocaleString()}</span>
                      {trendPct !== null && (
                        <span className={`text-[8px] font-semibold leading-none ${trendPct > 0 ? "text-green-500" : "text-red-500"}`}>
                          {trendPct > 0 ? "+" : ""}{trendPct.toFixed(1)}%
                        </span>
                      )}
                    </span>
                  </span>
                )}
                <button onClick={() => setPlayerProfileId(p.player_id)} className="text-gray-600 hover:text-blue-400 text-xs transition shrink-0 w-4" title="View profile">ⓘ</button>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default React.memo(RankingsTab);
