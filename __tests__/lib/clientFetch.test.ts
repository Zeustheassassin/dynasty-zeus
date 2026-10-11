// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cachedFetch,
  fetchJson,
  parseRetryAfterMs,
  RETRY_AFTER_DEFAULT_MS,
  RETRY_AFTER_MAX_MS,
  RETRY_AFTER_MIN_MS,
} from "@/lib/clientFetch";
import { createRequestQueue } from "@/lib/requestQueue";

// Characterization of the browser cache layer in front of /api/sleeper/*: TTL hit/miss/expiry,
// bypass, in-flight coalescing, retry policy, and quota eviction.

const P = "sleeperCache:";
const fetchMock = vi.fn();
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => json({ v: 1 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const entry = (data: unknown, expiresAt: number) => JSON.stringify({ data, expiresAt });

describe("cachedFetch — TTL cache", () => {
  it("miss fetches and stores under the prefixed URL key with the TTL", async () => {
    const now = Date.now();
    const data = await cachedFetch<{ v: number }>("/api/sleeper/a", { ttlMs: 60_000 });
    expect(data).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const stored = JSON.parse(window.localStorage.getItem(P + "/api/sleeper/a")!);
    expect(stored.data).toEqual({ v: 1 });
    expect(stored.expiresAt).toBeGreaterThanOrEqual(now + 60_000);
  });

  it("hit within TTL returns cached data without fetching", async () => {
    window.localStorage.setItem(P + "/api/sleeper/a", entry({ v: "cached" }, Date.now() + 10_000));
    expect(await cachedFetch("/api/sleeper/a", { ttlMs: 60_000 })).toEqual({ v: "cached" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("expired entry is dropped and refetched", async () => {
    window.localStorage.setItem(P + "/api/sleeper/a", entry({ v: "old" }, Date.now() - 1));
    expect(await cachedFetch("/api/sleeper/a", { ttlMs: 60_000 })).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(P + "/api/sleeper/a")!).data).toEqual({ v: 1 });
  });

  it("corrupt or malformed entries are treated as a miss", async () => {
    window.localStorage.setItem(P + "/bad-json", "{not json");
    window.localStorage.setItem(P + "/no-expiry", JSON.stringify({ data: { v: "x" } }));
    await cachedFetch("/bad-json", { ttlMs: 1000 });
    await cachedFetch("/no-expiry", { ttlMs: 1000 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("bypass skips the read but still refreshes the cache", async () => {
    window.localStorage.setItem(P + "/api/sleeper/a?bypass=1", entry({ v: "cached" }, Date.now() + 10_000));
    const data = await cachedFetch("/api/sleeper/a?bypass=1", { ttlMs: 60_000, bypass: true });
    expect(data).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem(P + "/api/sleeper/a?bypass=1")!).data).toEqual({ v: 1 });
  });

  it("cacheKey overrides the storage key while the fetch URL stays the same", async () => {
    await cachedFetch("/api/sleeper/a?bypass=1", { ttlMs: 1000, cacheKey: "/api/sleeper/a" });
    expect(fetchMock).toHaveBeenCalledWith("/api/sleeper/a?bypass=1");
    expect(window.localStorage.getItem(P + "/api/sleeper/a")).not.toBeNull();
    expect(window.localStorage.getItem(P + "/api/sleeper/a?bypass=1")).toBeNull();
  });
});

describe("cachedFetch — in-flight coalescing", () => {
  it("concurrent callers for the same URL share one request", async () => {
    const [a, b, c] = await Promise.all([
      cachedFetch("/api/sleeper/a", { ttlMs: 1000 }),
      cachedFetch("/api/sleeper/a", { ttlMs: 1000 }),
      cachedFetch("/api/sleeper/a", { ttlMs: 1000 }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("different URLs (including a ?bypass variant) do not share a request", async () => {
    await Promise.all([
      cachedFetch("/api/sleeper/a", { ttlMs: 1000 }),
      cachedFetch("/api/sleeper/a?bypass=1", { ttlMs: 1000, bypass: true }),
      cachedFetch("/api/sleeper/b", { ttlMs: 1000 }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("the in-flight slot is released after completion and after failure", async () => {
    await cachedFetch("/api/sleeper/a", { ttlMs: 0 });
    await cachedFetch("/api/sleeper/a", { ttlMs: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fetchMock.mockImplementation(async () => json({}, 404));
    await expect(cachedFetch("/api/sleeper/z", { ttlMs: 1000 })).rejects.toThrow();
    fetchMock.mockImplementation(async () => json({ v: 2 }));
    expect(await cachedFetch("/api/sleeper/z", { ttlMs: 1000 })).toEqual({ v: 2 });
  });
});

describe("cachedFetch — timeoutMs", () => {
  // Code-review catch (same session as the useSpyState.ts cachedFetch migration): the original
  // raw fetch() this replaced carried AbortSignal.timeout(FC_FETCH_TIMEOUT_MS); cachedFetch had
  // no timeout anywhere in its chain, so a stalled (accepted-but-never-resolving) connection
  // would hang forever instead of failing fast. timeoutMs restores that bound, opt-in only.
  it("passes an AbortSignal to fetch when timeoutMs is set", async () => {
    await cachedFetch("/api/sleeper/a", { ttlMs: 1000, timeoutMs: 5000 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("calls fetch with just the URL (no second arg) when timeoutMs is omitted", async () => {
    await cachedFetch("/api/sleeper/a", { ttlMs: 1000 });
    expect(fetchMock).toHaveBeenCalledWith("/api/sleeper/a");
  });
});

describe("cachedFetch — retry policy", () => {
  it("does not retry a deterministic 4xx and does not cache it", async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    await expect(cachedFetch("/api/sleeper/a", { ttlMs: 1000 })).rejects.toThrow(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(P + "/api/sleeper/a")).toBeNull();
  });

  it("retries 429 and succeeds on the next attempt", async () => {
    fetchMock.mockImplementationOnce(async () => json({}, 429));
    expect(await cachedFetch("/api/sleeper/a", { ttlMs: 1000 })).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 5xx up to 3 attempts then throws without caching", async () => {
    fetchMock.mockImplementation(async () => json({}, 503));
    await expect(cachedFetch("/api/sleeper/a", { ttlMs: 1000 })).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(P + "/api/sleeper/a")).toBeNull();
  });

  it("a lower `retries` opt caps attempts below the default of 3", async () => {
    fetchMock.mockImplementation(async () => json({}, 503));
    await expect(cachedFetch("/api/sleeper/a", { ttlMs: 1000, retries: 2 })).rejects.toThrow(/503/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("cachedFetch — localStorage write failures", () => {
  it("on quota errors evicts expired/oldest sleeperCache entries only, then writes", async () => {
    const now = Date.now();
    window.localStorage.setItem(P + "old1", entry(1, now - 5000));
    window.localStorage.setItem(P + "old2", entry(2, now - 1000));
    window.localStorage.setItem(P + "live", entry(3, now + 100_000));
    window.localStorage.setItem("unrelated", "keep me");

    const realSet = Storage.prototype.setItem;
    let failNext = true;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (failNext) {
        failNext = false;
        throw new DOMException("full", "QuotaExceededError");
      }
      return realSet.call(this, k, v);
    });

    expect(await cachedFetch("/api/sleeper/new", { ttlMs: 1000 })).toEqual({ v: 1 });
    expect(window.localStorage.getItem(P + "old1")).toBeNull();
    expect(window.localStorage.getItem(P + "old2")).toBeNull();
    expect(window.localStorage.getItem(P + "live")).not.toBeNull();
    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
    expect(window.localStorage.getItem(P + "/api/sleeper/new")).not.toBeNull();
  });

  it("gives up quietly (still returns data) when quota is full and nothing can be evicted", async () => {
    window.localStorage.setItem("unrelated", "keep me");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(await cachedFetch("/api/sleeper/a", { ttlMs: 1000 })).toEqual({ v: 1 });
    expect(window.localStorage.getItem("unrelated")).toBe("keep me");
  });

  it("a non-quota write error is swallowed without eviction", async () => {
    window.localStorage.setItem(P + "victim", entry(1, Date.now() - 1));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(await cachedFetch("/api/sleeper/a", { ttlMs: 1000 })).toEqual({ v: 1 });
    expect(window.localStorage.getItem(P + "victim")).not.toBeNull();
  });
});

describe("parseRetryAfterMs", () => {
  const NOW = Date.UTC(2026, 9, 10, 18);
  it("reads delta-seconds and HTTP dates, clamped to [MIN, MAX]", () => {
    expect(parseRetryAfterMs("7", NOW)).toBe(7_000);
    expect(parseRetryAfterMs(" 12 ", NOW)).toBe(12_000);
    expect(parseRetryAfterMs(new Date(NOW + 9_000).toUTCString(), NOW)).toBe(9_000);
    expect(parseRetryAfterMs("0", NOW)).toBe(RETRY_AFTER_MIN_MS);
    expect(parseRetryAfterMs(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(RETRY_AFTER_MIN_MS);
    expect(parseRetryAfterMs("3600", NOW)).toBe(RETRY_AFTER_MAX_MS);
  });

  it("falls back to the default when the header is missing or unreadable", () => {
    for (const h of [null, "", "  ", "soon", "-5", "1.5"]) {
      expect(parseRetryAfterMs(h, NOW), String(h)).toBe(RETRY_AFTER_DEFAULT_MS);
    }
  });
});

describe("cachedFetch — with a request queue (sleeperApi's)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 10, 18));
  });

  const limited = (retryAfter?: string) =>
    new Response("{}", { status: 429, headers: retryAfter ? { "Retry-After": retryAfter } : {} });

  it("a 429 pauses the WHOLE queue for its Retry-After, then the retry and everything behind it go", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 100, refillPerSec: 100 });
    fetchMock.mockImplementationOnce(async () => limited("3"));

    const a = cachedFetch("/api/sleeper/a", { ttlMs: 1000, queue });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(queue.stats().pausedUntil).toBe(Date.now() + 3_000);

    // A different route queued during the pause waits too — the server's bucket is shared.
    const b = cachedFetch("/api/sleeper/b", { ttlMs: 1000, queue });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(await a).toEqual({ v: 1 });
    expect(await b).toEqual({ v: 1 });
    expect(fetchMock.mock.calls.map(([u]) => u)).toEqual(["/api/sleeper/a", "/api/sleeper/a", "/api/sleeper/b"]);
  });

  it("no Retry-After pauses for the default rather than the old 200ms", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 100, refillPerSec: 100 });
    fetchMock.mockImplementationOnce(async () => limited());
    const a = cachedFetch("/api/sleeper/a", { ttlMs: 1000, queue });
    await vi.advanceTimersByTimeAsync(RETRY_AFTER_DEFAULT_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await a).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after 3 attempts of 429s, without caching", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 100, refillPerSec: 100 });
    fetchMock.mockImplementation(async () => limited("1"));
    const a = cachedFetch("/api/sleeper/a", { ttlMs: 1000, queue });
    await Promise.all([vi.advanceTimersByTimeAsync(5_000), expect(a).rejects.toThrow(/429/)]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(window.localStorage.getItem(P + "/api/sleeper/a")).toBeNull();
  });

  it("keeps the old policy for everything else: a 4xx isn't retried, a 5xx backs off 200/400ms", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 100, refillPerSec: 100 });
    fetchMock.mockImplementation(async () => json({}, 404));
    const notFound = cachedFetch("/api/sleeper/nf", { ttlMs: 1000, queue });
    await Promise.all([vi.advanceTimersByTimeAsync(0), expect(notFound).rejects.toThrow(/404/)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockImplementationOnce(async () => json({}, 503)).mockImplementation(async () => json({ v: 2 }));
    const flaky = cachedFetch("/api/sleeper/flaky", { ttlMs: 1000, queue });
    await vi.advanceTimersByTimeAsync(199);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await flaky).toEqual({ v: 2 });
    expect(queue.stats().pausedUntil).toBe(0); // only a 429 pauses the queue
  });

  it("only network attempts take a token — a cache hit never touches the queue", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 2, refillPerSec: 0.01 });
    window.localStorage.setItem(P + "/api/sleeper/hit", entry({ v: "cached" }, Date.now() + 10_000));
    expect(await cachedFetch("/api/sleeper/hit", { ttlMs: 1000, queue })).toEqual({ v: "cached" });
    expect(queue.stats().tokens).toBe(2);
    await cachedFetch("/api/sleeper/miss", { ttlMs: 1000, queue });
    expect(queue.stats().tokens).toBe(1);
  });

  it("without a queue a 429 is still retried on the plain back-off (other cachedFetch callers)", async () => {
    fetchMock.mockImplementationOnce(async () => limited("30"));
    const a = cachedFetch("/api/injuries/detail?x=1", { ttlMs: 1000 });
    await vi.advanceTimersByTimeAsync(200);
    expect(await a).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("fetchJson", () => {
  it("is uncached and goes through the queue when given one", async () => {
    const queue = createRequestQueue({ maxInFlight: 6, burst: 5, refillPerSec: 0.01 });
    expect(await fetchJson("https://api.sleeper.app/x", { queue })).toEqual({ v: 1 });
    expect(await fetchJson("https://api.sleeper.app/x", { queue })).toEqual({ v: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(window.localStorage.length).toBe(0);
    expect(queue.stats().tokens).toBe(3);
  });
});
