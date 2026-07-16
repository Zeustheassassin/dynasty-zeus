"use client";
import { severityStyles } from "../AlertsPage/alertsPageHelpers";
import type { DashboardAlert } from "../AlertsPage/alertsPageHelpers";

interface RecentAlertsPanelProps {
  alerts: DashboardAlert[];
  onDismiss: (alertId: string) => void;
  onViewAll: () => void;
}

// Weekly alerts (R7) — the top actionable items, same feed AlertsPage's
// "alerts" tab renders in full; capped to 5 here for the dashboard glance.
export default function RecentAlertsPanel({ alerts, onDismiss, onViewAll }: RecentAlertsPanelProps) {
  const shown = alerts.slice(0, 5);

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Recent Alerts</div>
        <button type="button" onClick={onViewAll} className="text-xs text-blue-300 hover:text-blue-200">
          View all →
        </button>
      </div>

      {shown.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">Nothing actionable right now — you&apos;re caught up.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {shown.map((alert) => (
            <div
              key={alert.id}
              className={`flex items-start justify-between gap-3 rounded-2xl border p-3 ${severityStyles[alert.severity] || severityStyles.low}`}
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white">{alert.title}</div>
                <div className="mt-0.5 truncate text-xs text-slate-300">{alert.detail}</div>
              </div>
              <button
                type="button"
                onClick={() => onDismiss(alert.id)}
                className="shrink-0 rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-slate-200 transition hover:border-white/25"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
