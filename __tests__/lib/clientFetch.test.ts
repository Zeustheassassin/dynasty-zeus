// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cachedFetch } from "@/lib/clientFetch";

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
