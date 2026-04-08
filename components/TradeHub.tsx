"use client";
import React from "react";
import {
  getStoredPickValue,
  getLeagueDirectionBucket,
  average,
  sum,
  CURRENT_YEAR,
} from "../lib/helpers";

const BASE_YEAR_TH = new Date().getFullYear();
const YEARS = Array.from({ length: 3 }, (_, index) => String(BASE_YEAR_TH + index));

// ── Props ──────────────────────────────────────────────────────────────────
interface TradeHubProps {
  // Tab state
  tradeHubSection: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS";
  setTradeHubSection: (section: "CALCULATOR" | "FINDER" | "RECOMMENDATIONS") => void;

  // League / roster state
  leagues: any[];
  user: any;
  players: Record<string, any>;
  rosters: any[];
  users: Record<string, any>;
  selectedLeague: any;
  allPicks: any[];
  pickFcValues: Record<string, number>;
  calcFcValues: Record<string, number>;
  redraftValues: Record<string, number>;
  selectedLeagueDynamicPickValues: Record<string, any>;

  // Computed direction / sim
  selectedLeagueDirection: any;
  selectedLeagueDirectionAdjusted: any;
  selectedLeagueSimulation: any;

  // Trade calculator state
  calcOpponentRosterId: number | null;
  setCalcOpponentRosterId: (id: number | null) => void;
  calcGive: string[];
  setCalcGive: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceive: string[];
  setCalcReceive: React.Dispatch<React.SetStateAction<string[]>>;
  calcGivePicks: string[];
  setCalcGivePicks: React.Dispatch<React.SetStateAction<string[]>>;
  calcReceivePicks: string[];
  setCalcReceivePicks: React.Dispatch<React.SetStateAction<string[]>>;

  // Trade finder state
  finderSeed: number;
  setFinderSeed: React.Dispatch<React.SetStateAction<number>>;
  finderPlayerSearch: string;
  setFinderPlayerSearch: (s: string) => void;
  finderPinnedPlayerId: string | null;
  setFinderPinnedPlayerId: (id: string | null) => void;
  finderTargetOppRosterId: number | null;
  setFinderTargetOppRosterId: (id: number | null) => void;
  finderTargetPlayerSearch: string;
  setFinderTargetPlayerSearch: (s: string) => void;
  finderTargetPlayerId: string | null;
  setFinderTargetPlayerId: (id: string | null) => void;

  // Draft state
  selectedLeagueDraftHasOccurred: boolean;

  // Additional state
  loadingCalcValues: boolean;
  calcSearchA: string;
  setCalcSearchA: (s: string) => void;
  calcSearchB: string;
  setCalcSearchB: (s: string) => void;
  playerDispositions: Record<string, { sell: string; buy: string }>;
  finderDraftCapitalMode: boolean;
  setFinderDraftCapitalMode: React.Dispatch<React.SetStateAction<boolean>>;

  // Computed
  leagueMateProfileByRosterId: Map<number, any>;
  selectedLeagueMateProfilesView: any[];
  tradeRecommendationCards: any[];
  tradePartnerRankings: any[];

  // Functions
  setPlayerProfileId: (id: string | null) => void;
  loadUserExposure: (ownerId: string) => void;
  loadUserTrades: (ownerId: string) => void;

  // Value trends
  historicalSnapshot: { players: Record<string, any>; recorded_at: string } | null;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function TradeHub({
  tradeHubSection, setTradeHubSection,
  leagues, user, players, rosters, users, selectedLeague, allPicks,
  pickFcValues, calcFcValues, redraftValues, selectedLeagueDynamicPickValues,
  selectedLeagueDirection, selectedLeagueDirectionAdjusted, selectedLeagueSimulation,
  calcOpponentRosterId, setCalcOpponentRosterId,
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  finderSeed, setFinderSeed, finderPlayerSearch, setFinderPlayerSearch,
  finderPinnedPlayerId, setFinderPinnedPlayerId,
  finderTargetOppRosterId, setFinderTargetOppRosterId,
  finderTargetPlayerSearch, setFinderTargetPlayerSearch,
  finderTargetPlayerId, setFinderTargetPlayerId,
  selectedLeagueDraftHasOccurred,
  loadingCalcValues, calcSearchA, setCalcSearchA, calcSearchB, setCalcSearchB,
  playerDispositions, finderDraftCapitalMode, setFinderDraftCapitalMode,
  leagueMateProfileByRosterId, selectedLeagueMateProfilesView,
  tradeRecommendationCards, tradePartnerRankings,
  setPlayerProfileId, loadUserExposure, loadUserTrades,
  historicalSnapshot,
}: TradeHubProps) {
  return (
    <>
  <div className="max-w-4xl mx-auto p-6">

    {/* Sub-tab nav */}
    <div className="flex justify-center border-b border-gray-700 mb-6 overflow-x-auto">
      <div className="flex justify-center gap-6 text-center">
      <button
        onClick={() => setTradeHubSection("CALCULATOR")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "CALCULATOR"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Calculator
      </button>
      <button
        onClick={() => setTradeHubSection("FINDER")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "FINDER"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Trade Finder
      </button>
      <button
        onClick={() => setTradeHubSection("RECOMMENDATIONS")}
        className={`pb-2 px-1 text-sm font-semibold transition ${
          tradeHubSection === "RECOMMENDATIONS"
            ? "border-b-2 border-blue-400 text-blue-400"
            : "text-gray-400 hover:text-white"
        }`}
      >
        Recommendations
      </button>
      </div>
    </div>

    {/* ── Trade Calculator ── */}
    {tradeHubSection === "CALCULATOR" && (() => {
      const rosterToUser: Record<number, string> = {};
      rosters.forEach((r: any) => { rosterToUser[r.roster_id] = r.owner_id; });

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const opponentRoster = calcOpponentRosterId != null
        ? rosters.find((r: any) => r.roster_id === calcOpponentRosterId)
        : null;

      // League-specific value lookup (falls back to generic if not yet loaded)
      const calcVal = (id: string) =>
        calcFcValues[id] ?? (players as any)[id]?.value ?? 0;

      // Player lists (excluding already-traded items), sorted by league-specific value
      const myAvailPlayers = (myRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcGive.includes(p.player_id));

      const theirAvailPlayers = (opponentRoster?.players || [] as string[])
        .map((id: string) => (players as any)[id])
        .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position))
        .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id))
        .filter((p: any) => !calcReceive.includes(p.player_id));

      // Pick lists (excluding already-added picks)
      const pickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const myAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === myRoster?.roster_id && !calcGivePicks.includes(pickKey(p))
      );
      const theirAvailPicks = (allPicks as any[]).filter(
        (p: any) => p.owner_id === opponentRoster?.roster_id && !calcReceivePicks.includes(pickKey(p))
      );
      const pickInsight = (pick: any) => selectedLeagueDynamicPickValues[pickKey(pick)];

      const getPickValue = (key: string) => {
        const pick = (allPicks as any[]).find((p: any) => pickKey(p) === key);
        if (!pick) return 0;
        return pickInsight(pick)?.expectedValue ?? getStoredPickValue(pickFcValues, pick);
      };
      const pickLabel = (p: any) => {
        const origOwnerUserId = rosterToUser[p.roster_id];
        const origName = (users as any)[origOwnerUserId] || `Team ${p.roster_id}`;
        const via = p.roster_id !== p.owner_id ? ` (via ${origName})` : "";
        const dynamic = pickInsight(p);
        // For current year, slot is "1.04" format; for future years slot is just the round number
        const slotLabel = p.slot && p.slot.includes(".")
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        return `${slotLabel}${via}${dynamic ? ` • ${dynamic.label}` : ""}`;
      };

      // Trade totals using league-specific values
      const totalGive =
        calcGive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcGivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);
      const totalReceive =
        calcReceive.reduce((s: number, id: string) => s + calcVal(id), 0) +
        calcReceivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);

