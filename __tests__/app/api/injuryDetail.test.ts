import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// /api/injuries/detail — one player's ESPN injury record for the Alert Hub's
// injury summary: name → ESPN id via the fantasy player list, then that
// athlete's injuries for the season.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 59 })),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

type Route = { GET: (req: never) => Promise<Response> };
const importRoute = async (): Promise<Route> => {
  vi.resetModules(); // fresh module = fresh player-list cache
  return (await import("@/app/api/injuries/detail/route")) as Route;
};
const req = (qs: string) => new NextRequest(`http://localhost/api/injuries/detail?${qs}`) as never;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

const PLAYER_LIST = [
  { id: 4880281, fullName: "Jordyn Tyson", lastName: "Tyson", proTeamId: 18, defaultPositionId: 3 },
];
const TYSON_INJURY = {
  items: [{
    status: "Injured Reserve",
    date: "2026-08-30T22:30Z",
    shortComment: "Tyson (hamstring) was placed on injured reserve with a designation to return by New Orleans on Sunday.",
    longComment: "Expected to miss two months, per https://example.com/story\"&gt;a report.",
    details: { fantasyStatus: { abbreviation: "IR-R" }, type: "Hamstring", side: "Right", detail: "Strain", returnDate: "2026-10-11" },
  }],
};

function mockEspn(injuries: (url: string) => Response) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.includes("/players?view=players_wl")) return json(PLAYER_LIST);
    if (url.includes("/athletes/")) return injuries(url);
    return json({}, 404);
  });
  global.fetch = fetchMock as never;
  return fetchMock;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-29T15:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); });

describe("GET /api/injuries/detail", () => {
  it("resolves the player and returns a slim, cleaned record", async () => {
    const fetchMock = mockEspn(() => json(TYSON_INJURY));
    const { GET } = await importRoute();
    const res = await GET(req("name=Jordyn%20Tyson&team=NO&pos=WR"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage");
    const body = await res.json();
    expect(body).toMatchObject({
      found: true, season: 2026, status: "Injured Reserve", fantasyStatus: "IR-R",
      type: "Hamstring", side: "Right", detail: "Strain", returnDate: "2026-10-11",
      longComment: "Expected to miss two months, per a report.",
    });
    // The player list needs the active filter (otherwise ESPN returns 50 players).
    const listCall = fetchMock.mock.calls.find(([u]) => String(u).includes("players_wl"))!;
    expect(JSON.stringify(listCall[1])).toContain("filterActive");
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/seasons/2026/athletes/4880281/injuries"))).toBe(true);
  });

  it("answers found:false (200) for a player ESPN doesn't list, without an athlete call", async () => {
    const fetchMock = mockEspn(() => json(TYSON_INJURY));
    const { GET } = await importRoute();
    const res = await GET(req("name=John%20Michael%20Gyllenborg&team=KC&pos=TE"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ found: false });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("/athletes/"))).toBe(false);
  });

  it("falls back to last season when this season has no record", async () => {
    mockEspn((url) => (url.includes("/seasons/2026/") ? json({ error: { code: 404 } }, 404) : json(TYSON_INJURY)));
    const { GET } = await importRoute();
    const body = await (await GET(req("name=Jordyn%20Tyson&team=NO&pos=WR"))).json();
    expect(body).toMatchObject({ found: true, season: 2025 });
  });

  it("returns 502 (never a cacheable 'no report') when ESPN fails", async () => {
    global.fetch = vi.fn(async () => json({}, 500)) as never;
    const { GET } = await importRoute();
    const res = await GET(req("name=Jordyn%20Tyson&team=NO&pos=WR"));
    expect(res.status).toBe(502);
  });

  it("rejects a missing name or a malformed team without calling ESPN", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    expect((await GET(req("team=NO"))).status).toBe(400);
    expect((await GET(req("name=Jordyn%20Tyson&team=N0!"))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
