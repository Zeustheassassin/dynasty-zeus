"use client";
import React from "react";
import { getStoredPickValue, CURRENT_YEAR } from "../../lib/helpers";
import type {
  TradeAttempt, TradeAttemptAsset, TradeAttemptPick,
  SleeperPlayer, SleeperRoster, AugmentedPick, SleeperUser,
} from "../../lib/types";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { buildTradeFingerprint } from "./shared";

interface TradeCalculatorProps {
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
  calcSearchA: string;
  setCalcSearchA: (s: string) => void;
  calcSearchB: string;
  setCalcSearchB: (s: string) => void;
  loadingCalcValues: boolean;
  allPicks: AugmentedPick[];
  user: SleeperUser | null;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  sessionMarked: Set<string>;
  onSessionMark: (fingerprint: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  loadUserExposure: (ownerId: string) => void;
  loadUserTrades: (ownerId: string) => void;
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;
}

function TradeCalculator({
  calcOpponentRosterId, setCalcOpponentRosterId,
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  calcSearchA, setCalcSearchA, calcSearchB, setCalcSearchB,
  loadingCalcValues, allPicks, user,
  onMarkAttempted, sessionMarked, onSessionMark,
  setPlayerProfileId, loadUserExposure, loadUserTrades,
  ignoredOwnerIds, toggleIgnoredOwner,
}: TradeCalculatorProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const { leagueAdjustedFcValues: calcFcValues, pickFcValues, selectedLeagueDynamicPickValues } = useValues();

  const rosterToUser: Record<number, string> = {};
  rosters.forEach((r) => { rosterToUser[r.roster_id] = r.owner_id; });

  const myRoster = rosters.find((r) => r.owner_id === user?.user_id);
  const opponentRoster = calcOpponentRosterId != null
    ? rosters.find((r) => r.roster_id === calcOpponentRosterId)
    : null;

  const calcVal = (id: string) =>
    (calcFcValues as Record<string, number>)[id] ?? players[id]?.value ?? 0;

  const myAvailPlayers = (myRoster?.players || [] as string[])
    .map((id: string) => players[id])
    .filter((p): p is SleeperPlayer => !!p && ["QB","RB","WR","TE"].includes(p.position))
    .sort((a, b) => calcVal(b.player_id) - calcVal(a.player_id))
    .filter((p) => !calcGive.includes(p.player_id));

  const theirAvailPlayers = (opponentRoster?.players || [] as string[])
    .map((id: string) => players[id])
    .filter((p): p is SleeperPlayer => !!p && ["QB","RB","WR","TE"].includes(p.position))
    .sort((a, b) => calcVal(b.player_id) - calcVal(a.player_id))
    .filter((p) => !calcReceive.includes(p.player_id));

  const pickKey = (p: AugmentedPick) => `${p.season}-${p.round}-${p.roster_id}`;
  const myAvailPicks = allPicks.filter(
    (p) => p.owner_id === myRoster?.roster_id && !calcGivePicks.includes(pickKey(p))
  );
  const theirAvailPicks = allPicks.filter(
    (p) => p.owner_id === opponentRoster?.roster_id && !calcReceivePicks.includes(pickKey(p))
  );
  const pickInsight = (pick: AugmentedPick) => selectedLeagueDynamicPickValues[pickKey(pick)];

  const getPickValue = (key: string) => {
    const pick = allPicks.find((p) => pickKey(p) === key);
    if (!pick) return 0;
    if (Number(pick.season) > Number(CURRENT_YEAR) + 1) return getStoredPickValue(pickFcValues, pick);
    return pickInsight(pick)?.expectedValue ?? getStoredPickValue(pickFcValues, pick);
  };
  const pickLabel = (p: AugmentedPick) => {
    const origOwnerUserId = rosterToUser[p.roster_id];
    const origName = users[origOwnerUserId] || `Team ${p.roster_id}`;
    const via = p.roster_id !== p.owner_id ? ` (via ${origName})` : "";
    const slotLabel = p.slot && p.slot.includes(".")
      ? `${p.season} ${p.slot}`
      : `${p.season} Rd ${p.round}`;
    if (p.slot && p.slot.includes(".")) return `${slotLabel}${via}`;
    const dynamic = pickInsight(p);
    const suffix = dynamic && Number(p.season) <= Number(CURRENT_YEAR) + 1
      ? ` · Predicted Slot ${dynamic.expectedSlot}`
      : "";
    return `${slotLabel}${suffix}${via}`;
  };

  const totalGive =
    calcGive.reduce((s: number, id: string) => s + calcVal(id), 0) +
    calcGivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);
  const totalReceive =
    calcReceive.reduce((s: number, id: string) => s + calcVal(id), 0) +
    calcReceivePicks.reduce((s: number, k: string) => s + getPickValue(k), 0);

