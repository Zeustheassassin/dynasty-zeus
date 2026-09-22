// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCalcValues } from "@/hooks/useCalcValues";
import { invalidateFcValuesCache } from "@/lib/fcValuesStore";

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function fcResponse(sleeperId: string, value: number) {
  return [{ player: { sleeperId }, value }];
}

// An outage must surface as an error AND stay retryable. Both loaders skip work once a format is
// "loaded", so latching an empty success (200 + []) would freeze the app on zero values.
describe("useCalcValues — empty / failed responses are errors, not loaded-but-empty", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFcValuesCache(); // the shared store is module-level state — isolate each test
  });

  function respondInOrder(...responses: Response[]) {
    const queue = [...responses];
    global.fetch = vi.fn(async () => queue.shift() ?? new Response("[]", { status: 200 })) as never;
    return global.fetch as ReturnType<typeof vi.fn>;
  }
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

  it.each([
    ["an empty array", () => ok([])],
    ["a non-array body", () => ok({ error: "nope" })],
    ["a 502", () => new Response(JSON.stringify([]), { status: 502 })],
  ])("loadCalcValues: %s sets the error and the next call retries", async (_label, bad) => {
    const fetchMock = respondInOrder(bad(), ok(fcResponse("p1", 4000)));
    const { result } = renderHook(() => useCalcValues());

    await act(async () => { await result.current.loadCalcValues(2); });
    expect(result.current.calcValuesError).not.toBeNull();
    expect(result.current.calcFcValues).toEqual({});

    // Not latched: the same format is fetched again and recovers.
    await act(async () => { await result.current.loadCalcValues(2); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.calcValuesError).toBeNull();
    expect(result.current.calcFcValues).toEqual({ p1: 4000 });
  });

  it.each([
    ["an empty array", () => ok([])],
    ["a non-array body", () => ok({ error: "nope" })],
  ])("loadRedraftValues: %s sets the error and the next call retries", async (_label, bad) => {
    const fetchMock = respondInOrder(bad(), ok(fcResponse("p1", 3000)));
    const { result } = renderHook(() => useCalcValues());

    await act(async () => { await result.current.loadRedraftValues(2); });
    expect(result.current.redraftError).not.toBeNull();
    expect(result.current.redraftValues).toEqual({});

    await act(async () => { await result.current.loadRedraftValues(2); });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.redraftError).toBeNull();
    expect(result.current.redraftValues).toEqual({ p1: 3000 });
  });
});

describe("useCalcValues — loadRedraftValues race guard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    invalidateFcValuesCache();
  });

  it("a slower single-QB (numQbs=1) load never overwrites a faster superflex (numQbs=2) load's result", async () => {
    const d1 = deferred<Response>(); // numQbs=1 — started first, resolves LAST (slow)
    const d2 = deferred<Response>(); // numQbs=2 — started second, resolves FIRST (fast)

    global.fetch = vi.fn((url: string) => {
      if (url.includes("numQbs=1")) return d1.promise;
      if (url.includes("numQbs=2")) return d2.promise;
      throw new Error(`unexpected url ${url}`);
    }) as never;

    const { result } = renderHook(() => useCalcValues());

    let p1!: Promise<void>;
    let p2!: Promise<void>;
    act(() => { p1 = result.current.loadRedraftValues(1); });
    act(() => { p2 = result.current.loadRedraftValues(2); });

    // numQbs=2 resolves first (fast).
    act(() => {
      d2.resolve(new Response(JSON.stringify(fcResponse("sf-player", 5000)), { status: 200 }));
    });
    await act(async () => { await p2; });
    expect(result.current.redraftValues).toEqual({ "sf-player": 5000 });

    // numQbs=1's stale response resolves after — pre-fix this would silently
    // overwrite the superflex values with single-QB values and leave
    // redraftNumQbsRef pointing at the wrong format.
    act(() => {
      d1.resolve(new Response(JSON.stringify(fcResponse("1qb-player", 3000)), { status: 200 }));
    });
    await act(async () => { await p1; });

    expect(result.current.redraftValues).toEqual({ "sf-player": 5000 });

    // Confirm redraftNumQbsRef wasn't left pointing at the stale format 1:
    // a no-arg refresh reuses "the last-loaded format" (2), so it must be a
    // no-op (no new fetch) rather than silently re-fetching format 1.
    const fetchCallsBefore = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => { await result.current.loadRedraftValues(); });
    expect((global.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallsBefore);
  });

  it("does not clear the error/loading flags for a load that's already been superseded", async () => {
    const d1 = deferred<Response>();
    const d2 = deferred<Response>();
    global.fetch = vi.fn((url: string) => (url.includes("numQbs=1") ? d1.promise : d2.promise)) as never;

    const { result } = renderHook(() => useCalcValues());

    act(() => { result.current.loadRedraftValues(1); });
    act(() => { result.current.loadRedraftValues(2); });

    // The stale (numQbs=1) request fails after being superseded — must not
    // flip redraftError/loadingRedraft, since request 2 is what's "current."
    await act(async () => {
      d1.resolve(new Response("error", { status: 500 }));
      await Promise.resolve();
    });
    expect(result.current.redraftError).toBeNull();

    await act(async () => {
      d2.resolve(new Response(JSON.stringify(fcResponse("sf-player", 5000)), { status: 200 }));
    });
    expect(result.current.redraftError).toBeNull();
    expect(result.current.loadingRedraft).toBe(false);
  });
});
