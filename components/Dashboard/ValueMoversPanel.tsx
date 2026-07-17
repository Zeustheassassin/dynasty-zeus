"use client";
import { getMarketMovers } from "../AlertsPage/alertsPageHelpers";
import type { DashboardAlert } from "../AlertsPage/alertsPageHelpers";
import { Card } from "../ui/Card";
import Button from "../ui/Button";

interface ValueMoversPanelProps {
  alerts: DashboardAlert[];
  onViewAll: () => void;
}

// Top value movers (R7) among owned + watchlisted players — reuses the same
// gainers/fallers split as AlertsPage's "movers" tab (components/AlertsPage/
// alertsPageHelpers.ts's getMarketMovers), just capped to 3 per side for a
// glanceable dashboard card instead of the full feed.
export default function ValueMoversPanel({ alerts, onViewAll }: ValueMoversPanelProps) {
  const { gainers, fallers } = getMarketMovers(alerts);

  return (
    <Card padding="lg" elevated>
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">Value Movers</div>
        <Button variant="link" size="none" className="text-xs" onClick={onViewAll}>
          View all →
        </Button>
      </div>

      {gainers.length === 0 && fallers.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">No significant value movement detected yet.</p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-400">Gaining</div>
            <div className="space-y-1.5">
              {gainers.slice(0, 3).map((alert) => {
                const delta = (alert.payload?.["delta"] as number | undefined) ?? 0;
                return (
                  <div key={alert.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-200">{alert.title.replace(" is climbing", "")}</span>
                    <span className="shrink-0 font-mono text-emerald-400">+{delta.toLocaleString()}</span>
                  </div>
                );
              })}
              {gainers.length === 0 && <p className="text-xs text-slate-600 italic">None</p>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Falling</div>
            <div className="space-y-1.5">
              {fallers.slice(0, 3).map((alert) => {
                const delta = Math.abs((alert.payload?.["delta"] as number | undefined) ?? 0);
                return (
                  <div key={alert.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-slate-200">{alert.title.replace(" is falling", "")}</span>
                    <span className="shrink-0 font-mono text-red-400">-{delta.toLocaleString()}</span>
                  </div>
                );
              })}
              {fallers.length === 0 && <p className="text-xs text-slate-600 italic">None</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
