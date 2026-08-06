"use client";
import React, { useMemo } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip } from "recharts";
import { getStoredPickValue, ordinal, valueAtLeastDaysAgo, leagueAdjustRatio, MIN_TREND_AGE_DAYS } from "../../lib/helpers";
import { usePlayers } from "../../lib/PlayersContext";
import { useLeague } from "../../lib/LeagueContext";
import { useValues } from "../../lib/ValuesContext";
import { usePlayerValueHistory, type PlayerValuePoint } from "../../hooks/usePlayerValueHistory";
import type { SleeperUser, SleeperTradedPick, SleeperPlayer } from "../../lib/types";
import { ChartCard, ChartTooltip, ChartLegend, chartGridProps, chartAxisProps, chartTickStyle } from "../charts/ChartCard";
import { MultiPointSparkline } from "../charts/MultiPointSparkline";
import { CHART_CATEGORICAL } from "../../lib/chartTheme";
import { CartesianGrid } from "recharts";
import { Card } from "../ui/Card";

/** Per-team "then vs. now" dynasty value, built from the daily
 *  player_value_history cron (migration 047) rather than the single-row
 *  per-user snapshot the Phase D chart originally shipped with — that
 *  snapshot could be same-day-fresh (auto-created on first login) and
 *  stored generic, non-league-adjusted values, so comparing it directly
 *  against `dynTotal` made every team look like it had gained value
 *  purely from the league-adjustment gap, not real time movement. "Then"
 *  here only uses each player's history point that is at least
 *  MIN_TREND_AGE_DAYS old (see valueAtLeastDaysAgo), scaled by that
 *  player's current adjusted/generic ratio (leagueAdjustRatio) so both
 *  sides are on the same scale. Only rendered by the caller once at
 *  least one player clears that age bar. "Now" uses `dynTotal` (the SAME
 *  total the table below ranks by, including picks in "Full Team" mode)
 *  so this chart's order/values always match the table's. */
function TeamValueTrendChart({
  rows, historyByPlayer, players,
}: {
  rows: { roster_id: number; ownerName: string; playerList: (SleeperPlayer & { dynVal: number })[]; pickVal: number; dynTotal: number }[];
  historyByPlayer: Record<string, PlayerValuePoint[]>;
  players: Record<string, SleeperPlayer>;
}) {
  const data = rows
    .map((r) => {
      const covered = r.playerList.some((p) => valueAtLeastDaysAgo(historyByPlayer[p.player_id] ?? []) !== null);
      const then = covered
        ? r.playerList.reduce((s, p) => {
            const weekAgo = valueAtLeastDaysAgo(historyByPlayer[p.player_id] ?? []);
            if (weekAgo === null) return s;
            const ratio = leagueAdjustRatio(p.dynVal, players[p.player_id]?.value ?? 0);
            return s + weekAgo * ratio;
          }, 0) + r.pickVal
        : undefined;
      return { name: r.ownerName, now: r.dynTotal, then };
    })
    .sort((a, b) => b.now - a.now);
  const height = Math.max(160, data.length * 28);

  return (
    <ChartCard
      title="Team Value Trend"
      subtitle={`Current roster's dynasty value vs. ${MIN_TREND_AGE_DAYS}+ days ago`}
      height={height}
      legend={<ChartLegend items={[{ label: "Then", color: CHART_CATEGORICAL[1] }, { label: "Now", color: CHART_CATEGORICAL[0] }]} />}
    >
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid {...chartGridProps} horizontal={false} />
        <XAxis type="number" {...chartAxisProps} tick={chartTickStyle} />
        <YAxis type="category" dataKey="name" {...chartAxisProps} tick={chartTickStyle} width={110} />
        <Tooltip content={ChartTooltip} />
        <Bar dataKey="then" name="Then" fill={CHART_CATEGORICAL[1]} radius={2} barSize={8} />
        <Bar dataKey="now" name="Now" fill={CHART_CATEGORICAL[0]} radius={2} barSize={8} />
      </BarChart>
    </ChartCard>
  );
}

/** Real multi-point per-team dynasty value trend (migration 047 /
 *  player-value-history cron), replacing the then/now bar chart once at
 *  least 2 days of shared history exist — a grouped bar chart only reads
 *  well for exactly 2 points, but a real time series needs to scale to
 *  however many teams a league has (up to ~14), so this is a compact
 *  sparkline-per-row list (same hand-rolled MultiPointSparkline the
 *  Draft Hub Consensus board and Dashboard odds trend already use)
 *  rather than one overlaid multi-line chart. */
