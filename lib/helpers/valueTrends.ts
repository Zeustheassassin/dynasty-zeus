// ============================================================
// Value Trends helpers — compares current dynasty values against the
// historical baseline snapshot (player_value_snapshots / HistoricalSnapshot).
// Shared by the Data Hub's Value Trends "My League Trends" view and the
// Dashboard's Value Movers panel, so both surfaces agree on which players
// count as meaningfully "moved."
// ============================================================
import type { HistoricalSnapshot, SleeperPlayer } from "../types";

// Hide low-value noise: a player going 10 -> 12 is "+20%" but means nothing.
// Require the player to be >500 in either the current map or the snapshot.
export const VALUE_TREND_FLOOR = 500;

export interface ValueTrendRow {
  playerId: string;
  full_name: string;
  position: string;
  currentVal: number;
  snapVal: number;
  delta: number;
  pct: number;
}

/** One row per QB/RB/WR/TE player with a real value on both sides of the snapshot. */
export function computeValueTrends(
  snap: HistoricalSnapshot | null,
  players: Record<string, SleeperPlayer>
): ValueTrendRow[] {
  if (!snap) return [];
  const out: ValueTrendRow[] = [];
  Object.entries(snap.players).forEach(([playerId, snapData]) => {
    const currentVal = players[playerId]?.value ?? 0;
    const snapVal = Number(snapData.value ?? 0);
    if (snapVal <= 0 || currentVal <= 0) return;
    if (currentVal < VALUE_TREND_FLOOR && snapVal < VALUE_TREND_FLOOR) return;
    const p = players[playerId];
    if (!p || !["QB", "RB", "WR", "TE"].includes(p.position)) return;
    const delta = currentVal - snapVal;
    const pct = (delta / snapVal) * 100;
    out.push({
      playerId,
      full_name: p.full_name ?? snapData.full_name,
      position: p.position,
      currentVal,
      snapVal,
      delta,
      pct,
    });
  });
  return out;
}

/** Splits into gainers/fallers, each sorted by percentage move (largest first). */
export function splitValueMovers(rows: ValueTrendRow[]): { gainers: ValueTrendRow[]; fallers: ValueTrendRow[] } {
  const gainers = rows.filter((r) => r.delta > 0).sort((a, b) => b.pct - a.pct);
  const fallers = rows.filter((r) => r.delta < 0).sort((a, b) => a.pct - b.pct);
  return { gainers, fallers };
}
