"use client";
import { useMemo } from "react";
import { usePlayers } from "../../lib/PlayersContext";
import { computeValueTrends, splitValueMovers } from "../../lib/helpers/valueTrends";
import type { HistoricalSnapshot } from "../../lib/types";
import { Card } from "../ui/Card";
import Button from "../ui/Button";

interface ValueMoversPanelProps {
  historicalSnapshot: HistoricalSnapshot | null;
  onViewAll: () => void;
}

const TOP_N = 5;

// Top value movers — same computation the Data Hub's Value Trends "My League
// Trends" view uses (lib/helpers/valueTrends.ts), so the two surfaces always
// agree; capped to the top 5 per side for a glanceable dashboard card instead
// of the full feed.
export default function ValueMoversPanel({ historicalSnapshot, onViewAll }: ValueMoversPanelProps) {
  const players = usePlayers();
  const { gainers, fallers } = useMemo(
    () => splitValueMovers(computeValueTrends(historicalSnapshot, players)),
    [historicalSnapshot, players]
  );

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
              {gainers.slice(0, TOP_N).map((row) => (
                <div key={row.playerId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-200">{row.full_name}</span>
                  <span className="shrink-0 font-mono text-emerald-400">+{row.delta.toLocaleString()}</span>
                </div>
              ))}
              {gainers.length === 0 && <p className="text-xs text-slate-600 italic">None</p>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-red-400">Falling</div>
            <div className="space-y-1.5">
              {fallers.slice(0, TOP_N).map((row) => (
                <div key={row.playerId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-slate-200">{row.full_name}</span>
                  <span className="shrink-0 font-mono text-red-400">{row.delta.toLocaleString()}</span>
                </div>
              ))}
              {fallers.length === 0 && <p className="text-xs text-slate-600 italic">None</p>}
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
