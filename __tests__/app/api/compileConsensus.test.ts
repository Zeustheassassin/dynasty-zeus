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

function makeFrom(table: string) {
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
}));

import { POST } from "@/app/api/compile-consensus/route";

// ── Helpers ─────────────────────────────────────────────────────────────────

const THIS_YEAR = new Date().getFullYear();

function makeReq(body: unknown): Request {
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
      if (url.endsWith(`/league/${lid}/drafts`))
        return [{ draft_id: draftId, season: String(THIS_YEAR), status: "complete", settings: { rounds: 4 } }];
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
      if (url.endsWith(`/league/${lid}/drafts`))
        return [{ draft_id: draftId, season: String(THIS_YEAR), status: "complete", settings: { rounds: 3 } }];
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
      if (url.endsWith(`/league/${lid}/drafts`))
        return [{ draft_id: draftId, season: String(THIS_YEAR), status: "complete", settings: { rounds: 2 } }];
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
    createClient.mockImplementationOnce(() => ({
      auth: { getUser },
      from: vi.fn((table: string) => ({
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
      })),
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
      if (url.endsWith(`/league/${lid}/drafts`))
        return [{ draft_id: draftId, season: String(THIS_YEAR), status: "complete", settings: { rounds: 2 } }];
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
      if (url.endsWith(`/league/${lid}/drafts`))
        // 15-round startup draft — must be skipped by the ROOKIE_DRAFT_MAX_ROUNDS filter.
        return [{ draft_id: "startup", season: String(THIS_YEAR), status: "complete", settings: { rounds: 15 } }];
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
});
