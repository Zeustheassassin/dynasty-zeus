import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// getFcValues is the one place FantasyCalc values are loaded server-side (the /api/fc-values route and
// both crons). Order: fresh cache -> live fetch (timeout, validated, cached via the service role) ->
// expired cache (optional) -> null. Audit Batch 2 step 8.

const h = vi.hoisted(() => ({
  upsertCacheRow: vi.fn(async (_table: string, _row: Record<string, unknown>) => true),
}));
vi.mock("@/lib/supabaseAdmin", () => ({ upsertCacheRow: h.upsertCacheRow }));

// Anon client stub: serves `cacheRow` for select().eq().single(), or throws when `cacheThrows`.
let cacheRow: { data: unknown; cached_at: string } | null = null;
let cacheThrows = false;
let readFrom: string[] = [];
vi.mock("@/lib/supabaseclient", () => {
  const supabase = {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => { readFrom.push(table); return q; };
      q.eq = () => q;
      q.single = () => {
        if (cacheThrows) throw new Error("network down");
        return Promise.resolve(cacheRow ? { data: cacheRow, error: null } : { data: null, error: { message: "no rows" } });
      };
      return q;
    },
  };
  // Mirrors the real lib/supabaseclient.ts readCacheRow's contract (miss/failure -> null)
  // directly against this test's state, rather than re-simulating the query chain.
  const readCacheRow = async (table: string, _filters: [string, unknown][], _columns: string) => {
    readFrom.push(table);
    if (cacheThrows) return null;
    return cacheRow ?? null;
  };
  return { supabase, readCacheRow };
});

import { getFcValues, isUsableFcPayload, type FcRawEntry } from "@/lib/server/fcValues";
import { FC_MIN_VALID_ENTRIES } from "@/lib/constants";

const HOUR = 3_600_000;
/** A plausible FantasyCalc payload: `n` valued players. */
const payload = (n = 120, base = 5000): FcRawEntry[] =>
  Array.from({ length: n }, (_, i) => ({ player: { sleeperId: String(1000 + i), position: "WR" }, value: base - i }));
const hoursAgo = (h_: number) => new Date(Date.now() - h_ * HOUR).toISOString();
const cached = (data: unknown, ageHours: number) => { cacheRow = { data, cached_at: hoursAgo(ageHours) }; };

let fetchMock: ReturnType<typeof vi.fn>;
const upstreamOk = (data: unknown = payload(120, 9000)) =>
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(data), { status: 200 }));
const upstreamFails = (how: "500" | "throw" | "empty" | "object" | "tiny") =>
  fetchMock.mockImplementation(async () => {
    if (how === "throw") throw new Error("timeout");
    if (how === "500") return new Response("boom", { status: 500 });
    const body = how === "empty" ? [] : how === "object" ? { error: "nope" } : payload(FC_MIN_VALID_ENTRIES - 1);
    return new Response(JSON.stringify(body), { status: 200 });
  });
const flush = () => new Promise((r) => setTimeout(r, 0)); // let afterResponse's cache write start

beforeEach(() => {
  vi.clearAllMocks();
  h.upsertCacheRow.mockResolvedValue(true);
  cacheRow = null;
  cacheThrows = false;
  readFrom = [];
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isUsableFcPayload", () => {
  it("accepts a plausible payload and rejects anything that isn't real values", () => {
    expect(isUsableFcPayload(payload(FC_MIN_VALID_ENTRIES))).toBe(true);
    expect(isUsableFcPayload(payload(FC_MIN_VALID_ENTRIES - 1))).toBe(false);
    expect(isUsableFcPayload([])).toBe(false);
    expect(isUsableFcPayload({ error: "x" })).toBe(false);
    expect(isUsableFcPayload(null)).toBe(false);
    // entries without a positive numeric value don't count toward the floor
    expect(isUsableFcPayload(Array.from({ length: 200 }, () => ({ value: 0 })))).toBe(false);
  });
});

