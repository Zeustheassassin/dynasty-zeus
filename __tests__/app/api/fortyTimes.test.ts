// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
  requireUser: vi.fn(),
  fetchCombinePosition: vi.fn(),
  fetchProjectedPosition: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/requireUser", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/server/fortyTimes", () => ({
  fetchCombinePosition: h.fetchCombinePosition,
  fetchProjectedPosition: h.fetchProjectedPosition,
}));

import { POST } from "@/app/api/scouting/forty-times/route";

const req = (body: unknown) => new NextRequest("http://localhost/api/scouting/forty-times", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body),
});
const thisYear = new Date().getUTCFullYear();
const ROW = { name: "A", school: "S", position: "RB", forty: 4.5, weight: 200 };

beforeEach(() => {
  h.requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
  h.fetchCombinePosition.mockReset().mockResolvedValue([ROW]);
  h.fetchProjectedPosition.mockReset().mockResolvedValue([ROW]);
});

describe("POST /api/scouting/forty-times", () => {
  it("rejects a bad year or position before reading anything", async () => {
    for (const body of [{ year: 1999, position: "RB" }, { year: thisYear + 5, position: "RB" }, { year: "2027", position: "RB" }, { year: 2027, position: "OT" }, {}]) {
      expect((await POST(req(body))).status).toBe(400);
    }
    expect(h.fetchProjectedPosition).not.toHaveBeenCalled();
  });

  it("returns both sources for a past or current class", async () => {
    const res = await POST(req({ year: thisYear, position: "RB" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ year: thisYear, position: "RB", combine: [ROW], projected: [ROW] });
  });

  it("doesn't read the combine for a class whose draft year hasn't come", async () => {
    const body = await (await POST(req({ year: thisYear + 1, position: "WR" }))).json();
    expect(body.combine).toBeNull();
    expect(h.fetchCombinePosition).not.toHaveBeenCalled();
    expect(h.fetchProjectedPosition).toHaveBeenCalledWith(thisYear + 1, "WR");
  });

  it("still answers with one source when the other fails", async () => {
    h.fetchProjectedPosition.mockRejectedValue(new Error("WalterFootball answered 503 for RB 2026"));
    const body = await (await POST(req({ year: thisYear, position: "RB" }))).json();
    expect(body).toMatchObject({ combine: [ROW], projected: [], projectedError: "WalterFootball answered 503 for RB 2026" });
  });

  it("needs a signed-in caller", async () => {
    h.requireUser.mockResolvedValue({ response: new Response("no", { status: 401 }) });
    expect((await POST(req({ year: thisYear, position: "RB" }))).status).toBe(401);
  });
});
