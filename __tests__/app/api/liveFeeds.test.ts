import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// Coverage for the two feeds the Gameday Hub layers on during games:
//   /api/stats/sleeper-live  — live cumulative stat lines (per-stat pace)
//   /api/injuries/espn       — ESPN injury report, trimmed (raw payload is ~9 MB)

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

const load = async <T,>(path: string): Promise<T> => {
  vi.resetModules(); // fresh module = fresh in-memory cache in the injuries route
  return (await import(path)) as T;
};
type Route = { GET: (req: never) => Promise<Response> };

const req = (url: string) => new NextRequest(`http://localhost${url}`) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
});

describe("GET /api/stats/sleeper-live", () => {
  const importRoute = () => load<Route>("@/app/api/stats/sleeper-live/route");

  it("calls Sleeper's working stats URL shape and trims to tracked, nonzero categories", async () => {
    const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify({
      "1": { pass_yd: 187, pass_td: 0, pass_int: 1, pts_ppr: 12.5, off_snp: 60, gp: 1 },
      "2": { rec: 5, rec_yd: 61, rush_yd: 0 },
      "3": { off_snp: 10, gp: 1 },     // nothing tracked -> dropped entirely
      "4": {},
    }), { status: 200 }));
    global.fetch = fetchMock as never;

    const { GET } = await importRoute();
    const res = await GET(req("/api/stats/sleeper-live?season=2026&week=3"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      "1": { pass_yd: 187, pass_int: 1 },
      "2": { rec: 5, rec_yd: 61 },
    });
    // The /stats/nfl/{season}/{week}?season_type=regular form returns {} for every player.
    expect(String(fetchMock.mock.calls[0][0])).toContain("/stats/nfl/regular/2026/3");
  });

  it("rejects a bad season or week without calling upstream", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    expect((await GET(req("/api/stats/sleeper-live?season=26&week=3"))).status).toBe(400);
    expect((await GET(req("/api/stats/sleeper-live?season=2026&week=0"))).status).toBe(400);
    expect((await GET(req("/api/stats/sleeper-live?season=2026"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a non-OK status (never a cached empty) when Sleeper fails", async () => {
    global.fetch = vi.fn(async () => new Response("nope", { status: 500 })) as never;
    const { GET } = await importRoute();
    const res = await GET(req("/api/stats/sleeper-live?season=2026&week=3"));
    expect(res.status).toBe(502);
  });

  it("honors the rate limiter", async () => {
    h.checkRateLimit.mockResolvedValueOnce({
      allowed: false,
      response: new Response("{}", { status: 429 }),
    } as never);
    const { GET } = await importRoute();
    expect((await GET(req("/api/stats/sleeper-live?season=2026&week=3"))).status).toBe(429);
  });
});

describe("GET /api/injuries/espn", () => {
  const importRoute = () => load<Route>("@/app/api/injuries/espn/route");
  const espnPayload = {
    injuries: [
      {
        displayName: "Arizona Cardinals",
        injuries: [
          { status: "Out", date: "2026-09-21T03:12Z", athlete: { displayName: "Some Runner", position: { abbreviation: "RB" }, team: { abbreviation: "ARI" } }, longComment: "x".repeat(2000) },
          { status: "Active", date: "2026-09-20T00:00Z", athlete: { displayName: "Some Passer", position: { abbreviation: "QB" }, team: { abbreviation: "ARI" } } },
          { status: "Out", athlete: { displayName: "A Kicker", position: { abbreviation: "K" }, team: { abbreviation: "ARI" } } },
          { athlete: { displayName: "No Status", position: { abbreviation: "WR" } } },
        ],
      },
    ],
  };

  it("keeps only skill positions with a status, trimmed to what the overlay needs", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify(espnPayload), { status: 200 })) as never;
    const { GET } = await importRoute();
    const body = await (await GET(req("/api/injuries/espn"))).json();
    expect(body.players).toEqual([
      { name: "Some Runner", position: "RB", team: "ARI", status: "Out", date: "2026-09-21T03:12Z" },
      { name: "Some Passer", position: "QB", team: "ARI", status: "Active", date: "2026-09-20T00:00Z" },
    ]);
  });

  it("serves from memory within the cache window instead of re-downloading 9 MB", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(espnPayload), { status: 200 }));
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    await GET(req("/api/injuries/espn"));
    await GET(req("/api/injuries/espn"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list (not an error) when ESPN is down and nothing is cached", async () => {
    global.fetch = vi.fn(async () => new Response("down", { status: 503 })) as never;
    const { GET } = await importRoute();
    const res = await GET(req("/api/injuries/espn"));
    expect(res.status).toBe(200);
    expect((await res.json()).players).toEqual([]);
  });
});
