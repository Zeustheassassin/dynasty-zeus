"use client";
import type { WatchlistEntry, SleeperPlayer } from "../lib/types";
import type { DashboardAlert, LeagueTransaction, InjuryReportPlayer } from "./AlertsPage/alertsPageHelpers";
import { POS_COLOR } from "./AlertsPage/alertsPageHelpers";
import { useAlertsState } from "./AlertsPage/hooks/useAlertsState";
import TxCard from "./AlertsPage/TxCard";
import FeedTab from "./AlertsPage/FeedTab";
import InjuryTab from "./AlertsPage/InjuryTab";
import { Card } from "./ui/Card";
import Badge from "./ui/Badge";
import EmptyState from "./ui/EmptyState";

type AlertsPageProps = {
  alerts: DashboardAlert[];
  actionableAlerts: DashboardAlert[];
  watchlistEntries: WatchlistEntry[];
  onDismissAlert: (alertId: string) => void;
  leagueTransactions: LeagueTransaction[];
  loadingTransactions: boolean;
  players: Record<string, SleeperPlayer>;
  injuryReportPlayers: InjuryReportPlayer[];
  currentNFLWeek: number;
  allTradeAttempts: { id: string; league_id: string; status: string }[];
  allLeagues: { league_id: string; name: string }[];
  onNavigateToAttempts: (leagueId: string) => void;
};

