"use client";
import React from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { getStoredPickValue, ordinal } from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import type { SleeperUser, SleeperTradedPick, SleeperPlayer, HistoricalSnapshot } from "../../lib/types";
import { ChartCard, ChartTooltip, ChartLegend, chartGridProps, chartAxisProps, chartTickStyle } from "../charts/ChartCard";
import { CHART_CATEGORICAL } from "../../lib/chartTheme";
import { CartesianGrid } from "recharts";

/** Per-team "then vs. now" dynasty value, built on the same single stored
 *  snapshot every other Phase D trend uses (see project_platform_upgrade_plan_july15
 *  memory — no dated history table exists yet, so this is 2 points per team,
 *  not a real time series). Sums each roster's CURRENT players' THEN values,
 *  same approximation RankingsTab/ValueTrendsTab already use per-player. */
function TeamValueTrendChart({
  rows, historicalSnapshot,
}: {
  rows: { roster_id: number; ownerName: string; playerList: (SleeperPlayer & { dynVal: number })[] }[];
  historicalSnapshot: HistoricalSnapshot;
}) {
  // Player-only totals on both sides (picks excluded — no historical pick
  // values exist) so "then" and "now" stay an apples-to-apples comparison.
  const data = rows
    .map((r) => ({
      name: r.ownerName,
      now: r.playerList.reduce((s, p) => s + p.dynVal, 0),
      then: r.playerList.reduce((s, p) => s + (historicalSnapshot.players[p.player_id]?.value ?? 0), 0),
    }))
    .sort((a, b) => b.now - a.now);
  const height = Math.max(160, data.length * 28);

  return (
    <ChartCard title="Team Value Trend" subtitle="Current roster's dynasty value vs. last snapshot" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid {...chartGridProps} horizontal={false} />
        <XAxis type="number" {...chartAxisProps} tick={chartTickStyle} />
        <YAxis type="category" dataKey="name" {...chartAxisProps} tick={chartTickStyle} width={110} />
        <Tooltip content={ChartTooltip} />
        <Bar dataKey="then" name="Then" fill={CHART_CATEGORICAL[1]} radius={2} barSize={8} />
        <Bar dataKey="now" name="Now" fill={CHART_CATEGORICAL[0]} radius={2} barSize={8} />
      </BarChart>
      <ChartLegend items={[{ label: "Then", color: CHART_CATEGORICAL[1] }, { label: "Now", color: CHART_CATEGORICAL[0] }]} />
    </ChartCard>
  );
}

type PrSortKey = "dynTotal" | "redTotal" | "qbTotal" | "rbTotal" | "wrTotal" | "teTotal";
type PrColKey = "dyn" | "red" | "QB" | "RB" | "WR" | "TE";

