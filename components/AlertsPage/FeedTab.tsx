"use client";
import { memo } from "react";
import type { DashboardAlert } from "./alertsPageHelpers";
import { severityStyles } from "./alertsPageHelpers";
import Button from "../ui/Button";
import Badge from "../ui/Badge";
import EmptyState from "../ui/EmptyState";

type FeedTabProps = {
  alerts: DashboardAlert[];
  actionableAlerts: DashboardAlert[];
  onDismissAlert: (alertId: string) => void;
};

function FeedTab({ alerts, actionableAlerts, onDismissAlert }: FeedTabProps) {
  return (
    <div className="grid gap-3">
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
                <Badge className="border-white/10 bg-black/20 uppercase tracking-[0.16em]">
                  {alert.category}
                </Badge>
                <span className="text-[11px] uppercase tracking-[0.16em] text-slate-300/80">
                  {alert.source}
                </span>
              </div>
              <div className="mt-2 text-sm font-semibold text-white">{alert.title}</div>
              <div className="mt-1 text-sm text-slate-300">{alert.detail}</div>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onDismissAlert(alert.id)}>
              Dismiss
            </Button>
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
        <EmptyState>Once values move, statuses change, or watchlist/news triggers hit, alerts will land here.</EmptyState>
      )}
    </div>
  );
}

export default memo(FeedTab);
