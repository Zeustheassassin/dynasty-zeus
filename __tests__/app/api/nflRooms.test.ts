// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 2 })),
  requireUser: vi.fn(),
  loadNflRooms: vi.fn(),
  client: { get: vi.fn() } as unknown,
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/requireUser", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/pff/nflRooms", () => ({ loadNflRooms: h.loadNflRooms }));
vi.mock("@/lib/pff/client", async (orig) => ({ ...(await orig<typeof import("@/lib/pff/client")>()), getPffClient: () => h.client }));

import { POST } from "@/app/api/scouting/nfl-rooms/route";
import { PffError } from "@/lib/pff/client";

const req = (body: unknown) => new NextRequest("http://localhost/api/scouting/nfl-rooms", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body),
});

beforeEach(() => {
  h.requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
  h.loadNflRooms.mockReset();
  h.client = { get: vi.fn() };
});

describe("POST /api/scouting/nfl-rooms", () => {
  it("rejects a year that isn't a past or current draft", async () => {
    const next = new Date().getUTCFullYear() + 1;
    for (const year of [next, 1999, "2027", 2027.5, undefined]) {
      expect((await POST(req({ year }))).status).toBe(400);
    }
    expect(h.loadNflRooms).not.toHaveBeenCalled();
  });

  it("returns the rooms", async () => {
    const rooms = { year: 2026, season: 2025, asOf: "x", bars: {}, teams: [], missing: [] };
    h.loadNflRooms.mockResolvedValue(rooms);
    const res = await POST(req({ year: 2026 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(rooms);
    expect(h.loadNflRooms).toHaveBeenCalledWith(h.client, 2026);
  });

  it("says when PFF's budget is spent, and when the key is missing", async () => {
    h.loadNflRooms.mockRejectedValue(new PffError("rate limited", 429, "rate_limited"));
    expect((await POST(req({ year: 2026 }))).status).toBe(429);
    h.client = null;
    const res = await POST(req({ year: 2026 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/PFF_API_KEY/);
  });
});
