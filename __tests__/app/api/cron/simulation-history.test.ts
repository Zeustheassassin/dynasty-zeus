// Tests for the simulation-history odds-snapshot cron GET handler.
//
// Full end-to-end coverage of the simulation pipeline (players, FC value
// caches, projections, matchups, rookie board, simulateLeague) would need
// to mock a very large surface — this file focuses on the same
// high-value, cheap-to-verify boundary the league-transactions cron test
// covers: the timing-safe auth guard, env-misconfiguration guards, the
// user_sleeper_links DB-error guard, and the zero-work early return
// (which happens before any FC-cache/simulation work runs).
//
// The route reads process.env at request time and imports CURRENT_YEAR /
// SLEEPER_BASE_URL at module scope, so we set env BEFORE importing and use
// vi.resetModules() per test (mirrors league-transactions.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET = "super-secret-cron-token";

interface FakeState {
  links: { rows: unknown[] | null; error: { message: string } | null };
  createClientCalls: number;
}

let fake: FakeState;

function makeQueryBuilder(table: string) {
  return {
    select: (_cols: string) => {
      if (table === "user_sleeper_links") {
        return Promise.resolve({ data: fake.links.rows, error: fake.links.error });
      }
      // fc_values_cache / fc_redraft_values_cache read chain:
      // .select("data").eq("num_qbs", numQbs).single()
      return {
        eq: (_col: string, _val: unknown) => ({
          single: () => Promise.resolve({ data: null, error: { message: "no rows" } }),
        }),
      };
    },
    upsert: (_batch: unknown[], _opts: unknown) => ({
      select: (_cols: string) => Promise.resolve({ data: [], error: null }),
    }),
  };
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: (_url: string, _key: string, _opts: unknown) => {
    fake.createClientCalls++;
    return {
      from: (table: string) => makeQueryBuilder(table),
    };
  },
}));

let fetchRoutes: Array<{ match: (u: string) => boolean; body: unknown }>;

function jsonResponse(body: unknown) {
  return { status: 200, ok: true, json: async () => body };
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const r = fetchRoutes.find((route) => route.match(u));
      return jsonResponse(r ? r.body : []);
    })
  );
}

function route(match: (u: string) => boolean, body: unknown) {
  fetchRoutes.push({ match, body });
}

function makeReq(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return { headers } as unknown as import("next/server").NextRequest;
}

async function loadGET() {
  vi.resetModules();
  const mod = await import("../../../../app/api/cron/simulation-history/route");
  return mod.GET;
}

const ORIG_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  fake = { links: { rows: [], error: null }, createClientCalls: 0 };
  fetchRoutes = [];
  installFetch();
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service.role.key";
});

afterEach(() => {
  vi.unstubAllGlobals();
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

  it("returns 401 for a token of the WRONG length (length-guarded, no throw)", async () => {
    const GET = await loadGET();
    const res = await GET(makeReq("Bearer short"));
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

describe("GET league discovery", () => {
  it("returns 500 when the user_sleeper_links read errors", async () => {
    fake.links = { rows: null, error: { message: "boom" } };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/DB read failed/);
  });

  it("returns ok:true with zero work when there are no links", async () => {
    fake.links = { rows: [], error: null };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, leaguesFound: 0, leaguesSimulated: 0, rowsWritten: 0 });
  });

  it("returns ok:true with zero work when linked users have no dynasty leagues", async () => {
    fake.links = { rows: [{ sleeper_user_id: "sleeper-1" }], error: null };
    route(
      (u) => u.includes("/user/sleeper-1/leagues/"),
      [
        {
          league_id: "L-redraft",
          name: "Redraft",
          settings: { taxi_slots: 0, best_ball: 0 },
          roster_positions: ["QB", "RB", "WR", "TE", "FLEX"],
        },
      ]
    );
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, leaguesFound: 0, leaguesSimulated: 0, rowsWritten: 0 });
  });

  it("dedupes a league shared by two registered users before simulating", async () => {
    // Both users belong to the same dynasty league. We don't chase the full
    // simulation pipeline here (rosters route returns [] → fetchLeagueCore
    // bails with null, so leaguesSimulated stays 0) — this only asserts the
    // dedup happened by checking the leagues/rosters endpoint was hit once
    // per unique league, not once per user.
    fake.links = {
      rows: [
        { sleeper_user_id: "sleeper-1" },
        { sleeper_user_id: "sleeper-2" },
      ],
      error: null,
    };
    const sharedLeague = {
      league_id: "L-shared",
      name: "Shared Dynasty",
      settings: { taxi_slots: 2, best_ball: 0 },
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
    };
    route((u) => u.includes("/user/sleeper-1/leagues/"), [sharedLeague]);
    route((u) => u.includes("/user/sleeper-2/leagues/"), [sharedLeague]);
    let rosterFetchCount = 0;
    route((u) => {
      if (u.includes("/league/L-shared/rosters")) {
        rosterFetchCount++;
        return true;
      }
      return false;
    }, []);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaguesFound).toBe(1);
    expect(rosterFetchCount).toBe(1);
  });
});
