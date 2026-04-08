"use client";
import { useState } from "react";

type DashboardAlert = {
  id: string;
  category: string;
  source: string;
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
  link?: string | null;
  teamLabel?: string | null;
};

type WatchlistEntry = {
  player_id: string;
  label: string;
  threshold_up: number;
  threshold_down: number;
};

type SearchPlayer = {
  player_id: string;
  full_name: string;
  position: string;
  team?: string;
};

type AlertsPageProps = {
  alerts: DashboardAlert[];
  actionableAlerts: DashboardAlert[];
  watchlistEntries: WatchlistEntry[];
  watchlistSearch: string;
  onWatchlistSearchChange: (value: string) => void;
  watchlistSearchResults: SearchPlayer[];
  onAddWatchlist: (playerId: string) => void;
  onRemoveWatchlist: (playerId: string) => void;
  onDismissAlert: (alertId: string) => void;
  watchThresholdUp: string;
  watchThresholdDown: string;
  onWatchThresholdUpChange: (value: string) => void;
  onWatchThresholdDownChange: (value: string) => void;
  loadingExternalAlerts: boolean;
  leagueTransactions: any[];
  loadingTransactions: boolean;
  players: Record<string, any>;
};

const severityStyles = {
  high: "border-red-700/70 bg-red-950/40 text-red-200",
  medium: "border-amber-700/70 bg-amber-950/40 text-amber-200",
  low: "border-slate-700 bg-slate-900 text-slate-200",
};

const POS_COLOR: Record<string, string> = {
  QB: "text-red-400",
  RB: "text-green-400",
  WR: "text-blue-400",
  TE: "text-yellow-400",
};