function TeamValueSparklineTable({
  rows, historyByPlayer, players,
}: {
  rows: { roster_id: number; ownerName: string; playerList: (SleeperPlayer & { dynVal: number })[]; pickVal: number; dynTotal: number }[];
  historyByPlayer: Record<string, PlayerValuePoint[]>;
  players: Record<string, SleeperPlayer>;
}) {
  const dates = Array.from(
    new Set(
      rows.flatMap((r) => r.playerList.flatMap((p) => (historyByPlayer[p.player_id] ?? []).map((h) => h.date)))
    )
  ).sort();

  // "now"/sort use `dynTotal` (the same total the table below ranks by,
  // including picks in "Full Team" mode) so this list's order always matches
  // the table's — plain playerList sums used to disagree with it whenever
  // picks were a meaningful share of a team's value. `pickVal` (current, held
  // constant — no historical pick value exists) is folded into every point of
  // the series too, so the sparkline's rightmost point lines up with "now."
  // Each player's raw (generic) history is scaled by their current
  // adjusted/generic ratio (leagueAdjustRatio) so the whole series sits on
  // the same league-adjusted scale as `dynTotal` — otherwise a superflex (or
  // other) adjustment would inflate "now" vs. every historical point for
  // reasons having nothing to do with real value movement. The %-change
  // figure specifically only compares against a point at least
  // MIN_TREND_AGE_DAYS old (valueAtLeastDaysAgo) so it never reads as a
  // meaningful trend off a 1-2 day-old baseline.
  const teamSeries = rows
    .map((r) => {
      const ratios = new Map(
        r.playerList.map((p) => [p.player_id, leagueAdjustRatio(p.dynVal, players[p.player_id]?.value ?? 0)])
      );
      const valueByPlayer = new Map(
        r.playerList.map((p) => [
          p.player_id,
          new Map((historyByPlayer[p.player_id] ?? []).map((h) => [h.date, h.value])),
        ])
      );
      const series = dates.map((d) =>
        r.playerList.reduce((s, p) => {
          const raw = valueByPlayer.get(p.player_id)?.get(d);
          return raw === undefined ? s : s + raw * (ratios.get(p.player_id) ?? 1);
        }, 0) + r.pickVal
      );
      const now = r.dynTotal;
      const covered = r.playerList.some((p) => valueAtLeastDaysAgo(historyByPlayer[p.player_id] ?? []) !== null);
      const weekAgo = covered
        ? r.playerList.reduce((s, p) => {
            const wa = valueAtLeastDaysAgo(historyByPlayer[p.player_id] ?? []);
            return wa === null ? s : s + wa * (ratios.get(p.player_id) ?? 1);
          }, 0) + r.pickVal
        : null;
      const delta = weekAgo !== null ? now - weekAgo : null;
      const pct = delta !== null && weekAgo! > 0 ? (delta / weekAgo!) * 100 : null;
      return { rosterId: r.roster_id, name: r.ownerName, series, now, delta, pct };
    })
    .sort((a, b) => b.now - a.now);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
      <div className="mb-2">
        <div className="text-sm font-semibold text-white">Team Value Trend</div>
        <div className="text-xs text-slate-500">Dynasty roster value over the last {dates.length} tracked days</div>
      </div>
      <div className="space-y-1">
        {teamSeries.map((t) => (
          <div key={t.rosterId} className="flex items-center gap-3 text-xs py-1">
            <span className="text-slate-200 w-28 truncate shrink-0">{t.name}</span>
            <MultiPointSparkline values={t.series} width={64} higherIsBetter />
            <span className="text-slate-200 font-mono ml-auto tabular-nums">{t.now.toLocaleString()}</span>
            <span
              className={`font-mono w-16 text-right tabular-nums ${t.pct === null ? "text-slate-600" : t.delta! >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {t.pct === null ? "—" : `${t.delta! >= 0 ? "+" : ""}${t.pct.toFixed(1)}%`}
            </span>
          </div>
        ))}
      </div>
    </div>
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
    ? "bg-emerald-900/40 text-emerald-400 border-emerald-700"
    : r >= bot3rd
    ? "bg-red-900/40 text-red-400 border-red-700"
    : "bg-slate-800/60 text-slate-400 border-slate-700";
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
}: PowerRankingsTabProps) {
  const players = usePlayers();
  const { selectedLeague, rosters, users } = useLeague();
  const {
    leagueAdjustedFcValues: calcFcValues,
    leagueAdjustedRedraftValues: redraftValues,
    pickFcValues,
  } = useValues();

  const allRosterPlayerIds = useMemo(
    () => Array.from(new Set(rosters.flatMap((r) => r.players || []))),
    [rosters]
  );
  const { historyByPlayer } = usePlayerValueHistory(allRosterPlayerIds);

  if (!selectedLeague || !rosters.length) return (
    <p className="text-sm text-slate-500">Select a league from Rosters &amp; Rules first to view Power Rankings.</p>
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
          <Card role="dialog" aria-modal="true" aria-labelledby="pr-popup-title" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setPrPopup(null); }} padding="lg" className="w-80 max-h-[80vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider">{colLabel} Roster</p>
                <p id="pr-popup-title" className="text-sm font-semibold text-white">{popRow.ownerName}</p>
              </div>
              <button aria-label="Close roster popup" onClick={() => setPrPopup(null)} className="text-slate-500 hover:text-white text-lg leading-none">✕</button>
            </div>
            <div className="space-y-1">
              {popPlayers.map((p) => (
                <div key={p.player_id} className="flex items-center justify-between bg-slate-800 rounded-lg px-2 py-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => { setPrPopup(null); setPlayerProfileId(p.player_id); }} className="text-xs text-white hover:text-blue-400 transition truncate text-left">{p.full_name}</button>
                    <span className="text-[10px] text-slate-500 shrink-0">{p.position}</span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono shrink-0 ml-2">
                    {col === "red" ? (p.redVal || 0).toLocaleString() : (p.dynVal || 0).toLocaleString()}
                  </span>
                </div>
              ))}
              {(col === "dyn") && allPicks.filter((p) => p.owner_id === prPopup.rosterId).length > 0 && (
                <>
                  <p className="text-[10px] text-slate-600 uppercase tracking-wider pt-1 pb-0.5 pl-1">Picks</p>
                  {allPicks.filter((p) => p.owner_id === prPopup.rosterId).map((p) => {
                    const via = p.roster_id !== p.owner_id ? ` (via ${prRosterToName[p.roster_id] || `Team ${p.roster_id}`})` : "";
                    const label = p.slot && String(p.slot).includes(".") ? `${p.season} ${p.slot}` : `${p.season} Rd ${p.round}`;
                    const val = getStoredPickValue(pickFcValues, p);
                    return (
                      <div key={`${p.season}-${p.round}-${p.roster_id}`} className="flex items-center justify-between bg-slate-800 rounded-lg px-2 py-1.5">
                        <span className="text-xs text-white truncate">{label}{via}</span>
                        <span className="text-xs text-slate-400 font-mono shrink-0 ml-2">{val.toLocaleString()}</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </Card>
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
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition ${active ? "bg-blue-600 border-blue-500 text-white" : "bg-slate-800/60 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500"}`}
              >
                {labels[m]}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Power rankings for <strong className="text-slate-300">{selectedLeague.name}</strong>.{" "}
          {prMode === "full" && "Dynasty rank includes picks."}
          {prMode === "starters" && "Showing projected optimal starting lineup based on dynasty values."}
          {prMode === "bench" && "Showing projected bench (players outside the optimal starting lineup)."}
          {" "}Click any pill to see that team&apos;s roster. Click column headers to sort.
        </p>
        {Object.values(historyByPlayer).some((h) => h.length >= 2) ? (
          <TeamValueSparklineTable rows={prRows} historyByPlayer={historyByPlayer} players={players} />
        ) : Object.values(historyByPlayer).some((h) => valueAtLeastDaysAgo(h) !== null) ? (
          <TeamValueTrendChart rows={prRows} historyByPlayer={historyByPlayer} players={players} />
        ) : (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs text-slate-500">
            Team value trend will appear once your league has at least a week of tracked dynasty values.
          </div>
        )}
        <div className="overflow-x-auto pb-1">
          <table className="min-w-full text-sm border-separate border-spacing-y-1">
            <thead>
              <tr className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                <th className="text-left pl-3 pb-2 pr-2">Owner</th>
                <SortTh col="dynTotal" label="Dynasty" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="redTotal" label="Redraft" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="qbTotal" label="QB" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="rbTotal" label="RB" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="wrTotal" label="WR" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                <SortTh col="teTotal" label="TE" prSortKey={prSortKey} prSortAsc={prSortAsc} setPrSortKey={setPrSortKey} setPrSortAsc={setPrSortAsc} />
                {prMode === "full" && <th className="text-center pb-2 px-2 text-slate-600">Picks</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => {
                const isMe = row.roster_id === myRosterId;
                const isIgnored = !isMe && ignoredOwnerIds.includes(row.ownerId);
                return (
                  <tr key={row.roster_id} className={`group ${isMe ? "bg-blue-900/20" : isIgnored ? "bg-red-950/20" : "bg-slate-900"}`}>
                    <td className={`pl-3 pr-2 py-2.5 rounded-l-xl text-sm font-medium ${isMe ? "text-blue-300" : isIgnored ? "text-red-400/70" : "text-white"}`}>
                      <div className="flex items-center gap-2">
                        <span>{row.ownerName}</span>
                        {isMe && <span className="text-[10px] text-blue-500">(you)</span>}
                        {isIgnored && <span className="text-[10px] text-red-500 font-normal">ignored</span>}
                        {!isMe && (
                          <button
                            onClick={() => toggleIgnoredOwner(row.ownerId)}
                            title={isIgnored ? "Remove from ignore list" : "Ignore this owner"}
                            className={`text-[11px] leading-none transition ${isIgnored ? "opacity-100 text-red-500 hover:text-red-300" : "opacity-0 group-hover:opacity-100 text-slate-600 hover:text-red-400"}`}
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
                    {prMode === "full" && <td className="text-center px-2 py-2.5 rounded-r-xl text-xs text-slate-400 font-mono">{row.pickVal > 0 ? row.pickVal.toLocaleString() : <span className="text-slate-700">—</span>}</td>}
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
