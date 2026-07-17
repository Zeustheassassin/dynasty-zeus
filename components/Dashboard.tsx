"use client";
import { useMemo } from "react";
import type { MainTab } from "../lib/hubs";
import type { LeagueOverviewEntry, CommittedSimsByLeague, CachedSimRow } from "../lib/types";
import type { DashboardAlert, InjuryReportPlayer } from "./AlertsPage/alertsPageHelpers";
import { getInjuredCount } from "./AlertsPage/alertsPageHelpers";
import StatStrip from "./Dashboard/StatStrip";
import TeamSummaryGrid, { type DashboardLeagueEntry } from "./Dashboard/TeamSummaryGrid";
import ValueMoversPanel from "./Dashboard/ValueMoversPanel";
import RecentAlertsPanel from "./Dashboard/RecentAlertsPanel";

type DashboardProps = {
  username: string;
  onNavigate: (tab: MainTab) => void;
  allLeagueData: DashboardLeagueEntry[];
  loadingAllLeagueData: boolean;
  injuryReportPlayers: InjuryReportPlayer[];
  allTradeAttempts: { id: string; league_id: string; status: string }[];
  visibleDashboardAlerts: DashboardAlert[];
  actionableDashboardAlerts: DashboardAlert[];
  onDismissAlert: (alertId: string) => void;
  onSelectLeague: (leagueId: string) => void;
  leagueOverviewData: Record<string, LeagueOverviewEntry>;
  redraftValues: Record<string, number>;
  committedSimsByLeague: CommittedSimsByLeague;
  leagueSimCache: Record<string, Record<number, CachedSimRow>>;
};

// Phase J — Dashboard rebuild (A7 cross-league team summary + R7 value
// movers/alerts/playoff-odds snapshot), built on J1's data layer, which
// turned out to already exist as allLeagueData/dashboardOwnedPlayers/
// injuryReportPlayers/visibleDashboardAlerts (all built for Alerts Hub +
// Data Hub's My Shares tab) — the only genuinely new J1 piece is the
// cross-league playoff-odds read in useDashboardPlayoffOdds (called from
// TeamSummaryGrid), everything else here is prop reuse.
export default function Dashboard({
  username,
  onNavigate,
  allLeagueData,
  loadingAllLeagueData,
  injuryReportPlayers,
  allTradeAttempts,
  visibleDashboardAlerts,
  actionableDashboardAlerts,
  onDismissAlert,
  onSelectLeague,
  leagueOverviewData,
  redraftValues,
  committedSimsByLeague,
  leagueSimCache,
}: DashboardProps) {
  const isConnected = !!username;

  const ownedPlayerCount = useMemo(() => {
    const seen = new Set<string>();
    allLeagueData.forEach((entry) => (entry.roster?.players || []).forEach((id) => seen.add(id)));
    return seen.size;
  }, [allLeagueData]);

  const openTradeCount = useMemo(
    () => allTradeAttempts.filter((a) => a.status === "PENDING").length,
    [allTradeAttempts]
  );

  const injuredCount = useMemo(() => getInjuredCount(injuryReportPlayers), [injuryReportPlayers]);

  return (
    <div className="min-h-screen bg-slate-950 p-6 text-white">
      <div className="mb-8">
        <h1 className="text-4xl font-bold">Welcome back, {username || "builder"}</h1>
        <p className="mt-2 text-slate-400">
          Manage your leagues, surface what changed, and keep the next move obvious.
        </p>
      </div>

      {isConnected && (
        <div className="mb-8 space-y-6">
          <StatStrip
            leagueCount={allLeagueData.length}
            ownedPlayerCount={ownedPlayerCount}
            openTradeCount={openTradeCount}
            injuredCount={injuredCount}
          />

          <div>
            <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Your Teams
            </h2>
            <TeamSummaryGrid
              entries={allLeagueData}
              loading={loadingAllLeagueData}
              onSelectLeague={onSelectLeague}
              leagueOverviewData={leagueOverviewData}
              redraftValues={redraftValues}
              committedSimsByLeague={committedSimsByLeague}
              leagueSimCache={leagueSimCache}
            />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ValueMoversPanel alerts={visibleDashboardAlerts} onViewAll={() => onNavigate("ALERTS")} />
            <RecentAlertsPanel
              alerts={actionableDashboardAlerts.length > 0 ? actionableDashboardAlerts : visibleDashboardAlerts}
              onDismiss={onDismissAlert}
              onViewAll={() => onNavigate("ALERTS")}
            />
          </div>
        </div>
      )}

      {!isConnected && (
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
          Sign in and connect Sleeper to activate your league workspace and alerts page.
        </div>
      )}
    </div>
  );
}