function relTime(ts: number): string {
  const ms = Date.now() - ts;
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function TxCard({ tx, players }: { tx: any; players: Record<string, any> }) {
  const type: string = tx.type;
  const isTrade = type === "trade";
  const adds: Record<string, number> = tx.adds ?? {};
  const drops: Record<string, number> = tx.drops ?? {};
  const picks: any[] = tx.draft_picks ?? [];
  const rosterOwnerMap: Record<number, string> = tx.rosterOwnerMap ?? {};

  const hasAdds = Object.keys(adds).length > 0;
  const hasDrops = Object.keys(drops).length > 0;

  // Card border/bg per type
  const cardCls = isTrade
    ? "border-violet-800/40 bg-violet-950/10"
    : hasAdds && hasDrops
    ? "border-blue-800/40 bg-blue-950/10"
    : hasAdds
    ? "border-emerald-800/40 bg-emerald-950/10"
    : "border-red-800/40 bg-red-950/10";

  const typeLabel = isTrade
    ? "🔄 Trade"
    : hasAdds && hasDrops
    ? "↕ Waiver"
    : hasAdds
    ? "➕ FA Add"
    : "➖ FA Drop";

  const typeLabelCls = isTrade
    ? "bg-violet-900/50 text-violet-300"
    : hasAdds && hasDrops
    ? "bg-blue-900/50 text-blue-300"
    : hasAdds
    ? "bg-emerald-900/50 text-emerald-300"
    : "bg-red-900/50 text-red-300";

  const PlayerPill = ({ playerId }: { playerId: string }) => {
    const p = players[playerId];
    if (!p) return <span className="text-xs text-slate-400">{playerId}</span>;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className={`text-[10px] font-bold ${POS_COLOR[p.position] ?? "text-slate-400"}`}>{p.position}</span>
        <span className="text-xs text-white">{p.full_name}</span>
        {p.team && <span className="text-[10px] text-slate-500">{p.team}</span>}
      </span>
    );
  };

  const PickPill = ({ pick }: { pick: any }) => {
    const slotLabel = pick.slot && String(pick.slot).includes(".")
      ? `${pick.season} ${pick.slot}`
      : `${pick.season} Rd ${pick.round}`;
    const viaName = pick.roster_id !== pick.owner_id
      ? (rosterOwnerMap[pick.roster_id] ?? null)
      : null;
    return (
      <span className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-0.5">
        <span className="text-[10px] font-bold text-amber-400">PICK</span>
        <span className="text-xs text-white">{slotLabel}</span>
        {viaName && <span className="text-[10px] text-slate-500">via {viaName}</span>}
      </span>
    );
  };

  if (isTrade) {
    // Group receiving assets by roster_id
    const sides: Record<number, { players: string[]; picks: any[] }> = {};
    Object.entries(adds).forEach(([playerId, rosterId]) => {
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].players.push(playerId);
    });
    picks.forEach((pick: any) => {
      const rosterId = pick.owner_id;
      if (!sides[rosterId]) sides[rosterId] = { players: [], picks: [] };
      sides[rosterId].picks.push(pick);
    });

    return (
      <div className={`rounded-2xl border p-4 ${cardCls}`}>
        <div className="flex items-center gap-2 mb-3">
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
          <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
          <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
        </div>
        <div className="space-y-2">
          {Object.entries(sides).map(([rosterIdStr, side]) => {
            const rosterId = Number(rosterIdStr);
            const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId}`;
            return (
              <div key={rosterId}>
                <div className="text-[10px] font-semibold text-slate-400 mb-1">{ownerName} receives</div>
                <div className="flex flex-wrap gap-1.5">
                  {side.players.map((pid) => <PlayerPill key={pid} playerId={pid} />)}
                  {side.picks.map((pick, i) => <PickPill key={i} pick={pick} />)}
                </div>
              </div>
            );
          })}
          {Object.keys(sides).length === 0 && (
            <p className="text-xs text-slate-500">Pick-only trade — no player assets.</p>
          )}
        </div>
      </div>
    );
  }

  // Waiver / FA — single owner involved
  const rosterId = tx.roster_ids?.[0];
  const ownerName = rosterOwnerMap[rosterId] ?? `Team ${rosterId ?? "?"}`;

  return (
    <div className={`rounded-2xl border p-4 ${cardCls}`}>
      <div className="flex items-center gap-2 mb-2.5">
        <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${typeLabelCls}`}>{typeLabel}</span>
        <span className="text-xs font-semibold text-slate-300">{tx.leagueName}</span>
        <span className="ml-auto text-[11px] text-slate-500 shrink-0">{relTime(tx.created)}</span>
      </div>
      <div className="text-xs font-semibold text-slate-400 mb-2">{ownerName}</div>
      {hasAdds && (
        <div className="mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-emerald-400 font-semibold mr-2">Added</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(adds).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
      {hasDrops && (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-red-400 font-semibold mr-2">Dropped</span>
          <span className="inline-flex flex-wrap gap-1.5">
            {Object.keys(drops).map((pid) => <PlayerPill key={pid} playerId={pid} />)}
          </span>
        </div>
      )}
    </div>
  );
}

export default function AlertsPage({
  alerts,
  actionableAlerts,
  watchlistEntries,
  watchlistSearch,
  onWatchlistSearchChange,
  watchlistSearchResults,
  onAddWatchlist,
  onRemoveWatchlist,
  onDismissAlert,
  watchThresholdUp,
  watchThresholdDown,
  onWatchThresholdUpChange,
  onWatchThresholdDownChange,
  loadingExternalAlerts,
  leagueTransactions,
  loadingTransactions,
  players,
}: AlertsPageProps) {
  const [feedTab, setFeedTab] = useState<"alerts" | "transactions">("alerts");

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Alerts Center
            </div>
            <h1 className="mt-2 text-3xl font-semibold text-white">Actionable today</h1>
            <p className="mt-1 text-sm text-slate-400">
              Internal changes, watchlist triggers, and matched news in one place.
            </p>
          </div>
          <div className="flex gap-3">
            <div className="rounded-2xl border border-blue-800/60 bg-blue-950/40 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300">Live feed</div>
              <div className="mt-1 text-lg font-semibold text-white">{alerts.length}</div>
              <div className="text-xs text-slate-400">
                {loadingExternalAlerts ? "Refreshing news..." : `${actionableAlerts.length} actionable now`}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-700 bg-slate-900/60 px-3 py-2 text-right">
              <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Transactions</div>
              <div className="mt-1 text-lg font-semibold text-white">{leagueTransactions.length}</div>
              <div className="text-xs text-slate-500">
                {loadingTransactions ? "Loading…" : "across all leagues"}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        {/* ── Left: Feed + Transactions ── */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          {/* Tab toggle */}
          <div className="flex gap-1 bg-slate-800/60 rounded-xl p-1 mb-4 w-fit">
            {(["alerts", "transactions"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setFeedTab(tab)}
                className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition ${
                  feedTab === tab
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:text-white"
                }`}
              >
                {tab === "alerts" ? `Alerts ${alerts.length > 0 ? `(${alerts.length})` : ""}` : `Transactions ${leagueTransactions.length > 0 ? `(${leagueTransactions.length})` : ""}`}
              </button>
            ))}
          </div>

          {/* ── Alerts tab ── */}
          {feedTab === "alerts" && (
            <div className="grid gap-3">
              {(actionableAlerts.length > 0 ? actionableAlerts : alerts).slice(0, 20).map((alert) => (
                <div
                  key={alert.id}
                  className={`rounded-2xl border p-4 ${severityStyles[alert.severity] || severityStyles.low}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                          {alert.category}
                        </span>
                        <span className="text-[11px] uppercase tracking-[0.16em] text-slate-300/80">
                          {alert.source}
                        </span>
                      </div>
                      <div className="mt-2 text-sm font-semibold text-white">{alert.title}</div>
                      <div className="mt-1 text-sm text-slate-300">{alert.detail}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onDismissAlert(alert.id)}
                      className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-white/25"
                    >
                      Dismiss
                    </button>
                  </div>

                  {(alert.link || alert.teamLabel) && (
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-300">
                      {alert.teamLabel && <span>{alert.teamLabel}</span>}
                      {alert.link && (
                        <a
                          href={alert.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-300 transition hover:text-blue-200"
                        >
                          Open source
                        </a>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {alerts.length === 0 && (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  Once values move, statuses change, or watchlist/news triggers hit, alerts will land here.
                </div>
              )}
            </div>
          )}

          {/* ── Transactions tab ── */}
          {feedTab === "transactions" && (
            <div>
              {loadingTransactions ? (
                <p className="text-sm text-blue-400 py-4">Loading transactions across all leagues…</p>
              ) : leagueTransactions.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-6 text-sm text-slate-400">
                  No recent transactions found. Make sure your leagues are loaded.
                </div>
              ) : (
                <div className="space-y-3">
                  {leagueTransactions.map((tx: any) => (
                    <TxCard key={`${tx.leagueId}-${tx.transaction_id}`} tx={tx} players={players} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Watchlists (unchanged) ── */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Watchlists
          </div>
          <h2 className="mt-2 text-2xl font-semibold text-white">Track your swings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Add players and alert thresholds for market spikes, drops, and matching news.
          </p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <label className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Spike threshold</div>
              <input
                value={watchThresholdUp}
                onChange={(e) => onWatchThresholdUpChange(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="rounded-2xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Drop threshold</div>
              <input
                value={watchThresholdDown}
                onChange={(e) => onWatchThresholdDownChange(e.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <input
            className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="Search a player to watch..."
            value={watchlistSearch}
            onChange={(e) => onWatchlistSearchChange(e.target.value)}
          />

          {watchlistSearchResults.length > 0 && (
            <div className="mt-3 space-y-2">
              {watchlistSearchResults.map((player) => (
                <div
                  key={player.player_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{player.full_name}</div>
                    <div className="text-xs text-slate-400">
                      {player.position} {player.team ? `- ${player.team}` : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onAddWatchlist(String(player.player_id))}
                    className="rounded-full border border-blue-700 bg-blue-950/40 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:border-blue-500"
                  >
                    Watch
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 space-y-2">
            {watchlistEntries.map((entry) => (
              <div
                key={entry.player_id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 px-3 py-3"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-white">{entry.label}</div>
                  <div className="text-xs text-slate-400">
                    +{entry.threshold_up} / -{entry.threshold_down}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onRemoveWatchlist(entry.player_id)}
                  className="rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-red-500 hover:text-red-300"
                >
                  Remove
                </button>
              </div>
            ))}

            {watchlistEntries.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                No watchlist entries yet. Add a player above and the alert feed will start tracking them.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
