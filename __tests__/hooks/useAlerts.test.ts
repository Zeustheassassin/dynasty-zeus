// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlerts } from "@/hooks/useAlerts";
import type { AlertsCenterItem } from "@/lib/types";

// Deferred promise so the test controls exactly when a Supabase query "resolves",
// to reproduce a fast sign-out/sign-in race between two accounts.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type QueryResult = { data: unknown[] | null; error: null };

// One deferred pair (watchlists, alerts) per login, keyed by user id so the
// mock can resolve a specific account's queries independently.
const deferredsByUser = new Map<string, { watchlists: ReturnType<typeof deferred<QueryResult>>; alerts: ReturnType<typeof deferred<QueryResult>> }>();

function deferredsFor(userId: string) {
  let d = deferredsByUser.get(userId);
  if (!d) {
    d = { watchlists: deferred<QueryResult>(), alerts: deferred<QueryResult>() };
    deferredsByUser.set(userId, d);
  }
  return d;
}

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    from: (table: "watchlists" | "alerts") => ({
      select: () => ({
        eq: (_col: string, userId: string) => {
          if (table === "watchlists") return deferredsFor(userId).watchlists.promise;
          // alerts chain has extra .not/.order/.limit before resolving
          return {
            not: () => ({
              order: () => ({
                limit: () => deferredsFor(userId).alerts.promise,
              }),
            }),
          };
        },
      }),
      upsert: () => Promise.resolve({ error: null }),
    }),
  },
}));

beforeEach(() => {
  localStorage.clear();
  deferredsByUser.clear();
});

describe("useAlerts — login-sync race guard", () => {
  it("a slow account's stale watchlist data never lands after signing in as a different account", async () => {
    const players = {};
    type Props = { user: { id: string } | null };
    const { result, rerender } = renderHook(
      ({ user }: Props) => useAlerts({ supabaseUser: user, players }),
      { initialProps: { user: { id: "user-A" } } as Props }
    );

    // user-A's fetch is in flight (slow). Sign out, then sign in as user-B —
    // faster — before A's fetch resolves.
    act(() => { rerender({ user: null }); });
    act(() => { rerender({ user: { id: "user-B" } }); });

    // user-B's watchlist resolves quickly.
    act(() => {
      deferredsFor("user-B").watchlists.resolve({ data: [{ player_id: "b1", label: "B's pick" }], error: null });
      deferredsFor("user-B").alerts.resolve({ data: [], error: null });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.watchlistEntries).toEqual([{ player_id: "b1", label: "B's pick" }]);

    // user-A's stale fetch finally resolves — pre-fix this would silently
    // overwrite user-B's watchlist with user-A's data.
    act(() => {
      deferredsFor("user-A").watchlists.resolve({ data: [{ player_id: "a1", label: "A's pick" }], error: null });
      deferredsFor("user-A").alerts.resolve({ data: [], error: null });
    });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(result.current.watchlistEntries).toEqual([{ player_id: "b1", label: "B's pick" }]);
  });
});

// Regression: market-move alert ids used to bake the player's current value
// into the id (market-up-<id>-<value>), so a player's value moving again
// generated a brand-new id instead of replacing the prior alert — the same
// player could show up multiple times in the Dashboard's Value Movers panel.
// mergeDashboardAlerts now collapses both the old and new id shapes by
// player, keeping only the most recent.
describe("useAlerts — mergeDashboardAlerts dedupes market-move alerts by player", () => {
  const mkAlert = (over: Partial<AlertsCenterItem> & { id: string; playerId: string }): AlertsCenterItem => ({
    category: "market",
    source: "internal",
    severity: "medium",
    title: "Test Player is climbing",
    detail: "",
    actionable: true,
    timestamp: 0,
    ...over,
  });

  it("collapses legacy market-up ids for the same player, keeping the newer alert", () => {
    const { result } = renderHook(() => useAlerts({ supabaseUser: null, players: {} }));

    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-up-p1-1000", playerId: "p1", timestamp: 1000, detail: "gained 600" }),
      ]);
    });
    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-up-p1-2000", playerId: "p1", timestamp: 2000, detail: "gained 700" }),
      ]);
    });

    expect(result.current.dashboardAlerts).toHaveLength(1);
    expect(result.current.dashboardAlerts[0].detail).toBe("gained 700");
  });

  it("collapses a legacy market-up id and the new market-move id for the same player into one row", () => {
    const { result } = renderHook(() => useAlerts({ supabaseUser: null, players: {} }));

    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-up-p1-1000", playerId: "p1", timestamp: 1000 }),
      ]);
    });
    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-move-p1", playerId: "p1", timestamp: 2000 }),
      ]);
    });

    expect(result.current.dashboardAlerts).toHaveLength(1);
    expect(result.current.dashboardAlerts[0].id).toBe("market-move-p1");
  });

  it("does not collapse different players' market-move alerts", () => {
    const { result } = renderHook(() => useAlerts({ supabaseUser: null, players: {} }));

    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-move-p1", playerId: "p1", timestamp: 1000 }),
        mkAlert({ id: "market-move-p2", playerId: "p2", timestamp: 1000 }),
      ]);
    });

    expect(result.current.dashboardAlerts).toHaveLength(2);
  });

  it("keeps a dismissed alert dismissed even when a stale duplicate row (dismissed:false) merges in", () => {
    const { result } = renderHook(() => useAlerts({ supabaseUser: null, players: {} }));

    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-up-p1-1000", playerId: "p1", timestamp: 2000, dismissed: true }),
      ]);
    });
    act(() => {
      result.current.mergeDashboardAlerts([
        mkAlert({ id: "market-up-p1-500", playerId: "p1", timestamp: 1000, dismissed: false }),
      ]);
    });

    expect(result.current.dashboardAlerts).toHaveLength(1);
    expect(result.current.dashboardAlerts[0].dismissed).toBe(true);
  });
});
