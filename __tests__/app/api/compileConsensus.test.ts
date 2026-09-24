import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────
// The compile-consensus route is pure I/O orchestration: it fans out to Sleeper
// via safeFetch/withConcurrency and writes to Supabase. We mock those externals so
// we can drive the *decisions* the route makes — the auth/param guards and, by
// consuming the NDJSON stream, the aggregation + upsert-then-prune behaviour inside
// compileDrafts (avg_pick_no, veteran filtering, name fallback, the empty-result
// "don't wipe the cache" gate).

// vi.mock factories are hoisted above all top-level code, so the mock fns they
// reference must be created with vi.hoisted (which runs first).
const h = vi.hoisted(() => {
  const checkRateLimit = vi.fn(async () => ({ allowed: true, remaining: 4 }));
  const getUser = vi.fn(async () => ({ data: { user: { id: "auth-user-1" } } }));
  const createClient = vi.fn();
  const safeFetch = vi.fn();
  const withConcurrency = vi.fn();
  return { checkRateLimit, getUser, createClient, safeFetch, withConcurrency };
});

// Rate limiter: allow by default; individual tests can override.
const checkRateLimit = h.checkRateLimit;
vi.mock("../../../lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

// Auth: by default a valid user; tests override for the unauthorized path.
const getUser = h.getUser;

// Captured Supabase operations so we can assert the upsert/prune ordering + payloads.
interface CapturedUpsert { table: string; rows: unknown[]; opts: unknown }
interface CapturedDelete { table: string; filters: Array<[string, string, unknown]> }
interface CapturedInsert { table: string; rows: unknown[] }
let upserts: CapturedUpsert[] = [];
let deletes: CapturedDelete[] = [];
let inserts: CapturedInsert[] = [];
// Lets a test force an upsert to fail (so the prune gate is exercised).
let upsertError: { message: string } | null = null;

// The Sleeper user_id currently on file in user_sleeper_links for auth-user-1.
// makeReq() auto-links this to whatever sleeperUserId a test sends, so the
// ownership check passes by default — tests exercising a mismatch override it
// after calling makeReq.
let linkedSleeperUserId: string | null = null;

// Years the caller has locked, as consensus_draft_meta would report them.
let lockedYears: number[] = [];

function makeFrom(table: string) {
  if (table === "consensus_draft_meta") {
    return {
      // The route reads locked years before compiling anything.
      select: vi.fn(() => {
        const chain = {
          eq: () => chain,
          then: (resolve: (v: { data: Array<{ year: number }>; error: null }) => void) =>
            resolve({ data: lockedYears.map((year) => ({ year })), error: null }),
        };
        return chain;
      }),
      upsert: vi.fn((rows: unknown[], opts: unknown) => {
        upserts.push({ table, rows, opts });
        return Promise.resolve({ error: upsertError });
      }),
    };
  }
  if (table === "user_sleeper_links") {
    return {
      select: vi.fn(() => {
        const chain = {
          eq: () => chain,
          maybeSingle: () =>
            Promise.resolve({
              data: linkedSleeperUserId != null ? { sleeper_user_id: linkedSleeperUserId } : null,
              error: null,
            }),
        };
        return chain;
      }),
    };
  }
  return {
    upsert: vi.fn((rows: unknown[], opts: unknown) => {
      upserts.push({ table, rows, opts });
      return Promise.resolve({ error: upsertError });
    }),
    insert: vi.fn((rows: unknown[]) => {
      inserts.push({ table, rows });
      return Promise.resolve({ error: null });
    }),
    delete: vi.fn(() => {
      const filters: Array<[string, string, unknown]> = [];
      const chain = {
        eq: (col: string, val: unknown) => { filters.push([col, "eq", val]); return chain; },
        lt: (col: string, val: unknown) => { filters.push([col, "lt", val]); return chain; },
        then: (resolve: (v: { error: null }) => void) => {
          deletes.push({ table, filters });
          return resolve({ error: null });
        },
      };
      return chain;
    }),
  };
}

const createClient = h.createClient;
h.createClient.mockImplementation(() => ({
  auth: { getUser: h.getUser },
  from: vi.fn((table: string) => makeFrom(table)),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: h.createClient }));

// Sleeper fan-out: safeFetch is keyed by URL; withConcurrency just runs fn over items.
const fetchResponders: Array<(url: string) => unknown | undefined> = [];
const safeFetch = h.safeFetch;
h.safeFetch.mockImplementation(async (url: string) => {
  for (const responder of fetchResponders) {
    const r = responder(url);
    if (r !== undefined) return r;
  }
  return null;
});
const withConcurrency = h.withConcurrency;
h.withConcurrency.mockImplementation(
  async (items: unknown[], fn: (item: unknown) => Promise<void>) => {
    for (const item of items) await fn(item);
  }
);
vi.mock("../../../lib/sleeperServer", () => ({
  safeFetch: h.safeFetch,
  withConcurrency: h.withConcurrency,
  // The real pacer sleeps to hold the crawl under Sleeper's rate ceiling;
  // in tests it resolves immediately so the suite doesn't wait on wall clock.
  createPacer: () => async () => {},
}));

import { POST } from "@/app/api/compile-consensus/route";
import { COMPILE_MAX_CONNECTED_USERS } from "@/lib/constants";

// ── Helpers ─────────────────────────────────────────────────────────────────

const THIS_YEAR = new Date().getFullYear();

function makeReq(body: unknown): Request {
  if (body && typeof body === "object" && "sleeperUserId" in body) {
    linkedSleeperUserId = String((body as { sleeperUserId?: unknown }).sleeperUserId ?? "");
  }
  return new Request("http://localhost/api/compile-consensus", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

// Drains the NDJSON stream the route returns into an array of parsed events.
async function readEvents(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

// A SUPER_FLEX dynasty (taxi slots) league with no IDP — passes all three filters.
function dynastyLeague(league_id: string) {
  return {
    league_id,
    settings: { taxi_slots: 4, best_ball: 0 },
    roster_positions: ["QB", "RB", "WR", "TE", "SUPER_FLEX"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  upserts = [];
  deletes = [];
  inserts = [];
  upsertError = null;
  linkedSleeperUserId = null;
  lockedYears = [];
  fetchResponders.length = 0;

  checkRateLimit.mockImplementation(async () => ({ allowed: true, remaining: 4 }));
  getUser.mockImplementation(async () => ({ data: { user: { id: "auth-user-1" } } }));
  createClient.mockImplementation(() => ({
    auth: { getUser },
    from: vi.fn((table: string) => makeFrom(table)),
  }));
  safeFetch.mockImplementation(async (url: string) => {
    for (const responder of fetchResponders) {
      const r = responder(url);
      if (r !== undefined) return r;
    }
    return null;
  });
  withConcurrency.mockImplementation(
    async (items: unknown[], fn: (item: unknown) => Promise<void>) => {
      for (const item of items) await fn(item);
    }
  );
});

// ── Guard: rate limiting ──────────────────────────────────────────────────────

describe("POST compile-consensus — guards", () => {
  it("returns the rate-limit response when the limiter rejects (never touches Supabase)", async () => {
    const blocked = new Response("rate limited", { status: 429 });
    checkRateLimit.mockResolvedValueOnce({ allowed: false, response: blocked } as never);

    const res = await POST(makeReq({ sleeperUserId: "1", accessToken: "t", years: [THIS_YEAR] }) as never);

    expect(res.status).toBe(429);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON with 400 INVALID_JSON", async () => {
    const res = await POST(makeReq("{not json") as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_JSON");
  });

  it("rejects when required params are missing with MISSING_PARAMS", async () => {
    // No accessToken.
    const res = await POST(makeReq({ sleeperUserId: "1", years: [THIS_YEAR] }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MISSING_PARAMS");
  });

  it("rejects an empty years array with MISSING_PARAMS", async () => {
    const res = await POST(makeReq({ sleeperUserId: "1", accessToken: "t", years: [] }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MISSING_PARAMS");
  });

  it("rejects more than 20 years with YEARS_TOO_MANY", async () => {
    const years = Array.from({ length: 21 }, (_, i) => THIS_YEAR - i);
    const res = await POST(makeReq({ sleeperUserId: "1", accessToken: "t", years }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("YEARS_TOO_MANY");
  });

  it("rejects when no year is inside the valid compilation range with INVALID_YEARS", async () => {
    // 1900 and a far-future year are both outside [current-10, current+6].
    const res = await POST(
      makeReq({ sleeperUserId: "1", accessToken: "t", years: [1900, THIS_YEAR + 100] }) as never
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_YEARS");
  });

  it("returns 401 UNAUTHORIZED when the access token resolves to no user", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null } } as never);
    const res = await POST(
      makeReq({ sleeperUserId: "1", accessToken: "bad", years: [THIS_YEAR] }) as never
    );
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("UNAUTHORIZED");
  });

  it("returns 403 SLEEPER_ID_MISMATCH when sleeperUserId doesn't match the caller's linked account", async () => {
    const req = makeReq({ sleeperUserId: "999", accessToken: "t", years: [THIS_YEAR] });
    // Simulate the authenticated user's real link pointing at a different Sleeper account —
    // i.e. someone tampering with the request body to scan a network that isn't theirs.
    linkedSleeperUserId = "1";
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SLEEPER_ID_MISMATCH");
    // Must reject before any Sleeper fan-out happens.
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("returns 403 SLEEPER_ID_MISMATCH when the caller has no user_sleeper_links row at all", async () => {
    const req = makeReq({ sleeperUserId: "1", accessToken: "t", years: [THIS_YEAR] });
    linkedSleeperUserId = null; // no link on file
    const res = await POST(req as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("SLEEPER_ID_MISMATCH");
    expect(safeFetch).not.toHaveBeenCalled();
  });
});

// ── Stream: aggregation + write behaviour ───────────────────────────────────────

describe("POST compile-consensus — compilation stream", () => {
  it("streams a year_done with playerCount 0 and writes nothing when no drafts are found", async () => {
    // User has no qualifying leagues → no drafts → empty result.
    fetchResponders.push((url) => (url.includes("/leagues/nfl/") ? [] : undefined));

    const res = await POST(
      makeReq({ sleeperUserId: "100", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    const events = await readEvents(res);

    const yearDone = events.find((e) => e.type === "year_done");
    expect(yearDone).toBeDefined();
    expect(yearDone!.playerCount).toBe(0);
    expect(events.some((e) => e.type === "done")).toBe(true);

    // Critical: an empty result must NOT wipe the cache — no prune delete on cache rows.
    expect(deletes.length).toBe(0);
    expect(upserts.some((u) => u.table === "consensus_draft_cache")).toBe(false);
    // No cache write → no history snapshot either.
    expect(inserts.some((i) => i.table === "consensus_draft_history")).toBe(false);
  });

  it("aggregates avg_pick_no across drafts, sorts ascending, and filters veteran picks", async () => {
    const lid = "L1";
    const draftId = "D1";

    fetchResponders.push((url) => {
      // The user's own leagues for the requested year.
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      // No connected users (single roster owned by the user).
      if (url.endsWith(`/league/${lid}/rosters`)) return [{ roster_id: 1, owner_id: "200" }];
      // Any other user's league scan returns nothing.
      if (url.includes("/leagues/nfl/")) return [];
      // The league has one short (rookie) draft this year, in-progress is fine for current year.
      if (url.endsWith(`/user/200/drafts/nfl/${THIS_YEAR}`))
        return [{ draft_id: draftId, league_id: lid, season: String(THIS_YEAR), status: "complete", settings: { rounds: 4 } }];
      if (url.includes("/drafts/nfl/")) return [];
      // Full Sleeper player DB fallback (large enough to avoid the warning path).
      if (url.endsWith("/players/nfl")) {
        const db: Record<string, unknown> = {};
        for (let i = 0; i < 200; i++) db[`x${i}`] = { first_name: "Db", last_name: `${i}` };
        return db;
      }
      // The draft's picks: rookie WR picked at 1 and 3 (avg 2); veteran RB (years_exp 5) ignored.
      if (url.endsWith(`/draft/${draftId}/picks`))
        return [
          { player_id: "rook", pick_no: 1, metadata: { first_name: "Rookie", last_name: "One", position: "WR", team: "KC", years_exp: "0" } },
          { player_id: "rook", pick_no: 3, metadata: { first_name: "Rookie", last_name: "One", position: "WR", team: "KC", years_exp: 0 } },
          { player_id: "vet", pick_no: 2, metadata: { first_name: "Old", last_name: "Vet", position: "RB", team: "SF", years_exp: "5" } },
        ];
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    const events = await readEvents(res);

    // One cache upsert batch.
    const cacheUpserts = upserts.filter((u) => u.table === "consensus_draft_cache");
    expect(cacheUpserts.length).toBe(1);
    const rows = cacheUpserts[0].rows as Array<Record<string, unknown>>;

    // Veteran filtered out → only the rookie remains.
    expect(rows.length).toBe(1);
    expect(rows[0].player_id).toBe("rook");
    expect(rows[0].player_name).toBe("Rookie One");
    expect(rows[0].position).toBe("WR");
    expect(rows[0].avg_pick_no).toBe(2); // (1 + 3) / 2
    expect(rows[0].draft_count).toBe(2);
    expect(rows[0].user_id).toBe("auth-user-1"); // stamped with the authed user, not the sleeper id

    // Upsert uses the composite conflict key.
    expect(cacheUpserts[0].opts).toEqual({ onConflict: "user_id,year,player_id" });

    // year_done reports the surviving player count.
    const yearDone = events.find((e) => e.type === "year_done");
    expect(yearDone!.playerCount).toBe(1);
    expect(yearDone!.draftCount).toBe(1);

    // A successful cache write also appends a history snapshot with the same
    // aggregated fields (minus computed_at, renamed to snapshotted_at).
    const historyInserts = inserts.filter((i) => i.table === "consensus_draft_history");
    expect(historyInserts.length).toBe(1);
    const historyRows = historyInserts[0].rows as Array<Record<string, unknown>>;
    expect(historyRows.length).toBe(1);
    expect(historyRows[0]).toMatchObject({
      user_id:     "auth-user-1",
      player_id:   "rook",
      avg_pick_no: 2,
      draft_count: 2,
    });
    expect(historyRows[0].snapshotted_at).toBeDefined();
    expect(historyRows[0]).not.toHaveProperty("computed_at");
  });

  it("falls back to the Sleeper player DB when pick metadata has no name", async () => {
    const lid = "L1";
    const draftId = "D1";
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      if (url.endsWith(`/league/${lid}/rosters`)) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.endsWith(`/user/200/drafts/nfl/${THIS_YEAR}`))
        return [{ draft_id: draftId, league_id: lid, season: String(THIS_YEAR), status: "complete", settings: { rounds: 3 } }];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) {
        const db: Record<string, unknown> = { p9: { first_name: "Fallback", last_name: "Name", position: "RB", team: "DAL" } };
        for (let i = 0; i < 200; i++) db[`x${i}`] = { first_name: "Db", last_name: `${i}` };
        return db;
      }
      if (url.endsWith(`/draft/${draftId}/picks`))
        return [
          // No name in metadata — must be resolved from the player DB.
          { player_id: "p9", pick_no: 5, metadata: { years_exp: 0 } },
          // No player_id at all → skipped entirely.
          { pick_no: 6, metadata: { first_name: "No", last_name: "Id" } },
          // No pick_no → skipped.
          { player_id: "p10", metadata: { first_name: "No", last_name: "Pick" } },
        ];
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    await readEvents(res);

    const rows = upserts.find((u) => u.table === "consensus_draft_cache")!.rows as Array<Record<string, unknown>>;
    expect(rows.length).toBe(1);
    expect(rows[0].player_name).toBe("Fallback Name");
    expect(rows[0].position).toBe("RB");
    expect(rows[0].team).toBe("DAL");
  });

  it("upserts fresh rows BEFORE pruning stale rows (ordering keeps cache readable)", async () => {
    const callOrder: string[] = [];
    const lid = "L1";
    const draftId = "D1";
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      if (url.endsWith(`/league/${lid}/rosters`)) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.endsWith(`/user/200/drafts/nfl/${THIS_YEAR}`))
        return [{ draft_id: draftId, league_id: lid, season: String(THIS_YEAR), status: "complete", settings: { rounds: 2 } }];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) {
        const db: Record<string, unknown> = {};
        for (let i = 0; i < 200; i++) db[`x${i}`] = { first_name: "Db", last_name: `${i}` };
        return db;
      }
      if (url.endsWith(`/draft/${draftId}/picks`))
        return [{ player_id: "rk", pick_no: 1, metadata: { first_name: "R", last_name: "K", years_exp: 0 } }];
      return undefined;
    });

    // Re-mock createClient for this test to record relative ordering of upsert vs delete.
    // user_sleeper_links still goes through the shared makeFrom() so the ownership
    // check (auto-linked by makeReq()) resolves normally.
    createClient.mockImplementationOnce(() => ({
      auth: { getUser },
      from: vi.fn((table: string) => {
        if (table === "user_sleeper_links") return makeFrom(table);
        // The route reads locked years from consensus_draft_meta before compiling.
        if (table === "consensus_draft_meta") return makeFrom(table);
        return {
          upsert: vi.fn((rows: unknown[], opts: unknown) => {
            if (table === "consensus_draft_cache") callOrder.push("upsert-cache");
            upserts.push({ table, rows, opts });
            return Promise.resolve({ error: null });
          }),
          insert: vi.fn((rows: unknown[]) => {
            if (table === "consensus_draft_history") callOrder.push("insert-history");
            inserts.push({ table, rows });
            return Promise.resolve({ error: null });
          }),
          delete: vi.fn(() => {
            const chain = {
              eq: () => chain,
              lt: () => chain,
              then: (resolve: (v: { error: null }) => void) => {
                callOrder.push("delete-cache");
                return resolve({ error: null });
              },
            };
            return chain;
          }),
        };
      }),
    }) as never);

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    await readEvents(res);

    expect(callOrder).toEqual(["upsert-cache", "delete-cache", "insert-history"]);
  });

  it("does NOT prune when the upsert fails (a partial write must not delete good rows)", async () => {
    upsertError = { message: "boom" };
    const lid = "L1";
    const draftId = "D1";
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      if (url.endsWith(`/league/${lid}/rosters`)) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.endsWith(`/user/200/drafts/nfl/${THIS_YEAR}`))
        return [{ draft_id: draftId, league_id: lid, season: String(THIS_YEAR), status: "complete", settings: { rounds: 2 } }];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) {
        const db: Record<string, unknown> = {};
        for (let i = 0; i < 200; i++) db[`x${i}`] = { first_name: "Db", last_name: `${i}` };
        return db;
      }
      if (url.endsWith(`/draft/${draftId}/picks`))
        return [{ player_id: "rk", pick_no: 1, metadata: { first_name: "R", last_name: "K", years_exp: 0 } }];
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    await readEvents(res);

    // Upsert was attempted but failed → no prune delete on the cache.
    expect(upserts.some((u) => u.table === "consensus_draft_cache")).toBe(true);
    expect(deletes.length).toBe(0);
    // A failed cache write must not produce a history snapshot either.
    expect(inserts.some((i) => i.table === "consensus_draft_history")).toBe(false);
  });

  it("ignores startup/full-roster drafts (rounds above the rookie max)", async () => {
    const lid = "L1";
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      if (url.endsWith(`/league/${lid}/rosters`)) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.endsWith(`/user/200/drafts/nfl/${THIS_YEAR}`))
        return [{ draft_id: "startup", league_id: lid, season: String(THIS_YEAR), status: "complete", settings: { rounds: 15 } }];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    const events = await readEvents(res);

    const yearDone = events.find((e) => e.type === "year_done");
    expect(yearDone!.draftCount).toBe(0);
    expect(yearDone!.playerCount).toBe(0);
    expect(deletes.length).toBe(0);
  });

  it("excludes non-dynasty / non-superflex / IDP leagues from the scan", async () => {
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`))
        return [
          // best_ball → not dynasty
          { league_id: "bb", settings: { taxi_slots: 4, best_ball: 1 }, roster_positions: ["SUPER_FLEX"] },
          // no taxi slots / short roster → not dynasty
          { league_id: "redraft", settings: { taxi_slots: 0, best_ball: 0 }, roster_positions: ["QB", "RB"] },
          // dynasty but single-QB (no SUPER_FLEX) → excluded
          { league_id: "1qb", settings: { taxi_slots: 4, best_ball: 0 }, roster_positions: ["QB", "RB", "WR"] },
          // dynasty superflex but has IDP → excluded
          { league_id: "idp", settings: { taxi_slots: 4, best_ball: 0 }, roster_positions: ["QB", "SUPER_FLEX", "LB"] },
        ];
      if (url.includes("/rosters")) return [];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    const events = await readEvents(res);

    // No qualifying league → no draft scan calls for any league_id, zero result.
    const yearDone = events.find((e) => e.type === "year_done");
    expect(yearDone!.playerCount).toBe(0);
    // None of the excluded league_ids should have had their /drafts endpoint hit.
    const draftCalls = safeFetch.mock.calls.filter((c) => String(c[0]).endsWith("/drafts"));
    expect(draftCalls.length).toBe(0);
  });

  it("caps connected-user expansion at COMPILE_MAX_CONNECTED_USERS instead of scanning the whole network", async () => {
    const lid = "L1";
    // One more owner than the cap allows, all distinct from the requesting user.
    const ownerCount = COMPILE_MAX_CONNECTED_USERS + 1;
    const roster = Array.from({ length: ownerCount }, (_, i) => ({
      roster_id: i + 2,
      owner_id: `owner${i}`,
    }));
    roster.push({ roster_id: 1, owner_id: "200" }); // the requesting user's own roster

    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague(lid)];
      if (url.endsWith(`/league/${lid}/rosters`)) return roster;
      // Every connected owner's own league scan (and the league's /drafts call) returns nothing.
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    await readEvents(res);

    // Exactly MAX_CONNECTED_USERS distinct owners swept, not ownerCount.
    const ownerDraftCalls = new Set(
      safeFetch.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => /\/user\/owner\d+\/drafts\/nfl\//.test(u))
    );
    expect(ownerDraftCalls.size).toBe(COMPILE_MAX_CONNECTED_USERS);
  });

  it("keeps the SAME connected users when truncating, run to run", async () => {
    // A Set iterates in insertion order, which under concurrent fetches depends on
    // which response lands first — so slicing it unsorted kept a different arbitrary
    // subset every run. That is what made repeat compiles of one network disagree
    // (5,546 vs 22,051 leagues on consecutive days). Sorting makes it reproducible.
    const ownerCount = COMPILE_MAX_CONNECTED_USERS + 25;
    const owners = Array.from({ length: ownerCount }, (_, i) => `owner${String(i).padStart(4, "0")}`);

    const runOnce = async (rosterOrder: string[]) => {
      fetchResponders.length = 0;
      safeFetch.mockClear();
      fetchResponders.push((url) => {
        if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague("L1")];
        if (url.endsWith("/league/L1/rosters"))
          return rosterOrder.map((owner_id, i) => ({ roster_id: i + 2, owner_id }));
        if (url.includes("/leagues/nfl/")) return [];
        if (url.includes("/drafts/nfl/")) return [];
        if (url.endsWith("/players/nfl")) return {};
        return undefined;
      });
      await readEvents(await POST(
        makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
      ));
      return new Set(
        safeFetch.mock.calls
          .map((c) => String(c[0]))
          .filter((u) => /\/user\/owner\d+\/drafts\/nfl\//.test(u))
      );
    };

    const forward = await runOnce(owners);
    const reversed = await runOnce([...owners].reverse());

    expect(forward.size).toBe(COMPILE_MAX_CONNECTED_USERS);
    // Same set despite the rosters arriving in the opposite order.
    expect([...reversed].sort()).toEqual([...forward].sort());
  });

  it("never probes /league/{id}/drafts — the per-league scan is gone", async () => {
    // The old pipeline cost one request per discovered league to find drafts:
    // 22,051 of them on a real network, against a 4,000 cap, i.e. an arbitrary
    // 18% sample. Drafts now come from the user-drafts endpoint instead.
    const leagues = Array.from({ length: 50 }, (_, i) => dynastyLeague(`L${i}`));
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return leagues;
      if (url.includes("/rosters")) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    await readEvents(await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    ));

    const perLeagueDraftScans = safeFetch.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => /\/league\/[^/]+\/drafts$/.test(u));
    expect(perLeagueDraftScans).toEqual([]);
  });

  it("sweeps the caller's own drafts, not just their leaguemates'", async () => {
    // Own leagues are otherwise only reachable through a leaguemate's draft list,
    // so a league with no other connected user would contribute nothing.
    fetchResponders.push((url) => {
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague("L1")];
      if (url.includes("/rosters")) return [{ roster_id: 1, owner_id: "200" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    await readEvents(await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    ));

    expect(
      safeFetch.mock.calls.map((c) => String(c[0]))
    ).toContain(`https://api.sleeper.app/v1/user/200/drafts/nfl/${THIS_YEAR}`);
  });
});

// ── Discovery years are independent of the years being compiled ──────────────

describe("POST compile-consensus — network discovery", () => {
  it("discovers the network across ALL years, not just the requested one", async () => {
    // The bug this covers: discovery used to be scoped to the requested years, so
    // compiling 2023 alone seeded from 2023 league membership only. On a real
    // account that found 22 connected users where the full sweep finds 524 — and
    // compiling 2020 alone found zero, because the caller had no superflex dynasty
    // league yet. Who is in your network is a property of your whole history.
    const PAST = THIS_YEAR - 3;
    fetchResponders.push((url) => {
      // The caller has a league only in the CURRENT year, with a leaguemate.
      if (url.endsWith(`/user/200/leagues/nfl/${THIS_YEAR}`)) return [dynastyLeague("Lnow")];
      if (url.endsWith("/league/Lnow/rosters"))
        return [{ roster_id: 1, owner_id: "200" }, { roster_id: 2, owner_id: "mate" }];
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    // Compile a PAST year only.
    await readEvents(await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [PAST] }) as never
    ));

    const urls = safeFetch.mock.calls.map((c) => String(c[0]));
    // The current year's leagues were still swept for discovery...
    expect(urls).toContain(`https://api.sleeper.app/v1/user/200/leagues/nfl/${THIS_YEAR}`);
    // ...so the leaguemate found there is asked about the PAST year's drafts.
    expect(urls).toContain(`https://api.sleeper.app/v1/user/mate/drafts/nfl/${PAST}`);
    // And drafts are only ever requested for the year actually being compiled.
    expect(urls.filter((u) => u.includes("/drafts/nfl/")).every((u) => u.endsWith(`/${PAST}`))).toBe(true);
  });
});

// ── Year locking ─────────────────────────────────────────────────────────────

describe("POST compile-consensus — locked years", () => {
  it("rejects with 409 YEARS_LOCKED when every requested year is locked", async () => {
    lockedYears = [THIS_YEAR];
    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("YEARS_LOCKED");
    // Nothing was fetched or written — the guard runs before any fan-out.
    expect(safeFetch.mock.calls.length).toBe(0);
    expect(upserts.length).toBe(0);
  });

  it("compiles the unlocked years and skips the locked ones", async () => {
    const PAST = THIS_YEAR - 1;
    lockedYears = [PAST];
    fetchResponders.push((url) => {
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });

    const events = await readEvents(await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [PAST, THIS_YEAR] }) as never
    ));

    const doneYears = events.filter((e) => e.type === "year_done").map((e) => e.year);
    expect(doneYears).toEqual([THIS_YEAR]);
    expect(doneYears).not.toContain(PAST);
    expect(events.some((e) => typeof e.message === "string" && e.message.includes("Skipping locked year"))).toBe(true);
  });

  it("does not reject when the lock is on some OTHER year", async () => {
    lockedYears = [THIS_YEAR - 5];
    fetchResponders.push((url) => {
      if (url.includes("/leagues/nfl/")) return [];
      if (url.includes("/drafts/nfl/")) return [];
      if (url.endsWith("/players/nfl")) return {};
      return undefined;
    });
    const res = await POST(
      makeReq({ sleeperUserId: "200", accessToken: "t", years: [THIS_YEAR] }) as never
    );
    expect(res.status).toBe(200);
  });
});