export default function AlertsPage({
  alerts,
  actionableAlerts,
  onDismissAlert,
  leagueTransactions,
  loadingTransactions,
  players,
  injuryReportPlayers,
  currentNFLWeek,
  allTradeAttempts,
  allLeagues,
  onNavigateToAttempts,
}: AlertsPageProps) {
  const {
    feedTab,
    setFeedTab,
    expandedInjuryId,
    setExpandedInjuryId,
    tradeActivity,
    waiverActivity,
    injuredCount,
    byeGroups,
    byeWeekNumbers,
    marketAlerts,
    gainers,
    fallers,
    TABS,
  } = useAlertsState({
    leagueTransactions,
    injuryReportPlayers,
    currentNFLWeek,
    alerts,
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <Card padding="lg" elevated>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Alerts Center
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Actionable today</h1>
            <p className="mt-1 text-sm text-slate-400">
              Internal changes, watchlist triggers, and league activity in one place.
            </p>
          </div>
          <div className="flex gap-3 flex-wrap">
            <div className="rounded-2xl border border-blue-800/60 bg-blue-950/40 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300">Alerts</div>
              <div className="mt-1 text-lg font-semibold text-white">{alerts.length}</div>
              <div className="text-xs text-slate-400">{actionableAlerts.length} actionable now</div>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Trades</div>
              <div className="mt-1 text-lg font-semibold text-white">{tradeActivity.length}</div>
              <div className="text-xs text-slate-500">
                {loadingTransactions ? "Loading…" : `${waiverActivity.length} waiver moves`}
              </div>
            </div>
            {injuredCount > 0 && (
              <div className="rounded-2xl border border-red-800/60 bg-red-950/30 px-3 py-2 text-right">
                <div className="text-[11px] uppercase tracking-[0.18em] text-red-400">Injured</div>
                <div className="mt-1 text-lg font-semibold text-white">{injuredCount}</div>
                <div className="text-xs text-slate-500">tracked players</div>
              </div>
            )}
          </div>
        </div>
      </Card>

      {(() => {
        const openByLeague = allLeagues
          .map((lg) => ({
            leagueId: lg.league_id,
            name: lg.name,
            count: allTradeAttempts.filter(
              (a) => a.league_id === lg.league_id && a.status === "PENDING"
            ).length,
          }))
          .filter((entry) => entry.count > 0)
          .sort((a, b) => b.count - a.count);
        if (openByLeague.length === 0) return null;
        return (
          <Card padding="lg" elevated>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Open Trades</div>
            <h2 className="mt-1 text-lg font-semibold text-white">Pending across all leagues</h2>
            <div className="mt-3 divide-y divide-slate-800">
              {openByLeague.map((entry) => (
                <button
                  key={entry.leagueId}
                  onClick={() => onNavigateToAttempts(entry.leagueId)}
                  className="w-full flex items-center justify-between py-2 text-left group hover:bg-slate-800/40 rounded-lg px-2 -mx-2 transition"
                >
                  <span className="text-sm text-slate-200 group-hover:text-white transition">{entry.name}</span>
                  <Badge tone="warning" className="group-hover:border-amber-500 transition">
                    {entry.count} open →
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
        );
      })()}

      <Card padding="lg" elevated>
        <div className="flex flex-wrap gap-1 bg-slate-800/60 rounded-xl p-1 mb-4">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFeedTab(tab.key)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
                feedTab === tab.key
                  ? "bg-slate-700 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {feedTab === "alerts" && (
          <FeedTab
            alerts={alerts}
            actionableAlerts={actionableAlerts}
            onDismissAlert={onDismissAlert}
          />
        )}

        {feedTab === "transactions" && (
          <div>
            {loadingTransactions ? (
              <p className="text-sm text-blue-400 py-4">Loading trades across your leagues…</p>
            ) : tradeActivity.length === 0 ? (
              <EmptyState>No recent trades found in your leagues.</EmptyState>
            ) : (
              <div className="space-y-3">
                {tradeActivity.map((tx) => (
                  <TxCard key={`${tx.leagueId}-${tx.transaction_id}`} tx={tx} players={players} />
                ))}
              </div>
            )}
          </div>
        )}

        {feedTab === "waivers" && (
          <div>
            {loadingTransactions ? (
              <p className="text-sm text-blue-400 py-4">Loading waiver activity…</p>
            ) : waiverActivity.length === 0 ? (
              <EmptyState>No recent waiver or free agent moves found across your leagues.</EmptyState>
            ) : (
              <div className="space-y-3">
                {waiverActivity.map((tx) => (
                  <TxCard key={`${tx.leagueId}-${tx.transaction_id}`} tx={tx} players={players} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* hidden bye watch tab — kept for potential future use */}
        {(feedTab as string) === "byes" && (
          <div>
            {currentNFLWeek === 0 ? (
              <EmptyState>Bye watch is active during the regular season. Check back once the NFL season begins.</EmptyState>
            ) : byeWeekNumbers.length === 0 ? (
              <EmptyState>No owned players on bye in the next 3 weeks. You&apos;re in the clear.</EmptyState>
            ) : (
              <div className="space-y-5">
                {byeWeekNumbers.map((week) => {
                  const offset = week - currentNFLWeek;
                  const label =
                    offset === 0 ? "This Week" :
                    offset === 1 ? "Next Week" :
                    "2 Weeks Out";
                  const urgency =
                    offset === 0 ? "border-red-700/60 bg-red-950/10 text-red-300" :
                    offset === 1 ? "border-amber-700/60 bg-amber-950/10 text-amber-300" :
                    "border-slate-700 bg-slate-900/40 text-slate-400";
                  const weekPlayers = byeGroups[week];
                  const byPos: Record<string, InjuryReportPlayer[]> = {};
                  weekPlayers.forEach((entry) => {
                    const pos = entry.player.position || "?";
                    if (!byPos[pos]) byPos[pos] = [];
                    byPos[pos].push(entry);
                  });
                  return (
                    <div key={week} className={`rounded-2xl border p-4 ${urgency.split(" ").slice(0, 2).join(" ")}`}>
                      <div className="flex items-center gap-3 mb-3">
                        <span className={`text-[10px] font-bold uppercase tracking-[0.2em] ${urgency.split(" ")[2]}`}>
                          {label}
                        </span>
                        <span className="text-sm font-semibold text-white">Week {week} Bye</span>
                        <span className="ml-auto text-[11px] text-slate-500">{weekPlayers.length} player{weekPlayers.length !== 1 ? "s" : ""}</span>
                      </div>
                      <div className="space-y-2">
                        {(["QB", "RB", "WR", "TE"] as const)
                          .filter((pos) => byPos[pos]?.length > 0)
                          .map((pos) => (
                            <div key={pos} className="flex items-start gap-2">
                              <span className={`text-[10px] font-bold w-7 shrink-0 pt-0.5 ${POS_COLOR[pos] ?? "text-slate-400"}`}>{pos}</span>
                              <div className="flex flex-wrap gap-1.5">
                                {byPos[pos].map(({ player, playerId, leagues, startingLeagues }) => (
                                  <span
                                    key={playerId}
                                    className={`text-xs px-2.5 py-1 rounded-xl border ${
                                      startingLeagues.length > 0
                                        ? "border-emerald-700/60 bg-emerald-950/30 text-emerald-200"
                                        : "border-slate-700 bg-slate-800/50 text-slate-300"
                                    }`}
                                    title={`${leagues.length} league${leagues.length !== 1 ? "s" : ""}${startingLeagues.length > 0 ? ` — starting in ${startingLeagues.length}` : ""}`}
                                  >
                                    {player.full_name}
                                    {startingLeagues.length > 0 && (
                                      <span className="ml-1 text-[9px] text-emerald-400">★{startingLeagues.length}</span>
                                    )}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-slate-600 text-center">
                  Green highlight = currently in a starting lineup · ★ = number of leagues starting
                </p>
              </div>
            )}
          </div>
        )}

        {/* hidden value movers tab — kept for potential future use */}
        {(feedTab as string) === "movers" && (
          <div>
            {marketAlerts.length === 0 ? (
              <EmptyState>No significant value movement detected yet. Value movers appear once players cross your threshold in either direction.</EmptyState>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400 mb-2">
                    Gaining Value ({gainers.length})
                  </div>
                  <div className="space-y-2">
                    {gainers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
                        No gainers detected.
                      </div>
                    ) : gainers.map((alert) => {
                      const delta = (alert.payload?.["delta"] as number | undefined) ?? 0;
                      return (
                        <div key={alert.id} className="rounded-2xl border border-emerald-800/40 bg-emerald-950/10 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{alert.title.replace(" is climbing", "")}</div>
                              {alert.teamLabel && (
                                <div className="text-[10px] text-slate-500">{alert.teamLabel}</div>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-bold text-emerald-400">+{delta.toLocaleString()}</div>
                              <div className="text-[10px] text-slate-500">dynasty pts</div>
                            </div>
                          </div>
                          {alert.severity === "high" && (
                            <div className="mt-1.5 text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">Major spike</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-400 mb-2">
                    Losing Value ({fallers.length})
                  </div>
                  <div className="space-y-2">
                    {fallers.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-4 text-xs text-slate-500">
                        No fallers detected.
                      </div>
                    ) : fallers.map((alert) => {
                      const delta = Math.abs((alert.payload?.["delta"] as number | undefined) ?? 0);
                      return (
                        <div key={alert.id} className="rounded-2xl border border-red-800/40 bg-red-950/10 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{alert.title.replace(" is falling", "")}</div>
                              {alert.teamLabel && (
                                <div className="text-[10px] text-slate-500">{alert.teamLabel}</div>
                              )}
                            </div>
                            <div className="shrink-0 text-right">
                              <div className="text-sm font-bold text-red-400">-{delta.toLocaleString()}</div>
                              <div className="text-[10px] text-slate-500">dynasty pts</div>
                            </div>
                          </div>
                          {alert.severity === "high" && (
                            <div className="mt-1.5 text-[10px] font-semibold text-red-300 uppercase tracking-wider">Major drop</div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {feedTab === "injury" && (
          <InjuryTab
            injuryReportPlayers={injuryReportPlayers}
            currentNFLWeek={currentNFLWeek}
            expandedInjuryId={expandedInjuryId}
            setExpandedInjuryId={setExpandedInjuryId}
          />
        )}
      </Card>
    </div>
  );
}
