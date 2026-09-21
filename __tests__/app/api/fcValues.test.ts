import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// The route is a thin shell over getFcValues (covered in __tests__/lib/server/fcValues.test.ts):
// validate params, delegate, and map "nothing usable" to a non-200 so clients treat it as an error
// instead of caching an empty list (audit Batch 2 step 8).

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
  getFcValues: vi.fn(),
}));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/fcValues", () => ({ getFcValues: h.getFcValues }));

import { GET } from "@/app/api/fc-values/route";

const req = (qs: string) => new NextRequest(`http://localhost/api/fc-values${qs}`);
const DATA = [{ player: { sleeperId: "1", position: "QB" }, value: 9000 }];

beforeEach(() => {
  vi.clearAllMocks();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 29 });
  h.getFcValues.mockResolvedValue({ data: DATA, source: "cache", fetchedAt: "2026-09-21T12:00:00.000Z" });
});

describe("GET /api/fc-values", () => {
  it("returns the raw FantasyCalc array with its provenance in headers", async () => {
    const res = await GET(req("?numQbs=2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DATA);
    expect(res.headers.get("X-FC-Source")).toBe("cache");
    expect(res.headers.get("X-FC-Fetched-At")).toBe("2026-09-21T12:00:00.000Z");
  });

  it("defaults to superflex dynasty, and passes numQbs / isDynasty through", async () => {
    await GET(req(""));
    expect(h.getFcValues).toHaveBeenLastCalledWith(2, true);
    await GET(req("?numQbs=1&isDynasty=false"));
    expect(h.getFcValues).toHaveBeenLastCalledWith(1, false);
    await GET(req("?numQbs=2&isDynasty=true"));
    expect(h.getFcValues).toHaveBeenLastCalledWith(2, true);
  });

  it("answers 502 (not 200 + []) when there is nothing usable, so clients retry instead of caching it", async () => {
    h.getFcValues.mockResolvedValue(null);
    const res = await GET(req("?numQbs=2"));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "FantasyCalc values unavailable" });
  });

  it.each(["?numQbs=0", "?numQbs=3", "?numQbs=abc"])("rejects %s with 400 before loading anything", async (qs) => {
    const res = await GET(req(qs));
    expect(res.status).toBe(400);
    expect(h.getFcValues).not.toHaveBeenCalled();
  });

  it("returns the rate limiter's response when the caller is over the limit", async () => {
    const limited = new Response("slow down", { status: 429 });
    h.checkRateLimit.mockResolvedValue({ allowed: false, response: limited } as never);
    const res = await GET(req("?numQbs=2"));
    expect(res.status).toBe(429);
    expect(h.getFcValues).not.toHaveBeenCalled();
  });
});
