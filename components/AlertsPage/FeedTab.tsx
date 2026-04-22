"use client";
import type { SleeperPlayer } from "../../lib/types";
import type { DashboardAlert } from "./alertsPageHelpers";
import { severityStyles, resolvePlayerIdsInDetail } from "./alertsPageHelpers";

type FeedTabProps = {
  alerts: DashboardAlert[];
  actionableAlerts: DashboardAlert[];
  onDismissAlert: (alertId: string) => void;
  loadingExternalAlerts: boolean;
  players: Record<string, SleeperPlayer>;
};

export default function FeedTab({ alerts, actionableAlerts, onDismissAlert, loadingExternalAlerts, players }: FeedTabProps) {
  return (
    <div className="grid gap-3">
      {loadingExternalAlerts && (
        <p className="text-xs text-blue-400 -mb-1">Refreshing alerts...</p>
      )}
      {alerts.length > 1 && (
        <div className="flex justify-end -mb-1">
          <button
            type="button"
            onClick={() => alerts.forEach((a) => onDismissAlert(a.id))}
            className="text-xs text-slate-500 hover:text-red-300 transition"
          >
            Dismiss all
          </button>
        </div>
      )}
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
              <div className="mt-1 text-sm text-slate-300">
                {alert.category === "league" && alert.source !== "internal"
                  ? resolvePlayerIdsInDetail(alert.detail, players)
                  : alert.detail}
              </div>
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
  );
}
