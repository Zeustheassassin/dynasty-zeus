import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Audit Batch 2 step 7. Since migration 026 the shared cache tables are SELECT-only for the anon key,
// so the routes' anon-client upserts were denied by RLS and nothing was ever cached (fc_values_cache
// stuck at one 2026-04-29 row; the other three tables empty). Reads still use the anon client; the
// WRITES must go through the service-role helper. Covers /api/fc-values (route + real getFcValues, step 8
// wiring) and /api/cross-league-rosters (/api/stats/sleeper-weekly has its own file).

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
  upsertCacheRow: vi.fn(async (_table: string, _row: Record<string, unknown>) => true),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/supabaseAdmin", () => ({ upsertCacheRow: h.upsertCacheRow }));

let cachedRow: Record<string, unknown> | null = null;
let readTables: string[] = [];
let anonWrites = 0;

// Chain that serves the cached row for any select().eq()...single() and counts anon writes.
vi.mock("@/lib/supabaseclient", () => {
  const chain = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    q.select = () => { readTables.push(table); return q; };
    q.eq = () => q;
    q.single = () => Promise.resolve(cachedRow ? { data: cachedRow, error: null } : { data: null, error: { message: "no rows" } });
    q.upsert = () => { anonWrites++; return Promise.resolve({ error: { message: "new row violates row-level security policy" } }); };
    return q;
  };
  // Mirrors the real lib/supabaseclient.ts readCacheRow's contract (miss -> null) directly
  // against this same test state, rather than re-simulating the query chain.
  const readCacheRow = async (table: string, _filters: [string, unknown][], _columns: string) => {
    readTables.push(table);
    return cachedRow ?? null;
  };
  return { supabase: { from: (table: string) => chain(table) }, readCacheRow };
});

type Route = { GET: (req: never) => Promise<Response> };
async function load(path: string): Promise<Route> {
  vi.resetModules();
  return (await import(path)) as Route;
}
const req = (url: string) => new NextRequest(`http://localhost${url}`) as never;
const flush = () => new Promise((r) => setTimeout(r, 0)); // let afterResponse's write start
const NOW = () => new Date().toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  h.upsertCacheRow.mockResolvedValue(true);
  cachedRow = null;
  readTables = [];
  anonWrites = 0;
});

