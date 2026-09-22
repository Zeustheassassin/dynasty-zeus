import { describe, it, expect } from "vitest";
import { computeValueTrends, splitValueMovers, VALUE_TREND_FLOOR } from "@/lib/helpers/valueTrends";
import type { HistoricalSnapshot, SleeperPlayer, PlayerValueSnapshotEntry } from "@/lib/types";

const p = (over: Partial<SleeperPlayer>) => over as SleeperPlayer;
const snapEntry = (over: Partial<PlayerValueSnapshotEntry>) => over as PlayerValueSnapshotEntry;

function snapshot(players: Record<string, PlayerValueSnapshotEntry>): HistoricalSnapshot {
  return { players, recorded_at: "2026-09-01T00:00:00.000Z" };
}

describe("computeValueTrends", () => {
  it("returns null-snapshot as an empty array", () => {
    expect(computeValueTrends(null, {})).toEqual([]);
  });

  it("computes delta/pct against the current player value", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "A", value: 1000 }) });
    const players = { p1: p({ full_name: "A", position: "WR", value: 1200 }) };
    const rows = computeValueTrends(snap, players);
    expect(rows).toEqual([
      expect.objectContaining({ playerId: "p1", delta: 200, pct: 20 }),
    ]);
  });

  it("drops a player whose value is below the floor on both sides (noise)", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "A", value: 10 }) });
    const players = { p1: p({ full_name: "A", position: "WR", value: 12 }) };
    expect(computeValueTrends(snap, players)).toEqual([]);
  });

  it("keeps a player above the floor on only one side", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "A", value: 10 }) });
    const players = { p1: p({ full_name: "A", position: "WR", value: VALUE_TREND_FLOOR + 1 }) };
    expect(computeValueTrends(snap, players)).toHaveLength(1);
  });

  it("drops a player missing from the current players map (currentVal 0)", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "A", value: 1000 }) });
    expect(computeValueTrends(snap, {})).toEqual([]);
  });

  it("drops a non-QB/RB/WR/TE position", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "A", value: 1000 }) });
    const players = { p1: p({ full_name: "A", position: "K", value: 1200 }) };
    expect(computeValueTrends(snap, players)).toEqual([]);
  });

  it("falls back to the snapshot's own name when the player has since left the pool", () => {
    const snap = snapshot({ p1: snapEntry({ full_name: "Snapshot Name", value: 1000 }) });
    // Still present in `players` (else currentVal would be 0 and the row would be dropped
    // entirely) but with no full_name of its own.
    const players = { p1: p({ position: "WR", value: 1200, full_name: undefined as unknown as string }) };
    expect(computeValueTrends(snap, players)[0].full_name).toBe("Snapshot Name");
  });
});

describe("splitValueMovers", () => {
  it("splits gainers (delta > 0) from fallers (delta < 0), each sorted by pct magnitude", () => {
    const rows = [
      { playerId: "small-gain", full_name: "SG", position: "WR", currentVal: 1100, snapVal: 1000, delta: 100, pct: 10 },
      { playerId: "big-gain", full_name: "BG", position: "WR", currentVal: 1500, snapVal: 1000, delta: 500, pct: 50 },
      { playerId: "small-fall", full_name: "SF", position: "WR", currentVal: 900, snapVal: 1000, delta: -100, pct: -10 },
      { playerId: "big-fall", full_name: "BF", position: "WR", currentVal: 500, snapVal: 1000, delta: -500, pct: -50 },
    ];
    const { gainers, fallers } = splitValueMovers(rows);
    expect(gainers.map((r) => r.playerId)).toEqual(["big-gain", "small-gain"]);
    expect(fallers.map((r) => r.playerId)).toEqual(["big-fall", "small-fall"]);
  });

  it("excludes a zero-delta row from both sides", () => {
    const rows = [{ playerId: "flat", full_name: "F", position: "WR", currentVal: 1000, snapVal: 1000, delta: 0, pct: 0 }];
    const { gainers, fallers } = splitValueMovers(rows);
    expect(gainers).toEqual([]);
    expect(fallers).toEqual([]);
  });
});
