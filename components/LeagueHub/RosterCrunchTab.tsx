"use client";
import React, { useEffect, useMemo } from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { getSleeperLeagueOrder } from "../../lib/helpers/leagueOrder";
import { DANGER_CUSHION, getRosterCrunch, playersHaveValues, type RosterCrunch } from "../../lib/helpers/rosterCrunch";
import type {
  SleeperLeague,
  SleeperUser,
  LeagueOverviewEntry,
  LeagueHubTab,
} from "../../lib/types";

interface RosterCrunchTabProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  loadingLeagueOverview: boolean;
  leagueOverviewLoaded: boolean;
  loadLeagueOverview: () => Promise<void>;
  onRefresh: () => Promise<void>;
  refreshing: boolean;
  loadRoster: (league: SleeperLeague) => void;
  setLeagueHubTab: (tab: LeagueHubTab) => void;
  setPlayerProfileId: (id: string | null) => void;
}

interface Row {
  league: SleeperLeague;
  crunch: RosterCrunch;
}

const ROUND_LABELS = ["1st", "2nd", "3rd", "4th", "5th", "6th"];

const WHERE_LABEL = { ACTIVE: "", IR: " · IR", TAXI: " · Taxi" } as const;

// Sticky so the league stays in view while the danger columns scroll sideways.
const LEAGUE_CELL = "sticky left-0 z-10 bg-slate-900 border-r border-slate-700 pr-3 text-left";
const GROUP_EDGE = "border-l border-slate-700";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The whole count spelled out, shown on hover over the Cut number. */
function cutTitle({ active, ir, taxi, picks, taxiFillable, taxiShort, waiverRoomCut, mustCut }: RosterCrunch): string {
  const lines = [
    `${active.filled} active + ${ir.filled} IR + ${taxi.filled} taxi + ${plural(picks, "pick")} = ${active.filled + ir.filled + taxi.filled + picks}`,
    `Room next season: ${active.cap} active + ${taxiFillable} taxi = ${active.cap + taxiFillable}`,
  ];
  if (taxiShort > 0) {
    lines.push(`Taxi is ${taxiShort} short.`);
  }
  if (waiverRoomCut > 0) {
    lines.push(`Includes 1 extra cut to open a spot for a free agent rookie, or buy ${plural(taxiShort, "more pick")} instead.`);
  }
  lines.push(`${mustCut} must be cut or traded.`);
  return lines.join("\n");
}

