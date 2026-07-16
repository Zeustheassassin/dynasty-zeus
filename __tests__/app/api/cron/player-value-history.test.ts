// Tests for the player-value-history daily snapshot cron GET handler.
//
// Mirrors simulation-history.test.ts's approach: the route reads
// process.env at request time, so env is set BEFORE each import and
// vi.resetModules() runs per test. Covers the timing-safe auth guard,
// env-misconfiguration guards, the fc_values_cache read-error guard, the
// zero-work early return, and the value-parsing + upsert happy path.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET = "super-secret-cron-token";

interface FakeState {
  fcCache: { data: unknown; error: { message: string } | null };
  upsertedBatches: unknown[][];
}

let fake: FakeState;

function makeQueryBuilder(table: string) {
  if (table === "fc_values_cache") {
    return {
      select: (_cols: string) => ({
        eq: (_col: string, _val: unknown) => ({
          single: () => Promise.resolve({ data: fake.fcCache.data, error: fake.fcCache.error }),
        }),
      }),
    };
  }
  // player_value_history
  return {
    upsert: (batch: unknown[], _opts: unknown) => {
      fake.upsertedBatches.push(batch);
      return { select: (_cols: string) => Promise.resolve({ data: batch.map((_, i) => ({ id: String(i) })), error: null }) };
    },
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, _opts: unknown) => ({
    from: (table: string) => makeQueryBuilder(table),
  }),
}));

function makeReq(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return { headers } as unknown as import("next/server").NextRequest;
}

async function loadGET() {
  vi.resetModules();
  const mod = await import("../../../../app/api/cron/player-value-history/route");
  return mod.GET;
}

const ORIG_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  fake = { fcCache: { data: null, error: null }, upsertedBatches: [] };
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service.role.key";
});

afterEach(() => {
  vi.clearAllMocks();
  for (const [k, v] of [
    ["CRON_SECRET", ORIG_ENV.CRON_SECRET],
    ["NEXT_PUBLIC_SUPABASE_URL", ORIG_ENV.URL],
    ["SUPABASE_SERVICE_ROLE_KEY", ORIG_ENV.KEY],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("GET auth + env guards", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/CRON_SECRET/);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const GET = await loadGET();
    const res = await GET(makeReq(undefined));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 401 for a wrong token of the SAME length (timing-safe compare)", async () => {
    const GET = await loadGET();
    const right = `Bearer ${SECRET}`;
    const wrong = "X".repeat(right.length);
    expect(wrong.length).toBe(right.length);
    const res = await GET(makeReq(wrong));
    expect(res.status).toBe(401);
  });

  it("returns 500 when Supabase env vars are absent (after auth passes)", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/misconfiguration/i);
  });
});

describe("GET fc_values_cache read + write", () => {
  it("returns 500 when the fc_values_cache read errors", async () => {
    fake.fcCache = { data: null, error: { message: "boom" } };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/DB read failed/);
  });

  it("returns ok:true with zero work when the cache has no usable entries", async () => {
    fake.fcCache = { data: { data: [{ player: { position: "PICK" }, value: 5000 }] }, error: null };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, playersFound: 0, rowsWritten: 0 });
  });

  it("parses sleeperId/value entries and upserts one row per player for today", async () => {
    fake.fcCache = {
      data: {
        data: [
          { player: { position: "WR", sleeperId: "1001" }, value: 8000 },
          { player: { position: "RB", sleeperId: "1002" }, value: 6500.6 },
          { player: { position: "QB" }, value: 9000 }, // no sleeperId — skipped
          { player: { position: "WR", sleeperId: "1003" }, value: 0 }, // zero value — skipped
        ],
      },
      error: null,
    };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.playersFound).toBe(2);
    expect(body.rowsWritten).toBe(2);
    expect(typeof body.snapshotDate).toBe("string");

    expect(fake.upsertedBatches).toHaveLength(1);
    const batch = fake.upsertedBatches[0] as { player_id: string; value: number; snapshot_date: string }[];
    expect(batch).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ player_id: "1001", value: 8000 }),
        expect.objectContaining({ player_id: "1002", value: 6501 }),
      ])
    );
  });
});
