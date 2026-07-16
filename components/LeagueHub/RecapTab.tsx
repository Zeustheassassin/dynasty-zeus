"use client";
import { useMemo, useState } from "react";
import { useLeague } from "../../lib/LeagueContext";
import { useMyRoster } from "../../lib/RosterContext";
import { usePlayers } from "../../lib/PlayersContext";
import { useValues } from "../../lib/ValuesContext";
import { useSimulationHistory } from "../../hooks/useSimulationHistory";
import { getRosterAgeCurve } from "../../lib/helpers/direction/age";
import { getDynastyTier } from "../../lib/helpers/direction/bucket";
import { CURRENT_YEAR } from "../../lib/helpers/season";
import type { StandingRow, AnnotatedTransaction } from "./leagueHubTypes";

interface Props {
  standings: StandingRow[];
  activityTransactions: AnnotatedTransaction[];
}

// Data-only templated season rollup — no LLM calls. Manually triggered
// (Phase I, I4 / A9) rather than generated automatically, since every
// input here is either already loaded for this league or a cheap
// on-demand read, and a fixed auto-trigger date doesn't fit a dynasty
// league that runs year-round.
export default function RecapTab({ standings, activityTransactions }: Props) {
  const { selectedLeague, users } = useLeague();
  const { myRoster } = useMyRoster();
  const players = usePlayers();
  const { leagueAdjustedFcValues } = useValues();
  const [generated, setGenerated] = useState(false);

  const { history, loadingHistory } = useSimulationHistory(
    generated ? selectedLeague?.league_id : null,
    myRoster?.roster_id ?? null,
  );

  const rankedStandings = useMemo(() => {
    return [...standings]
      .sort((a, b) => (b.wins - a.wins) || (b.ties - a.ties) || (b.fpts - a.fpts))
      .map((row, idx) => ({
        ...row,
        rank: idx + 1,
        tier: getDynastyTier(idx + 1, standings.length || 12),
        ownerName: users[String(row.roster_id)] ?? `Roster ${row.roster_id}`,
      }));
  }, [standings, users]);

  const myStanding = rankedStandings.find((r) => r.roster_id === myRoster?.roster_id) ?? null;

  const tradeStats = useMemo(() => {
    if (!selectedLeague) return { count: 0, byRoster: new Map<number, number>() };
    const leagueTrades = activityTransactions.filter(
      (t) => t.leagueId === selectedLeague.league_id && t.type === "trade" && t.status === "complete",
    );
    const byRoster = new Map<number, number>();
    for (const t of leagueTrades) {
      for (const rid of t.roster_ids) byRoster.set(rid, (byRoster.get(rid) ?? 0) + 1);
    }
    return { count: leagueTrades.length, byRoster };
  }, [activityTransactions, selectedLeague]);

  const mostActiveTrader = useMemo(() => {
    let best: { rosterId: number; count: number } | null = null;
    for (const [rosterId, count] of tradeStats.byRoster) {
      if (!best || count > best.count) best = { rosterId, count };
    }
    return best ? { ...best, ownerName: users[String(best.rosterId)] ?? `Roster ${best.rosterId}` } : null;
  }, [tradeStats, users]);

  const ageCurve = useMemo(() => {
    if (!myRoster) return [];
    return getRosterAgeCurve({
      roster: myRoster,
      players,
      dynastyValueForPlayer: (id) => leagueAdjustedFcValues[id] ?? 0,
    });
  }, [myRoster, players, leagueAdjustedFcValues]);

  const avgAge = ageCurve.length > 0 ? ageCurve.reduce((s, p) => s + p.age, 0) / ageCurve.length : null;
  const oldest = ageCurve.length > 0 ? [...ageCurve].sort((a, b) => b.age - a.age)[0] : null;
  const youngest = ageCurve.length > 0 ? [...ageCurve].sort((a, b) => a.age - b.age)[0] : null;

  const oddsStart = history[0] ?? null;
  const oddsLatest = history.length > 0 ? history[history.length - 1] : null;

  if (!selectedLeague) {
    return <p className="text-sm text-gray-500">Select a league to generate a recap.</p>;
  }

  if (!generated) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-6 text-center space-y-3">
        <p className="text-sm text-gray-300">
          Generate a data-only season recap for <span className="font-semibold text-white">{selectedLeague.name}</span> —
          standings, trade activity, playoff-odds trend, and your roster&apos;s age curve.
        </p>
        <button
          onClick={() => setGenerated(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-semibold text-white transition"
        >
          Generate Recap
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">{selectedLeague.name} — {CURRENT_YEAR} Recap</h3>
        <button onClick={() => setGenerated(false)} className="text-xs text-gray-500 hover:text-white">Reset</button>
      </div>

      {/* Standings */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Standings</p>
        <div className="space-y-1">
          {rankedStandings.map((row) => (
            <div
              key={row.roster_id}
              className={`flex items-center justify-between text-xs px-2 py-1 rounded ${
                row.roster_id === myRoster?.roster_id ? "bg-blue-900/30 text-blue-200" : "text-gray-300"
              }`}
            >
              <span className="flex items-center gap-2">
                <span className="text-gray-500 w-5">{row.rank}.</span>
                <span className="font-medium">{row.ownerName}</span>
                <span className={
                  row.tier === "Contender" ? "text-green-400" : row.tier === "Middle" ? "text-yellow-400" : "text-red-400"
                }>
                  {row.tier}
                </span>
              </span>
              <span className="font-mono">{row.wins}-{row.losses}{row.ties > 0 ? `-${row.ties}` : ""} · {row.fpts.toFixed(1)} pf</span>
            </div>
          ))}
        </div>
      </div>

      {/* Trade activity */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Trade Activity</p>
        <p className="text-sm text-gray-200">{tradeStats.count} completed trade{tradeStats.count === 1 ? "" : "s"} this season.</p>
        {mostActiveTrader && (
          <p className="text-xs text-gray-500 mt-1">
            Most active: <span className="text-gray-300">{mostActiveTrader.ownerName}</span> ({mostActiveTrader.count} trade{mostActiveTrader.count === 1 ? "" : "s"})
          </p>
        )}
      </div>

      {/* Playoff odds trend */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Playoff Odds Trend</p>
        {loadingHistory ? (
          <p className="text-xs text-gray-500">Loading...</p>
        ) : oddsLatest ? (
          <div className="text-xs text-gray-300 space-y-1">
            <p>
              Week {oddsLatest.week}: <span className="font-semibold text-white">{oddsLatest.playoffOdds.toFixed(1)}%</span> playoff odds,{" "}
              <span className="font-semibold text-white">{oddsLatest.titleOdds.toFixed(1)}%</span> title odds.
            </p>
            {oddsStart && oddsStart.week !== oddsLatest.week && (
              <p className="text-gray-500">
                Since week {oddsStart.week}: playoff odds {(oddsLatest.playoffOdds - oddsStart.playoffOdds >= 0 ? "+" : "")}
                {(oddsLatest.playoffOdds - oddsStart.playoffOdds).toFixed(1)}pts, title odds{" "}
                {(oddsLatest.titleOdds - oddsStart.titleOdds >= 0 ? "+" : "")}
                {(oddsLatest.titleOdds - oddsStart.titleOdds).toFixed(1)}pts.
              </p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No simulator history recorded yet for your roster this season.</p>
        )}
      </div>

      {/* Roster age curve */}
      <div className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-2">Your Roster Age</p>
        {avgAge != null ? (
          <div className="text-xs text-gray-300 space-y-1">
            <p>Average starter-eligible age: <span className="font-semibold text-white">{avgAge.toFixed(1)}</span></p>
            {youngest && <p className="text-gray-500">Youngest: {youngest.full_name} ({youngest.pos}, {youngest.age})</p>}
            {oldest && <p className="text-gray-500">Oldest: {oldest.full_name} ({oldest.pos}, {oldest.age})</p>}
          </div>
        ) : (
          <p className="text-xs text-gray-500">No roster data available.</p>
        )}
      </div>

      {myStanding && (
        <p className="text-[10px] text-gray-600 text-center">
          You&apos;re ranked #{myStanding.rank} of {rankedStandings.length} in {selectedLeague.name}.
        </p>
      )}
    </div>
  );
}