function RosterCrunchTab({
  leagues,
  user,
  leagueOverviewData,
  loadingLeagueOverview,
  leagueOverviewLoaded,
  loadLeagueOverview,
  onRefresh,
  refreshing,
  loadRoster,
  setLeagueHubTab,
  setPlayerProfileId,
}: RosterCrunchTabProps) {
  const players = usePlayers();
  const hasValues = useMemo(() => playersHaveValues(players ?? {}), [players]);

  useEffect(() => {
    if (!leagueOverviewLoaded && !loadingLeagueOverview && leagues.length > 0 && user) {
      loadLeagueOverview();
    }
  }, [leagueOverviewLoaded, loadingLeagueOverview, leagues.length, user, loadLeagueOverview]);

  const rows = useMemo<Row[]>(() => {
    if (!user || !players || !hasValues) return [];
    const order = getSleeperLeagueOrder(leagues);
    const result: Row[] = [];
    for (const league of leagues) {
      const entry = leagueOverviewData[league.league_id];
      const myRoster = entry?.rosters.find((r) => r.owner_id === user.user_id);
      if (!myRoster || !entry.tradedPicks || !entry.drafts) continue;
      result.push({
        league,
        crunch: getRosterCrunch(league, myRoster, entry.rosters, entry.tradedPicks, entry.drafts, players),
      });
    }
    return result.sort((a, b) => (order.get(a.league.league_id) ?? 0) - (order.get(b.league.league_id) ?? 0));
  }, [user, players, hasValues, leagues, leagueOverviewData]);

  if (!user || leagues.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-12">
        Connect a Sleeper account with leagues to see your Roster Crunch.
      </div>
    );
  }

  const roundColumns = Math.max(0, ...rows.map((row) => row.crunch.picksByRound.length));
  const dangerColumns = Math.max(0, ...rows.map((row) => row.crunch.danger.length));
  const draftSeasons = new Set(rows.map((row) => row.crunch.draftSeason));
  const picksHeading = draftSeasons.size === 1 ? `${[...draftSeasons][0]} Draft Picks` : "Next Draft Picks";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
      <div className="border-b border-slate-800 pb-2 mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Roster Crunch</div>
          <div className="mt-0.5 text-xs text-slate-200">
            Who has to go once IR players come back and your next rookie class arrives, lowest value first.{" "}
            <span className="text-red-400 font-semibold">Red</span> must be cut or traded;{" "}
            <span className="text-orange-400 font-semibold">orange</span> are the {DANGER_CUSHION} extra names. Everyone listed is tagged Danger, which puts them back in the Trade Finder pool until their value lifts them off the list.
          </div>
        </div>
        <button
          onClick={() => onRefresh()}
          disabled={loadingLeagueOverview || refreshing}
          title="Re-pull every league's rosters and picks"
          className="shrink-0 text-[10px] font-semibold border rounded-lg px-2.5 py-1 transition disabled:opacity-50 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 whitespace-nowrap"
        >
          {loadingLeagueOverview || refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {rows.length === 0 ? (
        <div className="text-[11px] text-slate-600 italic py-2">
          {loadingLeagueOverview || !hasValues ? "Loading rosters and values…" : "No rosters loaded yet."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-max border-collapse text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className={`${LEAGUE_CELL} font-semibold`} rowSpan={2}>League</th>
                <th className="px-2 pb-1 font-semibold" colSpan={roundColumns}>{picksHeading}</th>
                <th className={`${GROUP_EDGE} px-2 pb-1 font-semibold`} colSpan={3}>Taxi Squad</th>
                <th className={`${GROUP_EDGE} px-2 font-semibold`} rowSpan={2} title="Players to cut or trade to fit under the limit. Hover a number to see the count.">Cut</th>
                <th className={`${GROUP_EDGE} px-2 pb-1 font-semibold`} colSpan={dangerColumns}>Players in Danger +{DANGER_CUSHION}</th>
              </tr>
              <tr className="border-b border-slate-700">
                {ROUND_LABELS.slice(0, roundColumns).map((label) => (
                  <th key={label} className="px-1.5 pb-1 font-medium text-center">{label}</th>
                ))}
                <th className={`${GROUP_EDGE} px-1.5 pb-1 font-medium text-center`}>Spots</th>
                <th className="px-1.5 pb-1 font-medium text-center" title="Sleeper's Allow Non-Rookies For Taxi turned off: a player on taxi can stay until the limit, but only a rookie can be added.">Rookies Only</th>
                <th className="px-1.5 pb-1 font-medium text-center" title="Sleeper's Taxi Squad Years Experience Limit: a player past it must be activated.">Exp Limit</th>
                {Array.from({ length: dangerColumns }, (_, i) => (
                  <th key={i} className={`px-2 pb-1 font-medium text-left whitespace-nowrap ${i === 0 ? GROUP_EDGE : ""}`}>
                    {i === 0 ? "Lowest Value" : i === dangerColumns - 1 ? "Highest Value" : ">"}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ league, crunch }) => (
                <tr key={league.league_id} className="border-b border-slate-800/70">
                  <td className={`${LEAGUE_CELL} py-1`}>
                    <button
                      onClick={() => {
                        setLeagueHubTab("ROSTERS");
                        loadRoster(league);
                      }}
                      title={`${crunch.draftSeason} draft. Open this league's roster.`}
                      className="max-w-[13rem] truncate text-slate-200 hover:text-blue-400 transition text-left"
                    >
                      {league.name}
                    </button>
                  </td>
                  {Array.from({ length: roundColumns }, (_, i) => {
                    const count = crunch.picksByRound[i];
                    return (
                      <td key={i} className={`px-1.5 text-center font-mono ${count === undefined ? "text-[10px] text-slate-600" : count === 0 ? "text-slate-600" : "text-slate-200"}`}>
                        {count === undefined ? "N/A" : count}
                      </td>
                    );
                  })}
                  <td
                    className={`${GROUP_EDGE} px-1.5 text-center font-mono text-slate-200 whitespace-nowrap`}
                    title={crunch.taxiAgingOff.length > 0
                      ? `Past the limit next season, must be activated: ${crunch.taxiAgingOff.map((id) => players?.[id]?.full_name ?? id).join(", ")}`
                      : undefined}
                  >
                    {crunch.taxi.cap}
                    {crunch.taxiShort > 0 && (
                      <span className="ml-1 font-sans text-[10px] font-semibold text-amber-300">{crunch.taxiShort} short</span>
                    )}
                    {crunch.taxiAgingOff.length > 0 && (
                      <span className="ml-1 font-sans text-[10px] text-slate-500">{crunch.taxiAgingOff.length} aging off</span>
                    )}
                  </td>
                  <td className={`px-1.5 text-center ${crunch.rookiesOnly ? "font-semibold text-amber-300" : "text-slate-500"}`}>
                    {crunch.rookiesOnly ? "Yes" : "No"}
                  </td>
                  <td className="px-1.5 text-center text-slate-400 whitespace-nowrap">
                    {crunch.taxiYearsLimit === 0 ? "No Max" : plural(crunch.taxiYearsLimit, "Yr")}
                  </td>
                  <td
                    className={`${GROUP_EDGE} px-2 text-center font-mono font-bold cursor-help ${crunch.mustCut > 0 ? "text-red-400" : "text-emerald-400"}`}
                    title={cutTitle(crunch)}
                  >
                    {crunch.mustCut}
                  </td>
                  {Array.from({ length: dangerColumns }, (_, i) => {
                    const entry = crunch.danger[i];
                    return (
                      <td key={i} className={`px-2 py-1 whitespace-nowrap ${i === 0 ? GROUP_EDGE : ""}`}>
                        {entry && (
                          <>
                            <button
                              onClick={() => setPlayerProfileId(entry.playerId)}
                              className={`block font-semibold hover:underline ${entry.cushion ? "text-orange-400" : "text-red-400"}`}
                            >
                              {players?.[entry.playerId]?.full_name ?? entry.playerId}
                            </button>
                            <span className="block text-[10px] text-slate-500">
                              {players?.[entry.playerId]?.position} · {entry.value.toLocaleString()}{WHERE_LABEL[entry.where]}
                            </span>
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default React.memo(RosterCrunchTab);
