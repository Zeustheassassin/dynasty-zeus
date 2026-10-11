// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as C from "@/lib/constants";

// Sleeper call-budget Stage 3 (10/10), through the real sleeperApi: every call — cached or bypass,
// any route, and the direct-to-Sleeper ADP fetch — waits in ONE browser-wide queue. So Roster
// Overview's Refresh (bypass rosters) and the 2-min overview poll can't pile ~100 requests onto the
// server's per-IP bucket at once, and a 429 on either holds both for its Retry-After.

type Api = typeof import("@/lib/sleeperApi");

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

let open = 0;
let maxOpen = 0;
let fetched: string[] = [];
let respond: (url: string) => Response = () => json([]);
/** Each response lands LATENCY_MS after the request, so requests overlap like real ones do. */
const LATENCY_MS = 50;
const fetchMock = vi.fn(async (input: unknown) => {
  const url = String(input);
  fetched.push(url);
  open++;
  maxOpen = Math.max(maxOpen, open);
  await new Promise((r) => setTimeout(r, LATENCY_MS));
  open--;
  return respond(url);
});

async function loadApi(): Promise<Api> {
  vi.resetModules(); // a fresh queue (and empty in-flight map) per test
  return import("@/lib/sleeperApi");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 10, 18));
  window.localStorage.clear();
  open = 0;
  maxOpen = 0;
  fetched = [];
  respond = () => json([]);
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("sleeperApi — one browser-wide Sleeper queue", () => {
  it("a Refresh's bypass roster calls and a poll's cached calls together never exceed the in-flight cap", async () => {
    const { sleeperApi } = await loadApi();
    const ids = Array.from({ length: 25 }, (_, i) => String(1000 + i));
    const all = Promise.all([
      ...ids.map((id) => sleeperApi.getLeagueRosters(id, true)), // Roster Overview's Refresh
      ...ids.map((id) => sleeperApi.getLeagueRosters(id)),       // the overview poll
      ...ids.map((id) => sleeperApi.getLeagueUsers(id)),
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    await all;
    expect(fetched).toHaveLength(75);
    expect(maxOpen).toBe(C.SLEEPER_BROWSER_MAX_IN_FLIGHT);
    expect(fetched.filter((u) => u.endsWith("?bypass=1"))).toHaveLength(25);
  });

  it("a 429 on one route holds every other Sleeper call for its Retry-After", async () => {
    const { sleeperApi, sleeperRequestQueue } = await loadApi();
    let rostersCalls = 0;
    respond = (url) => {
      if (url.includes("/rosters") && rostersCalls++ === 0) return json({ error: "slow down" }, 429, { "Retry-After": "2" });
      return json([]);
    };

    const refresh = sleeperApi.getLeagueRosters("1", true);
    await vi.advanceTimersByTimeAsync(LATENCY_MS);
    expect(sleeperRequestQueue.stats().pausedUntil).toBe(Date.now() + 2_000);

    const poll = sleeperApi.getLeagueUsers("2");
    const adp = sleeperApi.getRookieBoardADP("2026");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(fetched).toHaveLength(1); // nothing else went out during the pause

    await vi.advanceTimersByTimeAsync(1 + LATENCY_MS);
    expect(await refresh).toEqual([]);
    expect(await poll).toEqual([]);
    expect(await adp).toEqual([]);
    expect(fetched[1]).toBe("/api/sleeper/league/1/rosters?bypass=1"); // the retry, first in line
    expect(fetched).toHaveLength(4);
  });

  it("after the burst, calls go out at SLEEPER_BROWSER_PER_SEC", async () => {
    const { sleeperApi } = await loadApi();
    const burst = C.SLEEPER_BROWSER_BURST;
    const perSec = C.SLEEPER_BROWSER_PER_SEC;
    const n = burst + 4 * perSec;
    const all = Promise.all(Array.from({ length: n }, (_, i) => sleeperApi.getLeagueUsers(String(5000 + i))));

    // The burst drains as fast as the in-flight cap and latency allow (~17 rounds of 6 x 50ms),
    // and from then on no more than burst + perSec x elapsed seconds have started.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetched.length).toBeGreaterThanOrEqual(burst);
    expect(fetched.length).toBeLessThanOrEqual(burst + perSec);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetched.length).toBeLessThanOrEqual(burst + 2 * perSec);

    await vi.advanceTimersByTimeAsync(2_500);
    expect(fetched).toHaveLength(n);
    await all;
  });

  it("cache hits never wait in the queue", async () => {
    const { sleeperApi, sleeperRequestQueue } = await loadApi();
    const users = sleeperApi.getLeagueUsers("9");
    await vi.advanceTimersByTimeAsync(LATENCY_MS);
    await users;
    const tokensAfterMiss = sleeperRequestQueue.stats().tokens;

    await sleeperApi.getLeagueUsers("9");
    expect(fetched).toHaveLength(1);
    expect(sleeperRequestQueue.stats().tokens).toBe(tokensAfterMiss);
  });
});