// The route + the REAL getFcValues helper together (the route test mocks the helper; the helper test
// skips the route) — guards the wiring between them.
describe("GET /api/fc-values — route + helper wiring", () => {
  const FC = Array.from({ length: 60 }, (_, i) => ({ player: { sleeperId: String(i + 1), position: "QB" }, value: 9000 - i }));
  const stubFc = (body: unknown = FC, status = 200) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  };

  it("caches a live response through the service role, into the dynasty table for isDynasty (default)", async () => {
    stubFc();
    const { GET } = await load("@/app/api/fc-values/route");
    const res = await GET(req("/api/fc-values?numQbs=2"));
    await flush();

    expect(res.headers.get("X-FC-Source")).toBe("live");
    expect(await res.json()).toEqual(FC);
    expect(h.upsertCacheRow).toHaveBeenCalledTimes(1);
    expect(h.upsertCacheRow).toHaveBeenCalledWith("fc_values_cache", expect.objectContaining({ num_qbs: 2, data: FC }));
    expect(anonWrites).toBe(0);
  });

  it("uses the redraft table for isDynasty=false", async () => {
    stubFc();
    const { GET } = await load("@/app/api/fc-values/route");
    await GET(req("/api/fc-values?numQbs=1&isDynasty=false"));
    await flush();
    expect(h.upsertCacheRow).toHaveBeenCalledWith("fc_redraft_values_cache", expect.objectContaining({ num_qbs: 1 }));
    expect(anonWrites).toBe(0);
  });

  it("does not hit FantasyCalc or write when the cache row is fresh", async () => {
    cachedRow = { data: FC, cached_at: NOW() };
    stubFc();
    const { GET } = await load("@/app/api/fc-values/route");
    const res = await GET(req("/api/fc-values?numQbs=2"));
    await flush();
    expect(res.headers.get("X-FC-Source")).toBe("cache");
    expect(await res.json()).toEqual(FC);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("serves the expired cache (200, X-FC-Source: stale) instead of [] when FantasyCalc is down", async () => {
    cachedRow = { data: FC, cached_at: new Date(Date.now() - 50 * 3_600_000).toISOString() };
    stubFc({ error: "down" }, 503);
    const { GET } = await load("@/app/api/fc-values/route");
    const res = await GET(req("/api/fc-values?numQbs=2"));
    await flush();
    expect(res.status).toBe(200);
    expect(res.headers.get("X-FC-Source")).toBe("stale");
    expect(await res.json()).toEqual(FC);
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it.each([[[]], [{ error: "nope" }]])("answers 502 and caches nothing for an unusable FantasyCalc body (%j) with no cache to fall back on", async (body) => {
    stubFc(body);
    const { GET } = await load("@/app/api/fc-values/route");
    const res = await GET(req("/api/fc-values?numQbs=2"));
    await flush();
    expect(res.status).toBe(502);
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("rejects an invalid numQbs before touching the cache or FantasyCalc", async () => {
    stubFc();
    const { GET } = await load("@/app/api/fc-values/route");
    const res = await GET(req("/api/fc-values?numQbs=3"));
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
    expect(readTables).toEqual([]);
  });
});

describe("GET /api/cross-league-rosters — cache writes", () => {
  const ROSTERS = [
    { roster_id: 1, owner_id: "111", players: ["a"] },
    { roster_id: 2, owner_id: "222", players: ["b"] },
  ];
  const stubRosters = (body: unknown = ROSTERS, status = 200) => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status })) as never;
  };
  const url = "/api/cross-league-rosters?sleeper_user_id=222&league_id=999";

  it("caches the requested owner's roster through the service role, never the anon client", async () => {
    stubRosters();
    const { GET } = await load("@/app/api/cross-league-rosters/route");
    const res = await GET(req(url));
    await flush();

    expect(await res.json()).toEqual({ roster: ROSTERS[1] });
    expect(h.upsertCacheRow).toHaveBeenCalledTimes(1);
    expect(h.upsertCacheRow).toHaveBeenCalledWith(
      "cross_league_rosters_cache",
      expect.objectContaining({ sleeper_user_id: "222", league_id: "999", roster: ROSTERS[1] })
    );
    expect(anonWrites).toBe(0);
  });

  it("does not write when the owner has no roster in that league", async () => {
    stubRosters([{ roster_id: 1, owner_id: "111" }]);
    const { GET } = await load("@/app/api/cross-league-rosters/route");
    const res = await GET(req(url));
    await flush();
    expect(await res.json()).toEqual({ roster: null });
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("serves a fresh cache hit without fetching or writing", async () => {
    cachedRow = { roster: ROSTERS[1], cached_at: NOW() };
    stubRosters();
    const { GET } = await load("@/app/api/cross-league-rosters/route");
    const res = await GET(req(url));
    await flush();
    expect(await res.json()).toEqual({ roster: ROSTERS[1] });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("returns 502 and writes nothing when Sleeper is down", async () => {
    stubRosters({ error: "down" }, 500);
    const { GET } = await load("@/app/api/cross-league-rosters/route");
    const res = await GET(req(url));
    await flush();
    expect(res.status).toBe(502);
    expect(h.upsertCacheRow).not.toHaveBeenCalled();
  });

  it("rejects malformed ids before touching the cache", async () => {
    stubRosters();
    const { GET } = await load("@/app/api/cross-league-rosters/route");
    const res = await GET(req("/api/cross-league-rosters?sleeper_user_id=abc&league_id=999"));
    expect(res.status).toBe(400);
    expect(readTables).toEqual([]);
  });
});
