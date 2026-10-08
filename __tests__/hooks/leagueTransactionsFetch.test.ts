import { describe, it, expect, vi, beforeEach } from "vitest";

// The Alerts Hub read the newest 200 league_transactions_cache rows of every type, and
// in-season waiver / free-agent moves are ~90% of them: 200 rows reached back ~3-4 days and
// every older trade fell off the Trades tab. Trades are now their own window.

type Row = { user_id: string; created: number; payload: { transaction_id: string; type: string } };

// In-memory league_transactions_cache behind a chainable fake of the supabase-js query builder.
// Filters are actually applied, so the tests check which rows come back, not which calls were made.
const db = vi.hoisted(() => ({
  rows: [] as Row[],
  error: null as null | { on: "trade" | "other"; message: string },
}));

vi.mock("@/lib/supabaseclient", () => {
  const col = (r: Row, c: string): unknown =>
    c === "payload->>type" ? r.payload.type : (r as unknown as Record<string, unknown>)[c];
  const query = () => {
    const filters: Array<(r: Row) => boolean> = [];
    let wantsTrades = false;
    let limit = Infinity;
    const b = {
      select: () => b,
      eq: (c: string, v: unknown) => {
        if (c === "payload->>type") wantsTrades = true;
        filters.push((r) => col(r, c) === v);
        return b;
      },
      neq: (c: string, v: unknown) => { filters.push((r) => col(r, c) !== v); return b; },
      gte: (c: string, v: number) => { filters.push((r) => Number(col(r, c)) >= v); return b; },
      order: () => b,
      limit: (n: number) => { limit = n; return b; },
      then: (resolve: (v: unknown) => void) => {
        const failing = db.error && (db.error.on === "trade") === wantsTrades;
        if (failing) return resolve({ data: null, error: { message: db.error!.message } });
        const data = db.rows
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, z) => z.created - a.created)
          .slice(0, limit)
          .map((r) => ({ payload: r.payload, created: r.created }));
        resolve({ data, error: null });
      },
    };
    return b;
  };
  return { supabase: { from: () => query() } };
});

import { fetchCachedLeagueTransactions } from "@/hooks/leagueTransactionsFetch";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

function tx(id: string, type: string, daysAgo: number, user = "me"): Row {
  return { user_id: user, created: NOW - daysAgo * DAY, payload: { transaction_id: id, type } };
}

beforeEach(() => {
  db.rows = [];
  db.error = null;
});

describe("fetchCachedLeagueTransactions", () => {
  it("keeps every recent trade when hundreds of newer waiver moves would have crowded them out", async () => {
    db.rows = [
      ...Array.from({ length: 10 }, (_, i) => tx(`t${i}`, "trade", 20 + i * 0.1)),
      ...Array.from({ length: 500 }, (_, i) => tx(`w${i}`, i % 2 ? "waiver" : "free_agent", i * 0.01)),
    ];

    const txs = await fetchCachedLeagueTransactions("me", NOW);

    expect(txs.filter((t) => t.type === "trade")).toHaveLength(10);
    expect(txs.filter((t) => t.type !== "trade")).toHaveLength(200);
    // newest first across both windows
    const createds = txs.map((t) => db.rows.find((r) => r.payload.transaction_id === t.transaction_id)!.created);
    expect(createds).toEqual([...createds].sort((a, b) => b - a));
  });

  it("shows trades from the last 30 days only, at most the newest 100", async () => {
    db.rows = [
      ...Array.from({ length: 150 }, (_, i) => tx(`t${i}`, "trade", i * 0.15)), // 0 .. 22.35 days
      tx("old-trade", "trade", 31),
    ];

    const trades = await fetchCachedLeagueTransactions("me", NOW);

    expect(trades).toHaveLength(100);
    expect(trades[0].transaction_id).toBe("t0");
    expect(trades[99].transaction_id).toBe("t99");
    expect(trades.some((t) => t.transaction_id === "old-trade")).toBe(false);
  });

  it("reads only the signed-in user's rows", async () => {
    db.rows = [tx("mine", "trade", 1), tx("theirs", "trade", 1, "someone-else")];

    const txs = await fetchCachedLeagueTransactions("me", NOW);

    expect(txs.map((t) => t.transaction_id)).toEqual(["mine"]);
  });

  it.each(["trade", "other"] as const)("throws rather than returning half a feed when the %s read fails", async (on) => {
    db.rows = [tx("t", "trade", 1), tx("w", "waiver", 1)];
    db.error = { on, message: "boom" };

    await expect(fetchCachedLeagueTransactions("me", NOW)).rejects.toThrow("boom");
  });
});
