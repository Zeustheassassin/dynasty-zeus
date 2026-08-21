import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Regression coverage for the "cache-poisoning on upstream failure" bug: a
// transient Sleeper 500/timeout used to still upsert {} into
// sleeper_stats_cache with a fresh cached_at, serving empty stats for the
// full 7-day TTL. The route must now skip the cache write entirely and
// return a non-OK status so the client (usePlayerStats.ts) knows to retry.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

let cachedRow: { data: unknown; cached_at: string } | null = null;
let upserts: Array<{ season: string; week: number; data: unknown; cached_at: string }> = [];

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: () => Promise.resolve(cachedRow ? { data: cachedRow, error: null } : { data: null, error: { message: "no rows" } }),
          }),
        }),
      }),
      upsert: (row: { season: string; week: number; data: unknown; cached_at: string }) => {
        upserts.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

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
    expect(upserts[0]).toMatchObject({ season: "2026", week: 3, data: { "123": { pts: 10 } } });
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