  const rosterLimit = (selectedLeague?.roster_positions ?? []).length || 25;
  const calcRosterDropCost = (roster: SleeperRoster | null | undefined, netPlayerGain: number): number => {
    if (!roster || netPlayerGain <= 0) return 0;
    const currentCount = (roster.players ?? []).length;
    const openSlots    = Math.max(0, rosterLimit - currentCount);
    const dropsNeeded  = Math.max(0, netPlayerGain - openSlots);
    if (dropsNeeded === 0) return 0;
    const sorted = (roster.players ?? [])
      .map((pid) => (calcFcValues as Record<string, number>)[pid] ?? 0)
      .sort((a, b) => a - b);
    return sorted.slice(0, dropsNeeded).reduce((s, v) => s + v, 0);
  };

  const calcMyNetPlayerGain = calcReceive.length - calcGive.length;
  const myDropCostCalc  = calcMyNetPlayerGain > 0
    ? calcRosterDropCost(myRoster, calcMyNetPlayerGain)
    : 0;
  const oppDropCostCalc = calcMyNetPlayerGain < 0
    ? calcRosterDropCost(opponentRoster, -calcMyNetPlayerGain)
    : 0;

  const calcStarDiscounts = (() => {
    const allGiveVals = [
      ...calcGive.map((id: string) => calcVal(id)),
      ...calcGivePicks.map((k: string) => getPickValue(k)),
    ];
    const allRecvVals = [
      ...calcReceive.map((id: string) => calcVal(id)),
      ...calcReceivePicks.map((k: string) => getPickValue(k)),
    ];
    if (allGiveVals.length === 0 || allRecvVals.length === 0) return { onReceive: 0, onGive: 0 };
    const globalTop = Math.max(...allGiveVals, ...allRecvVals);
    const pickParams = (keys: string[]): { threshold: number; maxPct: number } => {
      if (keys.length === 0) return { threshold: 0.78, maxPct: 0.12 };
      const best = Math.min(...keys.map((k: string) => Math.floor(Number(k.split("-")[1]))));
      if (best === 1) {
        const bestVal = Math.max(...keys.filter((k: string) => Math.floor(Number(k.split("-")[1])) === 1).map((k: string) => getPickValue(k)));
        if (bestVal >= globalTop * 0.97) return { threshold: 0.78, maxPct: 0.12 };
        return { threshold: 0.78, maxPct: 0.0125 };
      }
      if (best === 2) return { threshold: 0.83, maxPct: 0.09 };
      if (best === 3) return { threshold: 0.87, maxPct: 0.14 };
      return              { threshold: 0.91, maxPct: 0.20 };
    };
    const recvParams = pickParams(calcReceivePicks);
    const giveParams = pickParams(calcGivePicks);
    const giveSorted = [...allGiveVals].sort((a, b) => b - a);
    const recvSorted = [...allRecvVals].sort((a, b) => b - a);
    let onReceive = 0;
    let onGive = 0;
    const pairs = Math.min(giveSorted.length, recvSorted.length);
    for (let i = 0; i < pairs; i++) {
      const gv = giveSorted[i];
      const rv = recvSorted[i];
      if (gv > rv && gv >= 2000) {
        const ratio = rv / gv;
        if (ratio < recvParams.threshold)
          onReceive -= Math.round(Math.min((recvParams.threshold - ratio) / 0.25, 1.0) * gv * recvParams.maxPct);
      } else if (rv > gv && rv >= 2000) {
        const ratio = gv / rv;
        if (ratio < giveParams.threshold)
          onGive -= Math.round(Math.min((giveParams.threshold - ratio) / 0.25, 1.0) * rv * giveParams.maxPct);
      }
    }
    return { onReceive, onGive };
  })();
  const calcStarOnReceive = calcStarDiscounts.onReceive;
  const calcStarOnGive    = calcStarDiscounts.onGive;

