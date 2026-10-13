// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 29 })),
  requireUser: vi.fn(),
  getPffClient: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));
vi.mock("@/lib/server/requireUser", () => ({ requireUser: h.requireUser }));
vi.mock("@/lib/pff/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pff/client")>("@/lib/pff/client");
  return { ...actual, getPffClient: h.getPffClient };
});

import { POST } from "@/app/api/pff/bio/route";
import { PffError } from "@/lib/pff/client";
import type { PffBioResponse } from "@/lib/pff/api";

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const prospect = (n: number, extra: Record<string, unknown>) => ({
  id: ID(n), name: `Player ${n}`, height: `6'1"`, weight: 200, birthday: null, eligible_thru_year: 2027,
  pff_player_id: null, pff_match_status: null, ...extra,
});

let rows: Record<string, unknown>[] = [];
let inIds: string[] = [];
let loadError: { message: string; code: string } | null = null;

function caller() {
  return {
    user: { id: "u1" },
    supabase: {
      from: () => ({
        select: () => ({
          in: (_col: string, ids: string[]) => {
            inIds = ids;
            return Promise.resolve(loadError ? { data: null, error: loadError } : { data: rows, error: null });
          },
        }),
      }),
    },
  };
}

const post = (ids: unknown) =>
  POST(new NextRequest("http://localhost/api/pff/bio", {
    method: "POST",
    headers: { Authorization: "Bearer t", "Content-Type": "application/json" },
    body: JSON.stringify({ prospectIds: ids }),
  }));

beforeEach(() => {
  rows = [];
  inIds = [];
  loadError = null;
  h.requireUser.mockResolvedValue(caller());
});

describe("POST /api/pff/bio", () => {
  it("reads PFF only for sure links and reports why the rest weren't read", async () => {
    rows = [
      prospect(1, { pff_player_id: 11, pff_match_status: "auto" }),
      prospect(2, { pff_player_id: 22, pff_match_status: "review" }),
      prospect(3, {}),
      prospect(4, { pff_match_status: "none" }),
    ];
    const get = vi.fn(async () => ({ players: [{ id: 11, height: 603, weight: 214, dob: null, current_eligible_year: 2028 }] }));
    h.getPffClient.mockReturnValue({ get });

    const res = await post([ID(1), ID(2), ID(3), ID(4)]);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PffBioResponse;

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/v1/players", { league: "ncaa", id: 11 });
    expect(inIds).toEqual([ID(1), ID(2), ID(3), ID(4)]);
    expect(body.retryAfterMs).toBeNull();
    expect(body.results[0]).toEqual({
      prospectId: ID(1), name: "Player 1",
      current: { height: `6'1"`, weight: 200, birthday: null, eligibleThru: 2027 },
      pff: { heightIn: 75, weight: 214, dob: null, eligibleThru: 2028 },
    });
    expect(body.results.slice(1).map((r) => [r.pff, r.note])).toEqual([
      [null, "His PFF match is waiting on you in PFF Links"],
      [null, "Not linked to PFF yet"],
      [null, "You marked him as not in PFF"],
    ]);
  });

  it("stops reading when PFF's budget runs out and asks for the rest again", async () => {
    rows = [
      prospect(1, { pff_player_id: 11, pff_match_status: "auto" }),
      prospect(2, { pff_player_id: 22, pff_match_status: "confirmed" }),
    ];
    const get = vi.fn(async () => { throw new PffError("budget", 429, "rate_limited", 30_000); });
    h.getPffClient.mockReturnValue({ get });

    const body = (await (await post([ID(1), ID(2)])).json()) as PffBioResponse;
    expect(get).toHaveBeenCalledTimes(1);
    expect(body.retryAfterMs).toBe(30_000);
    expect(body.results.map((r) => r.error)).toEqual(["Not reached this batch; run again", "Not reached this batch; run again"]);
  });

  it("fails the batch when PFF refuses the key", async () => {
    rows = [prospect(1, { pff_player_id: 11, pff_match_status: "auto" })];
    h.getPffClient.mockReturnValue({ get: vi.fn(async () => { throw new PffError("no", 401, "unauthorized"); }) });
    const res = await post([ID(1)]);
    expect(res.status).toBe(502);
  });

  it("rejects bad ids and too many ids before any PFF read", async () => {
    const get = vi.fn();
    h.getPffClient.mockReturnValue({ get });
    expect((await post(["not-a-uuid"])).status).toBe(400);
    expect((await post([])).status).toBe(400);
    expect((await post(Array.from({ length: 21 }, () => ID(1)))).status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it("says to apply migration 071 when the column is missing", async () => {
    loadError = { message: "column prospects.eligible_thru_year does not exist", code: "42703" };
    const get = vi.fn();
    h.getPffClient.mockReturnValue({ get });
    const res = await post([ID(1)]);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).toContain("071");
    expect(get).not.toHaveBeenCalled();
  });

  it("needs a signed-in caller", async () => {
    const { NextResponse } = await import("next/server");
    h.requireUser.mockResolvedValue({ response: NextResponse.json({ error: "Missing auth token" }, { status: 401 }) });
    h.getPffClient.mockReturnValue({ get: vi.fn() });
    expect((await post([ID(1)])).status).toBe(401);
  });
});
