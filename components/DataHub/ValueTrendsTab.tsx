"use client";
import React from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import type { SleeperUser, HistoricalSnapshot, PlayerValueSnapshotEntry, FcTrendEntry } from "../../lib/types";
import { injuryBadge, ageColor } from "./dataHubHelpers";
import type { ShareEntry } from "./dataHubTypes";
import TradeMarket from "../tradeHub/TradeMarket";
import { MiniSparkline } from "../charts/MiniSparkline";

const TREND_GRID = "grid grid-cols-[2rem_1fr_2.25rem_2.5rem_3.75rem_3.75rem_2.25rem_4rem_2.5rem] gap-2 items-center px-1";

const TrendHeader = () => (
  <div className={`${TREND_GRID} text-[10px] uppercase tracking-wide text-gray-500 mb-1`}>
    <span></span>
    <span>Player</span>
    <span className="text-center">Age</span>
    <span className="text-center">Team</span>
    <span className="text-right">Now</span>
    <span className="text-right">Then</span>
    <span></span>
    <span className="text-right">Δ %</span>
    <span></span>
  </div>
);

interface ValueTrendsTabProps {
  historicalSnapshot: HistoricalSnapshot | null;
  onSaveSnapshot: () => Promise<void>;
  shares: Record<string, ShareEntry>;
  user: SleeperUser | null;
  // Market Pulse view (merged in from Trade Hub's old Market Trends tab, Phase B4/R2)
  fcTrendData: FcTrendEntry[];
  loadingFcTrends: boolean;
  onRefreshFcTrends: () => void;
}

type TrendRow = {
  playerId: string;
  full_name: string;
  position: string;
  age?: number | null;
  injury_status?: string | null;
  team?: string;
  currentVal: number;
  snapVal: number;
  delta: number;
  pct: number;
  owned: number;
};

type TradeSugg = {
  type: "sell-window" | "buy-window";
  giveId: string; receiveId: string;
  giveVal: number; receiveVal: number;
  givePct: number; receivePct: number;
  partnerName: string;
  givePos: string; receivePos: string;
  giveAge?: number; receiveAge?: number;
  giveTeam?: string; receiveTeam?: string;
};

// Hide low-value noise: a player going 10 → 12 is "+20%" but means nothing.
// Require the player to be >500 in either the current map or the snapshot.
const VALUE_FLOOR = 500;
const MIN_TRADE_VAL = 1500;
const RATIO_MIN = 0.72;
const RATIO_MAX = 1.35;

