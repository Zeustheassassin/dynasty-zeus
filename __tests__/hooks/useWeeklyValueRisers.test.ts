// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWeeklyValueRisers, resetWeeklyValueRisersCache } from "@/hooks/useWeeklyValueRisers";

// Waiver Watch's 7-day risers read player_value_history (migration 047): the latest snapshot vs the
// newest one at least 7 days older — a skipped cron day must widen the window, never shorten it.

interface QueryState {
  cols?: string;
  lte?: string;
  eq?: string;
  limit?: number;
}

const db = vi.hoisted(() => ({
  rows: [] as { player_id: string; snapshot_date: string; value: number }[],
  fail: false,
  queries: [] as QueryState[],
}));

vi.mock("@/lib/supabaseclient", () => {
  function answer(q: QueryState) {
    if (db.fail) return { data: null, error: { message: "boom" } };
    if (q.cols === "snapshot_date") {
      const dates = [...new Set(db.rows.map((r) => r.snapshot_date))]
        .filter((d) => !q.lte || d <= q.lte)
        .sort()
        .reverse()
        .slice(0, q.limit ?? Infinity);
      return { data: dates.map((snapshot_date) => ({ snapshot_date })), error: null };
    }
    return {
      data: db.rows.filter((r) => r.snapshot_date === q.eq).map(({ player_id, value }) => ({ player_id, value })),
      error: null,
    };
  }
  return {
    supabase: {
      from: () => {
        const state: QueryState = {};
        db.queries.push(state);
        const query = {
          select: (cols: string) => { state.cols = cols; return query; },
          lte: (_col: string, v: string) => { state.lte = v; return query; },
          eq: (_col: string, v: string) => { state.eq = v; return query; },
          order: () => query,
          limit: (n: number) => { state.limit = n; return query; },
          then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(answer(state)).then(resolve, reject),
        };
        return query;
      },
    },
  };
});

const row = (player_id: string, snapshot_date: string, value: number) => ({ player_id, snapshot_date, value });

beforeEach(() => {
  resetWeeklyValueRisersCache();
  db.fail = false;
  db.queries = [];
  // Latest 10/14; the cron skipped 10/07, so the base is 10/06 — not 10/08.
  db.rows = [
    row("a", "2026-10-14", 3000), row("b", "2026-10-14", 1500),
    row("a", "2026-10-08", 2900), row("b", "2026-10-08", 1000),
    row("a", "2026-10-06", 2000), row("b", "2026-10-06", 1400),
    row("a", "2026-10-01", 100),
  ];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useWeeklyValueRisers", () => {
  it("compares the latest snapshot with the newest one at least 7 days older", async () => {
    const { result } = renderHook(() => useWeeklyValueRisers(true));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({
      latestDate: "2026-10-14",
      baseDate: "2026-10-06",
      risers: [
        { playerId: "a", from: 2000, to: 3000, gain: 1000 },
        { playerId: "b", from: 1400, to: 1500, gain: 100 },
      ],
    });
    expect(db.queries.find((q) => q.lte)?.lte).toBe("2026-10-07");
    // Each date is its own read, so neither nears PostgREST's 1000-row cap.
    expect(db.queries.filter((q) => q.eq).map((q) => q.eq).sort()).toEqual(["2026-10-06", "2026-10-14"]);
  });

  it("answers no data (not an error) with under a week of history", async () => {
    db.rows = [row("a", "2026-10-14", 3000), row("a", "2026-10-10", 2000)];
    const { result } = renderHook(() => useWeeklyValueRisers(true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("reuses the answer on the next mount without reading again", async () => {
    const first = renderHook(() => useWeeklyValueRisers(true));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const reads = db.queries.length;
    const second = renderHook(() => useWeeklyValueRisers(true));
    expect(second.result.current.loading).toBe(false);
    expect(second.result.current.data?.latestDate).toBe("2026-10-14");
    await act(async () => {});
    expect(db.queries.length).toBe(reads);
  });

  it("doesn't read while disabled", () => {
    const { result } = renderHook(() => useWeeklyValueRisers(false));
    expect(result.current.loading).toBe(false);
    expect(db.queries).toHaveLength(0);
  });

  it("surfaces a read error without caching it, and Retry recovers", async () => {
    db.fail = true;
    const { result } = renderHook(() => useWeeklyValueRisers(true));
    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.data).toBeNull();

    db.fail = false;
    act(() => result.current.retry());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data?.baseDate).toBe("2026-10-06"));
    expect(result.current.error).toBeNull();
  });
});
