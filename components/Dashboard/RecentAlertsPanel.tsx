"use client";
import { severityStyles } from "../AlertsPage/alertsPageHelpers";
import type { DashboardAlert } from "../AlertsPage/alertsPageHelpers";
import { Card } from "../ui/Card";
import Button from "../ui/Button";

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
    <Card padding="lg" elevated>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Recent Alerts</div>
        <Button variant="link" size="none" className="text-xs" onClick={onViewAll}>
          View all →
        </Button>
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
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => onDismiss(alert.id)}>
                Dismiss
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