describe("getFcValues — fresh cache", () => {
  it("returns a fresh cached row without touching FantasyCalc or writing", async () => {
    const data = payload();
    cached(data, 3);
    const r = await getFcValues(2, true);
    await flush();
    expect(r).toMatchObject({ data, source: "cache", fetchedAt: cacheRow!.cached_at });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("reads the dynasty table for dynasty and the redraft table otherwise", async () => {
    cached(payload(), 1);
    await getFcValues(2, true);
    await getFcValues(1, false);
    expect(readFrom).toEqual(["fc_values_cache", "fc_redraft_values_cache"]);
  });

  it("honours a tighter maxAgeMs: a 10h-old row is fresh for 24h but not for 6h", async () => {
    cached(payload(), 10);
    upstreamOk();
    expect((await getFcValues(2, true))?.source).toBe("cache");
    expect((await getFcValues(2, true, { maxAgeMs: 6 * HOUR }))?.source).toBe("live");
  });

  it("ignores an unusable cached row (e.g. an old cached []) and refetches", async () => {
    cached([], 1);
    upstreamOk();
    expect((await getFcValues(2, true))?.source).toBe("live");
  });

  it("treats an unparseable cached_at as not fresh", async () => {
    cacheRow = { data: payload(), cached_at: "garbage" };
    upstreamOk();
    expect((await getFcValues(2, true))?.source).toBe("live");
  });

  it("treats a cache read that throws as a miss", async () => {
    cacheThrows = true;
    upstreamOk();
    expect((await getFcValues(2, true))?.source).toBe("live");
  });
});

describe("getFcValues — live fetch", () => {
  it("fetches, returns the payload, and caches it through the service role", async () => {
    const data = payload(120, 9000);
    upstreamOk(data);
    const before = Date.now();
    const r = await getFcValues(2, true);
    await flush();

    expect(r).toMatchObject({ data, source: "live" });
    expect(new Date(r!.fetchedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(h.upsertCacheRow).toHaveBeenCalledTimes(1);
    expect(h.upsertCacheRow).toHaveBeenCalledWith("fc_values_cache", { num_qbs: 2, data, cached_at: r!.fetchedAt });
  });

  it("writes the redraft table for isDynasty=false", async () => {
    upstreamOk();
    await getFcValues(1, false);
    await flush();
    expect(h.upsertCacheRow).toHaveBeenCalledWith("fc_redraft_values_cache", expect.objectContaining({ num_qbs: 1 }));
  });

  it("refreshes an expired cache row", async () => {
    cached(payload(120, 1000), 30);
    upstreamOk(payload(120, 9000));
    const r = await getFcValues(2, true);
    await flush();
    expect(r?.source).toBe("live");
    expect(r?.data[0].value).toBe(9000);
    expect(h.upsertCacheRow).toHaveBeenCalledTimes(1);
  });

  it("asks FantasyCalc for the right shape: dynasty carries numTeams/ppr, redraft does not", async () => {
    upstreamOk();
    await getFcValues(2, true);
    await getFcValues(1, false);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1");
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1");
  });

  it("bounds the upstream call with a timeout signal", async () => {
    upstreamOk();
    await getFcValues(2, true);
    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("getFcValues — FantasyCalc unavailable", () => {
  it.each(["500", "throw", "empty", "object", "tiny"] as const)(
    "%s: falls back to the expired cache, and never overwrites it with the bad payload",
    async (how) => {
      const data = payload(120, 4000);
      cached(data, 50);
      upstreamFails(how);
      const r = await getFcValues(2, true);
      await flush();
      expect(r).toMatchObject({ data, source: "stale", fetchedAt: cacheRow!.cached_at });
      expect(h.upsertCacheRow).not.toHaveBeenCalled();
    }
  );

  it.each(["500", "throw", "empty", "object", "tiny"] as const)(
    "%s: returns null when there is no cache at all",
    async (how) => {
      upstreamFails(how);
      expect(await getFcValues(2, true)).toBeNull();
      await flush();
      expect(h.upsertCacheRow).not.toHaveBeenCalled();
    }
  );

  it("allowStale:false refuses to hand an expired row back as current data", async () => {
    cached(payload(), 50);
    upstreamFails("500");
    expect(await getFcValues(2, true, { allowStale: false })).toBeNull();
  });

  it("a fresh cache still wins with allowStale:false (no upstream call needed)", async () => {
    cached(payload(), 1);
    expect((await getFcValues(2, true, { allowStale: false }))?.source).toBe("cache");
  });
});

describe("getFcValues — concurrent-caller dedup", () => {
  // Sept 22 code-review P2 finding #6: getFcValues had no single-flight dedup (unlike the
  // client-side lib/fcValuesStore.ts), so concurrent callers on a cache miss each independently
  // re-read the cache AND re-hit FantasyCalc.
  it("joins one live fetch for concurrent callers with the same numQbs/isDynasty/options", async () => {
    let release: (() => void) | null = null;
    let fetchCalls = 0;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          fetchCalls++;
          release = () => resolve(new Response(JSON.stringify(payload(120, 9000)), { status: 200 }));
        })
    );

    const p1 = getFcValues(2, true);
    const p2 = getFcValues(2, true);
    await flush(); // let both calls reach the in-flight fetch before releasing it
    expect(fetchCalls).toBe(1);
    release!();

    const [r1, r2] = await Promise.all([p1, p2]);
    await flush();
    expect(r1).toEqual(r2);
    expect(h.upsertCacheRow).toHaveBeenCalledTimes(1);
  });

  it("does NOT coalesce callers asking for different freshness guarantees (e.g. allowStale:false)", async () => {
    // player-value-history's 6h/no-stale window must never be satisfied by a result computed
    // under another caller's 24h/allowStale:true default.
    cached(payload(120, 4000), 50);
    upstreamFails("500");

    const [lax, strict] = await Promise.all([
      getFcValues(2, true),
      getFcValues(2, true, { allowStale: false }),
    ]);
    expect(lax?.source).toBe("stale");
    expect(strict).toBeNull();
  });

  it("a later call with the same options starts its own fresh load once the earlier one resolved", async () => {
    // Proves the in-flight entry is cleared after resolving, not left coalescing forever.
    upstreamOk(payload(120, 1000));
    const r1 = await getFcValues(2, true);
    expect(r1?.data[0].value).toBe(1000);

    upstreamOk(payload(120, 2000));
    const r2 = await getFcValues(2, true);
    expect(r2?.data[0].value).toBe(2000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
