// Tests for the league-transactions annotation cron GET handler.
//
// This is an I/O-orchestration route. We exercise the PUBLIC `GET`
// export end-to-end by mocking its two external boundaries:
//   - `@supabase/supabase-js` createClient  → in-memory fake client
//   - global `fetch` (used by lib/sleeperServer.safeFetch)  → URL router
//
// Doing it this way (rather than reaching into un-exported helpers)
// lets us assert the handler's real decisions — the timing-safe auth
// guard, env-misconfiguration guards, DB-error handling, the week-window
// calculation, and the full per-user annotation pipeline (dynasty
// filtering, transaction filtering, roster-owner map, draft-pick slot
// strings, and the PER_USER_TX_CAP) — without touching production source.
//
// The route reads process.env at request time and imports CURRENT_YEAR /
// SLEEPER_BASE_URL at module scope, so we set env BEFORE importing and use
// vi.resetModules() per test (mirrors __tests__/lib/envGuard.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CURRENT_YEAR } from "@/lib/helpers/season";

const SECRET = "super-secret-cron-token";

// ── Supabase fake ─────────────────────────────────────────────────────
// Records upsert batches and lets each test control the links read result
// and the upsert result.

interface FakeState {
  links: { rows: unknown[] | null; error: { message: string } | null };
  // Per-table upsert behaviour. transaction_id rows are echoed back from
  // `.select(...)` so the handler's `written` count reflects input length
  // unless we force an error.
  upsertError: { message: string } | null;
  upserts: unknown[][]; // captured batches
  createClientCalls: number;
}

let fake: FakeState;

function makeQueryBuilder(table: string) {
  return {
    // links read: supabase.from("user_sleeper_links").select(...)
    select: (_cols: string) => {
      if (table === "user_sleeper_links") {
        return Promise.resolve({ data: fake.links.rows, error: fake.links.error });
      }
      // upsert(...).select("transaction_id") path
      return {
        // resolved as a thenable below via the upsert chain
      };
    },
    upsert: (batch: unknown[], _opts: unknown) => {
      fake.upserts.push(batch);
      return {
        select: (_cols: string) =>
          Promise.resolve(
            fake.upsertError
              ? { data: null, error: fake.upsertError }
              : {
                  data: (batch as Array<{ transaction_id: string }>).map((r) => ({
                    transaction_id: r.transaction_id,
                  })),
                  error: null,
                }
          ),
      };
    },
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

// ── Sleeper fetch router ──────────────────────────────────────────────
// safeFetch calls global fetch(url, { signal }). We route by URL substring
// and return a Response-like object exposing { status, ok, json() }.

let fetchRoutes: Array<{ match: (u: string) => boolean; body: unknown }>;

function jsonResponse(body: unknown) {
  return {
    status: 200,
    ok: true,
    json: async () => body,
  };
}

function installFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      const route = fetchRoutes.find((r) => r.match(u));
      // Default: empty array body (mirrors Sleeper returning [] for unknown weeks)
      return jsonResponse(route ? route.body : []);
    })
  );
}

function route(match: (u: string) => boolean, body: unknown) {
  fetchRoutes.push({ match, body });
}

// ── Fixture builders ──────────────────────────────────────────────────

const dynastyLeague = (id: string, name: string) => ({
  league_id: id,
  name,
  season: CURRENT_YEAR,
  settings: { taxi_slots: 2, best_ball: 0 },
  roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
});

const redraftLeague = (id: string, name: string) => ({
  league_id: id,
  name,
  season: CURRENT_YEAR,
  settings: { taxi_slots: 0, best_ball: 0 },
  roster_positions: ["QB", "RB", "WR", "TE", "FLEX"], // <= 20, no taxi
});

const bestBallDynastyLeague = (id: string, name: string) => ({
  league_id: id,
  name,
  season: CURRENT_YEAR,
  settings: { taxi_slots: 4, best_ball: 1 }, // taxi present but best_ball excludes it
  roster_positions: Array(30).fill("BN"),
});

const completeTx = (overrides: Record<string, unknown> = {}) => ({
  transaction_id: "tx1",
  type: "trade",
  status: "complete",
  created: 1000,
  roster_ids: [1, 2],
  draft_picks: [],
  ...overrides,
});

// ── Helpers ───────────────────────────────────────────────────────────

function makeReq(authHeader?: string) {
  const headers = new Headers();
  if (authHeader !== undefined) headers.set("authorization", authHeader);
  return { headers } as unknown as import("next/server").NextRequest;
}

async function loadGET() {
  // Fresh module eval so module-scoped reads (logger, constants) are clean
  // and the supabase mock is freshly applied.
  vi.resetModules();
  const mod = await import(
    "../../../../app/api/cron/league-transactions/route"
  );
  return mod.GET;
}