  const totalGiveAdj    = totalGive    + myDropCostCalc  + calcStarOnGive;
  const totalReceiveAdj = Math.max(0, totalReceive + oppDropCostCalc + calcStarOnReceive);

  const net = totalReceiveAdj - totalGiveAdj;
  const verdict = Math.abs(net) <= 300 ? "EVEN" : net > 0 ? "YOU WIN" : "YOU LOSE";
  const verdictColor = verdict === "EVEN" ? "text-yellow-400" : verdict === "YOU WIN" ? "text-green-400" : "text-red-400";

  const filterPlayers = (list: SleeperPlayer[], search: string) =>
    search.trim().length >= 1
      ? list.filter((p) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
      : list;

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
              .filter((r) => r.owner_id !== user?.user_id)
              .map((r) => {
                const isIgnored = ignoredOwnerIds.includes(r.owner_id);
                return (
                  <option key={r.roster_id} value={r.roster_id}>
                    {isIgnored ? "🚫 " : ""}{users[r.owner_id] || `Team ${r.roster_id}`}{isIgnored ? " (Ignored)" : ""}
                  </option>
                );
              })}
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

              <button
                onClick={() => toggleIgnoredOwner(opponentRoster.owner_id)}
                className={`rounded-xl px-3 py-2 text-sm font-medium border transition whitespace-nowrap ${
                  ignoredOwnerIds.includes(opponentRoster.owner_id)
                    ? "bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-600 hover:text-gray-400"
                    : "bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300"
                }`}
              >
                {ignoredOwnerIds.includes(opponentRoster.owner_id) ? "Remove Ignore" : "Ignore Owner"}
              </button>
            </>
          )}
        </div>

        {/* Ignored owner warning banner */}
        {opponentRoster && ignoredOwnerIds.includes(opponentRoster.owner_id) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-gray-700 bg-gray-800/50 px-3 py-2.5">
            <span className="text-gray-500 text-sm leading-none mt-0.5">🚫</span>
            <div>
              <p className="text-sm font-medium text-gray-400">
                {users[opponentRoster.owner_id] || "This owner"} is on your ignore list
              </p>
              <p className="text-xs text-gray-600 mt-0.5">
                Excluded from Trade Finder and Recommendations. Click &quot;Remove Ignore&quot; above to re-enable.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Two-column asset panels */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Your assets */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-4">
          <div className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">
            Your Assets — {user?.user_id ? (users[user.user_id] || "You") : "You"}
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
                ...filterPlayers(myAvailPlayers, calcSearchA).map((p) => ({
                  label: `${p.full_name} (${p.position} · ${p.team})`,
                  value: calcVal(p.player_id),
                  playerId: p.player_id as string | undefined,
                  onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...(calcSearchA.trim().length === 0 ? myAvailPicks.map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
                  playerId: undefined as string | undefined,
                  onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                })) : []),
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
              ? `${users[opponentRoster.owner_id] || "Opponent"}'s Assets`
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
                .filter((r) => r.owner_id !== user?.user_id)
                .flatMap((r) =>
                  (r.players || []).map((id: string) => {
                    const p = players[id];
                    return p ? { ...p, _rosterId: r.roster_id } : null;
                  })
                )
                .filter((p): p is SleeperPlayer & { _rosterId: number } =>
                  !!p &&
                  ["QB","RB","WR","TE"].includes(p.position) &&
                  !!p.full_name?.toLowerCase().includes(q) &&
                  !calcReceive.includes(p.player_id)
                )
                .sort((a, b) => calcVal(b.player_id) - calcVal(a.player_id));
              if (allRosterPlayers.length === 0) return (
                <p className="text-xs text-gray-600">No player found — try a different name</p>
              );
              return allRosterPlayers.map((p) =>
                assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id), () => {
                  setCalcOpponentRosterId(p._rosterId);
                  setCalcReceive((prev) => [...prev, p.player_id]);
                }, p.player_id)
              );
            })() : (() => {
                const items = [
                  ...filterPlayers(theirAvailPlayers, calcSearchB).map((p) => ({
                    label: `${p.full_name} (${p.position} · ${p.team})`,
                    value: calcVal(p.player_id),
                    playerId: p.player_id as string | undefined,
                    onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                  })),
                  ...(calcSearchB.trim().length === 0 ? theirAvailPicks.map((p) => ({
                    label: pickLabel(p),
                    value: getPickValue(pickKey(p)),
                    playerId: undefined as string | undefined,
                    onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                  })) : []),
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
                const p = players[id];
                return tradeRow(
                  `${p?.full_name ?? id} (${p?.position})`,
                  calcVal(id),
                  () => setCalcGive((prev) => prev.filter((x) => x !== id))
                );
              })}
              {calcGivePicks.map((k: string) => {
                const pick = allPicks.find((p) => pickKey(p) === k);
                const label = pick ? pickLabel(pick) : k;
                return tradeRow(label, getPickValue(k),
                  () => setCalcGivePicks((prev) => prev.filter((x) => x !== k)));
              })}
            </div>
            {myDropCostCalc > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                <span className="text-xs text-amber-400 italic">Your Drop Cost</span>
                <span className="text-xs text-amber-400 font-mono">+{myDropCostCalc.toLocaleString()}</span>
              </div>
            )}
            {calcStarOnGive < 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                <span className="text-xs text-violet-400 italic">Star Discount</span>
                <span className="text-xs text-violet-400 font-mono">{calcStarOnGive.toLocaleString()}</span>
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
                const p = players[id];
                return tradeRow(
                  `${p?.full_name ?? id} (${p?.position})`,
                  calcVal(id),
                  () => setCalcReceive((prev) => prev.filter((x) => x !== id))
                );
              })}
              {calcReceivePicks.map((k: string) => {
                const pick = allPicks.find((p) => pickKey(p) === k);
                const label = pick ? pickLabel(pick) : k;
                return tradeRow(label, getPickValue(k),
                  () => setCalcReceivePicks((prev) => prev.filter((x) => x !== k)));
              })}
            </div>
            {oppDropCostCalc > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                <span className="text-xs text-amber-400 italic">Their Drop Cost</span>
                <span className="text-xs text-amber-400 font-mono">+{oppDropCostCalc.toLocaleString()}</span>
              </div>
            )}
            {calcStarOnReceive < 0 && (
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 rounded-lg">
                <span className="text-xs text-violet-400 italic">Star Discount</span>
                <span className="text-xs text-violet-400 font-mono">{calcStarOnReceive.toLocaleString()}</span>
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
            <div className="flex items-center gap-3">
              {calcOpponentRosterId != null && (calcGive.length > 0 || calcGivePicks.length > 0) && (calcReceive.length > 0 || calcReceivePicks.length > 0) && selectedLeague && (() => {
                const calcFp = buildTradeFingerprint(
                  selectedLeague.league_id,
                  calcOpponentRosterId,
                  calcGive,
                  calcReceive,
                );
                const alreadyMarked = sessionMarked.has(calcFp);
                const buildCalcPayload = (direction: "ME" | "THEM") => {
                  const oppRosterForCalc = rosters.find((r) => r.roster_id === calcOpponentRosterId);
                  const oppName = (oppRosterForCalc?.owner_id ? users[oppRosterForCalc.owner_id] : null) || `Team ${calcOpponentRosterId}`;
                  return {
                    league_id: selectedLeague.league_id,
                    partner_roster_id: calcOpponentRosterId,
                    partner_name: oppName,
                    give_players: calcGive.map((id: string) => {
                      const p = players[id];
                      return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                    }),
                    give_picks: calcGivePicks.map((k: string) => {
                      const pick = allPicks.find((p) => pickKey(p) === k);
                      return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                    }),
                    receive_players: calcReceive.map((id: string) => {
                      const p = players[id];
                      return { player_id: id, name: p?.full_name || id, position: p?.position || "", value: calcVal(id) } as TradeAttemptAsset;
                    }),
                    receive_picks: calcReceivePicks.map((k: string) => {
                      const pick = allPicks.find((p) => pickKey(p) === k);
                      return { key: k, label: pick ? pickLabel(pick) : k, value: getPickValue(k) } as TradeAttemptPick;
                    }),
                    source: "CALCULATOR" as const,
                    initiated_by: direction,
                    status: "PENDING" as const,
                    counter_details: null,
                  };
                };
                if (alreadyMarked) {
                  return <span className="text-xs text-green-400 font-semibold">✓ Recorded</span>;
                }
                return (
                  <div className="flex gap-2">
                    <button
                      onClick={async () => {
                        await onMarkAttempted(buildCalcPayload("ME"));
                        onSessionMark(calcFp);
                      }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg border border-orange-700 text-orange-400 hover:border-orange-500 hover:text-orange-300 transition"
                    >
                      I Sent This
                    </button>
                    <button
                      onClick={async () => {
                        await onMarkAttempted(buildCalcPayload("THEM"));
                        onSessionMark(calcFp);
                      }}
                      className="text-xs font-semibold px-3 py-1 rounded-lg border border-indigo-700 text-indigo-400 hover:border-indigo-500 hover:text-indigo-300 transition"
                    >
                      They Sent This
                    </button>
                  </div>
                );
              })()}
              <button
                onClick={() => { setCalcGive([]); setCalcReceive([]); setCalcGivePicks([]); setCalcReceivePicks([]); }}
                className="text-xs text-gray-600 hover:text-gray-300 transition"
              >
                Clear trade
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Position Health Panel */}
      {(calcGive.length > 0 || calcReceive.length > 0) && (() => {
        const calcPosTotals = (playerIds: string[]) => {
          const t: Record<string, number> = { QB: 0, RB: 0, WR: 0, TE: 0 };
          playerIds.forEach((id) => {
            const p = players[id];
            if (p && ["QB","RB","WR","TE"].includes(p.position)) {
              t[p.position] = (t[p.position] || 0) + calcVal(id);
            }
          });
          return t;
        };
        const allTeamsCalcPos = rosters.map((r) => calcPosTotals(r.players || []));
        const calcLeagueRank = (pos: string, total: number) => {
          const sorted = allTeamsCalcPos.map((t) => t[pos] || 0).sort((a, b) => b - a);
          let rank = 1;
          for (const t of sorted) { if (total >= t) break; rank++; }
          return Math.min(rank, rosters.length);
        };
        const preT = calcPosTotals(myRoster?.players || []);
        const postT = { ...preT };
        calcGive.forEach((id) => {
          const p = players[id];
          if (p && postT[p.position] !== undefined) postT[p.position] = Math.max(0, postT[p.position] - calcVal(id));
        });
        calcReceive.forEach((id) => {
          const p = players[id];
          if (p && postT[p.position] !== undefined) postT[p.position] = (postT[p.position] || 0) + calcVal(id);
        });
        const positions = ["QB", "RB", "WR", "TE"] as const;
        return (
          <div className="mt-4 bg-gray-900 border border-gray-800 rounded-2xl p-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-3">Position Health</h3>
            <div className="grid grid-cols-4 gap-2">
              {positions.map((pos) => {
                const preRank = calcLeagueRank(pos, preT[pos]);
                const postRank = calcLeagueRank(pos, postT[pos]);
                const delta = preRank - postRank;
                const color = delta > 0 ? "text-green-400" : delta < 0 ? "text-red-400" : "text-gray-500";
                return (
                  <div key={pos} className="bg-gray-800 rounded-xl p-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1">{pos}</div>
                    <div className="text-sm font-bold text-white">#{postRank}</div>
                    <div className={`text-[10px] mt-0.5 ${color}`}>
                      {delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : "—"} from #{preRank}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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
                ...myAvailPlayers.map((p) => ({
                  label: p.full_name, value: calcVal(p.player_id),
                  age: p.age, position: p.position, isPick: false,
                  onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...myAvailPicks.map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
                  isPick: true,
                  onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                })),
              ]
            : [
                ...theirAvailPlayers.map((p) => ({
                  label: p.full_name, value: calcVal(p.player_id),
                  age: p.age, position: p.position, isPick: false,
                  onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...theirAvailPicks.map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
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
                <h3 className="text-sm font-semibold text-gray-200 mb-3">Equalize the Trade</h3>
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
        Pick values shown as averages for that round. Drop Cost reflects the value of the lowest-ranked player your roster would need to cut to absorb extra incoming players. Star Discount applies when the best piece returning is far below the value of the star you&apos;re trading away.
      </p>
    </div>
  );
}

export default React.memo(TradeCalculator);
