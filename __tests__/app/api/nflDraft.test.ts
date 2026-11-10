// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
  requireUser: vi.fn(),
  loadDraftYear: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/requireUser", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/cfd/client", () => ({ getCfdReader: () => null }));
vi.mock("@/lib/cfd/draftPicks", () => ({ loadDraftYear: h.loadDraftYear }));

import { POST } from "@/app/api/scouting/nfl-draft/route";

const req = (body: unknown) => new NextRequest("http://localhost/api/scouting/nfl-draft", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer t" }, body: JSON.stringify(body),
});

beforeEach(() => {
  h.requireUser.mockResolvedValue({ user: { id: "u1" }, supabase: {} });
  h.loadDraftYear.mockReset();
});

describe("POST /api/scouting/nfl-draft", () => {
  it("rejects a year that isn't a past or current draft", async () => {
    const next = new Date().getUTCFullYear() + 1;
    for (const year of [next, 1999, "2027", 2027.5, undefined]) {
      const res = await POST(req({ year }));
      expect(res.status).toBe(400);
    }
    expect(h.loadDraftYear).not.toHaveBeenCalled();
  });

  it("returns the year's picks", async () => {
    h.loadDraftYear.mockResolvedValue({ picks: [], fetched: true, remaining: 700 });
    const res = await POST(req({ year: 2026 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ picks: [], fetched: true, remaining: 700 });
    expect(h.loadDraftYear).toHaveBeenCalledWith({}, null, 2026);
  });

  it("points at migration 090 when the table is missing", async () => {
    h.loadDraftYear.mockRejectedValue(new Error("Could not find the table 'public.cfd_draft_picks' in the schema cache"));
    const res = await POST(req({ year: 2026 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/migration 090/);
  });
});