function SortTh({ col, label, prSortKey, prSortAsc, setPrSortKey, setPrSortAsc }: {
  col: PrSortKey;
  label: string;
  prSortKey: PrSortKey;
  prSortAsc: boolean;
  setPrSortKey: (key: PrSortKey) => void;
  setPrSortAsc: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const active = prSortKey === col;
  return (
    <th
      className="text-center pb-2 px-2 cursor-pointer select-none hover:text-white transition"
      onClick={() => { if (active) setPrSortAsc(v => !v); else { setPrSortKey(col); setPrSortAsc(false); } }}
    >
      {label}{active ? (prSortAsc ? " ↑" : " ↓") : ""}
    </th>
  );
}

function RankPill({ r, rosterId, col, teamCount, setPrPopup }: {
  r: number;
  rosterId: number;
  col: PrColKey;
  teamCount: number;
  setPrPopup: (popup: { rosterId: number; col: PrColKey } | null) => void;
}) {
  const top3rd = Math.ceil(teamCount / 3);
  const bot3rd = teamCount - Math.floor(teamCount / 3) + 1;
  const color = r <= top3rd
    ? "bg-green-900/40 text-green-400 border-green-700"
    : r >= bot3rd
    ? "bg-red-900/40 text-red-400 border-red-700"
    : "bg-gray-800/60 text-gray-400 border-gray-700";
  return (
    <button
      onClick={() => setPrPopup({ rosterId, col })}
      className={`inline-block text-[11px] font-bold px-2 py-0.5 rounded-full border transition hover:opacity-80 cursor-pointer ${color}`}
    >
      {ordinal(r)}
    </button>
  );
}

interface PowerRankingsTabProps {
  user: SleeperUser | null;
  allPicks: SleeperTradedPick[];
  loadingCalcValues: boolean;
  prSortKey: PrSortKey;
  setPrSortKey: (key: PrSortKey) => void;
  prSortAsc: boolean;
  setPrSortAsc: React.Dispatch<React.SetStateAction<boolean>>;
  prPopup: { rosterId: number; col: PrColKey } | null;
  setPrPopup: (popup: { rosterId: number; col: PrColKey } | null) => void;
  prMode: "full" | "starters" | "bench";
  setPrMode: (mode: "full" | "starters" | "bench") => void;
  ignoredOwnerIds: string[];
  toggleIgnoredOwner: (ownerId: string) => void;
  setPlayerProfileId: (id: string | null) => void;
  historicalSnapshot: HistoricalSnapshot | null;
}

function PowerRankingsTab({
  user,
  allPicks,
  loadingCalcValues,
  prSortKey,
  setPrSortKey,
  prSortAsc,
  setPrSortAsc,
  prPopup,
  setPrPopup,
  prMode,
  setPrMode,
  ignoredOwnerIds,
  toggleIgnoredOwner,
  setPlayerProfileId,
  historicalSnapshot,
}: PowerRankingsTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const {
    leagueAdjustedFcValues: calcFcValues,
    leagueAdjustedRedraftValues: redraftValues,
    pickFcValues,
  } = useValues();

  if (!selectedLeague || !rosters.length) return (
    <p className="text-sm text-gray-500">Select a league from Rosters &amp; Rules first to view Power Rankings.</p>
  );
  if (loadingCalcValues) return <p className="text-sm text-blue-400">Loading player values…</p>;

  const calcVal = (id: string) => calcFcValues[id] ?? players[id]?.value ?? 0;
  const rosterPositions: string[] = selectedLeague.roster_positions || [];

  type PRPlayer = SleeperPlayer & { dynVal: number; redVal: number };
  const projectStarterIds = (playerList: PRPlayer[]): Set<string> => {
    const starterSlots = rosterPositions.filter((s) => s !== "BN" && s !== "TAXI");
    const available = [...playerList].sort((a, b) => b.dynVal - a.dynVal);
    const starterIds = new Set<string>();
    const pickBest = (eligible: string[]) => {
      const idx = available.findIndex((p) => eligible.includes(p.position));
      if (idx !== -1) { starterIds.add(available[idx].player_id); available.splice(idx, 1); }
    };
    starterSlots.filter((s) => ["QB","RB","WR","TE","K","DEF"].includes(s)).forEach((s) => pickBest([s]));
    starterSlots.filter((s) => s === "WRRB_FLEX").forEach(() => pickBest(["WR","RB"]));
    starterSlots.filter((s) => s === "FLEX").forEach(() => pickBest(["RB","WR","TE"]));
    starterSlots.filter((s) => s === "SUPER_FLEX").forEach(() => pickBest(["QB","RB","WR","TE"]));
    return starterIds;
  };

  const prRows = rosters.map((r) => {
    const ownerId = r.owner_id;
    const ownerName = users[ownerId] || `Team ${r.roster_id}`;
    const allPlayerList = (r.players || []).map((id: string) => {
      const p = players[id];
      return p ? { ...p, dynVal: calcVal(id), redVal: redraftValues[id] || 0 } : null;
    }).filter((p): p is PRPlayer => !!p);

    const starterIds = projectStarterIds(allPlayerList);
    const playerList = prMode === "starters"
      ? allPlayerList.filter((p) => starterIds.has(p.player_id))
      : prMode === "bench"
      ? allPlayerList.filter((p) => !starterIds.has(p.player_id))
      : allPlayerList;

    const pickVal = prMode === "full"
      ? allPicks.filter((p) => p.owner_id === r.roster_id).reduce((s: number, p) => s + getStoredPickValue(pickFcValues, p), 0)
      : 0;

    const dynTotal = playerList.reduce((s: number, p) => s + p.dynVal, 0) + pickVal;
    const redTotal = playerList.reduce((s: number, p) => s + p.redVal, 0);
    const qbTotal  = playerList.filter((p) => p.position === "QB").reduce((s: number, p) => s + p.dynVal, 0);
    const rbTotal  = playerList.filter((p) => p.position === "RB").reduce((s: number, p) => s + p.dynVal, 0);
    const wrTotal  = playerList.filter((p) => p.position === "WR").reduce((s: number, p) => s + p.dynVal, 0);
    const teTotal  = playerList.filter((p) => p.position === "TE").reduce((s: number, p) => s + p.dynVal, 0);

    return { roster_id: r.roster_id, ownerId, ownerName, playerList, pickVal, dynTotal, redTotal, qbTotal, rbTotal, wrTotal, teTotal };
  });

  const prRosterToName: Record<number, string> = {};
  rosters.forEach((r) => { prRosterToName[Number(r.roster_id)] = users[r.owner_id] || `Team ${r.roster_id}`; });

  const rankMap = (key: "dynTotal"|"redTotal"|"qbTotal"|"rbTotal"|"wrTotal"|"teTotal") => {
    const sorted = [...prRows].sort((a, b) => b[key] - a[key]);
    return Object.fromEntries(sorted.map((row, i) => [row.roster_id, i + 1]));
  };

  const dynRanks = rankMap("dynTotal");
  const redRanks = rankMap("redTotal");
  const qbRanks  = rankMap("qbTotal");
  const rbRanks  = rankMap("rbTotal");
  const wrRanks  = rankMap("wrTotal");
  const teRanks  = rankMap("teTotal");

  const n = prRows.length;
  const myRosterId = rosters.find((r) => r.owner_id === user?.user_id)?.roster_id;

  const sortedRows = [...prRows].sort((a, b) => {
    const diff = b[prSortKey] - a[prSortKey];
    return prSortAsc ? -diff : diff;
  });

  let popupContent: React.ReactNode = null;
  if (prPopup) {
    const popRow = prRows.find(r => r.roster_id === prPopup.rosterId);
    if (popRow) {
      const col = prPopup.col;
      let popPlayers: PRPlayer[] = [];
      if (col === "dyn" || col === "red") {
        popPlayers = [...popRow.playerList].sort((a, b) =>
          col === "dyn" ? b.dynVal - a.dynVal : b.redVal - a.redVal
        );
      } else {
        popPlayers = popRow.playerList.filter((p) => p.position === col)
          .sort((a, b) => b.dynVal - a.dynVal);
      }
      const colLabel = col === "dyn" ? "Dynasty" : col === "red" ? "Redraft" : col;
      popupContent = (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setPrPopup(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="pr-popup-title" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setPrPopup(null); }} className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-80 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">{colLabel} Roster</p>
                <p id="pr-popup-title" className="text-sm font-semibold text-white">{popRow.ownerName}</p>
              </div>
              <button aria-label="Close roster popup" onClick={() => setPrPopup(null)} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="space-y-1">
              {popPlayers.map((p) => (
                <div key={p.player_id} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => { setPrPopup(null); setPlayerProfileId(p.player_id); }} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                    <span className="text-[10px] text-gray-500 shrink-0">{p.position}</span>
                  </div>
                  <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">
                    {col === "red" ? (p.redVal || 0).toLocaleString() : (p.dynVal || 0).toLocaleString()}
                  </span>
                </div>
              ))}
              {(col === "dyn") && allPicks.filter((p) => p.owner_id === prPopup.rosterId).length > 0 && (
                <>
                  <p className="text-[10px] text-gray-600 uppercase tracking-wider pt-1 pb-0.5 pl-1">Picks</p>
                  {allPicks.filter((p) => p.owner_id === prPopup.rosterId).map((p) => {
                    const via = p.roster_id !== p.owner_id ? ` (via ${prRosterToName[p.roster_id] || `Team ${p.roster_id}`})` : "";
                    const label = p.slot && String(p.slot).includes(".") ? `${p.season} ${p.slot}` : `${p.season} Rd ${p.round}`;
                    const val = getStoredPickValue(pickFcValues, p);
                    return (
                      <div key={`${p.season}-${p.round}-${p.roster_id}`} className="flex items-center justify-between bg-gray-800 rounded-lg px-2 py-1.5">
                        <span className="text-xs text-white truncate">{label}{via}</span>
                        <span className="text-xs text-gray-400 font-mono shrink-0 ml-2">{val.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <>
      {popupContent}
      <div className="space-y-3">
        <div className="flex items-center gap-1">
          {(["full","starters","bench"] as const).map((m) => {
            const labels = { full: "Full Team", starters: "Projected Starters", bench: "Projected Bench" };
            const active = prMode === m;
            return (
              <button
                key={m}
                onClick={() => setPrMode(m)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800/60 border-gray-700 text-gray-400 hover:text-white hover:border-gray-500"}`}
              >
                {labels[m]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-gray-500">
          Power rankings for <strong className="text-gray-300">{selectedLeague.name}</strong>.{" "}
          {prMode === "full" && "Dynasty rank includes picks."}
          {prMode === "starters" && "Showing projected optimal starting lineup based on dynasty values."}
          {prMode === "bench" && "Showing projected bench (players outside the optimal starting lineup)."}
          {" "}Click any pill to see that team&apos;s roster. Click column headers to sort.
        </p>
        {historicalSnapshot && <TeamValueTrendChart rows={prRows} historicalSnapshot={historicalSnapshot} />}
        <div className="overflow-x-auto pb-1">
          <table className="min-w-full text-sm border-separate border-spacing-y-1">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-gray-600">
                <th className="text-left pl-3 pb-2 pr-2">Owner</th>
                <SortTh col="dynTotal" label="Dynasty" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="redTotal" label="Redraft" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="qbTotal" label="QB" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="rbTotal" label="RB" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="wrTotal" label="WR" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="teTotal" label="TE" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                {prMode === "full" && <th className="text-center pb-2 px-2 text-gray-600">Picks</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isMe = row.roster_id === myRosterId;
                const isIgnored = !isMe && ignoredOwnerIds.includes(row.ownerId);
                return (
                  <tr key={row.roster_id} className={`group ${isMe ? "bg-blue-900/20" : isIgnored ? "bg-red-950/20" : "bg-gray-900"}`}>
                    <td className={`pl-3 pr-2 py-2.5 rounded-l-xl text-sm font-medium ${isMe ? "text-blue-300" : isIgnored ? "text-red-400/70" : "text-white"}`}>
                      <div className="flex items-center gap-2">
                        <span>{row.ownerName}</span>
                        {isMe && <span className="text-[10px] text-blue-500">(you)</span>}
                        {isIgnored && <span className="text-[10px] text-red-500 font-normal">ignored</span>}
                        {!isMe && (
                          <button
                            onClick={() => toggleIgnoredOwner(row.ownerId)}
                            title={isIgnored ? "Remove from ignore list" : "Ignore this owner"}
                            className={`text-[11px] leading-none transition ${isIgnored ? "opacity-100 text-red-500 hover:text-red-300" : "opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400"}`}
                          >
                            🚫
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="text-center px-2 py-2.5"><RankPill r={dynRanks[row.roster_id]} rosterId={row.roster_id} col="dyn" teamCount={n} setPrPopup={setPrPopup} /></td>
                    <td className="text-center px-2 py-2.5"><RankPill r={redRanks[row.roster_id]} rosterId={row.roster_id} col="red" teamCount={n} setPrPopup={setPrPopup} /></td>
                    <td className="text-center px-2 py-2.5"><RankPill r={qbRanks[row.roster_id]} rosterId={row.roster_id} col="QB" teamCount={n} setPrPopup={setPrPopup} /></td>
                    <td className="text-center px-2 py-2.5"><RankPill r={rbRanks[row.roster_id]} rosterId={row.roster_id} col="RB" teamCount={n} setPrPopup={setPrPopup} /></td>
                    <td className="text-center px-2 py-2.5"><RankPill r={wrRanks[row.roster_id]} rosterId={row.roster_id} col="WR" teamCount={n} setPrPopup={setPrPopup} /></td>
                    <td className={`text-center px-2 py-2.5 ${prMode !== "full" ? "rounded-r-xl" : ""}`}><RankPill r={teRanks[row.roster_id]} rosterId={row.roster_id} col="TE" teamCount={n} setPrPopup={setPrPopup} /></td>
                    {prMode === "full" && <td className="text-center px-2 py-2.5 rounded-r-xl text-xs text-gray-400 font-mono">{row.pickVal > 0 ? row.pickVal.toLocaleString() : <span className="text-gray-700">—</span>}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default React.memo(PowerRankingsTab);
