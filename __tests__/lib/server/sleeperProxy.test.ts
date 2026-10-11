import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fetchSleeperJson (call-budget Stage 4): the proxies' Data Cache moved from fetch's own
// `next: { revalidate }` to unstable_cache so the global Sleeper budget counts only calls that reach
// Sleeper. This pins that property with a stand-in cache that really caches — what runs inside it
// (the budget slot and the fetch) happens on a miss and never on a hit.

const nc = vi.hoisted(() => ({
  store: new Map<string, unknown>(),
  windows: new Map<string, number>(),
}));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => Promise<unknown>, key: string[], opts: { revalidate: number }) => async () => {
    const k = JSON.stringify(key);
    if (nc.store.has(k)) return nc.store.get(k);
    const value = await fn(); // a throw leaves nothing cached, as in Next
    nc.store.set(k, value);
    nc.windows.set(k, opts.revalidate);
    return value;
  },
}));
const budget = vi.hoisted(() => ({ slots: [] as string[] }));
vi.mock("@/lib/server/sleeperBudget", () => ({
  waitForSleeperSlot: async (priority: string) => { budget.slots.push(priority); },
}));

import { fetchSleeperJson, SleeperUpstreamError } from "@/lib/server/sleeperProxy";

const URL_A = "https://api.sleeper.app/v1/league/1/rosters";
const fetchMock = vi.fn();
beforeEach(() => {
  nc.store.clear();
  nc.windows.clear();
  budget.slots = [];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify([{ roster_id: 1 }])));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("fetchSleeperJson", () => {
  it("a cache hit neither calls Sleeper nor takes a budget slot", async () => {
    expect(await fetchSleeperJson(URL_A, { revalidate: 300 })).toEqual([{ roster_id: 1 }]);
    expect(await fetchSleeperJson(URL_A, { revalidate: 300 })).toEqual([{ roster_id: 1 }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(URL_A, { cache: "no-store" });
    expect(budget.slots).toEqual(["interactive"]);
    expect(nc.windows.get(JSON.stringify(["sleeper-json", URL_A]))).toBe(300);
  });

  it("is keyed by URL, so two routes asking for the same URL share one entry", async () => {
    const other = "https://api.sleeper.app/v1/league/2/rosters";
    await fetchSleeperJson(URL_A, { revalidate: 300 });
    await fetchSleeperJson(other, { revalidate: 300 });
    await fetchSleeperJson(URL_A, { revalidate: 300 });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([URL_A, other]);
  });

  it("bypass always calls Sleeper, takes a slot each time, and caches nothing", async () => {
    await fetchSleeperJson(URL_A, { revalidate: 300, bypass: true });
    await fetchSleeperJson(URL_A, { revalidate: 300, bypass: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(budget.slots).toEqual(["interactive", "interactive"]);
    expect(nc.store.size).toBe(0);
  });

  it("a non-OK answer throws SleeperUpstreamError with Sleeper's Retry-After and is never cached", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response("slow", { status: 429, headers: { "Retry-After": "9" } }));
    const err = await fetchSleeperJson(URL_A, { revalidate: 300 }).catch((e) => e);
    expect(err).toBeInstanceOf(SleeperUpstreamError);
    expect(err).toMatchObject({ status: 429, retryAfter: "9" });
    expect(nc.store.size).toBe(0);

    // The next request tries Sleeper again rather than serving the failure.
    expect(await fetchSleeperJson(URL_A, { revalidate: 300 })).toEqual([{ roster_id: 1 }]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("caches Sleeper's null body like any other answer", async () => {
    fetchMock.mockImplementation(async () => new Response("null"));
    expect(await fetchSleeperJson(URL_A, { revalidate: 3600 })).toBeNull();
    expect(await fetchSleeperJson(URL_A, { revalidate: 3600 })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
