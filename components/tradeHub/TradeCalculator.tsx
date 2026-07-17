"use client";
import React from "react";
import { getStoredPickValue, CURRENT_YEAR } from "../../lib/helpers";
import type {
  TradeAttempt, SleeperPlayer, AugmentedPick, SleeperUser,
} from "../../lib/types";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { computeRosterDropCost, computeStarDiscounts, EVEN_NET_THRESHOLD } from "./calculatorUtils";
import CalculatorResult from "./CalculatorResult";
import { Card } from "../ui/Card";

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
  calcShowAllPlayers: boolean;
  setCalcShowAllPlayers: (v: boolean) => void;
  loadingCalcValues: boolean;
  allPicks: AugmentedPick[];
  user: SleeperUser | null;
  onMarkAttempted: (attempt: Omit<TradeAttempt, "id" | "user_id" | "attempted_at" | "resolved_at">) => Promise<void>;
  sessionMarked: Set<string>;
  onSessionMark: (fingerprint: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  loadUserExposure: (ownerId: string) => void;
  loadUserTrades: (ownerId: string, bypass?: boolean) => void;
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;
}

function TradeCalculator({
  calcOpponentRosterId, setCalcOpponentRosterId,
  calcGive, setCalcGive, calcReceive, setCalcReceive,
  calcGivePicks, setCalcGivePicks, calcReceivePicks, setCalcReceivePicks,
  calcSearchA, setCalcSearchA, calcSearchB, setCalcSearchB,
  calcShowAllPlayers, setCalcShowAllPlayers,
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
  const fcValMap = calcFcValues as Record<string, number>;

  const calcMyNetPlayerGain = calcReceive.length - calcGive.length;
  const myDropCostCalc = calcMyNetPlayerGain > 0
    ? computeRosterDropCost(myRoster, calcMyNetPlayerGain, rosterLimit, fcValMap)
    : 0;
  const oppDropCostCalc = calcMyNetPlayerGain < 0
    ? computeRosterDropCost(opponentRoster, -calcMyNetPlayerGain, rosterLimit, fcValMap)
    : 0;

  const allGiveVals = [
    ...calcGive.map((id: string) => calcVal(id)),
    ...calcGivePicks.map((k: string) => getPickValue(k)),
  ];
  const allRecvVals = [
    ...calcReceive.map((id: string) => calcVal(id)),
    ...calcReceivePicks.map((k: string) => getPickValue(k)),
  ];
  const { onReceive: calcStarOnReceive, onGive: calcStarOnGive } = computeStarDiscounts(
    allGiveVals, allRecvVals, calcGivePicks, calcReceivePicks, getPickValue,
  );

  const totalGiveAdj    = totalGive    + myDropCostCalc  + calcStarOnGive;
  const totalReceiveAdj = Math.max(0, totalReceive + oppDropCostCalc + calcStarOnReceive);

  const net = totalReceiveAdj - totalGiveAdj;
  const verdict = Math.abs(net) <= EVEN_NET_THRESHOLD ? "EVEN" : net > 0 ? "YOU WIN" : "YOU LOSE";
  const verdictColor = verdict === "EVEN" ? "text-amber-400" : verdict === "YOU WIN" ? "text-emerald-400" : "text-red-400";

  const filterPlayers = (list: SleeperPlayer[], search: string) =>
    search.trim().length >= 1
      ? list.filter((p) => p.full_name?.toLowerCase().includes(search.toLowerCase()))
      : list;

  const filterPicks = (list: AugmentedPick[], search: string) => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((p) =>
      pickLabel(p).toLowerCase().includes(q) || String(p.season).includes(q)
    );
  };

  // Historical-logging escape hatch: a player who's since moved teams (or been
  // dropped) no longer shows up on either roster, so the normal roster-scoped
  // pickers can't find them. When calcShowAllPlayers is on, search the entire
  // Sleeper player database instead — gated behind a minimum query length so
  // we never map/sort/render the ~thousands of skill-position entries at once.
  const ALL_PLAYER_SEARCH_MIN = 2;
  const searchAllPlayers = (search: string, excludeIds: string[]): SleeperPlayer[] => {
    const q = search.trim().toLowerCase();
    if (q.length < ALL_PLAYER_SEARCH_MIN) return [];
    const excluded = new Set(excludeIds);
    return Object.values(players)
      .filter((p): p is SleeperPlayer =>
        !!p &&
        ["QB", "RB", "WR", "TE"].includes(p.position) &&
        !excluded.has(p.player_id) &&
        !!p.full_name?.toLowerCase().includes(q)
      )
      .sort((a, b) => calcVal(b.player_id) - calcVal(a.player_id))
      .slice(0, 25);
  };

  const assetRow = (label: string, value: number, onAdd: () => void, playerId?: string) => (
    <div
      key={label}
      className="w-full flex items-center justify-between px-3 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg transition"
    >
      <button onClick={onAdd} className="flex-1 text-sm truncate text-left">{label}</button>
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <span className="text-xs text-blue-300 font-mono">{value > 0 ? value.toLocaleString() : "—"}</span>
        {playerId && (
          <button
            onClick={(e) => { e.stopPropagation(); setPlayerProfileId(playerId); }}
            className="text-slate-600 hover:text-blue-400 text-xs transition"
            title="View profile"
          >ⓘ</button>
        )}
      </div>
    </div>
  );

  if (!selectedLeague) {
    return <p className="text-slate-400 text-sm">Select a league from the dropdown above to use the Trade Calculator.</p>;
  }

  return (
    <div>
      <p className="text-xs text-slate-500 mb-2">
        Powered by FantasyCalc — values calibrated for <strong className="text-slate-300">{selectedLeague.name}</strong>.
        {loadingCalcValues && <span className="ml-2 text-blue-400">Loading values…</span>}
      </p>

      {/* Opponent picker */}
      <div className="mb-6">
        <label className="text-xs text-slate-400 mb-1 block">Trade with</label>
        <div className="flex flex-col md:flex-row gap-3">
          <select
            value={calcOpponentRosterId ?? ""}
            onChange={(e) => {
              setCalcOpponentRosterId(e.target.value ? Number(e.target.value) : null);
              setCalcReceive([]);
              setCalcReceivePicks([]);
              setCalcSearchB("");
            }}
            className="bg-slate-800 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-blue-500 w-full md:w-64"
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
                className="bg-slate-800 border border-slate-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Most Owned Players
              </button>

              <button
                onClick={() => loadUserTrades(opponentRoster.owner_id)}
                className="bg-slate-800 border border-slate-700 hover:border-blue-500 text-white rounded-xl px-3 py-2 text-sm font-medium transition whitespace-nowrap"
              >
                Recent Trades
              </button>

              <button
                onClick={() => toggleIgnoredOwner(opponentRoster.owner_id)}
                className={`rounded-xl px-3 py-2 text-sm font-medium border transition whitespace-nowrap ${
                  ignoredOwnerIds.includes(opponentRoster.owner_id)
                    ? "bg-slate-800 border-slate-700 text-slate-500 hover:border-slate-600 hover:text-slate-400"
                    : "bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600 hover:text-slate-300"
                }`}
              >
                {ignoredOwnerIds.includes(opponentRoster.owner_id) ? "Remove Ignore" : "Ignore Owner"}
              </button>
            </>
          )}
        </div>

        {/* Ignored owner warning banner */}
        {opponentRoster && ignoredOwnerIds.includes(opponentRoster.owner_id) && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5">
            <span className="text-slate-500 text-sm leading-none mt-0.5">🚫</span>
            <div>
              <p className="text-sm font-medium text-slate-400">
                {users[opponentRoster.owner_id] || "This owner"} is on your ignore list
              </p>
              <p className="text-xs text-slate-600 mt-0.5">
                Excluded from Trade Finder and Recommendations. Click &quot;Remove Ignore&quot; above to re-enable.
              </p>
            </div>
          </div>
        )}

        <label className="mt-3 flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none w-fit">
          <input
            type="checkbox"
            checked={calcShowAllPlayers}
            onChange={(e) => setCalcShowAllPlayers(e.target.checked)}
            className="rounded border-slate-700 bg-slate-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-slate-900"
          />
          Search all players, not just current rosters
          <span className="text-slate-600">— for logging an old offer involving someone who&apos;s since changed teams</span>
        </label>
      </div>

      {/* Two-column asset panels */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Your assets */}
        <Card>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
            Your Assets — {user?.user_id ? (users[user.user_id] || "You") : "You"}
          </div>
          <input
            type="text"
            value={calcSearchA}
            onChange={(e) => setCalcSearchA(e.target.value)}
            placeholder={calcShowAllPlayers ? "Search all players by name..." : "Filter players..."}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {(() => {
              if (calcShowAllPlayers) {
                if (calcSearchA.trim().length < ALL_PLAYER_SEARCH_MIN) return (
                  <p className="text-xs text-slate-600">Type at least 2 letters to search all players</p>
                );
                const playerResults = searchAllPlayers(calcSearchA, calcGive);
                const pickResults = filterPicks(myAvailPicks, calcSearchA);
                if (playerResults.length === 0 && pickResults.length === 0) return <p className="text-xs text-slate-600">No player or pick found — try a different name</p>;
                const items = [
                  ...playerResults.map((p) => ({
                    label: `${p.full_name} (${p.position}${p.team ? ` · ${p.team}` : ""})`,
                    value: calcVal(p.player_id),
                    playerId: p.player_id as string | undefined,
                    onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                  })),
                  ...pickResults.map((p) => ({
                    label: pickLabel(p),
                    value: getPickValue(pickKey(p)),
                    playerId: undefined as string | undefined,
                    onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                  })),
                ].sort((a, b) => b.value - a.value);
                return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
              }
              const items = [
                ...filterPlayers(myAvailPlayers, calcSearchA).map((p) => ({
                  label: `${p.full_name} (${p.position} · ${p.team})`,
                  value: calcVal(p.player_id),
                  playerId: p.player_id as string | undefined,
                  onAdd: () => setCalcGive((prev: string[]) => [...prev, p.player_id]),
                })),
                ...filterPicks(myAvailPicks, calcSearchA).map((p) => ({
                  label: pickLabel(p),
                  value: getPickValue(pickKey(p)),
                  playerId: undefined as string | undefined,
                  onAdd: () => setCalcGivePicks((prev: string[]) => [...prev, pickKey(p)]),
                })),
              ].sort((a, b) => b.value - a.value);
              if (items.length === 0) return <p className="text-xs text-slate-600">No assets available</p>;
              return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
            })()}
          </div>
        </Card>

        {/* Their assets */}
        <Card>
          <div className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
            {opponentRoster
              ? `${users[opponentRoster.owner_id] || "Opponent"}'s Assets`
              : "Their Assets"}
          </div>
          <input
            type="text"
            value={calcSearchB}
            onChange={(e) => setCalcSearchB(e.target.value)}
            placeholder={
              !opponentRoster ? "Search any player to find their team..."
              : calcShowAllPlayers ? "Search all players by name..."
              : "Filter players..."
            }
            className="w-full bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-xs mb-3 focus:outline-none focus:border-blue-500"
          />
          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {!opponentRoster ? (() => {
              const q = calcSearchB.trim().toLowerCase();
              if (q.length < 1) return (
                <p className="text-xs text-slate-600">Search a player name above or select an opponent from the dropdown</p>
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
                <p className="text-xs text-slate-600">No player found — try a different name (picks aren&apos;t searchable until an opponent is selected)</p>
              );
              return allRosterPlayers.map((p) =>
                assetRow(`${p.full_name} (${p.position} · ${p.team})`, calcVal(p.player_id), () => {
                  setCalcOpponentRosterId(p._rosterId);
                  setCalcReceive((prev) => [...prev, p.player_id]);
                }, p.player_id)
              );
            })() : calcShowAllPlayers ? (() => {
                if (calcSearchB.trim().length < ALL_PLAYER_SEARCH_MIN) return (
                  <p className="text-xs text-slate-600">Type at least 2 letters to search all players</p>
                );
                const playerResults = searchAllPlayers(calcSearchB, calcReceive);
                const pickResults = filterPicks(theirAvailPicks, calcSearchB);
                if (playerResults.length === 0 && pickResults.length === 0) return <p className="text-xs text-slate-600">No player or pick found — try a different name</p>;
                const items = [
                  ...playerResults.map((p) => ({
                    label: `${p.full_name} (${p.position}${p.team ? ` · ${p.team}` : ""})`,
                    value: calcVal(p.player_id),
                    playerId: p.player_id as string | undefined,
                    onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                  })),
                  ...pickResults.map((p) => ({
                    label: pickLabel(p),
                    value: getPickValue(pickKey(p)),
                    playerId: undefined as string | undefined,
                    onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                  })),
                ].sort((a, b) => b.value - a.value);
                return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
              })() : (() => {
                const items = [
                  ...filterPlayers(theirAvailPlayers, calcSearchB).map((p) => ({
                    label: `${p.full_name} (${p.position} · ${p.team})`,
                    value: calcVal(p.player_id),
                    playerId: p.player_id as string | undefined,
                    onAdd: () => setCalcReceive((prev: string[]) => [...prev, p.player_id]),
                  })),
                  ...filterPicks(theirAvailPicks, calcSearchB).map((p) => ({
                    label: pickLabel(p),
                    value: getPickValue(pickKey(p)),
                    playerId: undefined as string | undefined,
                    onAdd: () => setCalcReceivePicks((prev: string[]) => [...prev, pickKey(p)]),
                  })),
                ].sort((a, b) => b.value - a.value);
                if (items.length === 0) return <p className="text-xs text-slate-600">No assets available</p>;
                return items.map((item) => assetRow(item.label, item.value, item.onAdd, item.playerId));
              })()
            }
          </div>
        </Card>
      </div>

      <CalculatorResult
        calcGive={calcGive}
        setCalcGive={setCalcGive}
        calcReceive={calcReceive}
        setCalcReceive={setCalcReceive}
        calcGivePicks={calcGivePicks}
        setCalcGivePicks={setCalcGivePicks}
        calcReceivePicks={calcReceivePicks}
        setCalcReceivePicks={setCalcReceivePicks}
        allPicks={allPicks}
        myAvailPlayers={myAvailPlayers}
        theirAvailPlayers={theirAvailPlayers}
        myAvailPicks={myAvailPicks}
        theirAvailPicks={theirAvailPicks}
        myRoster={myRoster}
        calcOpponentRosterId={calcOpponentRosterId}
        calcVal={calcVal}
        getPickValue={getPickValue}
        pickKey={pickKey}
        pickLabel={pickLabel}
        totalGiveAdj={totalGiveAdj}
        totalReceiveAdj={totalReceiveAdj}
        myDropCostCalc={myDropCostCalc}
        oppDropCostCalc={oppDropCostCalc}
        calcStarOnGive={calcStarOnGive}
        calcStarOnReceive={calcStarOnReceive}
        net={net}
        verdict={verdict}
        verdictColor={verdictColor}
        onMarkAttempted={onMarkAttempted}
        sessionMarked={sessionMarked}
        onSessionMark={onSessionMark}
      />
    </div>
  );
}

export default React.memo(TradeCalculator);
