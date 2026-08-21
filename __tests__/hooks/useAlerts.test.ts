// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAlerts } from "@/hooks/useAlerts";

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