const ORIG_ENV = {
  CRON_SECRET: process.env.CRON_SECRET,
  URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

beforeEach(() => {
  fake = {
    links: { rows: [], error: null },
    upsertError: null,
    upserts: [],
    createClientCalls: 0,
  };
  fetchRoutes = [];
  installFetch();
  process.env.CRON_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://x.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service.role.key";
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  // Restore env
  for (const [k, v] of [
    ["CRON_SECRET", ORIG_ENV.CRON_SECRET],
    ["NEXT_PUBLIC_SUPABASE_URL", ORIG_ENV.URL],
    ["SUPABASE_SERVICE_ROLE_KEY", ORIG_ENV.KEY],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

// ════════════════════════════════════════════════════════════════════
// Auth + env guards
// ════════════════════════════════════════════════════════════════════

describe("GET auth + env guards", () => {
  it("returns 500 when CRON_SECRET is not configured", async () => {
    delete process.env.CRON_SECRET;
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toMatch(/CRON_SECRET/);
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const GET = await loadGET();
    const res = await GET(makeReq(undefined));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("returns 401 for a wrong token of the SAME length (timing-safe compare)", async () => {
    const GET = await loadGET();
    // Same byte length as `Bearer ${SECRET}` but different content
    const right = `Bearer ${SECRET}`;
    const wrong = "X".repeat(right.length);
    expect(wrong.length).toBe(right.length);
    const res = await GET(makeReq(wrong));
    expect(res.status).toBe(401);
  });

  it("returns 401 for a token of the WRONG length (length-guarded, no throw)", async () => {
    const GET = await loadGET();
    // A short header would make timingSafeEqual throw if not length-guarded.
    const res = await GET(makeReq("Bearer short"));
    expect(res.status).toBe(401);
  });

  it("returns 401 for the bare secret without the 'Bearer ' prefix", async () => {
    const GET = await loadGET();
    const res = await GET(makeReq(SECRET));
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

  it("returns 500 only when the service-role key is missing", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
  });
});

// ════════════════════════════════════════════════════════════════════
// DB read failure
// ════════════════════════════════════════════════════════════════════

describe("GET links read", () => {
  it("returns 500 when the user_sleeper_links read errors", async () => {
    fake.links = { rows: null, error: { message: "boom" } };
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/DB read failed/);
  });

  it("returns ok:true with zero work when there are no links", async () => {
    fake.links = { rows: [], error: null };
    route((u) => u.includes("/state/nfl"), { week: 5, leg: 5 });
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.linksFound).toBe(0);
    expect(body.usersProcessed).toBe(0);
    expect(body.rowsWritten).toBe(0);
    // No upserts should have happened
    expect(fake.upserts).toHaveLength(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Week-window calculation
// ════════════════════════════════════════════════════════════════════

describe("GET week-window calculation", () => {
  beforeEach(() => {
    fake.links = { rows: [], error: null }; // no users → skip fan-out, just inspect weeks
  });

  it("derives 4 descending weeks from nflState.leg", async () => {
    route((u) => u.includes("/state/nfl"), { week: 99, leg: 10 });
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    // leg (10) preferred over week (99); lookback 4 → [10,9,8,7]
    expect(body.weeks).toEqual([10, 9, 8, 7]);
  });

  it("falls back to nflState.week when leg is absent", async () => {
    route((u) => u.includes("/state/nfl"), { week: 6 });
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect((await res.json()).weeks).toEqual([6, 5, 4, 3]);
  });

  it("clamps the upper bound to week 18", async () => {
    route((u) => u.includes("/state/nfl"), { leg: 50 });
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect((await res.json()).weeks).toEqual([18, 17, 16, 15]);
  });

  it("never emits a week below 1 (offseason / week 1)", async () => {
    route((u) => u.includes("/state/nfl"), { leg: 2 });
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    // curWeek=2 → [2,1] (0 and -1 dropped)
    expect((await res.json()).weeks).toEqual([2, 1]);
  });

  it("defaults to week 1 when nflState fetch yields no data", async () => {
    // No /state/nfl route → router default returns [] which is not an
    // object with leg/week, so fallback is week 1.
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect((await res.json()).weeks).toEqual([1]);
  });
});

// ════════════════════════════════════════════════════════════════════
// Per-user annotation pipeline (drives processUser via the public GET)
// ════════════════════════════════════════════════════════════════════

describe("GET per-user annotation pipeline", () => {
  // Common scaffold: one link, NFL state at week 5.
  function oneUser() {
    fake.links = {
      rows: [{ user_id: "auth-1", sleeper_user_id: "sleeper-1" }],
      error: null,
    };
    route((u) => u.includes("/state/nfl"), { leg: 5, week: 5 });
  }

  it("filters out non-dynasty and best-ball leagues before fan-out", async () => {
    oneUser();
    route(
      (u) => u.includes("/user/sleeper-1/leagues/"),
      [
        redraftLeague("L-redraft", "Redraft"),
        bestBallDynastyLeague("L-bestball", "Best Ball"),
      ]
    );
    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    // No dynasty leagues → processUser returns 0, but the user is still processed
    expect(body.usersProcessed).toBe(1);
    expect(body.rowsWritten).toBe(0);
    expect(fake.upserts).toHaveLength(0);
  });

  it("keeps only complete, non-waiver_failed transactions", async () => {
    oneUser();
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    // The lookback window for leg=5 is weeks [5,4,3,2]; put txs on week 5.
    route(
      (u) => u.includes("/league/L1/transactions/5"),
      [
        completeTx({ transaction_id: "keep", status: "complete", type: "trade" }),
        completeTx({ transaction_id: "drop-incomplete", status: "failed", type: "trade" }),
        completeTx({
          transaction_id: "drop-waiverfail",
          status: "complete",
          type: "waiver_failed",
        }),
      ]
    );
    route((u) => u.includes("/league/L1/users"), []);
    route((u) => u.includes("/league/L1/rosters"), []);
    route((u) => u.includes("/league/L1/drafts"), []);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.rowsWritten).toBe(1);
    expect(fake.upserts).toHaveLength(1);
    const batch = fake.upserts[0] as Array<{ transaction_id: string }>;
    expect(batch.map((r) => r.transaction_id)).toEqual(["keep"]);
  });

  it("builds the rosterOwnerMap with display_name, then username, then Team fallback", async () => {
    oneUser();
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    route((u) => u.includes("/league/L1/transactions/5"), [
      completeTx({ transaction_id: "keep" }),
    ]);
    route((u) => u.includes("/league/L1/users"), [
      { user_id: "owner-A", display_name: "Alice", username: "alice99" },
      { user_id: "owner-B", display_name: "", username: "bob_user" },
    ]);
    route((u) => u.includes("/league/L1/rosters"), [
      { roster_id: 1, owner_id: "owner-A" },
      { roster_id: 2, owner_id: "owner-B" }, // display_name empty → username
      { roster_id: 3, owner_id: "owner-MISSING" }, // no matching user → Team N
    ]);
    route((u) => u.includes("/league/L1/drafts"), []);

    const GET = await loadGET();
    await GET(makeReq(`Bearer ${SECRET}`));
    const batch = fake.upserts[0] as Array<{
      payload: { rosterOwnerMap: Record<number, string> };
    }>;
    const map = batch[0].payload.rosterOwnerMap;
    expect(map[1]).toBe("Alice");
    expect(map[2]).toBe("bob_user");
    expect(map[3]).toBe("Team 3");
  });

  it("annotates the payload with leagueName, leagueId and the raw transaction", async () => {
    oneUser();
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    route((u) => u.includes("/league/L1/transactions/5"), [
      completeTx({ transaction_id: "keep", created: 7777 }),
    ]);
    route((u) => u.includes("/league/L1/users"), []);
    route((u) => u.includes("/league/L1/rosters"), []);
    route((u) => u.includes("/league/L1/drafts"), []);

    const GET = await loadGET();
    await GET(makeReq(`Bearer ${SECRET}`));
    const row = (fake.upserts[0] as Array<{
      user_id: string;
      transaction_id: string;
      league_id: string;
      created: number;
      payload: { leagueName: string; leagueId: string; transaction_id: string };
    }>)[0];
    expect(row.user_id).toBe("auth-1");
    expect(row.transaction_id).toBe("keep");
    expect(row.league_id).toBe("L1");
    expect(row.created).toBe(7777);
    expect(row.payload.leagueName).toBe("Dynasty One");
    expect(row.payload.leagueId).toBe("L1");
    expect(row.payload.transaction_id).toBe("keep");
  });

  it("annotates a current-year draft pick with a zero-padded slot string", async () => {
    oneUser();
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    // Linear (non-snake) draft so getDraftRoundSlot returns baseSlot directly.
    route((u) => u.includes("/league/L1/drafts"), [
      {
        draft_id: "D1",
        season: CURRENT_YEAR,
        type: "linear",
        // draft_order keyed by user_id → base slot
        draft_order: { "owner-A": 4 },
      },
    ]);
    route((u) => u.includes("/league/L1/users"), [
      { user_id: "owner-A", display_name: "Alice", username: "alice" },
    ]);
    route((u) => u.includes("/league/L1/rosters"), [
      { roster_id: 1, owner_id: "owner-A" },
      { roster_id: 2, owner_id: "owner-A" },
    ]);
    route((u) => u.includes("/league/L1/transactions/5"), [
      completeTx({
        transaction_id: "keep",
        draft_picks: [
          { season: CURRENT_YEAR, round: 1, roster_id: 1, previous_owner_id: 2, owner_id: 1 },
        ],
      }),
    ]);

    const GET = await loadGET();
    await GET(makeReq(`Bearer ${SECRET}`));
    const pick = (fake.upserts[0] as Array<{
      payload: { draft_picks: Array<{ slot: string }> };
    }>)[0].payload.draft_picks[0];
    // round 1, baseSlot 4 (owner-A) → "1.04"
    expect(pick.slot).toBe("1.04");
  });

  it("annotates a future-year draft pick with the bare round string", async () => {
    oneUser();
    const futureYear = String(Number(CURRENT_YEAR) + 1);
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    route((u) => u.includes("/league/L1/drafts"), [
      { draft_id: "D1", season: CURRENT_YEAR, type: "linear", draft_order: {} },
    ]);
    route((u) => u.includes("/league/L1/users"), []);
    route((u) => u.includes("/league/L1/rosters"), []);
    route((u) => u.includes("/league/L1/transactions/5"), [
      completeTx({
        transaction_id: "keep",
        draft_picks: [
          { season: futureYear, round: 2, roster_id: 3, previous_owner_id: 1, owner_id: 3 },
        ],
      }),
    ]);

    const GET = await loadGET();
    await GET(makeReq(`Bearer ${SECRET}`));
    const pick = (fake.upserts[0] as Array<{
      payload: { draft_picks: Array<{ slot: string }> };
    }>)[0].payload.draft_picks[0];
    // future year → slot is just the round number as a string
    expect(pick.slot).toBe("2");
  });

  it("caps stored rows at PER_USER_TX_CAP (200) keeping the freshest by created", async () => {
    oneUser();
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    route((u) => u.includes("/league/L1/users"), []);
    route((u) => u.includes("/league/L1/rosters"), []);
    route((u) => u.includes("/league/L1/drafts"), []);
    // 250 complete txs with increasing `created`; cap should keep the 200
    // newest. Newest created = 249 (id "tx249").
    const many = Array.from({ length: 250 }, (_, i) =>
      completeTx({ transaction_id: `tx${i}`, created: i })
    );
    route((u) => u.includes("/league/L1/transactions/5"), many);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.rowsWritten).toBe(200);
    // single upsert batch of exactly 200
    expect(fake.upserts).toHaveLength(1);
    const batch = fake.upserts[0] as Array<{ created: number }>;
    expect(batch).toHaveLength(200);
    // Freshest kept (created 249) and oldest of the kept window is 50
    const createds = batch.map((r) => r.created);
    expect(Math.max(...createds)).toBe(249);
    expect(Math.min(...createds)).toBe(50);
  });

  it("continues (no throw) and records 0 rows written when the upsert errors", async () => {
    oneUser();
    fake.upsertError = { message: "upsert exploded" };
    route((u) => u.includes("/user/sleeper-1/leagues/"), [
      dynastyLeague("L1", "Dynasty One"),
    ]);
    route((u) => u.includes("/league/L1/users"), []);
    route((u) => u.includes("/league/L1/rosters"), []);
    route((u) => u.includes("/league/L1/drafts"), []);
    route((u) => u.includes("/league/L1/transactions/5"), [
      completeTx({ transaction_id: "keep" }),
    ]);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.usersProcessed).toBe(1);
    expect(body.rowsWritten).toBe(0); // error batch contributes nothing
    expect(fake.upserts).toHaveLength(1); // it still attempted the write
  });

  it("isolates a thrown user so other users still process", async () => {
    // Two links. The first user's leagues fetch throws (fetch rejects);
    // safeFetch swallows fetch errors → returns null → leagues=[] → 0 rows,
    // user still counts as processed. The second user produces a row.
    fake.links = {
      rows: [
        { user_id: "auth-1", sleeper_user_id: "sleeper-1" },
        { user_id: "auth-2", sleeper_user_id: "sleeper-2" },
      ],
      error: null,
    };
    route((u) => u.includes("/state/nfl"), { leg: 5, week: 5 });
    route((u) => u.includes("/user/sleeper-1/leagues/"), []); // user 1: no leagues
    route((u) => u.includes("/user/sleeper-2/leagues/"), [
      dynastyLeague("L2", "User Two Dynasty"),
    ]);
    route((u) => u.includes("/league/L2/users"), []);
    route((u) => u.includes("/league/L2/rosters"), []);
    route((u) => u.includes("/league/L2/drafts"), []);
    route((u) => u.includes("/league/L2/transactions/5"), [
      completeTx({ transaction_id: "u2tx" }),
    ]);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.linksFound).toBe(2);
    expect(body.usersProcessed).toBe(2);
    expect(body.rowsWritten).toBe(1);
  });
});
