"use client";
import React, { useEffect, useMemo } from "react";
import { usePlayers } from "../../lib/PlayersContext";
import type {
  SleeperLeague,
  SleeperUser,
  LeagueOverviewEntry,
  LeagueHubTab,
} from "../../lib/types";

// Sleeper's `injury_status` is null/empty for healthy players and uses a mix
// of spellings/codes for hurt ones (IR, O, Out, PUP, Sus, NA, DNR, Cov, NFI,
// "IR-Designated", etc.). Rather than try to enumerate every code, exclude
// the small set of statuses that are NOT IR-eligible: empty/null, "Active",
// "Questionable", "Doubtful", "Probable". Everything else means the player
// could go on IR.
const NON_IR_RE = /^(?:active|questionable|doubtful|probable)$/i;
const isIREligible = (injuryStatus?: string | null): boolean => {
  const s = (injuryStatus ?? "").trim();
  if (!s) return false;
  return !NON_IR_RE.test(s);
};

interface RosterOverviewTabProps {
  leagues: SleeperLeague[];
  user: SleeperUser | null;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  loadingLeagueOverview: boolean;
  leagueOverviewLoaded: boolean;
  loadLeagueOverview: () => Promise<void>;
  loadRoster: (league: SleeperLeague) => void;
  setLeagueHubTab: (tab: LeagueHubTab) => void;
}

interface Row {
  leagueId: string;
  leagueName: string;
  league: SleeperLeague;
  active: { filled: number; cap: number };
  ir: { filled: number; cap: number };
  taxi: { filled: number; cap: number };
  unflaggedInjuries: number;
}

function fillColor(filled: number, cap: number, hasCap: boolean): string {
  if (!hasCap) return "text-slate-500";
  if (filled > cap) return "text-red-500 font-bold";
  if (filled === cap) return "text-emerald-400";
  if (filled === 0) return "text-rose-400";
  return "text-amber-300";
}

function fillLabel(filled: number, cap: number, hasCap: boolean): string {
  if (!hasCap) return "—";
  return `${filled} / ${cap}`;
}

