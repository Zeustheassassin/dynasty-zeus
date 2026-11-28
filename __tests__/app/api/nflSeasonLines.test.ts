import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// GET /api/nfl-season-lines: a thin shell over getSeasonLines (covered in
// __tests__/lib/server/nflSeasonLines.test.ts): the last three finished
// seasons, sent compact with a day-long CDN cache; 502 when they can't be read.

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 19 })),
  getSeasonLines: vi.fn(),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/nflSeasonLines", () => ({ getSeasonLines: h.getSeasonLines }));

import { GET } from "@/app/api/nfl-season-lines/route";
import { LINE_KEYS, finishedSeasons } from "@/lib/helpers/nflSeasonLines";

const req = () => new NextRequest("http://localhost/api/nfl-season-lines");
const stats = Object.fromEntries(LINE_KEYS.map((k) => [k, k === "rec" ? 80 : 0]));

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 19 });
  h.getSeasonLines.mockResolvedValue([{ season: 2025, pos: "WR", games: 17, stats }]);
});

describe("GET /api/nfl-season-lines", () => {
  it("sends the finished seasons' lines compact, cached a day at the CDN", async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seasons).toEqual(finishedSeasons(new Date()));
    expect(body.keys).toEqual([...LINE_KEYS]);
    expect(body.lines).toEqual([["WR", 2025, 17, ...LINE_KEYS.map((k) => stats[k])]]);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=86400, stale-while-revalidate=604800");
    expect(h.getSeasonLines).toHaveBeenCalledWith(finishedSeasons(new Date()));
  });

  it("answers 502 when nflverse can't be read", async () => {
    h.getSeasonLines.mockRejectedValue(new Error("nflverse 2025 weekly stats answered 404"));
    const res = await GET(req());
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/couldn't be read: nflverse 2025/);
  });

  it("returns the rate limiter's response when the caller is over the limit", async () => {
    const limited = new Response("slow down", { status: 429 });
    h.checkRateLimit.mockResolvedValue({ allowed: false, response: limited } as never);
    const res = await GET(req());
    expect(res.status).toBe(429);
    expect(h.getSeasonLines).not.toHaveBeenCalled();
  });
});