function ValueTrendsTab({ historicalSnapshot, onSaveSnapshot, shares, user, fcTrendData, loadingFcTrends, onRefreshFcTrends }: ValueTrendsTabProps) {
  const players = usePlayers();
  const { rosters, users } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues } = useValues();

  const [view, setView] = React.useState<"MY_LEAGUE" | "MARKET_PULSE">("MY_LEAGUE");
  const [trendThreshold, setTrendThreshold] = React.useState(10);
  const [trendPos, setTrendPos] = React.useState("ALL");
  const [savingSnapshot, setSavingSnapshot] = React.useState(false);
  const [snapshotSavedAt, setSnapshotSavedAt] = React.useState<number | null>(null);
  const [mountedAt] = React.useState(() => Date.now());

  const snap = historicalSnapshot;
  const snapshotDate = snap ? new Date(snap.recorded_at) : null;
  const { ageLabel, isStaleSnapshot } = React.useMemo(() => {
    if (!snap) return { ageLabel: "", isStaleSnapshot: false };
    const ageMs = mountedAt - new Date(snap.recorded_at).getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
    const ageLabel = ageDays >= 2 ? `${ageDays} days ago` : ageDays === 1 ? "yesterday" : `${ageHours}h ago`;
    return { ageLabel, isStaleSnapshot: ageDays >= 7 };
  }, [snap, mountedAt]);

  const allTrends = React.useMemo<TrendRow[]>(() => {
    if (!snap) return [];
    const out: TrendRow[] = [];
    Object.entries(snap.players).forEach(([playerId, snapData]: [string, PlayerValueSnapshotEntry]) => {
      const currentVal = players[playerId]?.value ?? 0;
      const snapVal = Number(snapData.value ?? 0);
      if (snapVal <= 0 || currentVal <= 0) return;
      if (currentVal < VALUE_FLOOR && snapVal < VALUE_FLOOR) return;
      const delta = currentVal - snapVal;
      const pct = (delta / snapVal) * 100;
      const p = players[playerId];
      if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
      if (trendPos !== "ALL" && p.position !== trendPos) return;
      out.push({
        playerId,
        full_name: p.full_name ?? snapData.full_name,
        position: p.position,
        age: p.age,
        injury_status: p.injury_status,
        team: p.team ?? snapData.team,
        currentVal,
        snapVal,
        delta,
        pct,
        owned: shares[playerId]?.count ?? 0,
      });
    });
    return out;
  }, [snap, players, trendPos, shares]);

  const falling = React.useMemo(
    () => allTrends.filter((r) => r.pct <= -trendThreshold).sort((a, b) => a.pct - b.pct),
    [allTrends, trendThreshold]
  );
  const rising = React.useMemo(
    () => allTrends.filter((r) => r.pct >= trendThreshold).sort((a, b) => b.pct - a.pct),
    [allTrends, trendThreshold]
  );

  // Trend-based trade suggestions — O(n²) partner matching, so memoize off the
  // render path (recomputes only when the snapshot, rosters, values, or league change).
  const { sellWindowTrades, buyWindowTrades } = React.useMemo(() => {
    if (!snap) return { sellWindowTrades: [] as TradeSugg[], buyWindowTrades: [] as TradeSugg[] };
    const trendMap = new Map<string, number>();
    Object.entries(snap.players).forEach(([pid, snapData]) => {
      const cv = players[pid]?.value ?? 0;
      const sv = Number(snapData.value ?? 0);
      if (sv > 0 && cv > 0) trendMap.set(pid, ((cv - sv) / sv) * 100);
    });

    const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
    const myPlayerSet = new Set<string>(myRoster?.players ?? []);
    const partnerRosters = rosters.filter((r) => r.owner_id && r.owner_id !== user?.user_id);

    const usedGiveA = new Set<string>();
    const usedRecvA = new Set<string>();
    const sellWindowTrades: TradeSugg[] = [];
    if (myRoster) {
      const mySellCands = [...myPlayerSet]
        .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
        .filter((x) => x.pct <= -5 && x.val >= MIN_TRADE_VAL)
        .sort((a, b) => a.pct - b.pct);

      outer1: for (const mine of mySellCands) {
        if (sellWindowTrades.length >= 5) break;
        if (usedGiveA.has(mine.id)) continue;
        for (const partnerRoster of partnerRosters) {
          if (sellWindowTrades.length >= 5) break outer1;
          const partnerCands = ((partnerRoster.players ?? []) as string[])
            .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
            .filter((x) => x.val >= MIN_TRADE_VAL && !usedRecvA.has(x.id))
            .sort((a, b) => Math.abs(a.val - mine.val) - Math.abs(b.val - mine.val));
          for (const theirs of partnerCands) {
            const ratio = mine.val / theirs.val;
            if (ratio < RATIO_MIN || ratio > RATIO_MAX) continue;
            const myP = players[mine.id];
            const theirP = players[theirs.id];
            if (!myP || !theirP) continue;
            usedGiveA.add(mine.id);
            usedRecvA.add(theirs.id);
            sellWindowTrades.push({
              type: "sell-window",
              giveId: mine.id, receiveId: theirs.id,
              giveVal: mine.val, receiveVal: theirs.val,
              givePct: mine.pct, receivePct: theirs.pct,
              partnerName: users[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
              givePos: myP.position, receivePos: theirP.position,
              giveAge: myP.age ?? undefined, receiveAge: theirP.age ?? undefined,
              giveTeam: myP.team ?? undefined, receiveTeam: theirP.team ?? undefined,
            });
            break;
          }
        }
      }
    }

    const usedGiveB = new Set<string>();
    const usedRecvB = new Set<string>();
    const buyWindowTrades: TradeSugg[] = [];
    if (myRoster) {
      const myGiveCands = [...myPlayerSet]
        .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
        .filter((x) => x.val >= MIN_TRADE_VAL);

      outerBuy: for (const partnerRoster of partnerRosters) {
        if (buyWindowTrades.length >= 5) break;
        const partnerRising = ((partnerRoster.players ?? []) as string[])
          .filter((id) => !myPlayerSet.has(id))
          .map((id) => ({ id, pct: trendMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
          .filter((x) => x.pct >= 5 && x.val >= MIN_TRADE_VAL && !usedRecvB.has(x.id))
          .sort((a, b) => b.pct - a.pct);

        for (const theirs of partnerRising) {
          if (buyWindowTrades.length >= 5) break outerBuy;
          const giveCand = myGiveCands
            .filter((x) => !usedGiveB.has(x.id))
            .sort((a, b) => Math.abs(a.val - theirs.val) - Math.abs(b.val - theirs.val))
            .find((x) => {
              const ratio = x.val / theirs.val;
              return ratio >= RATIO_MIN && ratio <= RATIO_MAX;
            });
          if (!giveCand) continue;
          const myP = players[giveCand.id];
          const theirP = players[theirs.id];
          if (!myP || !theirP) continue;
          usedGiveB.add(giveCand.id);
          usedRecvB.add(theirs.id);
          buyWindowTrades.push({
            type: "buy-window",
            giveId: giveCand.id, receiveId: theirs.id,
            giveVal: giveCand.val, receiveVal: theirs.val,
            givePct: giveCand.pct, receivePct: theirs.pct,
            partnerName: users[partnerRoster.owner_id] || `Team ${partnerRoster.roster_id}`,
            givePos: myP.position, receivePos: theirP.position,
            giveAge: myP.age ?? undefined, receiveAge: theirP.age ?? undefined,
            giveTeam: myP.team ?? undefined, receiveTeam: theirP.team ?? undefined,
          });
        }
      }
    }

    return { sellWindowTrades, buyWindowTrades };
  }, [snap, players, rosters, user, calcFcValues, users]);

  const viewToggle = (
    <div className="flex justify-center gap-2 mb-4">
      {(["MY_LEAGUE", "MARKET_PULSE"] as const).map((v) => (
        <button
          key={v}
          onClick={() => setView(v)}
          className={`px-3 py-1.5 rounded-full text-xs font-semibold transition ${
            view === v ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"
          }`}
        >
          {v === "MY_LEAGUE" ? "My League Trends" : "Market Pulse"}
        </button>
      ))}
    </div>
  );

  // Market Pulse is FantasyCalc's league-wide trend data (30-day movers, most
  // traded) — it doesn't depend on this league's snapshot, so it's available
  // even before one exists. This is the old Trade Hub "Market Trends" tab,
  // moved here in Phase B4/R2.
  if (view === "MARKET_PULSE") {
    return (
      <>
        {viewToggle}
        <TradeMarket fcTrendData={fcTrendData} loadingFcTrends={loadingFcTrends} onRefreshFcTrends={onRefreshFcTrends} />
      </>
    );
  }

  if (!snap) {
    return (
      <>
        {viewToggle}
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <div className="text-3xl">📊</div>
          <p className="text-base font-semibold text-white">No baseline snapshot yet</p>
          <p className="text-sm text-gray-400 max-w-sm">
            Load a league to start tracking values. A daily snapshot will be saved automatically once your dynasty values are loaded.
          </p>
        </div>
      </>
    );
  }

  const TrendRow = ({ row, direction }: { row: TrendRow; direction: "up" | "down" }) => (
    <div className={`${TREND_GRID} text-xs py-0.5`}>
      <span className="text-[10px] uppercase text-gray-500">{row.position}</span>
      <span className="text-gray-200 min-w-0 truncate flex items-center gap-1">
        {row.full_name}{injuryBadge(row.injury_status)}
      </span>
      <span className={`text-[10px] font-mono text-center ${ageColor(row.age ?? undefined, row.position)}`}>{row.age || "—"}</span>
      <span className="text-[10px] text-gray-500 text-center truncate">{row.team || ""}</span>
      <span className="text-[11px] text-gray-200 font-mono text-right">{row.currentVal.toLocaleString()}</span>
      <span className="text-[11px] text-gray-500 font-mono text-right">{row.snapVal.toLocaleString()}</span>
      <MiniSparkline from={row.snapVal} to={row.currentVal} />
      <span className={`text-xs font-semibold font-mono text-right ${direction === "down" ? "text-red-400" : "text-emerald-400"}`}>
        {direction === "up" ? "+" : ""}{row.pct.toFixed(1)}%
      </span>
      <span className="text-[10px] text-gray-500 text-right">{row.owned > 0 ? `${row.owned}×` : ""}</span>
    </div>
  );

  const TradeSuggCard = ({ t }: { t: TradeSugg }) => {
    const isSell = t.type === "sell-window";
    const giveP = players[t.giveId];
    const receiveP = players[t.receiveId];
    const lastName = (full: string | undefined) => full?.split(" ").slice(1).join(" ") || full || "";
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
        <div className="border-b border-gray-800 pb-2 mb-2 flex items-center justify-between">
          <span className={`text-xs font-semibold ${isSell ? "text-red-400" : "text-emerald-400"}`}>
            {isSell ? "Sell Window" : "Buy Window"}
          </span>
          <span className="text-[11px] text-gray-500">w/ {t.partnerName}</span>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-800 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">You Give</div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] uppercase text-gray-500 shrink-0">{t.givePos}</span>
              <span className="text-xs text-gray-200 truncate">{giveP?.full_name}</span>
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{t.giveTeam || "—"} · Age {t.giveAge || "—"}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-gray-300 font-mono">{t.giveVal.toLocaleString()}</span>
              <span className={`text-[11px] font-semibold font-mono ${t.givePct < 0 ? "text-red-400" : "text-emerald-400"}`}>
                {t.givePct > 0 ? "+" : ""}{t.givePct.toFixed(1)}%
              </span>
            </div>
          </div>
          <div className="rounded-lg border border-gray-800 px-2 py-1.5">
            <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-0.5">You Receive</div>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] uppercase text-gray-500 shrink-0">{t.receivePos}</span>
              <span className="text-xs text-gray-200 truncate">{receiveP?.full_name}</span>
            </div>
            <div className="text-[10px] text-gray-500 mt-0.5">{t.receiveTeam || "—"} · Age {t.receiveAge || "—"}</div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-[11px] text-gray-300 font-mono">{t.receiveVal.toLocaleString()}</span>
              <span className={`text-[11px] font-semibold font-mono ${t.receivePct >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                {t.receivePct > 0 ? "+" : ""}{t.receivePct.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>
        <div className="mt-2 text-[11px] text-gray-500 leading-relaxed">
          {isSell
            ? `Sell ${lastName(giveP?.full_name)} while the market is down ${Math.abs(t.givePct).toFixed(0)}% and get fair value back in ${lastName(receiveP?.full_name)}${t.receivePct >= 5 ? ` (up ${t.receivePct.toFixed(0)}%)` : ""} before your asset drops further.`
            : `${lastName(receiveP?.full_name)} is up ${t.receivePct.toFixed(0)}% — buy in now using ${lastName(giveP?.full_name)}${t.givePct >= 10 ? ` (up ${t.givePct.toFixed(0)}%, sell high)` : ""} before the market catches on.`
          }
        </div>
      </div>
    );
  };

  return (
    <>
      {viewToggle}
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex gap-1.5">
          {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
            <button
              key={pos}
              onClick={() => setTrendPos(pos)}
              className={`px-3 py-1 rounded text-sm font-medium transition ${trendPos === pos ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400 hover:text-white"}`}
            >
              {pos}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-gray-500 shrink-0">Threshold</span>
          <div className="flex bg-gray-800 rounded-lg p-0.5 gap-0.5">
            {[5, 10, 15, 20].map((pct) => (
              <button
                key={pct}
                onClick={() => setTrendThreshold(pct)}
                className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition ${trendThreshold === pct ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {pct}%
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Snapshot age banner */}
      <div className={`flex flex-wrap items-center gap-2 mb-3 rounded-xl border px-3 py-2 ${isStaleSnapshot ? "border-amber-700/50 bg-amber-950/20" : "border-gray-800 bg-gray-900"}`}>
        <span className={`text-[11px] ${isStaleSnapshot ? "text-amber-400" : "text-gray-500"}`}>Comparing current values against snapshot from</span>
        <span className={`text-[11px] font-semibold ${isStaleSnapshot ? "text-amber-300" : "text-gray-200"}`}>{ageLabel}</span>
        <span className="text-[11px] text-gray-500">({snapshotDate?.toLocaleDateString()})</span>
        {isStaleSnapshot && <span className="text-[10px] text-amber-500 font-semibold">· snapshot may be stale</span>}
        <span className="text-[10px] text-gray-500">{Object.keys(snap.players).length} players tracked</span>
        <button
          type="button"
          disabled={savingSnapshot}
          onClick={async () => {
            setSavingSnapshot(true);
            await onSaveSnapshot();
            setSavingSnapshot(false);
            setSnapshotSavedAt(Date.now());
          }}
          className="ml-auto text-[10px] font-semibold border rounded-lg px-2.5 py-1 transition disabled:opacity-50 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"
        >
          {savingSnapshot ? "Saving…" : snapshotSavedAt ? "✓ Snapshot Saved" : "Take Snapshot Now"}
        </button>
      </div>

      {/* Sell window */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-3">
        <div className="border-b border-gray-800 pb-2 mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-red-400">Sell Window Open</span>
          <span className="text-xs text-gray-200 font-medium">{falling.length}</span>
          <span className="text-[11px] text-gray-500">Value fell {trendThreshold}%+ — sell before it drops further</span>
        </div>
        {falling.length === 0 ? (
          <div className="text-[11px] text-gray-600 italic">No players down {trendThreshold}%+ from the snapshot.</div>
        ) : (
          <>
            <TrendHeader />
            <div className="space-y-0.5">
              {falling.map((row) => <TrendRow key={row.playerId} row={row} direction="down" />)}
            </div>
          </>
        )}
      </div>

      {/* Rising / buy window closing */}
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-3">
        <div className="border-b border-gray-800 pb-2 mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-emerald-400">Buy Window Closing</span>
          <span className="text-xs text-gray-200 font-medium">{rising.length}</span>
          <span className="text-[11px] text-gray-500">Value up {trendThreshold}%+ — buy now or sell at peak</span>
        </div>
        {rising.length === 0 ? (
          <div className="text-[11px] text-gray-600 italic">No players up {trendThreshold}%+ from the snapshot.</div>
        ) : (
          <>
            <TrendHeader />
            <div className="space-y-0.5">
              {rising.map((row) => <TrendRow key={row.playerId} row={row} direction="up" />)}
            </div>
          </>
        )}
      </div>

      {/* ── Trade suggestions ── */}
      <div className="mt-6 mb-2">
        <h3 className="text-sm font-semibold text-gray-200">Trend-Based Trade Suggestions</h3>
        <p className="text-[11px] text-gray-500 mt-0.5">
          {!user || !rosters.length
            ? "Load a league to see trade suggestions based on your roster."
            : `Up to 5 suggestions per window · fixed thresholds: sell at −5%, buy at +5%, peak at +20%`}
        </p>
      </div>

      {(!user || !rosters.length) ? (
        <div className="text-[11px] text-gray-600 italic">No league loaded. Select a league from the League Hub first.</div>
      ) : (
        <>
          {/* Sell Window Trades */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3 mb-3">
            <div className="border-b border-gray-800 pb-2 mb-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-red-400">Sell Window Trades</span>
              <span className="text-xs text-gray-200 font-medium">{sellWindowTrades.length}</span>
              <span className="text-[11px] text-gray-500">Give your −5%+ fallers · receive fair-value assets from league mates</span>
            </div>
            {sellWindowTrades.length === 0 ? (
              <div className="text-[11px] text-gray-600 italic">
                No matches found — either no roster players are down 5%+, no league mates hold players up 20%+, or value gaps are too wide.
              </div>
            ) : (
              <div className="space-y-2">
                {sellWindowTrades.map((t) => <TradeSuggCard key={`${t.giveId}-${t.receiveId}`} t={t} />)}
              </div>
            )}
          </div>

          {/* Buy Window Trades */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
            <div className="border-b border-gray-800 pb-2 mb-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-emerald-400">Buy Window Trades</span>
              <span className="text-xs text-gray-200 font-medium">{buyWindowTrades.length}</span>
              <span className="text-[11px] text-gray-500">Target partners&apos; +5%+ early risers · give your closest fair-value asset in return</span>
            </div>
            {buyWindowTrades.length === 0 ? (
              <div className="text-[11px] text-gray-600 italic">
                No matches found — either no roster players are up 20%+, no league mates hold early-rising players, or value gaps are too wide.
              </div>
            ) : (
              <div className="space-y-2">
                {buyWindowTrades.map((t) => <TradeSuggCard key={`${t.giveId}-${t.receiveId}`} t={t} />)}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default React.memo(ValueTrendsTab);
