import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for the "cache-poisoning on upstream failure" bug: a
// transient Sleeper 500/timeout used to still upsert {} into
// sleeper_stats_cache with a fresh cached_at, serving empty stats for the
// full 7-day TTL. The route must now skip the cache write entirely and
// return a non-OK status so the client (usePlayerStats.ts) knows to retry.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
  upsertCacheRow: vi.fn(async (_table: string, _row: Record<string, unknown>) => true),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

// Cache WRITES go through the service-role helper: sleeper_stats_cache is SELECT-only for the anon
// client (RLS), so an anon upsert is silently denied and nothing is ever cached (audit Batch 2 step 7).
vi.mock("@/lib/supabaseAdmin", () => ({ upsertCacheRow: h.upsertCacheRow }));

let cachedRow: { data: unknown; cached_at: string } | null = null;
let upserts: Array<{ season: string; week: number; data: unknown; cached_at: string }> = [];
let upsertTables: string[] = [];
let anonWrites = 0;
let selectEqs: Array<[string, unknown]> = [];

vi.mock("@/lib/supabaseclient", () => {
  const supabase = {
    from: (_table: string) => ({
      select: () => ({
        eq: (col: string, val: unknown) => ({
          eq: (col2: string, val2: unknown) => {
            selectEqs.push([col, val], [col2, val2]);
            return {
              single: () => Promise.resolve(cachedRow ? { data: cachedRow, error: null } : { data: null, error: { message: "no rows" } }),
            };
          },
        }),
      }),
      // Reads still use the anon client; a write here would be denied by RLS in production.
      upsert: () => {
        anonWrites++;
        return Promise.resolve({ error: { message: "new row violates row-level security policy" } });
      },
    }),
  };
  // Mirrors the real lib/supabaseclient.ts readCacheRow's contract (miss/failure -> null)
  // directly against this test's state, rather than re-simulating the query chain.
  const readCacheRow = async (_table: string, filters: [string, unknown][], _columns: string) => {
    filters.forEach(([col, val]) => selectEqs.push([col, val]));
    return cachedRow ?? null;
  };
  return { supabase, readCacheRow };
});

async function loadGET() {
  vi.resetModules();
  const mod = await import("@/app/api/stats/sleeper-weekly/route");
  return mod.GET;
}

function makeReq(season: string, week: string): NextRequest {
  return new NextRequest(`http://localhost/api/stats/sleeper-weekly?season=${season}&week=${week}`);
}

// Let any withRetry-scheduled cache write settle before asserting on `upserts`.
async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  cachedRow = null;
  upserts = [];
  upsertTables = [];
  anonWrites = 0;
  selectEqs = [];
  h.upsertCacheRow.mockImplementation(async (table, row) => {
    upsertTables.push(table);
    upserts.push(row as (typeof upserts)[number]);
    return true;
  });
});

describe("GET /api/stats/sleeper-weekly", () => {
  it("caches a successful upstream response", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ "123": { pts: 10 } }), { status: 200 })) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "3") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "123": { pts: 10 } });
    await flush();
    expect(upserts).toHaveLength(1);
    // Stored under the versioned key so pre-fix (all-empty) rows can never be served.
    expect(upserts[0]).toMatchObject({ season: "v2-2026", week: 3, data: { "123": { pts: 10 } } });
  });

  it("writes the cache through the service-role helper, never the anon client (RLS makes anon writes a no-op)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ "123": { pts: 10 } }), { status: 200 })) as never;
    const GET = await loadGET();
    await GET(makeReq("2026", "3") as never);
    await flush();
    expect(upsertTables).toEqual(["sleeper_stats_cache"]);
    expect(anonWrites).toBe(0);
  });

  it("requests Sleeper's working stats URL shape (the old ?season_type= form returns {} for every player)", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({ "1": { off_snp: 30 } }), { status: 200 }));
    global.fetch = fetchMock as never;
    const GET = await loadGET();
    await GET(makeReq("2026", "3") as never);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/stats/nfl/regular/2026/3");
    expect(url).not.toContain("season_type");
  });

  it("reads the cache under the versioned key, not the legacy one", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ "1": { off_snp: 30 } }), { status: 200 })) as never;
    const GET = await loadGET();
    await GET(makeReq("2026", "3") as never);
    expect(selectEqs).toContainEqual(["season", "v2-2026"]);
    expect(selectEqs).not.toContainEqual(["season", "2026"]);
  });

  it("does NOT cache an all-empty response (every player {}), but still returns it", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ "1": {}, "2": {} }), { status: 200 })) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "3") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "1": {}, "2": {} });
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("does NOT cache an empty object either", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as never;
    const GET = await loadGET();
    await GET(makeReq("2026", "18") as never);
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("ignores a cached row that holds no stats and refetches instead of serving it", async () => {
    cachedRow = { data: { "1": {}, "2": {} }, cached_at: new Date().toISOString() };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ "1": { off_snp: 30 } }), { status: 200 }));
    global.fetch = fetchMock as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "3") as never);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ "1": { off_snp: 30 } });
  });

  it("does NOT cache when the upstream response is non-OK, and returns a non-OK status itself", async () => {
    global.fetch = vi.fn(async () => new Response("server error", { status: 500 })) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "4") as never);
    expect(res.ok).toBe(false);
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("does NOT cache when the fetch itself throws (network error / timeout)", async () => {
    global.fetch = vi.fn(async () => { throw new Error("network down"); }) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "5") as never);
    expect(res.ok).toBe(false);
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("serves a fresh cache hit without calling fetch at all", async () => {
    cachedRow = { data: { "999": { pts: 5 } }, cached_at: new Date().toISOString() };
    global.fetch = vi.fn() as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "6") as never);
    expect(await res.json()).toEqual({ "999": { pts: 5 } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed season/week params before touching cache or fetch", async () => {
    const GET = await loadGET();
    global.fetch = vi.fn() as never;
    const res = await GET(makeReq("26", "3") as never);
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
