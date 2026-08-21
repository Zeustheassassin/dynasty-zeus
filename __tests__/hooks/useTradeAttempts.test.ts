// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useTradeAttempts } from "@/hooks/useTradeAttempts";

// Deferred promise so tests can control exactly when a query "resolves",
// to reproduce the fast-league-switch race the seq guard fixes.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

type QueryResult = { data: unknown; error: { message: string } | null };

// Queued deferred results consumed in FIFO order by successive
// loadTradeAttempts() calls' .order() terminal call.
let queue: Array<ReturnType<typeof deferred<QueryResult>>> = [];

function nextDeferred() {
  const d = deferred<QueryResult>();
  queue.push(d);
  return d;
}

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => {
              const d = queue.shift();
              return d ? d.promise : Promise.resolve({ data: [], error: null });
            },
          }),
          // Mount-effect query has only one .eq() before .order() — support
          // both shapes on the same chain object.
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

const user = { id: "auth-user-1" } as never;

beforeEach(() => {
  queue = [];
});

describe("useTradeAttempts — league-switch race guard", () => {
  it("a slower earlier load's stale data never lands after a faster later load's result", async () => {
    const { result } = renderHook(() => useTradeAttempts(user));

    // User switches League A -> League B quickly. League A's fetch is the
    // slower one and resolves LAST, after League B's already landed — this
    // is the exact fast-switch race the seq guard exists for.
    const leagueA = nextDeferred();
    const leagueB = nextDeferred();

    let pA!: Promise<void>;
    let pB!: Promise<void>;
    act(() => {
      pA = result.current.loadTradeAttempts("league-A");
    });
    act(() => {
      pB = result.current.loadTradeAttempts("league-B");
    });

    // League B's fetch resolves first (fast).
    act(() => {
      leagueB.resolve({ data: [{ id: "b1", league_id: "league-B" }], error: null });
    });
    await act(async () => { await pB; });
    expect(result.current.tradeAttempts).toEqual([{ id: "b1", league_id: "league-B" }]);

    // League A's stale fetch resolves after — pre-fix this would silently
    // overwrite the correct League B data with League A's under the "League B"
    // label. Post-fix the seq guard discards it entirely.
    act(() => {
      leagueA.resolve({ data: [{ id: "a1", league_id: "league-A" }], error: null });
    });
    await act(async () => { await pA; });

    expect(result.current.tradeAttemptsLeagueId).toBe("league-B");
    expect(result.current.tradeAttempts).toEqual([{ id: "b1", league_id: "league-B" }]);
  });

  it("surfaces a Supabase error via tradeAttemptsError instead of swallowing it silently", async () => {
    const { result } = renderHook(() => useTradeAttempts(user));
    const d = nextDeferred();

    act(() => {
      result.current.loadTradeAttempts("league-X");
    });
    act(() => {
      d.resolve({ data: null, error: { message: "boom" } });
    });

    await waitFor(() => {
      expect(result.current.tradeAttemptsError).toBe("Couldn't load trade attempts — try again.");
    });
    expect(result.current.loadingTradeAttempts).toBe(false);
  });

  it("clears a prior error at the start of a new load", async () => {
    const { result } = renderHook(() => useTradeAttempts(user));
    const failing = nextDeferred();

    act(() => { result.current.loadTradeAttempts("league-X"); });
    act(() => { failing.resolve({ data: null, error: { message: "boom" } }); });
    await waitFor(() => expect(result.current.tradeAttemptsError).toBeTruthy());

    const succeeding = nextDeferred();
    act(() => { result.current.loadTradeAttempts("league-Y"); });
    // Error clears synchronously at the start of the new load, before the fetch resolves.
    expect(result.current.tradeAttemptsError).toBeNull();
    act(() => { succeeding.resolve({ data: [], error: null }); });
    await waitFor(() => expect(result.current.loadingTradeAttempts).toBe(false));
  });
});
