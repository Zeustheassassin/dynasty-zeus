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
};

const severityStyles = {
  high: "border-red-700/70 bg-red-950/40 text-red-200",
  medium: "border-amber-700/70 bg-amber-950/40 text-amber-200",
  low: "border-slate-700 bg-slate-900 text-slate-200",
};

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
}: AlertsPageProps) {
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
          <div className="rounded-2xl border border-blue-800/60 bg-blue-950/40 px-3 py-2 text-right">
            <div className="text-[11px] uppercase tracking-[0.18em] text-blue-300">Live feed</div>
            <div className="mt-1 text-lg font-semibold text-white">{alerts.length}</div>
            <div className="text-xs text-slate-400">
              {loadingExternalAlerts ? "Refreshing news..." : `${actionableAlerts.length} actionable now`}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
            Feed
          </div>
          <div className="mt-4 grid gap-3">
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
        </div>

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