function RosterOverviewTab({
  leagues,
  user,
  leagueOverviewData,
  loadingLeagueOverview,
  leagueOverviewLoaded,
  loadLeagueOverview,
  loadRoster,
  setLeagueHubTab,
}: RosterOverviewTabProps) {
  const players = usePlayers();

  useEffect(() => {
    if (
      !leagueOverviewLoaded &&
      !loadingLeagueOverview &&
      leagues.length > 0 &&
      user
    ) {
      loadLeagueOverview();
    }
  }, [
    leagueOverviewLoaded,
    loadingLeagueOverview,
    leagues.length,
    user,
    loadLeagueOverview,
  ]);

  const rows = useMemo<Row[]>(() => {
    if (!user) return [];
    const result: Row[] = [];
    for (const league of leagues) {
      const entry = leagueOverviewData[league.league_id];
      if (!entry) continue;
      const myRoster = entry.rosters.find((r) => r.owner_id === user.user_id);
      if (!myRoster) continue;

      // Sleeper's roster.players is the full union — actives + IR + taxi —
      // so subtract IR and taxi to get the starters/bench count.
      const reserveSet = new Set(myRoster.reserve ?? []);
      const taxiSet = new Set(myRoster.taxi ?? []);
      const allPlayers = myRoster.players ?? [];
      const activeFilled = allPlayers.filter((pid) => !reserveSet.has(pid) && !taxiSet.has(pid)).length;
      const activeCap = (league.roster_positions ?? []).length;
      const irFilled = (myRoster.reserve ?? []).length;
      const irCap = league.settings?.reserve_slots ?? 0;
      const taxiFilled = (myRoster.taxi ?? []).length;
      const taxiCap = league.settings?.taxi_slots ?? 0;

      // Only count IR-eligible players who AREN'T already on IR — those are
      // the ones the user could still claim into a reserve slot. Taxi players
      // generally can't be IR'd, so exclude them too.
      const unflaggedInjuries = allPlayers.filter((pid) => {
        if (reserveSet.has(pid) || taxiSet.has(pid)) return false;
        return isIREligible(players?.[pid]?.injury_status);
      }).length;

      result.push({
        leagueId: league.league_id,
        leagueName: league.name,
        league,
        active: { filled: activeFilled, cap: activeCap },
        ir: { filled: irFilled, cap: irCap },
        taxi: { filled: taxiFilled, cap: taxiCap },
        unflaggedInjuries,
      });
    }
    result.sort((a, b) => a.leagueName.localeCompare(b.leagueName));
    return result;
  }, [user, leagues, leagueOverviewData, players]);

  if (!user || leagues.length === 0) {
    return (
      <div className="text-sm text-slate-500 text-center py-12">
        Connect a Sleeper account with leagues to see your Roster Overview.
      </div>
    );
  }

  // Fixed (not minmax(0,1fr)) column widths so the league name always gets real room —
  // on a phone the row is wider than the screen and the wrapping container scrolls
  // horizontally instead of squeezing the name down to one character.
  const GRID = "grid grid-cols-[13rem_5rem_4rem_4rem_5rem] gap-2 items-center px-1";

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-xl p-3">
      <div className="border-b border-slate-800 pb-2 mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Roster Overview</div>
          <div className="mt-0.5 text-xs text-slate-200">
            Active / IR / Taxi utilization across all your leagues, plus a flag for IR-eligible players still on your active roster.
          </div>
        </div>
        <button
          onClick={() => loadLeagueOverview()}
          disabled={loadingLeagueOverview}
          className="text-[10px] font-semibold border rounded-lg px-2.5 py-1 transition disabled:opacity-50 border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 whitespace-nowrap"
        >
          {loadingLeagueOverview ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {!leagueOverviewLoaded && loadingLeagueOverview && rows.length === 0 ? (
        <div className="text-[11px] text-slate-600 italic py-2">Loading rosters…</div>
      ) : rows.length === 0 ? (
        <div className="text-[11px] text-slate-600 italic py-2">No rosters loaded yet.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <div className="min-w-max">
              <div className={`${GRID} text-[10px] uppercase tracking-wide text-slate-500 mb-1`}>
                <span>League</span>
                <span className="text-right">Active</span>
                <span className="text-right">IR</span>
                <span className="text-right">Taxi</span>
                <span className="text-right" title="IR-eligible players still on the active roster (could be moved to IR)">IR-Eligible</span>
              </div>
              <div className="space-y-0.5">
                {rows.map((row) => {
                  const hasIR = row.ir.cap > 0;
                  const hasTaxi = row.taxi.cap > 0;
                  return (
                    <div
                      key={row.leagueId}
                      onClick={() => {
                        setLeagueHubTab("ROSTERS");
                        loadRoster(row.league);
                      }}
                      className={`${GRID} text-xs py-1 rounded cursor-pointer hover:bg-slate-800/40 transition`}
                    >
                      <span className="text-slate-200 truncate">{row.leagueName}</span>
                      <span className={`text-right font-mono ${fillColor(row.active.filled, row.active.cap, row.active.cap > 0)}`}>
                        {fillLabel(row.active.filled, row.active.cap, row.active.cap > 0)}
                      </span>
                      <span className={`text-right font-mono ${fillColor(row.ir.filled, row.ir.cap, hasIR)}`}>
                        {fillLabel(row.ir.filled, row.ir.cap, hasIR)}
                      </span>
                      <span className={`text-right font-mono ${fillColor(row.taxi.filled, row.taxi.cap, hasTaxi)}`}>
                        {fillLabel(row.taxi.filled, row.taxi.cap, hasTaxi)}
                      </span>
                      <span className={`text-right font-mono ${row.unflaggedInjuries > 0 ? "text-orange-300" : "text-slate-600"}`}>
                        {row.unflaggedInjuries > 0 ? row.unflaggedInjuries : "—"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-slate-600 mt-2">Click any row to open that league&apos;s roster.</p>
        </>
      )}
    </div>
  );
}

export default React.memo(RosterOverviewTab);
