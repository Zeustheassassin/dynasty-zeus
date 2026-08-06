// Tests for POST /api/simulation-history — the client-triggered sibling to
// the weekly cron (app/api/cron/simulation-history). Focuses on the same
// cheap-to-verify boundary as the other API route tests: the auth guard
// (session must be valid, never trust a client-supplied user id), the
// input-validation guards, and that a valid request upserts to
// league_simulation_history with the same onConflict key the cron uses.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

const h = vi.hoisted(() => {
  const checkRateLimit = vi.fn(async () => ({ allowed: true, remaining: 59 }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "auth-user-1" } } }));
  return { checkRateLimit, getUser };
});

vi.mock("../../../lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

interface CapturedUpsert { rows: unknown[]; opts: unknown }
let upserts: CapturedUpsert[] = [];
let upsertError: { message: string } | null = null;
let authClientCalls: string[] = []; // Authorization headers passed to the anon-key client

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, key: string, opts?: { global?: { headers?: Record<string, string> } }) => {
    // The route creates two clients: one with the anon key (to verify the
    // caller's session) and one with the service-role key (to write).
    // Distinguish them by which key string was passed in.
    if (key === "anon-key") {
      authClientCalls.push(opts?.global?.headers?.Authorization ?? "");
      return { auth: { getUser: h.getUser } };
    }
    return {
      from: (_table: string) => ({
        upsert: (rows: unknown[], upsertOpts: unknown) => {
          upserts.push({ rows, opts: upsertOpts });
          return { select: (_cols: string) => Promise.resolve({ data: rows.map((_, i) => ({ id: i })), error: upsertError }) };
        },
      }),
    };
  },
}));

async function loadPOST() {
  vi.resetModules();
  const mod = await import("../../../app/api/simulation-history/route");
  return mod.POST;
}

function makeReq(body: unknown) {
  return {
    json: async () => body,
  } as unknown as import("next/server").NextRequest;
}

const validRow = { rosterId: 1, playoffOdds: 55.5, titleOdds: 12.3, expectedWins: 8.2, avgFinish: 4.1, finishRange: "2-7" };
const validBody = { accessToken: "tok-abc", leagueId: "league-1", season: "2026", week: 0, rows: [validRow] };

const ORIG_ENV = {
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  ANON: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SERVICE: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  upserts = [];
  upsertError = null;
  authClientCalls = [];
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
  h.getUser.mockResolvedValue({ data: { user: { id: "auth-user-1" } } });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
});

afterAll(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIG_ENV.URL;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ORIG_ENV.ANON;
  process.env.SUPABASE_SERVICE_ROLE_KEY = ORIG_ENV.SERVICE;
});

describe("POST /api/simulation-history", () => {
  it("rejects when rate limited", async () => {
    h.checkRateLimit.mockResolvedValue({
      allowed: false,
      response: new Response(JSON.stringify({ error: "rate limited" }), { status: 429 }),
    });
    const POST = await loadPOST();
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(429);
    expect(upserts).toHaveLength(0);
  });

  it("rejects a request with no accessToken", async () => {
    const POST = await loadPOST();
    const res = await POST(makeReq({ ...validBody, accessToken: undefined }));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("rejects an invalid session (never trusts a client-supplied user id)", async () => {
    h.getUser.mockResolvedValue({ data: { user: null } });
    const POST = await loadPOST();
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(401);
    expect(upserts).toHaveLength(0);
  });

  it("passes the caller's token through to the anon-key session check", async () => {
    const POST = await loadPOST();
    await POST(makeReq(validBody));
    expect(authClientCalls).toEqual(["Bearer tok-abc"]);
  });

  it.each([
    ["bad season", { ...validBody, season: "26" }],
    ["negative week", { ...validBody, week: -1 }],
    ["non-integer week", { ...validBody, week: 1.5 }],
    ["missing leagueId", { ...validBody, leagueId: "" }],
    ["empty rows", { ...validBody, rows: [] }],
    ["too many rows", { ...validBody, rows: Array(41).fill(validRow) }],
    ["malformed row", { ...validBody, rows: [{ rosterId: "not-a-number" }] }],
  ])("rejects %s", async (_label, body) => {
    const POST = await loadPOST();
    const res = await POST(makeReq(body));
    expect(res.status).toBe(400);
    expect(upserts).toHaveLength(0);
  });

  it("upserts with the same onConflict key the cron uses, keyed by league/roster/season/week", async () => {
    const POST = await loadPOST();
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, rowsWritten: 1 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts).toEqual({ onConflict: "league_id,roster_id,season,week" });
    expect(upserts[0].rows).toEqual([
      expect.objectContaining({
        league_id: "league-1",
        roster_id: 1,
        season: "2026",
        week: 0,
        playoff_odds: 55.5,
        title_odds: 12.3,
        expected_wins: 8.2,
        avg_finish: 4.1,
        finish_range: "2-7",
      }),
    ]);
  });

  it("returns 500 and does not leak the DB error when the upsert fails", async () => {
    upsertError = { message: "constraint violation" };
    const POST = await loadPOST();
    const res = await POST(makeReq(validBody));
    expect(res.status).toBe(500);
    const json = await res.json();
    expect(JSON.stringify(json)).not.toContain("constraint violation");
  });
});
