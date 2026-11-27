// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
  requireUser: vi.fn(),
  fetchCombineSizes: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/requireUser", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/server/fortyTimes", () => ({ fetchCombineSizes: h.fetchCombineSizes }));

import { POST } from "@/app/api/scouting/combine-sizes/route";

const req = (body: unknown) => new NextRequest("http://localhost/api/scouting/combine-sizes", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body),
});
const thisYear = new Date().getUTCFullYear();
const ROW = { name: "A", school: "S", position: "RB", heightEighths: 576, weight: 210 };

beforeEach(() => {
  h.requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
  h.fetchCombineSizes.mockReset().mockResolvedValue([ROW]);
});

describe("POST /api/scouting/combine-sizes", () => {
  it("rejects a bad year before reading anything", async () => {
    for (const body of [{ year: 1999 }, { year: thisYear + 5 }, { year: "2026" }, {}]) {
      expect((await POST(req(body))).status).toBe(400);
    }
    expect(h.fetchCombineSizes).not.toHaveBeenCalled();
  });

  it("needs a signed-in user", async () => {
    h.requireUser.mockResolvedValue({ response: new Response("no", { status: 401 }) });
    expect((await POST(req({ year: thisYear }))).status).toBe(401);
    expect(h.fetchCombineSizes).not.toHaveBeenCalled();
  });

  it("returns the year's rows, and null for a class whose combine is still ahead without reading", async () => {
    const now = await POST(req({ year: thisYear }));
    expect(await now.json()).toEqual({ year: thisYear, rows: [ROW] });
    const ahead = await POST(req({ year: thisYear + 1 }));
    expect(await ahead.json()).toEqual({ year: thisYear + 1, rows: null });
    expect(h.fetchCombineSizes).toHaveBeenCalledTimes(1);
  });

  it("says so when nflverse can't be read", async () => {
    h.fetchCombineSizes.mockRejectedValue(new Error("nflverse combine.csv answered 503"));
    const res = await POST(req({ year: thisYear }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/503/);
  });
});
