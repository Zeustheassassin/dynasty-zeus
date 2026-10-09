import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// /api/nfl-scoreboard's optional season param (ESPN's `dates`), used for a
// season's Week 1 kickoff by the draft board's class switch.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

type Route = { GET: (req: never) => Promise<Response> };
const importRoute = async () => {
  vi.resetModules();
  return (await import("@/app/api/nfl-scoreboard/route")) as Route;
};
const req = (url: string) => new NextRequest(`http://localhost${url}`) as never;

const event = (date: string, home: string, away: string) => ({
  date,
  competitions: [{
    date,
    status: { type: { name: "STATUS_SCHEDULED", state: "pre" } },
    competitors: [{ team: { abbreviation: home } }, { team: { abbreviation: away } }],
  }],
});
const espn = (body: unknown) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status: 200 }));

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
});

describe("GET /api/nfl-scoreboard with a season", () => {
  it("asks ESPN for that season's week and parses it", async () => {
    const fetchMock = espn({ season: { year: 2026, type: 2 }, events: [event("2026-09-10T00:20Z", "SEA", "NE")] });
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    const res = await GET(req("/api/nfl-scoreboard?week=1&season=2026"));
    expect(String(fetchMock.mock.calls[0][0])).toContain("week=1&seasontype=2&dates=2026");
    const body = await res.json();
    expect(body.SEA).toMatchObject({ kickoffAt: Date.parse("2026-09-10T00:20Z"), state: "Upcoming", opponent: "NE" });
  });

  it("answers {} for a season ESPN has no schedule for, or a reply for another season", async () => {
    global.fetch = espn({ events: [] }) as never;
    let { GET } = await importRoute();
    expect(await (await GET(req("/api/nfl-scoreboard?week=1&season=2027"))).json()).toEqual({});

    global.fetch = espn({ season: { year: 2026, type: 2 }, events: [event("2026-09-10T00:20Z", "SEA", "NE")] }) as never;
    ({ GET } = await importRoute());
    expect(await (await GET(req("/api/nfl-scoreboard?week=1&season=2027"))).json()).toEqual({});
  });

  it("rejects a malformed season without calling ESPN", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    expect(await (await GET(req("/api/nfl-scoreboard?week=1&season=26"))).json()).toEqual({});
    expect(await (await GET(req("/api/nfl-scoreboard?week=1&season=abcd"))).json()).toEqual({});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves the season off without one, as before", async () => {
    const fetchMock = espn({ events: [] });
    global.fetch = fetchMock as never;
    const { GET } = await importRoute();
    await GET(req("/api/nfl-scoreboard?week=5"));
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/week=5&seasontype=2$/);
  });
});
