import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/projections/sleeper-week serves one week of Sleeper's projections, trimmed, for the season
// simulator's weekly availability (byes, injury return dates). Cached in sleeper_stats_cache under
// its own 'proj-v1-' season prefix; an empty week is never cached and answers non-OK.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
  upsertCacheRow: vi.fn(async (_table: string, _row: Record<string, unknown>) => true),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/supabaseAdmin", () => ({ upsertCacheRow: h.upsertCacheRow }));

let cachedRow: { data: unknown; cached_at: string } | null = null;
let upserts: Array<{ season: string; week: number; data: unknown }> = [];
let selectEqs: Array<[string, unknown]> = [];

vi.mock("@/lib/supabaseclient", () => ({
  supabase: {},
  readCacheRow: async (_table: string, filters: [string, unknown][]) => {
    filters.forEach(([col, val]) => selectEqs.push([col, val]));
    return cachedRow ?? null;
  },
}));

async function loadGET() {
  vi.resetModules();
  const mod = await import("@/app/api/projections/sleeper-week/route");
  return mod.GET;
}

const makeReq = (season: string, week: string) =>
  new NextRequest(`http://localhost/api/projections/sleeper-week?season=${season}&week=${week}`);

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

const sleeperRows = [
  { player_id: "1", player: { position: "WR" }, stats: { rec: 5, rec_yd: 60, pts_ppr: 11, adp_dd_ppr: 40 } },
  { player_id: "2", player: { position: "QB" }, stats: { pts_ppr: 0 } }, // on bye / out
  { player_id: "3", player: { position: "K" }, stats: { fgm: 2, pts_ppr: 8 } },
];

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
  cachedRow = null;
  upserts = [];
  selectEqs = [];
  h.upsertCacheRow.mockImplementation(async (_table, row) => {
    upserts.push(row as (typeof upserts)[number]);
    return true;
  });
});

describe("GET /api/projections/sleeper-week", () => {
  it("fetches the week from Sleeper, trims it to projected skill players, and caches it under its own prefix", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(sleeperRows), { status: 200 }));
    global.fetch = fetchMock as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "9") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ "1": { position: "WR", stats: { rec: 5, rec_yd: 60 } } });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/projections/nfl/2026/9?season_type=regular");
    expect(selectEqs).toContainEqual(["season", "proj-v1-2026"]);
    await flush();
    expect(upserts).toEqual([expect.objectContaining({ season: "proj-v1-2026", week: 9 })]);
  });

  it("serves a fresh cache hit without calling Sleeper", async () => {
    cachedRow = { data: { "1": { position: "WR", stats: { rec: 5 } } }, cached_at: new Date().toISOString() };
    global.fetch = vi.fn() as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "9") as never);
    expect(await res.json()).toEqual({ "1": { position: "WR", stats: { rec: 5 } } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refetches once the cached week is over an hour old", async () => {
    cachedRow = { data: { "1": { position: "WR", stats: { rec: 1 } } }, cached_at: new Date(Date.now() - 61 * 60_000).toISOString() };
    global.fetch = vi.fn(async () => new Response(JSON.stringify(sleeperRows), { status: 200 })) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "9") as never);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ "1": { position: "WR", stats: { rec: 5, rec_yd: 60 } } });
  });

  it("answers non-OK and caches nothing when Sleeper projects no one (so the sim falls back)", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify([sleeperRows[1]]), { status: 200 })) as never;
    const GET = await loadGET();
    const res = await GET(makeReq("2026", "9") as never);
    expect(res.ok).toBe(false);
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("answers non-OK and caches nothing on an upstream error or a thrown fetch", async () => {
    global.fetch = vi.fn(async () => new Response("err", { status: 500 })) as never;
    let GET = await loadGET();
    expect((await GET(makeReq("2026", "9") as never)).ok).toBe(false);
    global.fetch = vi.fn(async () => { throw new Error("timeout"); }) as never;
    GET = await loadGET();
    expect((await GET(makeReq("2026", "9") as never)).ok).toBe(false);
    await flush();
    expect(upserts).toHaveLength(0);
  });

  it("rejects a malformed season or week before touching the cache or Sleeper", async () => {
    global.fetch = vi.fn() as never;
    const GET = await loadGET();
    expect((await GET(makeReq("26", "9") as never)).status).toBe(400);
    expect((await GET(makeReq("2026", "19") as never)).status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