      // Waiver adjustment — when one side has more assets, the side with fewer gets
      // a waiver credit equal to each extra asset's value × 0.42 (FantasyCalc approximation)
      const giveAssets = [
        ...calcGive.map((id: string) => calcVal(id)),
        ...calcGivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const receiveAssets = [
        ...calcReceive.map((id: string) => calcVal(id)),
        ...calcReceivePicks.map((k: string) => getPickValue(k)),
      ].sort((a, b) => b - a);
      const assetDiff = giveAssets.length - receiveAssets.length;
      let waiverAdj = 0;
      let waiverAdjSide: "give" | "receive" | null = null;
      // No waiver adjustment if either side is completely empty
      const calcWaiverAdj = (extras: number[]) =>
        extras.reduce((sum, val, i) => {
          const cap = i === 0 ? 550 : 750;
          return sum + Math.min(Math.round(val * 0.42), cap);
        }, 0);
      if (assetDiff > 0 && receiveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(giveAssets.slice(receiveAssets.length));
        waiverAdjSide = "receive";
      } else if (assetDiff < 0 && giveAssets.length > 0) {
        waiverAdj = calcWaiverAdj(receiveAssets.slice(giveAssets.length));
        waiverAdjSide = "give";
      }

      const totalGiveAdj = totalGive + (waiverAdjSide === "give" ? waiverAdj : 0);
      const totalReceiveAdj = totalReceive + (waiverAdjSide === "receive" ? waiverAdj : 0);

      const net = totalReceiveAdj - totalGiveAdj;
      const verdict = Math.abs(net) <= 300 ? "EVEN" : net > 0 ? "YOU WIN" : "YOU LOSE";
      const verdictColor = verdict === "EVEN" ? "text-yellow-400" : verdict === "YOU WIN" ? "text-green-400" : "text-red-400";

      const filterPlayers = (list: any[], search: string) =>
        search.trim().length >= 1
          ? list.filter((p: any) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
          : list;

      // Asset row component (inline) — playerId optional to enable profile panel
      const assetRow = (label: string, value: number, onAdd: () => void, playerId?: string) => (
        <div
          key={label}
          className="w-full flex items-center justify-between px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition"
        >
          <button onClick={onAdd} className="flex-1 text-sm truncate text-left">{label}</button>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            {playerId && (
              <button
                onClick={(e) => { e.stopPropagation(); setPlayerProfileId(playerId); }}
                className="text-gray-600 hover:text-blue-400 text-xs transition"
                title="View profile"
              >ⓘ</button>
            )}
          </div>
        </div>
      );

      // Trade item row (inline)
      const tradeRow = (label: string, value: number, onRemove: () => void) => (
        <div key={label} className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
          <span className="text-sm truncate">{label}</span>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
            <button onClick={onRemove} className="text-gray-600 hover:text-red-400 text-xs">✕</button>
          </div>
        </div>
      );

      if (!selectedLeague) {
        return <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Calculator.</p>;
      }

      return (
        <div>
          <p className="text-xs text-gray-500 mb-2">
            Powered by FantasyCalc — values calibrated for <strong className="text-gray-300">{selectedLeague.name}</strong>.
            {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
          </p>

          {/* Opponent picker */}
          <div className="mb-6">
            <label className="text-xs text-gray-400 mb-1 block">Trade with</label>
            <div className="flex flex-col md:flex-row gap-3">
              <select
                value={calcOpponentRosterId ?? ""}
                onChange={(e) => {
                  setCalcOpponentRosterId(e.target.value ? Number(e.target.value) : null);
                  setCalcReceive([]);
                  setCalcReceivePicks([]);
                  setCalcSearchB("");
                }}
                className="bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full md:w-64"
              >
                <option value="">Select opponent...</option>
                {rosters
                  .filter((r: any) => r.owner_id !== user?.user_id)
                  .map((r: any) => (
                    <option key={r.roster_id} value={r.roster_id}>
                      {(users as any)[r.owner_id] || `Team ${r.roster_id}`}
                    </option>
                ))}
              </select>

          {opponentRoster && (
            <>
              <button
                onClick={() => loadUserExposure(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Most Owned Players
              </button>

              <button
                onClick={() => loadUserTrades(opponentRoster.owner_id)}
                className="bg-gray-800 border border-gray-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Recent Trades
              </button>
            </>
          )}
            </div>
          </div>

          {/* Two-column asset panels */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            {/* Your assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                Your Assets — {(users as any)[user?.user_id] || "You"}
              </div>
              <input
                type="text"
                value={calcSearchA}
                onChange={(e) => setCalcSearchA(e.target.value)}
                placeholder="Filter players..."
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {(() => {
                  const items = [
                    ...filterPlayers(myAvailPlayers, calcSearchA).map((p: any) => ({
                      label: `${p.full_name} (${p.position} · ${p.team})`,
                      value: calcVal(p.player_id),
                      playerId: p.player_id as string | undefined,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      playerId: undefined as string | undefined,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ].sort((a, b) => b.value - a.value);
                  if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                  return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
                })()}
              </div>
            </div>

            {/* Their assets */}
            <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
              <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
                {opponentRoster
                  ? `${(users as any)[opponentRoster.owner_id] || "Opponent"}'s Assets`
                  : "Their Assets"}
              </div>
              <input
                type="text"
                value={calcSearchB}
                onChange={(e) => setCalcSearchB(e.target.value)}
                placeholder={opponentRoster ? "Filter players..." : "Search any player to find their team..."}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
              />
              <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
                {!opponentRoster ? (() => {
                  const q = calcSearchB.trim().toLowerCase();
                  if (q.length < 1) return (
                    <p className="text-xs text-gray-600">Search a player name above or select an opponent from the dropdown</p>
                  );
                  const allRosterPlayers = rosters
                    .filter((r: any) => r.owner_id !== user?.user_id)
                    .flatMap((r: any) =>
                      (r.players || []).map((id: string) => {
                        const p = (players as any)[id];
                        return p ? { ...p, _rosterId: r.roster_id } : null;
                      })
                    )
                    .filter((p: any) =>
                      p &&
                      ["QB","RB","WR","TE"].includes(p.position) &&
                      p.full_name?.toLowerCase().includes(q) &&
                      !calcReceive.includes(p.player_id)
                    )
                    .sort((a: any, b: any) => calcVal(b.player_id) - calcVal(a.player_id));
                  if (allRosterPlayers.length === 0) return (
                    <p className="text-xs text-gray-600">No player found — try a different name</p>
                  );
                  return allRosterPlayers.map((p: any) =>
                    assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id), () => {
                      setCalcOpponentRosterId(p._rosterId);
                      setCalcReceive((prev) => [...prev, p.player_id]);
                    }, p.player_id)
                  );
                })() : (() => {
                    const items = [
                      ...filterPlayers(theirAvailPlayers, calcSearchB).map((p: any) => ({
                        label: `${p.full_name} (${p.position} · ${p.team})`,
                        value: calcVal(p.player_id),
                        playerId: p.player_id as string | undefined,
                        onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                      })),
                      ...theirAvailPicks.map((p: any) => ({
                        label: pickLabel(p),
                        value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                        playerId: undefined as string | undefined,
                        onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                      })),
                    ].sort((a, b) => b.value - a.value);
                    if (items.length === 0) return <p className="text-xs text-gray-600">No assets available</p>;
                    return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
                  })()
                }
              </div>
            </div>
          </div>

          {/* Trade summary */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
            <div className="grid grid-cols-2 gap-6">
              {/* You Give */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-red-400 mb-2">You Give</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcGive.length === 0 && calcGivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcGive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcGive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcGivePicks.map((k: string) => {
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "give" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-red-400">{totalGiveAdj.toLocaleString()}</span>
                </div>
              </div>

              {/* You Receive */}
              <div>
                <div className="text-xs font-bold uppercase tracking-widest text-green-400 mb-2">You Receive</div>
                <div className="space-y-1 min-h-[48px]">
                  {calcReceive.length === 0 && calcReceivePicks.length === 0 && (
                    <p className="text-xs text-gray-600">Click assets above to add</p>
                  )}
                  {calcReceive.map((id: string) => {
                    const p = (players as any)[id];
                    return tradeRow(
                      `${p?.full_name ?? id} (${p?.position})`,
                      calcVal(id),
                      () => setCalcReceive((prev) => prev.filter((x) => x !== id))
                    );
                  })}
                  {calcReceivePicks.map((k: string) => {
                    const pick = (allPicks as any[]).find((p: any) => pickKey(p) === k);
                    const label = pick ? pickLabel(pick) : k;
                    return tradeRow(label, getPickValue(k),
                      () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
                  })}
                </div>
                {waiverAdjSide === "receive" && waiverAdj > 0 && (
                  <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                    <span className="text-xs text-gray-400 italic">Waiver Adjustment</span>
                    <span className="text-xs text-blue-300 font-mono">+{waiverAdj.toLocaleString()}</span>
                  </div>
                )}
                <div className="mt-3 pt-2 border-t border-gray-700 flex justify-between items-center">
                  <span className="text-xs text-gray-500">Total</span>
                  <span className="text-base font-bold text-green-400">{totalReceiveAdj.toLocaleString()}</span>
                </div>
              </div>
            </div>

            {/* Verdict */}
            {(calcGive.length > 0 || calcGivePicks.length > 0 || calcReceive.length > 0 || calcReceivePicks.length > 0) && (
              <div className="mt-4 pt-4 border-t border-gray-700 flex items-center justify-between">
                <div>
                  <span className={`text-xl font-black ${verdictColor}`}>{verdict}</span>
                  {verdict !== "EVEN" && (
                    <span className="ml-2 text-sm text-gray-400">
                      by {Math.abs(net).toLocaleString()} pts
                    </span>
                  )}
                </div>
                <button
                  onClick={() => { setCalcGive([]); setCalcReceive([]); setCalcGivePicks([]); setCalcReceivePicks([]); }}
                  className="text-xs text-gray-600 hover:text-gray-300 transition"
                >
                  Clear trade
                </button>
              </div>
            )}
          </div>

          {/* Trade Equalizer */}
          {verdict !== "EVEN" &&
            (calcGive.length + calcGivePicks.length) > 0 &&
            (calcReceive.length + calcReceivePicks.length) > 0 &&
            (() => {
              const gap = Math.abs(net);
              const youWin = net > 0;

              type EqCandidate = {
                label: string; value: number; age?: number;
                position?: string; isPick: boolean; onAdd: () => void;
              };

              const candidates: EqCandidate[] = youWin
                ? [
                    ...myAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...myAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ]
                : [
                    ...theirAvailPlayers.map((p: any) => ({
                      label: p.full_name, value: calcVal(p.player_id),
                      age: p.age, position: p.position, isPick: false,
                      onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                    })),
                    ...theirAvailPicks.map((p: any) => ({
                      label: pickLabel(p),
                      value: pickInsight(p)?.expectedValue ?? getStoredPickValue(pickFcValues, p),
                      isPick: true,
                      onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                    })),
                  ];

              const suggestions = candidates
                .filter((c) => c.value > 0)
                .sort((a, b) => Math.abs(a.value - gap) - Math.abs(b.value - gap))
                .slice(0, 5);

              if (suggestions.length === 0) return null;

              return (
                <div className="mt-4 flex justify-center">
                  <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5 w-full max-w-md">
                    <h3 className="text-sm font-semibold text-gray-200 mb-3">Players To Equalize Trade</h3>
                    <div className="flex justify-end gap-6 text-[11px] text-gray-500 mb-1 pr-9">
                      <span>Age</span>
                      <span>Value</span>
                    </div>
                    <div className="space-y-1">
                      {suggestions.map((s) => (
                        <div key={s.label} className="flex items-center justify-between px-3 py-2 bg-gray-800 rounded-lg">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm font-medium text-blue-400 truncate">{s.label}</span>
                            <span className="text-[10px] bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded font-bold uppercase shrink-0">
                              {s.isPick ? "PICK" : s.position}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 shrink-0 ml-3">
                            <span className="text-xs text-gray-400 w-8 text-right">{s.age ?? ""}</span>
                            <span className="text-xs font-mono text-gray-300 w-12 text-right">{s.value.toLocaleString()}</span>
                            <button
                              onClick={s.onAdd}
                              className="w-6 h-6 bg-blue-500 hover:bg-blue-400 rounded-full flex items-center justify-center text-white text-sm font-bold transition shrink-0"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

          <p className="text-[10px] text-gray-700 mt-3">
            Pick values shown as averages for that round. Waiver adjustment approximated at 42% of extra assets' value when sides have unequal player counts.
          </p>
        </div>
      );
    })()}

    {/* ── Trade Finder ── */}
    {tradeHubSection === "FINDER" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to use the Trade Finder.</p>
      );

      const calcVal = (id: string) => calcFcValues[id] ?? (players as any)[id]?.value ?? 0;
      const finderPickKey = (p: any) => `${p.season}-${p.round}-${p.roster_id}`;
      const finderPickLabel = (p: any) => {
        const via = p.roster_id !== p.owner_id ? ` (via ${users[p.roster_id] || `Team ${p.roster_id}`})` : "";
        const isSlotted = p.slot && String(p.slot).includes(".");
        const slotLabel = isSlotted
          ? `${p.season} ${p.slot}`
          : `${p.season} Rd ${p.round}`;
        const expectedSlot = !isSlotted
          ? (selectedLeagueDynamicPickValues[`${p.season}-${p.round}-${p.roster_id}`]?.expectedSlot ?? null)
          : null;
        const expectedSuffix = expectedSlot != null ? ` · Predicted Slot ${expectedSlot}` : "";
        return `${slotLabel}${expectedSuffix}${via}`;
      };

      // Build roster player list with values
      const rosterPlayers = (roster: any) =>
        (roster?.players || [])
          .map((id: string) => { const p = (players as any)[id]; return p ? { ...p, value: calcVal(id) } : null; })
          .filter((p: any) => p && ["QB","RB","WR","TE"].includes(p.position) && p.value > 0)
          .sort((a: any, b: any) => b.value - a.value);

      // Position totals for a player list
      const posTotals = (plist: any[]) => {
        const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
        plist.forEach((p: any) => { t[p.position] = (t[p.position] || 0) + p.value; });
        return t;
      };

      // Waiver adj using same caps as calculator
      const tradeWaiverAdj = (giveVals: number[], receiveVals: number[]) => {
        const diff = giveVals.length - receiveVals.length;
        if (diff === 0) return 0;
        const capAdj = (extras: number[]) =>
          extras.reduce((s, v, i) => s + Math.min(Math.round(v * 0.42), i === 0 ? 550 : 750), 0);
        if (diff > 0) {
          const sg = [...giveVals].sort((a, b) => b - a);
          return capAdj(sg.slice(receiveVals.length));
        } else {
          const sr = [...receiveVals].sort((a, b) => b - a);
          return capAdj(sr.slice(giveVals.length));
        }
      };

      // Check if a trade is value-balanced (within ±400 after waiver adj)
      const isBalanced = (giveVals: number[], receiveVals: number[]) => {
        const gTotal = giveVals.reduce((s, v) => s + v, 0);
        const rTotal = receiveVals.reduce((s, v) => s + v, 0);
        const diff = giveVals.length - receiveVals.length;
        const adjG = gTotal + (diff < 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        const adjR = rTotal + (diff > 0 ? tradeWaiverAdj(giveVals, receiveVals) : 0);
        return Math.abs(adjR - adjG) <= 400;
      };

      const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
      const myPlayers = rosterPlayers(myRoster);
      const isBlockedSellDisposition = (playerId?: string | null) =>
        !!playerId && playerDispositions[playerId]?.sell === "Not Willing to Trade";
      const isBlockedBuyDisposition = (playerId?: string | null) =>
        !!playerId && ["Zero Interest", "Skip"].includes(playerDispositions[playerId]?.buy || "");
      const myT = posTotals(myPlayers);
      const rosterDynVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val:
            rosterPlayers(r).reduce((s: number, p: any) => s + p.value, 0) +
            (allPicks as any[])
              .filter((p: any) => p.owner_id === r.roster_id)
              .reduce((s: number, p: any) => s + getStoredPickValue(pickFcValues, p), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const rosterRedVal = rosters
        .map((r: any) => ({
          roster_id: r.roster_id,
          val: (r.players || []).reduce((s: number, id: string) => s + (redraftValues[id] || 0), 0),
        }))
        .sort((a, b) => b.val - a.val);
      const dynRank = myRoster ? rosterDynVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      const redRank = myRoster ? rosterRedVal.findIndex((r) => r.roster_id === myRoster.roster_id) + 1 : 0;
      // Single source of truth: use the fully adjusted profile (dynasty + redraft + sim + age).
      // This is the same profile shown in the League Hub — no divergence possible.
      const finderDirectionProfile = selectedLeagueDirectionAdjusted ?? selectedLeagueDirection;
      const finderDirection = finderDirectionProfile?.bucket || getLeagueDirectionBucket(dynRank, redRank).bucket;
      const myFinderPlayoffOdds = (finderDirectionProfile as any)?.playoffOdds ??
        (selectedLeagueSimulation?.rowByRosterId?.get(Number(myRoster?.roster_id))?.playoffOdds ?? 0);
      // Below 50% playoff odds = tanking. Filling weak positions wins games you don't want to win —
      // it slides your 1.02 to 1.05 with zero championship upside.
      // iAmTankingFinder ALWAYS overrides the asset-based bucket in all scoring logic.
      const iAmTankingFinder = myFinderPlayoffOdds < 50;
      const draftCapitalMode = finderDraftCapitalMode;
      const priorityDraftYear = String(
        Number(CURRENT_YEAR) + (selectedLeagueDraftHasOccurred ? 1 : 0)
      );
      const orderedDraftYears = [
        ...YEARS.filter((year) => Number(year) >= Number(priorityDraftYear)),
        ...YEARS.filter((year) => Number(year) < Number(priorityDraftYear)),
      ];
      const draftYearPriority = Object.fromEntries(
        orderedDraftYears.map((year, idx) => [year, idx])
      ) as Record<string, number>;
      const numTeams = rosters.length;
      const myFinderPicks = (allPicks as any[])
        .filter((p: any) => p.owner_id === myRoster?.roster_id)
        .map((p: any) => ({ ...p, value: getStoredPickValue(pickFcValues, p) }))
        .filter((p: any) => p.value > 0)
        .sort((a: any, b: any) => {
          const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
          if (yearDiff !== 0) return yearDiff;
          if (a.round !== b.round) return a.round - b.round;
          return b.value - a.value;
        })
        .slice(0, 6);
      const ageCutoffByPos: Record<string, number> = { QB: 30, RB: 26, WR: 29, TE: 29 };
      const weakPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank >= Math.max(4, numTeams - 2))
          .map((entry: any) => entry.pos)
      );
      const strongPositions = new Set(
        (finderDirectionProfile?.positionRanks || [])
          .filter((entry: any) => entry.rank <= Math.max(2, Math.ceil(numTeams / 3)))
          .map((entry: any) => entry.pos)
      );
      const isAgingAsset = (player: any) =>
        Number(player?.age || 0) >= (ageCutoffByPos[player?.position] || 29);
      const isOldProducerBuy = (player: any) => {
        const age = Number(player?.age || 0);
        if (player?.position === "RB") return age >= 25;
        if (player?.position === "QB") return age >= 31;
        if (player?.position === "WR" || player?.position === "TE") return age >= 29;
        return age >= 29;
      };
      const isYoungBuildingBlock = (player: any) =>
        ["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 24;
      const isFutureInsulationAsset = (player: any) =>
        (["QB", "WR"].includes(player?.position) && Number(player?.age || 99) <= 25) ||
        (player?.position === "TE" && Number(player?.age || 99) <= 25) ||
        (player?.position === "RB" && Number(player?.age || 99) <= 23);
      const isPremiumCurrentPick = (pick: any) =>
        String(pick?.season) === CURRENT_YEAR && String(pick?.slot || "").match(/^1\.(0[1-6]|[1-6])$/);
      const getDirectionTradeScore = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingRedraft = outgoingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const incomingRedraft = incomingPlayers.reduce((sum: number, p: any) => sum + (redraftValues[p.player_id] || 0), 0);
        const outgoingDynasty = outgoingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const incomingDynasty = incomingPlayers.reduce((sum: number, p: any) => sum + p.value, 0);
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const weakPosLosses = outgoingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const agingSells = outgoingPlayers.filter((p: any) => isAgingAsset(p)).length;
        const youngCoreBuys = incomingPlayers.filter((p: any) => isYoungBuildingBlock(p)).length;
        const picksIn = incomingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const picksOut = outgoingPicks.reduce((sum: number, p: any) => sum + p.value, 0);
        const premiumCurrentPicksOut = outgoingPicks.filter((p: any) => isPremiumCurrentPick(p)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const oldProducerBuys = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const oldProducerSells = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const insulationBuys = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const insulationSells = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const currentPlayerCapitalOut = outgoingPlayers.reduce((sum: number, p: any) => {
          const age = Number(p.age || 0);
          const position = p.position;
          const olderProducer =
            (position === "RB" && age >= 25) ||
            (position === "QB" && age >= 28) ||
            ((position === "WR" || position === "TE") && age >= 27);
          return sum + (olderProducer ? 1 : 0);
        }, 0);
        const assetConsolidation =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;

        let score = 0;

        // iAmTankingFinder ALWAYS takes priority over the asset-based bucket.
        // A team at 0% playoff odds is NOT a True Contender — buying points is actively harmful
        // regardless of how good the assets look on paper.
        if (iAmTankingFinder) {
          // Tank mode: below 50% playoff odds. Only valid moves are selling floor production,
          // stacking picks, and targeting young upside shots.
          score += oldProducerSells * 10;
          score += agingSells * 8;
          score += insulationBuys * 9;
          score += youngCoreBuys * 8;
          score += futureFirstsIn * 14;
          score += picksIn / 150;
          // Every pick traded away is a lost future draft slot — penalize heavily
          score -= outgoingPicks.length * 10;
          score -= picksOut / 150;
          score -= premiumCurrentPicksOut * 18;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 8;
          // Counter the posScore reward for filling weak positions — that wins games you don't want
          score -= incomingRedraft / 160;
          score -= weakPosAdds * 10;
          score += strongPosSells * 3;
        } else if (["Elite", "True Contender", "Almost There"].includes(finderDirection)) {
          score += (incomingRedraft - outgoingRedraft) / 160;
          score += weakPosAdds * 8;
          score -= weakPosLosses * 10;
          score += assetConsolidation > 0 ? assetConsolidation * 4 : assetConsolidation * 1.5;
          score += currentPlayerCapitalOut * 3;
          score -= outgoingPicks.length * 3;
          score -= premiumCurrentPicksOut * 10;
          score -= incomingPicks.length * 2;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 28).length * 4;
          // RBs injure most often and are hardest to replace off waivers.
          // Contending teams should value RB depth even when RB is already a "strong" position.
          score += incomingPlayers.filter((p: any) =>
            p.position === "RB" && Number(p.age || 0) >= 22 && Number(p.age || 0) <= 26
          ).length * 4;
        } else if (["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection)) {
          score += agingSells * 9;
          score += oldProducerSells * 8;
          score += youngCoreBuys * 8;
          score += insulationBuys * 10;
          score -= insulationSells * 10;
          score += futureFirstsIn * 12;
          score += picksIn / 180;
          score -= picksOut / 180;
          score -= premiumCurrentPicksOut * 12;
          score -= oldProducerBuys * 18;
          score -= incomingPlayers.filter((p: any) => p.position === "RB" && Number(p.age || 0) >= 25).length * 7;
          score -= incomingRedraft / 160;
          score += strongPosSells * 3;
        } else {
          // True middle — has a realistic playoff path, balanced approach
          score += weakPosAdds * 6;
          score -= weakPosLosses * 7;
          score += assetConsolidation > 0 ? assetConsolidation * 5 : assetConsolidation * 1.5;
          score += agingSells * 4;
          score += youngCoreBuys * 4;
          score += futureFirstsIn * 6;
          score -= outgoingPicks.length * 4;
          score -= premiumCurrentPicksOut * 9;
          score += currentPlayerCapitalOut * 2;
          score += (incomingDynasty - outgoingDynasty) / 250;
        }

        if (outgoingPicks.length > 0 && currentPlayerCapitalOut === 0 && !iAmTankingFinder) score -= 6;
        if (incomingPicks.length > 0 && outgoingPlayers.length === 0 && !draftCapitalMode && !iAmTankingFinder) score -= 4;
        // Don't penalize draft capital trades for tanking or rebuild teams
        if (trade.draftCapital && !["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && !iAmTankingFinder) score -= 3;

        return score;
      };
      const getTradeIntent = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const outgoingPicks = trade.givePicks || [];
        const incomingPicks = trade.receivePicks || [];
        const outgoingOldProducers = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingOldProducers = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const incomingInsulation = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const outgoingInsulation = outgoingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const weakPosAdds = incomingPlayers.filter((p: any) => weakPositions.has(p.position)).length;
        const strongPosSells = outgoingPlayers.filter((p: any) => strongPositions.has(p.position)).length;
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const playerCountDelta =
          outgoingPlayers.length + outgoingPicks.length - incomingPlayers.length - incomingPicks.length;
        const incomingBest = [...incomingPlayers].sort((a: any, b: any) => b.value - a.value)[0];
        const outgoingBest = [...outgoingPlayers].sort((a: any, b: any) => b.value - a.value)[0];

        if (incomingPicks.length > 0 && incomingPlayers.length === 0) {
          return {
            label: "Pick Accumulation",
            detail: "Turning player value into future insulation and draft capital.",
          };
        }
        if (outgoingPicks.length > 0 && incomingPlayers.length > 0 && weakPosAdds > 0) {
          return {
            label: "Pick-For-Points",
            detail: "Using picks to patch a lineup need with immediate player help.",
          };
        }
        // iAmTankingFinder takes priority — even a "True Contender" bucket team at 0% is a seller
        if (iAmTankingFinder && outgoingOldProducers > 0 && (incomingPicks.length > 0 || incomingInsulation > 0)) {
          return {
            label: "Tank Sell",
            detail: `At ${Math.round(myFinderPlayoffOdds)}% playoff odds, converting floor production into draft capital maximizes future pick position without sacrificing cornerstone pieces.`,
          };
        }
        if (!iAmTankingFinder && ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection) && outgoingOldProducers > 0 && (futureFirstsIn > 0 || incomingInsulation > 0)) {
          return {
            label: "Rebuild Sell",
            detail: "Selling present points for youth, insulation, or future firsts.",
          };
        }
        if (!iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection) && incomingOldProducers > 0 && weakPosAdds > 0) {
          return {
            label: "Win-Now Patch",
            detail: "Buying immediate production where your current lineup needs help.",
          };
        }
        if (
          incomingBest &&
          outgoingBest &&
          incomingBest.value > outgoingBest.value &&
          playerCountDelta > 0
        ) {
          return {
            label: "Tier-Up",
            detail: "Condensing depth into one stronger difference-maker.",
          };
        }
        if (incomingInsulation > outgoingInsulation && incomingOldProducers === 0) {
          return {
            label: "Insulation Buy",
            detail: "Shifting value into younger assets that better fit a long-term build.",
          };
        }
        if (strongPosSells > 0 && weakPosAdds > 0) {
          return {
            label: "Strength-For-Need",
            detail: "Using excess at a strong position to solve a weaker room.",
          };
        }
        if (playerCountDelta > 0 && incomingPlayers.length > 0) {
          return {
            label: "Consolidation",
            detail: "Shrinking asset count to clean up your lineup and bench shape.",
          };
        }
        if (playerCountDelta < 0 && incomingPlayers.length > 1) {
          return {
            label: "Depth Split",
            detail: "Breaking one concentrated asset into multiple usable pieces.",
          };
        }
        if (incomingInsulation > 0 && outgoingOldProducers > 0) {
          return {
            label: "Age-Down Bet",
            detail: "Moving from older production into a younger value window.",
          };
        }
        return {
          label: "Value Rebalance",
          detail: "A balanced value move that changes roster shape more than headline value.",
        };
      };
      const failsDirectionGuardrail = (trade: TradeResult) => {
        const outgoingPlayers = trade.give || [];
        const incomingPlayers = trade.receive || [];
        const incomingPicks = trade.receivePicks || [];
        const futureFirstsIn = incomingPicks.filter((p: any) => Number(p.round) === 1 && String(p.season) !== CURRENT_YEAR).length;
        const oldProducerBuys = incomingPlayers.filter((p: any) => isOldProducerBuy(p)).length;
        const insulationBuys = incomingPlayers.filter((p: any) => isFutureInsulationAsset(p)).length;
        const outgoingOldProducers = outgoingPlayers.filter((p: any) => isOldProducerBuy(p)).length;

        // iAmTankingFinder covers ALL seller/rebuild cases regardless of bucket label.
        // A team at 0% playoff odds is a seller even if their assets say "True Contender."
        const isEffectiveSeller = iAmTankingFinder || ["Rebuilder", "Blow Up", "Hopeless"].includes(finderDirection);
        const isEffectiveContender = !iAmTankingFinder && ["Elite", "True Contender", "Almost There"].includes(finderDirection);

        if (isEffectiveSeller) {
          // Never load up on aging producers without future compensation
          if (oldProducerBuys > 0 && futureFirstsIn === 0 && insulationBuys === 0 && !trade.receivePicks.length) {
            return true;
          }
          if (
            incomingPlayers.length > 0 &&
            incomingPlayers.every((p: any) => isOldProducerBuy(p)) &&
            futureFirstsIn === 0 &&
            insulationBuys === 0
          ) {
            return true;
          }
          if (oldProducerBuys > outgoingOldProducers && futureFirstsIn === 0 && insulationBuys === 0) {
            return true;
          }
          // Block Pick-For-Points: never give picks to fill lineup holes.
          // Valid pick trades only:
          //   1. Tier-up to a true cornerstone prospect (ALL incoming players are young building blocks)
          //   2. Excess pick relief (8+ picks owned — can't realistically roster them all)
          const outgoingPicksGuard = trade.givePicks || [];
          if (outgoingPicksGuard.length > 0 && incomingPlayers.length > 0) {
            const incomingAllYoung = incomingPlayers.every((p: any) => isFutureInsulationAsset(p));
            const myTotalPickCount = (allPicks as any[]).filter(
              (p: any) => Number(p.owner_id) === Number(myRoster?.roster_id)
            ).length;
            const hasExcessPicks = myTotalPickCount >= 8;
            if (!incomingAllYoung && !hasExcessPicks) return true;
          }
        }

        if (isEffectiveContender) {
          if (incomingPlayers.length === 0 && incomingPicks.length > 0) return true;
        }

        return false;
      };
      // When a player is pinned, ensure they're always in the give pool even if outside top 10
      const myTopBase = myPlayers
        .filter((p: any) => !isBlockedSellDisposition(p.player_id))
        .slice(0, 10);
      const myPinnedPlayer = finderPinnedPlayerId && !isBlockedSellDisposition(finderPinnedPlayerId)
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId)
        : null;
      const myTop = myPinnedPlayer && !myTopBase.some((p: any) => p.player_id === myPinnedPlayer.player_id)
        ? [...myTopBase.slice(0, 9), myPinnedPlayer].filter(Boolean)
        : myTopBase;
      // When either give or receive player is pinned, relax loop caps so rarer combos surface
      const pinnedActive = !!(finderPinnedPlayerId || finderTargetPlayerId);


      // League-wide positional totals for every team (used for ranking)
      const allTeamPosTotals = rosters.map((r: any) => posTotals(rosterPlayers(r)));

      // Rank user (1 = best) at a given position given their total at that position
      const leagueRank = (pos: string, total: number) => {
        const sorted = allTeamPosTotals.map((t) => t[pos] || 0).sort((a, b) => b - a);
        let rank = 1;
        for (const t of sorted) { if (total >= t) break; rank++; }
        return Math.min(rank, numTeams);
      };

      // Positional fit score using post-trade league rankings.
      // Rewards improving weak positions, penalizes destroying strong ones.
      // Heavy drops now hurt instead of hard-blocking the trade so rebuild paths
      // and value-insulation deals can still surface.
      const posScore = (givePL: any[], receivePL: any[]) => {
        const postT: Record<string, number> = { ...myT };
        givePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) - p.value; });
        receivePL.forEach((p: any) => { postT[p.position] = (postT[p.position] || 0) + p.value; });

        let score = 0;
        for (const pos of ["QB", "RB", "WR", "TE"]) {
          const beforeRank = leagueRank(pos, myT[pos] || 0);
          const afterRank  = leagueRank(pos, postT[pos] || 0);
          const rankDelta  = beforeRank - afterRank; // positive = moved up (improved)

          // Scale reward/penalty by rank change; improving a weak spot is worth more
          const wasWeak = beforeRank > Math.floor(numTeams / 2);
          score += rankDelta * (wasWeak && rankDelta > 0 ? 3 : 2);

          const drop = afterRank - beforeRank;
          if (drop >= 3) score -= drop * 2.5;
          if (afterRank >= Math.max(8, numTeams - 2)) score -= 4;
          if (afterRank === numTeams) score -= 5;
        }
        return score;
      };

      if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

      // ── Player search / pin UI ──
      const searchMatches = finderPlayerSearch.trim().length >= 2
        ? myPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const pinnedPlayer = finderPinnedPlayerId
        ? myPlayers.find((p: any) => p.player_id === finderPinnedPlayerId && !isBlockedSellDisposition(p.player_id)) ?? null
        : null;

      // Opponent roster(s) for target player search
      const finderOppRostersFiltered = rosters.filter((r: any) =>
        r.owner_id !== user?.user_id &&
        (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId)
      );
      const allOppPlayers = finderOppRostersFiltered.flatMap((r: any) => rosterPlayers(r));
      const targetSearchMatches = finderTargetPlayerSearch.trim().length >= 2
        ? allOppPlayers.filter((p: any) =>
            p.full_name.toLowerCase().includes(finderTargetPlayerSearch.toLowerCase())
          ).slice(0, 6)
        : [];
      const targetPinnedPlayer = finderTargetPlayerId
        ? allOppPlayers.find((p: any) => p.player_id === finderTargetPlayerId) ?? null
        : null;

      // QB safety gate — find the top-32 QB value floor across all known players
      const allQBsSorted = Object.values(players as Record<string, any>)
        .filter((p: any) => p.position === "QB")
        .map((p: any) => calcVal(p.player_id))
        .filter((v) => v > 0)
        .sort((a, b) => b - a);
      const top32QBFloor = allQBsSorted[31] ?? 0; // value of the 32nd-best QB

      // How many of my QBs are within top-32 threshold
      const myTop32QBs = myPlayers.filter(
        (p: any) => p.position === "QB" && p.value >= top32QBFloor
      );

      // Returns true if giving these players still leaves ≥3 top-32 QBs on my roster
      const qbSafe = (givePlayers: any[]) => {
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return myTop32QBs.length - qbsGiven >= 3;
      };

      // Returns true if the opponent still has ≥3 top-32 QBs after giving these players away
      const oppQbSafe = (oppPlayersList: any[], givePlayers: any[]) => {
        const oppTop32QBs = oppPlayersList.filter(
          (p: any) => p.position === "QB" && p.value >= top32QBFloor
        );
        const qbsGiven = givePlayers.filter((p: any) => p.position === "QB" && p.value >= top32QBFloor).length;
        return oppTop32QBs.length - qbsGiven >= 3;
      };

      // Any QB/WR/TE the opponent receives must rank within the positional threshold
      // on their roster post-trade. Prevents dumping low-end players on teams that
      // already have better depth at that spot.
      //   QB  → must be top 3  (they need a real starter)
      //   WR  → must be top 5  (starter/flex quality)
      //   TE  → must be top 2  (positional scarcity)
      const POS_RANK_LIMITS: Record<string, number> = { QB: 3, WR: 5, TE: 2 };
      const oppReceiveOk = (oppPlayersList: any[], givePlayers: any[], receivePlayers: any[]) => {
        const outgoingIds = new Set(receivePlayers.map((p: any) => p.player_id));
        for (const pos of ["QB", "WR", "TE"] as const) {
          const limit = POS_RANK_LIMITS[pos];
          const incoming = givePlayers.filter((p: any) => p.position === pos);
          if (incoming.length === 0) continue;
          const oppPosAfter = oppPlayersList
            .filter((p: any) => p.position === pos && !outgoingIds.has(p.player_id))
            .concat(incoming)
            .sort((a: any, b: any) => b.value - a.value);
          const passes = incoming.every((pl: any) => {
            const rank = oppPosAfter.findIndex((p: any) => p.player_id === pl.player_id);
            return rank < limit; // 0-indexed: rank 0…limit-1 = top N
          });
          if (!passes) return false;
        }
        return true;
      };

      // No package (give or receive) may contain 2+ QBs or 2+ TEs
      const packageOk = (pkg: any[]) => {
        const qbs = pkg.filter((p: any) => p.position === "QB").length;
        const tes = pkg.filter((p: any) => p.position === "TE").length;
        return qbs <= 1 && tes <= 1;
      };

      type TradeResult = {
        give: any[]; receive: any[];
        givePicks: any[]; receivePicks: any[];
        oppName: string; oppRosterId: number;
        score: number; net: number; format: string;
        draftCapital?: boolean;
      };

      const starterSlots = (selectedLeague?.roster_positions || []).filter(
        (slot: string) => !["BN", "IR", "TAXI"].includes(slot)
      );
      const starterCounts = starterSlots.reduce((acc: Record<string, number>, slot: string) => {
        acc[slot] = (acc[slot] || 0) + 1;
        return acc;
      }, {});
      const hasSuperFlex = (starterCounts.SUPER_FLEX || 0) > 0;
      const hasFlex = (starterCounts.FLEX || 0) > 0;
      const rosterById = new Map(
        rosters.map((r: any) => [Number(r.roster_id), r])
      );
      const playerTradeScore = (player: any) =>
        (redraftValues[player?.player_id] ?? 0) * 2 + (player?.value ?? 0);

      const buildPostTradePlayers = (baseRoster: any, givePlayers: any[], receivePlayers: any[]) => {
        const giveIds = new Set(givePlayers.map((p: any) => p.player_id));
        return [
          ...(baseRoster?.players || [])
            .map((id: string) => (players as any)[id])
            .filter((p: any) => p && !giveIds.has(p.player_id)),
          ...receivePlayers,
        ].filter((p: any) => p && ["QB", "RB", "WR", "TE"].includes(p.position));
      };

      const evaluateLineupSafety = (rosterPlayersList: any[], relaxed = false) => {
        const available = [...rosterPlayersList].sort(
          (a: any, b: any) => playerTradeScore(b) - playerTradeScore(a)
        );
        const usedIds = new Set<string>();
        const lineup: Array<{ slot: string; player: any; score: number }> = [];

        const claimBest = (eligiblePositions: string[], slot: string) => {
          const idx = available.findIndex(
            (player: any) =>
              !usedIds.has(player.player_id) &&
              eligiblePositions.includes(player.position)
          );
          if (idx === -1) {
            lineup.push({ slot, player: null, score: 0 });
            return;
          }
          const player = available[idx];
          usedIds.add(player.player_id);
          lineup.push({ slot, player, score: playerTradeScore(player) });
        };

        starterSlots.forEach((slot: string) => {
          if (slot === "FLEX") return claimBest(["RB", "WR", "TE"], slot);
          if (slot === "SUPER_FLEX") return claimBest(["QB", "RB", "WR", "TE"], slot);
          return claimBest([slot], slot);
        });

        const bench = available.filter((player: any) => !usedIds.has(player.player_id));
        const benchCounts = bench.reduce((acc: Record<string, number>, player: any) => {
          acc[player.position] = (acc[player.position] || 0) + 1;
          return acc;
        }, {});

        const emptySlots = lineup.filter((slot) => !slot.player).length;
        const lineupScore = lineup.reduce((sum, slot) => sum + slot.score, 0);
        const reserveFlex = bench.filter((p: any) => ["RB", "WR", "TE"].includes(p.position)).length;
        const reserveQb = benchCounts.QB || 0;
        const reserveTe = benchCounts.TE || 0;
        const reserveRb = benchCounts.RB || 0;
        const reserveWr = benchCounts.WR || 0;
        const reserveTotal = bench.length;

        const minReserveQb = hasSuperFlex ? (relaxed ? 0 : 1) : starterCounts.QB ? (relaxed ? 0 : 1) : 0;
        const minReserveTe = starterCounts.TE ? (relaxed ? 0 : 1) : 0;
        const minReserveFlex = hasFlex || hasSuperFlex ? (relaxed ? 1 : 2) : (relaxed ? 0 : 1);
        const minReserveRb = starterCounts.RB >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveWr = starterCounts.WR >= 2 ? (relaxed ? 0 : 1) : 0;
        const minReserveTotal = relaxed ? 2 : 4;

        const shortages = [
          emptySlots > 0 ? `empty-${emptySlots}` : null,
          reserveQb < minReserveQb ? "qb" : null,
          reserveTe < minReserveTe ? "te" : null,
          reserveFlex < minReserveFlex ? "flex" : null,
          reserveRb < minReserveRb ? "rb" : null,
          reserveWr < minReserveWr ? "wr" : null,
          reserveTotal < minReserveTotal ? "total" : null,
        ].filter(Boolean);

        return {
          valid: emptySlots === 0,
          shortages,
          emptySlots,
          lineupScore,
          reserveQb,
          reserveTe,
          reserveFlex,
          reserveRb,
          reserveWr,
          reserveTotal,
        };
      };

      const getTradeLineupSafety = (trade: TradeResult) => {
        const myAfterPlayers = buildPostTradePlayers(myRoster, trade.give, trade.receive);
        const oppRoster = rosterById.get(Number(trade.oppRosterId));
        const oppBeforePlayers = rosterPlayers(oppRoster);
        const oppAfterPlayers = buildPostTradePlayers(oppRoster, trade.receive, trade.give);
        const myBefore = evaluateLineupSafety(myPlayers, false);
        const myAfter = evaluateLineupSafety(myAfterPlayers, false);
        const oppBefore = evaluateLineupSafety(oppBeforePlayers, true);
        const oppAfter = evaluateLineupSafety(oppAfterPlayers, true);
        const myShortagePenalty =
          myAfter.emptySlots * 14 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - myAfter.reserveQb) * (hasSuperFlex ? 7 : 4) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - myAfter.reserveTe) * 3 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - myAfter.reserveFlex) * 2.5 +
          Math.max(0, 2 - myAfter.reserveTotal) * 2;
        const oppShortagePenalty =
          oppAfter.emptySlots * 10 +
          Math.max(0, (starterCounts.QB || 0 ? 1 : 0) - oppAfter.reserveQb) * (hasSuperFlex ? 5 : 3) +
          Math.max(0, (starterCounts.TE || 0 ? 1 : 0) - oppAfter.reserveTe) * 2 +
          Math.max(0, (hasFlex || hasSuperFlex ? 1 : 0) - oppAfter.reserveFlex) * 1.5;

        const myDelta =
          (myAfter.lineupScore - myBefore.lineupScore) / 150 +
          (myAfter.reserveFlex - myBefore.reserveFlex) * 2 +
          (myAfter.reserveQb - myBefore.reserveQb) * (hasSuperFlex ? 3 : 1.5) +
          (myAfter.reserveTotal - myBefore.reserveTotal) * 1.25;
        const oppDelta =
          (oppAfter.lineupScore - oppBefore.lineupScore) / 175 +
          (oppAfter.reserveFlex - oppBefore.reserveFlex) * 1.5 +
          (oppAfter.reserveQb - oppBefore.reserveQb) * (hasSuperFlex ? 2 : 1) +
          (oppAfter.reserveTotal - oppBefore.reserveTotal);

        const contenderBuckets = new Set(["Elite", "True Contender", "Almost There", "Fading Contender"]);
        const isContenderish = contenderBuckets.has(finderDirection);
        const reserveTotalDrop = myBefore.reserveTotal - myAfter.reserveTotal;
        const reserveFlexDrop = myBefore.reserveFlex - myAfter.reserveFlex;
        const reserveQbDrop = myBefore.reserveQb - myAfter.reserveQb;
        const reserveTeDrop = myBefore.reserveTe - myAfter.reserveTe;
        const severeDepthLoss =
          reserveTotalDrop >= 2 ||
          reserveFlexDrop >= 2 ||
          (hasSuperFlex && reserveQbDrop >= 1) ||
          (!hasSuperFlex && starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
          (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1);
        const thinBenchForContender =
          isContenderish && (
            myAfter.reserveTotal < Math.max(4, Math.min(myBefore.reserveTotal, 5)) ||
            myAfter.reserveFlex < (hasFlex || hasSuperFlex ? Math.max(2, Math.min(myBefore.reserveFlex, 3)) : 1) ||
            (starterCounts.QB > 0 && myAfter.reserveQb < 1 && myBefore.reserveQb >= 1) ||
            (starterCounts.TE > 0 && myAfter.reserveTe < 1 && myBefore.reserveTe >= 1)
          );
        const lineupGain = myAfter.lineupScore - myBefore.lineupScore;
        const depthCollapsePenalty =
          Math.max(0, reserveTotalDrop) * 3.5 +
          Math.max(0, reserveFlexDrop) * 4 +
          Math.max(0, reserveQbDrop) * (hasSuperFlex ? 6 : 3) +
          Math.max(0, reserveTeDrop) * 2.5;
        const blocksForDepth =
          (isContenderish && severeDepthLoss && lineupGain < 90) ||
          thinBenchForContender;

        return {
          myBefore,
          myAfter,
          oppBefore,
          oppAfter,
          myValid: myAfter.valid,
          oppValid: oppAfter.valid,
          valid: myAfter.emptySlots === 0 && oppAfter.emptySlots === 0 && !blocksForDepth,
          blocksForDepth,
          reserveTotalDrop,
          reserveFlexDrop,
          reserveQbDrop,
          reserveTeDrop,
          score: myDelta + oppDelta * 0.7 - myShortagePenalty - oppShortagePenalty * 0.7 - depthCollapsePenalty,
        };
      };

      const results: TradeResult[] = [];

      for (const oppRoster of rosters.filter((r: any) => r.owner_id !== user?.user_id && (finderTargetOppRosterId === null || r.roster_id === finderTargetOppRosterId))) {
        const oppPlayers = rosterPlayers(oppRoster);
        const oppPicks = (allPicks as any[])
          .filter((p: any) => p.owner_id === oppRoster.roster_id)
          .map((p: any) => ({ ...p, value: getStoredPickValue(pickFcValues, p) }))
          .filter((p: any) => p.value > 0)
          .sort((a: any, b: any) => {
            const yearDiff = (draftYearPriority[a.season] ?? 999) - (draftYearPriority[b.season] ?? 999);
            if (yearDiff !== 0) return yearDiff;
            if (a.round !== b.round) return a.round - b.round;
            return b.value - a.value;
          })
          .slice(0, 8);

        // Ensure target player (if on this roster) is always in the pool even if ranked 11+
        // Also exclude "Zero Interest" buy-disposition players unless explicitly targeted
        const oppTopBase = oppPlayers
          .filter((p: any) => !isBlockedBuyDisposition(p.player_id))
          .slice(0, 10);
        const targetPinnedOppPlayer = finderTargetPlayerId && !isBlockedBuyDisposition(finderTargetPlayerId)
          ? oppPlayers.find((p: any) => p.player_id === finderTargetPlayerId)
          : null;
        const oppTop = targetPinnedOppPlayer && !oppTopBase.some((p: any) => p.player_id === targetPinnedOppPlayer.player_id)
          ? [...oppTopBase.slice(0, 9), targetPinnedOppPlayer].filter(Boolean)
          : oppTopBase;
        const oppName = (users as any)[oppRoster.owner_id] || `Team ${oppRoster.roster_id}`;

        if (draftCapitalMode) {
          for (const mp of myTop) {
            for (const pick of oppPicks) {
              if (!isBalanced([mp.value], [pick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
              results.push({
                give: [mp], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                score: -Math.abs(pick.value - mp.value), net: pick.value - mp.value, format: "1 for 1", draftCapital: true,
              });
            }
          }

          for (const mp of myTop) {
            for (let i = 0; i < oppPicks.length; i++) {
              for (let j = i + 1; j < oppPicks.length; j++) {
                const p1 = oppPicks[i], p2 = oppPicks[j];
                if (!isBalanced([mp.value], [p1.value, p2.value])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [])) continue;
                const adj = tradeWaiverAdj([mp.value], [p1.value, p2.value]);
                results.push({
                  give: [mp], receive: [], givePicks: [], receivePicks: [p1, p2], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((p1.value + p2.value - adj) - mp.value), net: p1.value + p2.value - mp.value - adj, format: "1 for 2", draftCapital: true,
                });
              }
            }
          }

          for (let i = 0; i < Math.min(myTop.length, 8); i++) {
            for (let j = i + 1; j < Math.min(myTop.length, 8); j++) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!packageOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [])) continue;
              for (const pick of oppPicks) {
                if (!isBalanced([mp1.value, mp2.value], [pick.value])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value], [pick.value]);
                results.push({
                  give: [mp1, mp2], receive: [], givePicks: [], receivePicks: [pick], oppName, oppRosterId: oppRoster.roster_id,
                  score: -Math.abs((pick.value + adj) - (mp1.value + mp2.value)), net: pick.value + adj - mp1.value - mp2.value, format: "2 for 1", draftCapital: true,
                });
              }
            }
          }

          continue;
        }

        const myCap = (base: number) => pinnedActive ? myTop.length : Math.min(myTop.length, base);
        const oppCap = (base: number) => pinnedActive ? oppTop.length : Math.min(oppTop.length, base);

        // 1v1
        for (const mp of myTop) {
          for (const op of oppTop) {
            if (!isBalanced([mp.value], [op.value])) continue;
            if (!qbSafe([mp])) continue;
            if (!oppQbSafe(oppPlayers, [op])) continue;
            if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
            results.push({
              give: [mp], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([mp], [op]),
              net: op.value - mp.value, format: "1 for 1",
            });
          }
        }

        // 1v2
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(9); i++) {
            for (let j = i + 1; j < oppCap(9); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!isBalanced([mp.value], [op1.value, op2.value])) continue;
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value]);
              results.push({
                give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op1, op2]),
                net: op1.value + op2.value - mp.value - adj, format: "1 for 2",
              });
            }
          }
        }

        // 1v3
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(8); i++) {
            for (let j = i + 1; j < oppCap(8); j++) {
              for (let k = j + 1; k < oppCap(8); k++) {
                const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k];
                if (!isBalanced([mp.value], [op1.value, op2.value, op3.value])) continue;
                if (!packageOk([op1, op2, op3])) continue;
                if (!qbSafe([mp])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value]);
                results.push({
                  give: [mp], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2, op3]),
                  net: op1.value + op2.value + op3.value - mp.value - adj, format: "1 for 3",
                });
              }
            }
          }
        }

        // 1v4
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(7); i++) {
            for (let j = i + 1; j < oppCap(7); j++) {
              for (let k = j + 1; k < oppCap(7); k++) {
                for (let l = k + 1; l < oppCap(7); l++) {
                  const op1 = oppTop[i], op2 = oppTop[j], op3 = oppTop[k], op4 = oppTop[l];
                  if (!isBalanced([mp.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                  if (!packageOk([op1, op2, op3, op4])) continue;
                  if (!qbSafe([mp])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp], [op1, op2, op3, op4])) continue;
                  const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, op3.value, op4.value]);
                  results.push({
                    give: [mp], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp], [op1, op2, op3, op4]),
                    net: op1.value + op2.value + op3.value + op4.value - mp.value - adj, format: "1 for 4",
                  });
                }
              }
            }
          }
        }

        // 2v1
        for (let i = 0; i < myCap(9); i++) {
          for (let j = i + 1; j < myCap(9); j++) {
            for (const op of oppTop) {
              const mp1 = myTop[i], mp2 = myTop[j];
              if (!isBalanced([mp1.value, mp2.value], [op.value])) continue;
              if (!packageOk([mp1, mp2])) continue;
              if (!qbSafe([mp1, mp2])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
              const adj = tradeWaiverAdj([mp1.value, mp2.value], [op.value]);
              results.push({
                give: [mp1, mp2], receive: [op], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp1, mp2], [op]),
                net: op.value + adj - mp1.value - mp2.value, format: "2 for 1",
              });
            }
          }
        }

        // 2v2
        for (let i = 0; i < myCap(8); i++) {
          for (let j = i + 1; j < myCap(8); j++) {
            for (let k = 0; k < oppCap(8); k++) {
              for (let l = k + 1; l < oppCap(8); l++) {
                const mp1 = myTop[i], mp2 = myTop[j];
                const op1 = oppTop[k], op2 = oppTop[l];
                if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value])) continue;
                if (!packageOk([mp1, mp2])) continue;
                if (!packageOk([op1, op2])) continue;
                if (!qbSafe([mp1, mp2])) continue;
                if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2])) continue;
                results.push({
                  give: [mp1, mp2], receive: [op1, op2], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op1, op2]),
                  net: op1.value + op2.value - mp1.value - mp2.value, format: "2 for 2",
                });
              }
            }
          }
        }

        // 2v3
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = 0; k < oppCap(7); k++) {
              for (let l = k + 1; l < oppCap(7); l++) {
                for (let m = l + 1; m < oppCap(7); m++) {
                  const mp1 = myTop[i], mp2 = myTop[j];
                  const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m];
                  if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value])) continue;
                  if (!packageOk([mp1, mp2])) continue;
                  if (!packageOk([op1, op2, op3])) continue;
                  if (!qbSafe([mp1, mp2])) continue;
                  if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                  if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3])) continue;
                  const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value]);
                  results.push({
                    give: [mp1, mp2], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                    score: posScore([mp1, mp2], [op1, op2, op3]),
                    net: op1.value + op2.value + op3.value - mp1.value - mp2.value - adj, format: "2 for 3",
                  });
                }
              }
            }
          }
        }

        // 2v4
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = 0; k < oppCap(7); k++) {
              for (let l = k + 1; l < oppCap(7); l++) {
                for (let m = l + 1; m < oppCap(7); m++) {
                  for (let n = m + 1; n < oppCap(7); n++) {
                    const mp1 = myTop[i], mp2 = myTop[j];
                    const op1 = oppTop[k], op2 = oppTop[l], op3 = oppTop[m], op4 = oppTop[n];
                    if (!isBalanced([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                    if (!packageOk([mp1, mp2])) continue;
                    if (!packageOk([op1, op2, op3, op4])) continue;
                    if (!qbSafe([mp1, mp2])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op1, op2, op3, op4])) continue;
                    const adj = tradeWaiverAdj([mp1.value, mp2.value], [op1.value, op2.value, op3.value, op4.value]);
                    results.push({
                      give: [mp1, mp2], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2], [op1, op2, op3, op4]),
                      net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - adj, format: "2 for 4",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v3
        for (let i = 0; i < myCap(7); i++) {
          for (let j = i + 1; j < myCap(7); j++) {
            for (let k = j + 1; k < myCap(7); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!packageOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(7); a++) {
                for (let b = a + 1; b < oppCap(7); b++) {
                  for (let c = b + 1; c < oppCap(7); c++) {
                    const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c];
                    if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value])) continue;
                    if (!packageOk([op1, op2, op3])) continue;
                    if (!oppQbSafe(oppPlayers, [op1, op2, op3])) continue;
                    if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3])) continue;
                    results.push({
                      give: [mp1, mp2, mp3], receive: [op1, op2, op3], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                      score: posScore([mp1, mp2, mp3], [op1, op2, op3]),
                      net: op1.value + op2.value + op3.value - mp1.value - mp2.value - mp3.value, format: "3 for 3",
                    });
                  }
                }
              }
            }
          }
        }

        // 3v4
        for (let i = 0; i < myCap(6); i++) {
          for (let j = i + 1; j < myCap(6); j++) {
            for (let k = j + 1; k < myCap(6); k++) {
              const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k];
              if (!packageOk([mp1, mp2, mp3])) continue;
              if (!qbSafe([mp1, mp2, mp3])) continue;
              for (let a = 0; a < oppCap(6); a++) {
                for (let b = a + 1; b < oppCap(6); b++) {
                  for (let c = b + 1; c < oppCap(6); c++) {
                    for (let d = c + 1; d < oppCap(6); d++) {
                      const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                      if (!isBalanced([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                      if (!packageOk([op1, op2, op3, op4])) continue;
                      if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                      if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3], [op1, op2, op3, op4])) continue;
                      const adj = tradeWaiverAdj([mp1.value, mp2.value, mp3.value], [op1.value, op2.value, op3.value, op4.value]);
                      results.push({
                        give: [mp1, mp2, mp3], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                        score: posScore([mp1, mp2, mp3], [op1, op2, op3, op4]),
                        net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - adj, format: "3 for 4",
                      });
                    }
                  }
                }
              }
            }
          }
        }

        // 4v4
        for (let i = 0; i < myCap(6); i++) {
          for (let j = i + 1; j < myCap(6); j++) {
            for (let k = j + 1; k < myCap(6); k++) {
              for (let l = k + 1; l < myCap(6); l++) {
                const mp1 = myTop[i], mp2 = myTop[j], mp3 = myTop[k], mp4 = myTop[l];
                if (!packageOk([mp1, mp2, mp3, mp4])) continue;
                if (!qbSafe([mp1, mp2, mp3, mp4])) continue;
                for (let a = 0; a < oppCap(6); a++) {
                  for (let b = a + 1; b < oppCap(6); b++) {
                    for (let c = b + 1; c < oppCap(6); c++) {
                      for (let d = c + 1; d < oppCap(6); d++) {
                        const op1 = oppTop[a], op2 = oppTop[b], op3 = oppTop[c], op4 = oppTop[d];
                        if (!isBalanced([mp1.value, mp2.value, mp3.value, mp4.value], [op1.value, op2.value, op3.value, op4.value])) continue;
                        if (!packageOk([op1, op2, op3, op4])) continue;
                        if (!oppQbSafe(oppPlayers, [op1, op2, op3, op4])) continue;
                        if (!oppReceiveOk(oppPlayers, [mp1, mp2, mp3, mp4], [op1, op2, op3, op4])) continue;
                        results.push({
                          give: [mp1, mp2, mp3, mp4], receive: [op1, op2, op3, op4], givePicks: [], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                          score: posScore([mp1, mp2, mp3, mp4], [op1, op2, op3, op4]),
                          net: op1.value + op2.value + op3.value + op4.value - mp1.value - mp2.value - mp3.value - mp4.value, format: "4 for 4",
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        }

        const myEqualizerPicks = myFinderPicks.slice(0, 4);
        const oppEqualizerPicks = oppPicks.slice(0, 4);

        // 1 + your pick for 1
        for (const mp of myTop) {
          for (const myPick of myEqualizerPicks) {
            for (const op of oppTop) {
              if (!isBalanced([mp.value, myPick.value], [op.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value, myPick.value], [op.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + adj - mp.value - myPick.value, format: "1 + pick for 1",
              });
            }
          }
        }

        // 2 + your pick for 1
        for (let i = 0; i < Math.min(myTop.length, 7); i++) {
          for (let j = i + 1; j < Math.min(myTop.length, 7); j++) {
            const mp1 = myTop[i], mp2 = myTop[j];
            if (!packageOk([mp1, mp2])) continue;
            if (!qbSafe([mp1, mp2])) continue;
            for (const myPick of myEqualizerPicks) {
              for (const op of oppTop) {
                if (!isBalanced([mp1.value, mp2.value, myPick.value], [op.value])) continue;
                if (!oppQbSafe(oppPlayers, [op])) continue;
                if (!oppReceiveOk(oppPlayers, [mp1, mp2], [op])) continue;
                const adj = tradeWaiverAdj([mp1.value, mp2.value, myPick.value], [op.value]);
                results.push({
                  give: [mp1, mp2], receive: [op], givePicks: [myPick], receivePicks: [], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp1, mp2], [op]),
                  net: op.value + adj - mp1.value - mp2.value - myPick.value, format: "2 + pick for 1",
                });
              }
            }
          }
        }

        // 1 for 1 + their pick
        for (const mp of myTop) {
          for (const op of oppTop) {
            for (const oppPick of oppEqualizerPicks) {
              if (!isBalanced([mp.value], [op.value, oppPick.value])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op])) continue;
              const adj = tradeWaiverAdj([mp.value], [op.value, oppPick.value]);
              results.push({
                give: [mp], receive: [op], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                score: posScore([mp], [op]),
                net: op.value + oppPick.value - mp.value - adj, format: "1 for 1 + pick",
              });
            }
          }
        }

        // 1 for 2 + their pick
        for (const mp of myTop) {
          for (let i = 0; i < oppCap(8); i++) {
            for (let j = i + 1; j < oppCap(8); j++) {
              const op1 = oppTop[i], op2 = oppTop[j];
              if (!packageOk([op1, op2])) continue;
              if (!qbSafe([mp])) continue;
              if (!oppQbSafe(oppPlayers, [op1, op2])) continue;
              if (!oppReceiveOk(oppPlayers, [mp], [op1, op2])) continue;
              for (const oppPick of oppEqualizerPicks) {
                if (!isBalanced([mp.value], [op1.value, op2.value, oppPick.value])) continue;
                const adj = tradeWaiverAdj([mp.value], [op1.value, op2.value, oppPick.value]);
                results.push({
                  give: [mp], receive: [op1, op2], givePicks: [], receivePicks: [oppPick], oppName, oppRosterId: oppRoster.roster_id,
                  score: posScore([mp], [op1, op2]),
                  net: op1.value + op2.value + oppPick.value - mp.value - adj, format: "1 for 2 + pick",
                });
              }
            }
          }
        }

        // ── Lottery ticket trades for this opponent ───────────────────────────
        // Any player outside the top ~150 dynasty value (< 700) who is young enough
        // to have breakout upside, traded for one of my 3rd+ round picks.
        // Disposition guards: skip "Zero Interest" receives and "Not Willing to Trade" gives.
        const FINDER_LOTTERY_CEILING = 700;
        const myLotteryFinderPicks = myFinderPicks.filter((p: any) =>
          Number(p.round) >= 3
        );
        const oppLotteryPlayers = oppPlayers.filter((p: any) => {
          if (isBlockedBuyDisposition(p.player_id)) return false;
          const age = Number(p.age || 99);
          const val = Number(p.value || 0);
          if (val < 60 || val >= FINDER_LOTTERY_CEILING) return false;
          if (p.position === "RB" && age > 23) return false;
          if (p.position === "QB" && age > 26) return false;
          if (["WR", "TE"].includes(p.position) && age > 27) return false;
          return true;
        });
        for (const lp of oppLotteryPlayers) {
          for (const myPick of myLotteryFinderPicks) {
            if (playerDispositions[myPick.player_id]?.sell === "Not Willing to Trade") continue;
            const ratio = lp.value / Math.max(myPick.value, 1);
            if (ratio < 0.25 || ratio > 2.0) continue;
            results.push({
              give: [], receive: [lp], givePicks: [myPick], receivePicks: [],
              oppName, oppRosterId: oppRoster.roster_id,
              score: posScore([], [lp]) * 0.6, // softer posScore weight for lottery
              net: lp.value - myPick.value,
              format: "Lottery",
            });
          }
        }
      }

      const getSortedIds = (items: any[], getId: (item: any) => string) =>
        items.map(getId).filter(Boolean).sort();
      const sameIds = (a: string[], b: string[]) =>
        a.length === b.length && a.every((id, index) => id === b[index]);
      const overlapRatio = (a: string[], b: string[]) => {
        if (!a.length || !b.length) return 0;
        const bSet = new Set(b);
        const overlap = a.filter((id) => bSet.has(id)).length;
        return overlap / Math.min(a.length, b.length);
      };
      const getTradeSimilarityProfile = (trade: any) => {
        const givePlayers = getSortedIds(trade.give, (p: any) => String(p.player_id));
        const receivePlayers = getSortedIds(trade.receive, (p: any) => String(p.player_id));
        const givePicks = getSortedIds(trade.givePicks, (p: any) => finderPickKey(p));
        const receivePicks = getSortedIds(trade.receivePicks, (p: any) => finderPickKey(p));
        return {
          givePlayers,
          receivePlayers,
          givePicks,
          receivePicks,
          allAssets: [
            ...givePlayers.map((id) => `give-player-${id}`),
            ...receivePlayers.map((id) => `receive-player-${id}`),
            ...givePicks.map((id) => `give-pick-${id}`),
            ...receivePicks.map((id) => `receive-pick-${id}`),
          ].sort(),
        };
      };
      const areTradesTooSimilar = (a: any, b: any) => {
        if (String(a.oppRosterId) !== String(b.oppRosterId)) return false;

        const aProfile = getTradeSimilarityProfile(a);
        const bProfile = getTradeSimilarityProfile(b);
        const sameFormat = a.format === b.format;
        const sameReceivePlayers = sameIds(aProfile.receivePlayers, bProfile.receivePlayers);
        const sameGivePlayers = sameIds(aProfile.givePlayers, bProfile.givePlayers);
        const sameReceivePackage = sameReceivePlayers && sameIds(aProfile.receivePicks, bProfile.receivePicks);
        const sameGivePackage = sameGivePlayers && sameIds(aProfile.givePicks, bProfile.givePicks);
        const givePlayerOverlap = overlapRatio(aProfile.givePlayers, bProfile.givePlayers);
        const receivePlayerOverlap = overlapRatio(aProfile.receivePlayers, bProfile.receivePlayers);
        const fullAssetOverlap = overlapRatio(aProfile.allAssets, bProfile.allAssets);

        if (sameFormat && sameReceivePlayers && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePlayers && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameReceivePackage && givePlayerOverlap >= 0.5) return true;
        if (sameFormat && sameGivePackage && receivePlayerOverlap >= 0.5) return true;
        if (sameFormat && fullAssetOverlap >= 0.75) return true;
        return false;
      };

      // Deduplicate by player set, filter near-duplicate frameworks, enforce per-player and per-opponent appearance caps, take 15
      const seen = new Set<string>();
      const playerCount: Record<string, number> = {};
      const oppCount: Record<string, number> = {};
      // Seeded shuffle so Refresh button produces a new random set
      const shuffled = results
        .filter((r) => isFinite(r.score))
        .filter((r) => !r.give.some((p: any) => isBlockedSellDisposition(p.player_id)))
        .filter((r) => !r.receive.some((p: any) => isBlockedBuyDisposition(p.player_id)))
        .filter((r) => !pinnedPlayer || r.give.some((p: any) => p.player_id === pinnedPlayer.player_id))
        .filter((r) => !finderTargetPlayerId || r.receive.some((p: any) => p.player_id === finderTargetPlayerId))
        .filter((r) => !failsDirectionGuardrail(r))
        .map((r) => {
          const lineupSafety = getTradeLineupSafety(r);
          const partnerProfile = leagueMateProfileByRosterId.get(Number(r.oppRosterId));
          const bucketPriority = draftCapitalMode && r.receivePicks.length > 0
            ? Math.min(...r.receivePicks.map((p: any) => draftYearPriority[p.season] ?? 999))
            : 999;
          const partnerFitScore =
            (partnerProfile?.fitScore ?? 0) * 0.65 +
            Math.min(partnerProfile?.tradeCount30d ?? 0, 3) * 1.5 +
            Math.min(partnerProfile?.totalDynastyLeagues ?? 0, 8) * 0.35;
          // Disposition scoring: combines deal-probability weighting with direction-aware bonuses/penalties.
          // Example: "Will Trade but Higher than Market" (sell high) in give side + value-negative trade
          // gets a heavy penalty — the user wants a premium, not a discount.
          // "Buy Low" in receive side + value-negative trade = overpaying for something they wanted cheap.
          const sellScoreMap: Record<string, number> = {
            "Trade at All Costs": 4, "Lower than Market": 2, "Neutral": 1,
            "Will Trade but Higher than Market": -1,
          };
          const buyScoreMap: Record<string, number> = {
            "Buy Over Market": 4, "Buy at Market": 2, "Neutral": 1, "Buy Low": -1,
          };
          const dispositionScore = (() => {
            let ds = 0;
            // Base probability scores
            ds += r.give.reduce((s: number, gp: any) =>
              s + (sellScoreMap[playerDispositions[gp.player_id]?.sell ?? "Neutral"] ?? 0), 0);
            ds += r.receive.reduce((s: number, rp: any) =>
              s + (buyScoreMap[playerDispositions[rp.player_id]?.buy ?? "Neutral"] ?? 0), 0);
            // Direction-aware: disposition tags also mean "only do this deal in the RIGHT direction"
            // "Sell High" given away at a loss contradicts the tag — penalize hard
            const sellHighGiven = r.give.filter((gp: any) =>
              playerDispositions[gp.player_id]?.sell === "Will Trade but Higher than Market"
            ).length;
            if (sellHighGiven > 0 && r.net < -150) ds -= sellHighGiven * 8; // losing value, bad
            if (sellHighGiven > 0 && r.net >= 0)   ds += sellHighGiven * 4;  // gaining value, good
            // "Buy Low" received while overpaying contradicts the tag — penalize hard
            const buyLowReceived = r.receive.filter((rp: any) =>
              playerDispositions[rp.player_id]?.buy === "Buy Low"
            ).length;
            if (buyLowReceived > 0 && r.net < -150) ds -= buyLowReceived * 8; // overpaying, bad
            if (buyLowReceived > 0 && r.net >= 0)   ds += buyLowReceived * 5;  // getting them cheap, perfect
            return ds;
          })();
          const strategyScore = r.score + getDirectionTradeScore(r) + lineupSafety.score + partnerFitScore + dispositionScore;
          return {
            r,
            lineupSafety,
            partnerProfile,
            bucketPriority,
            strategyScore,
            sort: Math.abs(Math.sin(finderSeed * (results.indexOf(r) + 1)) * 10000) % 1,
          };
        })
        .filter(({ lineupSafety }) => lineupSafety.valid)
        .sort((a, b) => {
          if (a.bucketPriority !== b.bucketPriority) return a.bucketPriority - b.bucketPriority;
          if (b.strategyScore !== a.strategyScore) return b.strategyScore - a.strategyScore;
          return a.sort - b.sort;
        })
        .map(({ r }) => r);
      const top15 = shuffled.reduce((acc: any[], r) => {
          const allIds = [
            ...r.give.map((p: any) => `player-${p.player_id}`),
            ...r.receive.map((p: any) => `player-${p.player_id}`),
            ...r.givePicks.map((p: any) => `pick-${finderPickKey(p)}`),
            ...r.receivePicks.map((p: any) => `pick-${finderPickKey(p)}`),
          ];
          const key = [...allIds].sort().join(",");
          if (seen.has(key)) return acc;
          if (acc.some((existing: any) => areTradesTooSimilar(existing, r))) return acc;
          // Each player may appear in at most 4 shown trades (pinned player is exempt)
          if (allIds.some((pid) => pid !== `player-${finderPinnedPlayerId}` && (playerCount[pid] || 0) >= 4)) return acc;
          // Each opponent may appear in at most 4 shown trades
          const oppKey = String(r.oppRosterId);
          if ((oppCount[oppKey] || 0) >= 4) return acc;
          seen.add(key);
          allIds.forEach((pid) => { playerCount[pid] = (playerCount[pid] || 0) + 1; });
          oppCount[oppKey] = (oppCount[oppKey] || 0) + 1;
          acc.push(r);
          return acc.length >= 15 ? acc : acc;
        }, [])
        .slice(0, 15);

      return (
        <div className="space-y-4">
          {/* ── Player pin search ── */}
          <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4 space-y-2">
            {finderDirectionProfile && (
              <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Direction Engine</div>
                    <div className="mt-1 text-sm text-gray-200">{finderDirectionProfile.summary}</div>
                  </div>
                  <span className={`inline-flex text-[10px] font-semibold px-2 py-1 rounded-full border self-start ${finderDirectionProfile.bucketColor}`}>
                    {finderDirectionProfile.bucket}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {finderDirectionProfile.actions.map((action: string) => (
                    <span key={action} className="rounded-full border border-blue-800 bg-blue-950/40 px-3 py-1 text-[11px] text-blue-200">
                      {action}
                    </span>
                  ))}
                </div>
                {selectedLeagueMateProfilesView.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Best Partner Targets</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {selectedLeagueMateProfilesView.slice(0, 3).map((mate: any) => (
                        <button
                          key={mate.rosterId}
                          onClick={() => setFinderTargetOppRosterId(Number(mate.rosterId))}
                          className="rounded-full border border-cyan-800 bg-cyan-950/30 px-3 py-1 text-[11px] text-cyan-200 transition hover:border-cyan-500"
                        >
                          {mate.ownerName} • {mate.fitLabel}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Find trades involving a specific player</p>
            <div className="flex items-center justify-between gap-3 rounded-lg bg-gray-800/70 px-3 py-2">
              <div>
                <div className="text-sm font-medium text-white">Draft Capital Mode</div>
                <div className="text-[11px] text-gray-400">
                  Current direction: <span className="text-gray-300">{finderDirection}</span>. {finderDirectionProfile?.shortAction || "When on, Finder can turn roster talent into picks while still respecting opponent fit rules."}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFinderDraftCapitalMode((prev) => !prev)}
                aria-pressed={finderDraftCapitalMode}
                className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full border transition ${
                  finderDraftCapitalMode ? "border-blue-500 bg-blue-600/80" : "border-gray-700 bg-gray-700"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 rounded-full bg-white transition ${
                    finderDraftCapitalMode ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
            {pinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{pinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{pinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{pinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderPinnedPlayerId(null); setFinderPlayerSearch(""); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderPlayerSearch}
                  onChange={(e) => { setFinderPlayerSearch(e.target.value); setFinderPinnedPlayerId(null); }}
                  placeholder="Search your roster…"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {searchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {searchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderPinnedPlayerId(p.player_id); setFinderPlayerSearch(""); setFinderSeed(Math.random()); }}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{p.full_name}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── Owner filter dropdown ── */}
            <select
              value={finderTargetOppRosterId ?? ""}
              onChange={(e) => {
                const val = e.target.value ? Number(e.target.value) : null;
                setFinderTargetOppRosterId(val);
                setFinderTargetPlayerId(null);
                setFinderTargetPlayerSearch("");
                setFinderSeed(Math.random());
              }}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              <option value="">Trade with any owner…</option>
              {rosters
                .filter((r: any) => r.owner_id !== user?.user_id)
                .slice()
                .sort((a: any, b: any) =>
                  ((users as any)[a.owner_id] || "").localeCompare((users as any)[b.owner_id] || "")
                )
                .map((r: any) => (
                  <option key={r.roster_id} value={r.roster_id}>
                    {(users as any)[r.owner_id] || `Team ${r.roster_id}`}
                  </option>
                ))}
            </select>

            {/* ── Target player (want to receive) search ── */}
            {targetPinnedPlayer ? (
              <div className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">Want to receive</span>
                  <span className="text-sm text-white font-medium">{targetPinnedPlayer.full_name}</span>
                  <span className="text-[10px] text-gray-500 uppercase">{targetPinnedPlayer.position}</span>
                  <span className="text-xs text-gray-500 font-mono">{targetPinnedPlayer.value.toLocaleString()}</span>
                </div>
                <button
                  onClick={() => { setFinderTargetPlayerId(null); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
                  className="text-xs text-gray-500 hover:text-red-400 transition ml-3"
                >
                  ✕ Clear
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={finderTargetPlayerSearch}
                  onChange={(e) => { setFinderTargetPlayerSearch(e.target.value); setFinderTargetPlayerId(null); }}
                  placeholder={finderTargetOppRosterId ? "Search their roster for a player to receive…" : "Search league for a player you want to receive…"}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
                {targetSearchMatches.length > 0 && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg overflow-hidden shadow-xl">
                    {targetSearchMatches.map((p: any) => (
                      <button
                        key={p.player_id}
                        onClick={() => { setFinderTargetPlayerId(p.player_id); setFinderTargetPlayerSearch(""); setFinderSeed(Math.random()); }}
                        className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-700 transition text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-white">{p.full_name}</span>
                          <span className="text-[10px] text-gray-500 uppercase">{p.position}</span>
                        </div>
                        <span className="text-xs text-gray-400 font-mono">{p.value.toLocaleString()}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">
              {pinnedPlayer
                ? <>Trades involving <strong className="text-gray-300">{pinnedPlayer.full_name}</strong> for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
                : <>Random trade suggestions for <strong className="text-gray-300">{selectedLeague.name}</strong>.</>
              }
              {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
            </p>
            <button
              onClick={() => setFinderSeed(Math.random())}
              className="text-xs font-semibold text-blue-400 hover:text-blue-300 border border-blue-700 hover:border-blue-500 rounded-lg px-3 py-1.5 transition shrink-0 ml-3"
            >
              Refresh
            </button>
          </div>
          {top15.length === 0 && (
            <p className="text-gray-400 text-sm">
              {pinnedPlayer
                ? `No balanced trades found involving ${pinnedPlayer.full_name}. Try a different player or hit Refresh.`
                : draftCapitalMode
                ? "No balanced draft-capital trades found. Try Refresh, pin a player you want to move, or turn Draft Capital Mode off."
                : "No balanced trades found. You can still turn Draft Capital Mode on above to look for pick-return deals."
              }
            </p>
          )}
          {top15.map((trade: TradeResult, idx: number) => {
            const partnerProfile = leagueMateProfileByRosterId.get(Number(trade.oppRosterId));
            const tradeIntent = getTradeIntent(trade);
            const giveVals = [...trade.give.map((p: any) => p.value), ...trade.givePicks.map((p: any) => p.value)];
            const receiveVals = [...trade.receive.map((p: any) => p.value), ...trade.receivePicks.map((p: any) => p.value)];
            const giveTotal = giveVals.reduce((s: number, v: number) => s + v, 0);
            const receiveTotal = receiveVals.reduce((s: number, v: number) => s + v, 0);
            const giveCount = giveVals.length;
            const recCount = receiveVals.length;
            const cardAdj = giveCount !== recCount
              ? tradeWaiverAdj(giveVals, receiveVals)
              : 0;
            // give>receive → waiver credit added to receive; receive>give → waiver credit added to give
            const adjOnGive = recCount > giveCount ? cardAdj : 0;
            const adjOnReceive = giveCount > recCount ? cardAdj : 0;
            const giveTotalAdj = giveTotal + adjOnGive;
            const receiveTotalAdj = receiveTotal + adjOnReceive;
            const netDisplay = Math.abs(trade.net);
            const isEven = netDisplay <= 100;
            return (
              <div key={idx} className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">{trade.format}</span>
                    <span className="text-xs text-gray-500">with</span>
                    <span className="text-sm font-semibold text-blue-300">{trade.oppName}</span>
                    <span className="rounded-full border border-violet-800 bg-violet-950/30 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
                      {tradeIntent.label}
                    </span>
                    {partnerProfile?.fitLabel && (
                      <span className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] font-semibold text-cyan-300">
                        {partnerProfile.fitLabel}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isEven ? "bg-yellow-900 text-yellow-300" : trade.net > 0 ? "bg-green-900 text-green-300" : "bg-red-900 text-red-300"}`}>
                    {isEven ? "EVEN" : trade.net > 0 ? `+${netDisplay.toLocaleString()}` : `-${netDisplay.toLocaleString()}`}
                  </span>
                </div>
                {partnerProfile?.fitReasons?.[0] && (
                  <div className="mb-3 text-xs text-gray-500">
                    {tradeIntent.detail} {partnerProfile.fitReasons[0] ? `• ${partnerProfile.fitReasons[0]}` : ""}
                  </div>
                )}
                {!partnerProfile?.fitReasons?.[0] && (
                  <div className="mb-3 text-xs text-gray-500">
                    {tradeIntent.detail}
                  </div>
                )}
                {(partnerProfile?.repeatedPlayers?.length > 0 || partnerProfile?.acquiredPlayers?.length > 0 || partnerProfile?.tradePreferenceLabel) && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {partnerProfile?.tradePreferenceLabel && (
                      <span className="rounded-full border border-amber-800 bg-amber-950/20 px-2 py-0.5 text-[10px] text-amber-200">
                        {partnerProfile.tradePreferenceLabel}
                      </span>
                    )}
                    {partnerProfile.repeatedPlayers.slice(0, 2).map((player: any) => (
                      <span key={player.playerId} className="rounded-full border border-cyan-800 bg-cyan-950/30 px-2 py-0.5 text-[10px] text-cyan-200">
                        Likes {player.name}
                      </span>
                    ))}
                    {partnerProfile?.acquiredPlayers?.slice(0, 1).map((player: any) => (
                      <span key={`recent-${player.playerId}`} className="rounded-full border border-emerald-800 bg-emerald-950/30 px-2 py-0.5 text-[10px] text-emerald-200">
                        Recently Bought {player.name}
                      </span>
                    ))}
                  </div>
                )}
                {/* Trade columns */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-red-400 mb-1.5">You Give</div>
                    <div className="space-y-1">
                      {trade.give.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {trade.givePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnGive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnGive.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-gray-600 text-right pr-1">Total: {giveTotalAdj.toLocaleString()}</div>
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-green-400 mb-1.5">You Receive</div>
                    <div className="space-y-1">
                      {trade.receive.map((p: any) => (
                        <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button onClick={() => setPlayerProfileId(p.player_id)} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                            <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {trade.receivePicks.map((p: any) => (
                        <div key={finderPickKey(p)} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="text-xs text-white truncate">{finderPickLabel(p)}</span>
                            <span className="text-[10px] text-gray-500 shrink-0">PICK</span>
                          </div>
                          <span className="text-xs text-gray-400 font-mono shrink-0 ml-1">{p.value.toLocaleString()}</span>
                        </div>
                      ))}
                      {adjOnReceive > 0 && (
                        <div className="flex items-center justify-between px-2 py-1">
                          <span className="text-[10px] text-gray-500 italic">Waiver Adjustment</span>
                          <span className="text-[10px] text-blue-400 font-mono">+{adjOnReceive.toLocaleString()}</span>
                        </div>
                      )}
                      <div className="text-[10px] text-gray-600 text-right pr-1">Total: {receiveTotalAdj.toLocaleString()}</div>
                    </div>
                  </div>
                </div>
                {/* Send to Calculator */}
                <button
                  onClick={() => {
                    setCalcOpponentRosterId(trade.oppRosterId);
                    setCalcGive(trade.give.map((p: any) => p.player_id));
                    setCalcReceive(trade.receive.map((p: any) => p.player_id));
                    setCalcGivePicks(trade.givePicks.map((p: any) => finderPickKey(p)));
                    setCalcReceivePicks(trade.receivePicks.map((p: any) => finderPickKey(p)));
                    setCalcSearchA("");
                    setCalcSearchB("");
                    setTradeHubSection("CALCULATOR");
                  }}
                  className="mt-3 w-full text-xs text-gray-500 hover:text-blue-400 border border-gray-700 hover:border-blue-500 rounded-lg py-1.5 transition"
                >
                  Open in Trade Calculator →
                </button>
              </div>
            );
          })}
        </div>
      );
    })()}

    {tradeHubSection === "RECOMMENDATIONS" && (() => {
      if (!selectedLeague) return (
        <p className="text-gray-400 text-sm">Select a league from the dropdown above to view recommendations.</p>
      );
      if (tradeRecommendationCards.length === 0) return (
        <p className="text-gray-400 text-sm">Recommendations are still building. Load a league and values first, then come back here.</p>
      );

      const renderAsset = (asset: any) => {
        if (!asset) return null;
        if ("expectedValue" in asset && asset.season) {
          const isSlotted = asset.slot && String(asset.slot).includes(".");
          const pickTitle = isSlotted
            ? `${asset.season} ${asset.slot}`
            : `${asset.season} Rd ${asset.round}${asset.expectedSlot != null ? ` · Predicted Slot ${asset.expectedSlot}` : ""}`;
          return (
            <div key={`${asset.season}-${asset.round}-${asset.roster_id}`} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm text-white">{pickTitle}</div>
                <div className="text-[11px] text-gray-500">{asset.label}</div>
              </div>
              <div className="text-xs font-mono text-blue-300">{asset.expectedValue.toLocaleString()}</div>
            </div>
          );
        }
        return (
          <div key={asset.player_id} className="flex items-center justify-between rounded-lg bg-gray-800 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm text-white">{asset.full_name}</div>
              <div className="text-[11px] text-gray-500">{asset.position} • {asset.team || "FA"}</div>
            </div>
            <div className="text-xs font-mono text-gray-300">{(asset.dynValue ?? asset.value ?? 0).toLocaleString()}</div>
          </div>
        );
      };

      // ── Trend-based trade suggestions ──────────────────────────────────────
      const trendTrades: Array<{
        type: "sell-window" | "buy-window";
        giveId: string; receiveId: string;
        giveVal: number; receiveVal: number;
        givePct: number; receivePct: number;
        partnerName: string;
      }> = [];

      if (historicalSnapshot) {
        const tMap = new Map<string, number>();
        Object.entries(historicalSnapshot.players).forEach(([pid, sd]: [string, any]) => {
          const cv = calcFcValues[pid] ?? 0;
          const sv = Number(sd.value ?? 0);
          if (sv > 0 && cv > 0) tMap.set(pid, ((cv - sv) / sv) * 100);
        });

        const myRoster = rosters.find((r: any) => r.owner_id === user?.user_id);
        const mySet = new Set<string>(myRoster?.players ?? []);
        const partnerRosters = rosters.filter((r: any) => r.owner_id && r.owner_id !== user?.user_id);
        const MIN_VAL = 1500;
        const R_MIN = 0.72, R_MAX = 1.35;
        const usedGA = new Set<string>(), usedRA = new Set<string>();
        const usedGB = new Set<string>(), usedRB = new Set<string>();

        // Sell Window: give my −5%+ fallers → receive ANY fair-value player from the partner
        const mySell = [...mySet]
          .map((id) => ({ id, pct: tMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
          .filter((x) => x.pct <= -5 && x.val >= MIN_VAL)
          .sort((a, b) => a.pct - b.pct);

        outerSell: for (const mine of mySell) {
          if (trendTrades.filter((t) => t.type === "sell-window").length >= 5) break;
          if (usedGA.has(mine.id)) continue;
          for (const pr of partnerRosters) {
            if (trendTrades.filter((t) => t.type === "sell-window").length >= 5) break outerSell;
            // Any partner player at fair value — no trend filter, sorted by closest value
            const cands = ((pr.players ?? []) as string[])
              .map((id) => ({ id, pct: tMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
              .filter((x) => x.val >= MIN_VAL && !usedRA.has(x.id))
              .sort((a, b) => Math.abs(a.val - mine.val) - Math.abs(b.val - mine.val));
            for (const theirs of cands) {
              const ratio = mine.val / theirs.val;
              if (ratio < R_MIN || ratio > R_MAX) continue;
              if (!players[mine.id] || !players[theirs.id]) continue;
              usedGA.add(mine.id); usedRA.add(theirs.id);
              trendTrades.push({
                type: "sell-window",
                giveId: mine.id, receiveId: theirs.id,
                giveVal: mine.val, receiveVal: theirs.val,
                givePct: mine.pct, receivePct: theirs.pct,
                partnerName: users[pr.owner_id] || `Team ${pr.roster_id}`,
              });
              break;
            }
          }
        }

        // Buy Window: target partner's +5%+ rising players → give ANY of my fair-value roster players
        const myGivePool = [...mySet]
          .map((id) => ({ id, pct: tMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
          .filter((x) => x.val >= MIN_VAL);

        outerBuy: for (const pr of partnerRosters) {
          if (trendTrades.filter((t) => t.type === "buy-window").length >= 5) break;
          const partnerRising = ((pr.players ?? []) as string[])
            .filter((id) => !mySet.has(id))
            .map((id) => ({ id, pct: tMap.get(id) ?? 0, val: calcFcValues[id] ?? 0 }))
            .filter((x) => x.pct >= 5 && x.val >= MIN_VAL && !usedRB.has(x.id))
            .sort((a, b) => b.pct - a.pct);
          for (const theirs of partnerRising) {
            if (trendTrades.filter((t) => t.type === "buy-window").length >= 5) break outerBuy;
            const giveCand = myGivePool
              .filter((x) => !usedGB.has(x.id))
              .sort((a, b) => Math.abs(a.val - theirs.val) - Math.abs(b.val - theirs.val))
              .find((x) => { const r = x.val / theirs.val; return r >= R_MIN && r <= R_MAX; });
            if (!giveCand) continue;
            if (!players[giveCand.id] || !players[theirs.id]) continue;
            usedGB.add(giveCand.id); usedRB.add(theirs.id);
            trendTrades.push({
              type: "buy-window",
              giveId: giveCand.id, receiveId: theirs.id,
              giveVal: giveCand.val, receiveVal: theirs.val,
              givePct: giveCand.pct, receivePct: theirs.pct,
              partnerName: users[pr.owner_id] || `Team ${pr.roster_id}`,
            });
          }
        }
      }

      const sellTrades = trendTrades.filter((t) => t.type === "sell-window");
      const buyTrades  = trendTrades.filter((t) => t.type === "buy-window");

      return (
        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Advanced Trade Recommendations</div>
            <div className="mt-1 text-sm text-gray-200">
              These recommendations now stack partner ranking, simulated team outlook, and pick-value distributions into concrete trade paths and opening angles.
            </div>
          </div>

          <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Partner Board</div>
            <div className="mt-3 grid gap-2 lg:grid-cols-2">
              {tradePartnerRankings.slice(0, 6).map((partner: any) => (
                <div key={partner.rosterId} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{partner.ownerName}</div>
                      <div className="text-[11px] text-gray-500">{partner.fitLabel} • {partner.bestApproach}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-blue-300">{partner.rankScore}</div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-500">Partner Score</div>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-gray-300">
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Playoffs {Math.round(partner.playoffOdds || 0)}%</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Title {Math.round(partner.titleOdds || 0)}%</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">Finish {partner.finishRange}</span>
                    <span className="rounded-full border border-gray-700 bg-gray-900 px-2 py-0.5">1.01 {Math.round(partner.oneOhOneOdds || 0)}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Trend-based trade suggestions ── */}
          {(sellTrades.length > 0 || buyTrades.length > 0) && (
            <>
              <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Value Trend Trades</div>
                <div className="mt-1 text-sm text-gray-200">
                  Signal-driven suggestions from your Value Trends snapshot. Sell Window trades offload your falling assets (−5%+) for any fair-value player in the league. Buy Window trades target your league mates&apos; early risers (+5%+) using any of your matching roster assets.
                </div>
              </div>

              {[...sellTrades, ...buyTrades].map((t) => {
                const isSell = t.type === "sell-window";
                const giveP  = players[t.giveId];
                const recvP  = players[t.receiveId];
                if (!giveP || !recvP) return null;
                const giveAsset = { player_id: t.giveId, full_name: giveP.full_name, position: giveP.position, team: giveP.team, dynValue: t.giveVal };
                const recvAsset = { player_id: t.receiveId, full_name: recvP.full_name, position: recvP.position, team: recvP.team, dynValue: t.receiveVal };
                const lastName = (p: any) => p?.full_name?.split(" ").slice(1).join(" ") || p?.full_name || "";
                return (
                  <div key={`trend-${t.giveId}-${t.receiveId}`} className={`rounded-2xl border p-5 ${isSell ? "border-red-900/40 bg-red-950/10" : "border-green-900/40 bg-green-950/10"}`}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`text-sm font-semibold ${isSell ? "text-red-300" : "text-green-300"}`}>
                            {isSell ? "📉 Sell Window Trade" : "📈 Buy Window Trade"}
                          </span>
                          <span className="rounded-full border border-blue-700 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                            {t.partnerName}
                          </span>
                          <span className="rounded-full border border-gray-700 bg-gray-950/60 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                            Value Trend Signal
                          </span>
                        </div>
                        <div className="mt-2 text-sm text-gray-300">
                          {isSell
                            ? `Sell ${lastName(giveP)} while down ${Math.abs(t.givePct).toFixed(0)}% and get fair value back in ${lastName(recvP)}${t.receivePct >= 5 ? ` (up ${t.receivePct.toFixed(0)}%)` : ""} before the asset drops further.`
                            : `${lastName(recvP)} is up ${t.receivePct.toFixed(0)}% — buy in now using ${lastName(giveP)}${t.givePct >= 10 ? ` (up ${t.givePct.toFixed(0)}%, sell high)` : ""} before the market catches on.`
                          }
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-center md:min-w-[200px]">
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Give Trend</div>
                          <div className={`mt-1 text-sm font-semibold ${t.givePct < 0 ? "text-red-300" : "text-green-300"}`}>
                            {t.givePct > 0 ? "+" : ""}{t.givePct.toFixed(1)}%
                          </div>
                        </div>
                        <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                          <div className="text-[10px] uppercase tracking-wide text-gray-500">Recv Trend</div>
                          <div className="mt-1 text-sm font-semibold text-green-300">+{t.receivePct.toFixed(1)}%</div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                      <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">You Give</div>
                        <div className="space-y-2">{renderAsset(giveAsset)}</div>
                        <div className="mt-2 text-right text-[11px] text-gray-500">Total {t.giveVal.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-green-400">You Receive</div>
                        <div className="space-y-2">{renderAsset(recvAsset)}</div>
                        <div className="mt-2 text-right text-[11px] text-gray-500">Total {t.receiveVal.toLocaleString()}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </>
          )}

          {tradeRecommendationCards.map((card: any) => (
            <div key={`${card.archetype}-${card.partnerName}`} className="rounded-2xl border border-gray-800 bg-gray-900 p-5">
              <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-white">{card.archetype}</span>
                    <span className="rounded-full border border-blue-700 bg-blue-950/40 px-2 py-0.5 text-[10px] font-semibold text-blue-300">
                      {card.partnerName}
                    </span>
                    <span className="rounded-full border border-gray-700 bg-gray-950/60 px-2 py-0.5 text-[10px] font-semibold text-gray-300">
                      {card.fitLabel}
                    </span>
                    <span className="rounded-full border border-emerald-700 bg-emerald-950/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                      Score {card.recommendationScore}
                    </span>
                  </div>
                  <div className="mt-2 text-sm text-gray-300">{card.summary}</div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center md:min-w-[220px]">
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Partner Playoffs</div>
                    <div className="mt-1 text-sm font-semibold text-white">{Math.round(card.partnerPlayoffOdds || 0)}%</div>
                  </div>
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-500">Package Delta</div>
                    <div className={`mt-1 text-sm font-semibold ${card.packageDelta >= 0 ? "text-green-300" : "text-red-300"}`}>
                      {card.packageDelta > 0 ? "+" : ""}{card.packageDelta.toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-red-400">You Give</div>
                  <div className="space-y-2">
                    {card.give.map((asset: any) => renderAsset(asset))}
                  </div>
                  <div className="mt-2 text-right text-[11px] text-gray-500">Total {card.giveTotal.toLocaleString()}</div>
                </div>
                <div>
                  <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-green-400">You Receive</div>
                  <div className="space-y-2">
                    {card.receive.map((asset: any) => renderAsset(asset))}
                  </div>
                  <div className="mt-2 text-right text-[11px] text-gray-500">Total {card.receiveTotal.toLocaleString()}</div>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-blue-400">Why You Do It</div>
                  <div className="mt-1 text-xs text-gray-300">{card.whyYou}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-orange-400">Why They Might</div>
                  <div className="mt-1 text-xs text-gray-300">{card.whyThem}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-violet-400">Best Approach</div>
                  <div className="mt-1 text-xs text-gray-300">{card.bestApproach}</div>
                </div>
                <div className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                  <div className="text-[10px] uppercase tracking-wide text-cyan-400">Opening Offer</div>
                  <div className="mt-1 text-xs text-gray-300">{card.openingOffer}</div>
                </div>
              </div>

              <div className="mt-3 rounded-xl border border-gray-800 bg-gray-950/60 p-3">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Negotiation Notes</div>
                <div className="mt-2 space-y-1">
                  {(card.negotiationNotes || []).map((note: string) => (
                    <div key={note} className="text-xs text-gray-300">{note}</div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      );
    })()}

  </div>
    </>
  );
}
