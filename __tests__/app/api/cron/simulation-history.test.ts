// Tests for the simulation-history odds-snapshot cron GET handler.
//
// Full end-to-end coverage of the simulation pipeline (players, FC value
// caches, projections, matchups, rookie board, simulateLeague) would need
// to mock a very large surface — this file focuses on the same
// high-value, cheap-to-verify boundary the league-transactions cron test
// covers: the timing-safe auth guard, env-misconfiguration guards, the
// user_sleeper_links DB-error guard, and the zero-work early return
// (which happens before any FC-cache/simulation work runs), plus how the run
// behaves when FantasyCalc values are (un)available. getFcValues is mocked —
// its own behavior is covered in __tests__/lib/server/fcValues.test.ts.
//
// The route reads process.env at request time and imports CURRENT_YEAR /
// SLEEPER_BASE_URL at module scope, so we set env BEFORE importing and use
// vi.resetModules() per test (mirrors league-transactions.test.ts).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SECRET = "super-secret-cron-token";

interface FakeState {
  links: { rows: unknown[] | null; error: { message: string } | null };
  createClientCalls: number;
  historyUpserts: number;
  historyUpsertBatchSizes: number[];
}

let fake: FakeState;

function makeQueryBuilder(table: string) {
  return {
    select: (_cols: string) => {
      if (table === "user_sleeper_links") {
        return Promise.resolve({ data: fake.links.rows, error: fake.links.error });
      }
      // Only user_sleeper_links is read with this client — FantasyCalc values come from the mocked loader.
      return Promise.resolve({ data: [], error: null });
    },
    upsert: (batch: unknown[], _opts: unknown) => {
      fake.historyUpserts++;
      fake.historyUpsertBatchSizes.push(batch.length);
      return { select: (_cols: string) => Promise.resolve({ data: batch.map(() => ({ id: 1 })), error: null }) };
    },
  };
}

const h = vi.hoisted(() => ({ getFcValues: vi.fn(), simulateLeague: vi.fn() }));
vi.mock("@/lib/server/fcValues", () => ({ getFcValues: h.getFcValues }));
vi.mock("@/lib/helpers/simulation", () => ({ simulateLeague: h.simulateLeague }));
const fcOk = { data: [], source: "cache", fetchedAt: "2026-09-21T09:00:00.000Z" };

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
  fake = { links: { rows: [], error: null }, createClientCalls: 0, historyUpserts: 0, historyUpsertBatchSizes: [] };
  h.getFcValues.mockReset();
  h.getFcValues.mockResolvedValue(fcOk);
  h.simulateLeague.mockReset();
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

describe("GET NFL state availability", () => {
  // Sept 22 code-review Tier 2 #8: a failed /state/nfl fetch used to fall through to
  // currentWeek=0/isOffseason=true even during the regular season, silently mis-simulating
  // every league. It must now abort the whole run instead of guessing.
  it("aborts with 502 (nothing fetched, nothing written) when Sleeper's /state/nfl is unavailable", async () => {
    fake.links = { rows: [{ sleeper_user_id: "s1" }], error: null };
    route((u) => u.includes("/user/s1/leagues/"), [
      {
        league_id: "L-1",
        name: "Dynasty",
        settings: { taxi_slots: 2, best_ball: 0 },
        roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
      },
    ]);
    route((u) => u.includes("/state/nfl"), null); // safeFetch returns null on a JSON body of null too
    let rosterFetchCount = 0;
    route((u) => {
      if (u.includes("/rosters")) { rosterFetchCount++; return true; }
      return false;
    }, []);

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "NFL state unavailable" });
    expect(rosterFetchCount).toBe(0);
    expect(h.getFcValues).not.toHaveBeenCalled();
    expect(fake.historyUpserts).toBe(0);
  });
});

describe("GET FantasyCalc availability", () => {
  const league2qb = {
    league_id: "L-sf", name: "Superflex", settings: { taxi_slots: 2, best_ball: 0 },
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"],
  };
  const league1qb = {
    league_id: "L-1qb", name: "One QB", settings: { taxi_slots: 2, best_ball: 0 },
    roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "BN"],
  };
  let rosterFetches: string[];

  beforeEach(() => {
    rosterFetches = [];
  });

  function setup(leagues: unknown[], { inSeason }: { inSeason: boolean }) {
    fake.links = { rows: [{ sleeper_user_id: "s1" }], error: null };
    route((u) => u.includes("/user/s1/leagues/"), leagues);
    if (inSeason) route((u) => u.includes("/state/nfl"), { season_type: "regular", week: 5, season: "2026" });
    route((u) => {
      if (u.includes("/rosters")) { rosterFetches.push(u); return true; }
      return false;
    }, []);
  }
  const asked = () =>
    h.getFcValues.mock.calls.map(([n, dynasty]) => `${n}:${dynasty ? "dynasty" : "redraft"}`).sort();
  const run = async () => (await loadGET())(makeReq(`Bearer ${SECRET}`));

  it("loads only the formats its leagues use — a superflex-only run never asks for 1QB", async () => {
    setup([league2qb], { inSeason: true });
    await run();
    expect(asked()).toEqual(["2:dynasty", "2:redraft"]);
  });

  it("a single-QB league asks for the 1QB formats", async () => {
    setup([league1qb], { inSeason: true });
    await run();
    expect(asked()).toEqual(["1:dynasty", "1:redraft"]);
  });

  it("in the offseason it also loads the superflex dynasty map the rookie board is ranked by", async () => {
    setup([league1qb], { inSeason: false });
    await run();
    expect(asked()).toEqual(["1:dynasty", "1:redraft", "2:dynasty"]);
  });

  it("aborts with 502 (nothing fetched, nothing written) when the offseason superflex values are unavailable", async () => {
    setup([league2qb], { inSeason: false });
    h.getFcValues.mockImplementation(async (n: number, dynasty: boolean) => (n === 2 && dynasty ? null : fcOk));
    const res = await run();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ ok: false, error: "FantasyCalc values unavailable" });
    expect(rosterFetches).toEqual([]);
    expect(fake.historyUpserts).toBe(0);
  });

  it("skips every league — without spending Sleeper requests — and answers 502 when FantasyCalc is down in-season", async () => {
    setup([league2qb], { inSeason: true });
    h.getFcValues.mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ ok: false, leaguesFound: 1, leaguesSimulated: 0, leaguesSkipped: 1, rowsWritten: 0 });
    expect(rosterFetches).toEqual([]);
    expect(fake.historyUpserts).toBe(0);
  });

  it("skips a league whose REDRAFT map is missing even though the dynasty map loaded (the sim needs both)", async () => {
    setup([league2qb], { inSeason: true });
    h.getFcValues.mockImplementation(async (_n: number, dynasty: boolean) => (dynasty ? fcOk : null));
    const res = await run();
    expect(res.status).toBe(502);
    expect((await res.json()).leaguesSkipped).toBe(1);
    expect(rosterFetches).toEqual([]);
  });

  it("a partial outage skips only the affected league and does not fail the run", async () => {
    setup([league2qb, league1qb], { inSeason: true });
    h.getFcValues.mockImplementation(async (n: number) => (n === 2 ? fcOk : null));
    const res = await run();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, leaguesFound: 2, leaguesSkipped: 1 });
    // The 2QB league still ran (its rosters were requested); the 1QB league was skipped up front.
    expect(rosterFetches.filter((u) => u.includes("L-sf"))).toHaveLength(1);
    expect(rosterFetches.filter((u) => u.includes("L-1qb"))).toHaveLength(0);
  });
});

describe("GET incremental writes", () => {
  // Sept 22 code-review Tier 1 #6: allRows used to be accumulated across the WHOLE per-league
  // loop and upserted once at the very end. If Vercel hard-kills the function past maxDuration
  // mid-run, every already-simulated league's rows were lost, not just the unreached ones. The
  // route now upserts each per-league batch's rows right after that batch finishes.
  it("upserts each per-league batch immediately instead of writing everything once at the end", async () => {
    // CONCURRENCY (route-internal, not exported) is 5 — 6 leagues means a 5-league batch then a
    // 1-league batch, each with its own upsert call.
    const leagues = Array.from({ length: 6 }, (_, i) => ({
      league_id: `L${i + 1}`,
      name: `League ${i + 1}`,
      settings: { taxi_slots: 2, best_ball: 0 },
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"],
    }));
    fake.links = { rows: [{ sleeper_user_id: "s1" }], error: null };
    route((u) => u.includes("/user/s1/leagues/"), leagues);
    route((u) => u.includes("/state/nfl"), { season_type: "regular", week: 5, season: "2026" });
    route((u) => u.includes("/rosters"), [{ roster_id: 1, owner_id: "owner1", settings: {} }]);
    h.simulateLeague.mockReturnValue({
      rows: [{ rosterId: 1, playoffOdds: 0.5, titleOdds: 0.1, expectedWins: 5, avgFinish: 4, finishRange: "3-5" }],
    });

    const GET = await loadGET();
    const res = await GET(makeReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.leaguesSimulated).toBe(6);
    expect(fake.historyUpsertBatchSizes).toEqual([5, 1]);
    expect(body.rowsWritten).toBe(6);
  });
});

describe("GET time budget", () => {
  // Sept 22 code-review P1 finding #4: this cron had no TIME_BUDGET_MS guard (unlike
  // league-transactions, fixed in the Sept 21 audit's Batch 7), so a growing unique-league
  // count across registered users risked Vercel killing the function mid-run past
  // maxDuration=300s with none of the graceful early-stop accounting the other cron has.
  const run = async () => (await loadGET())(makeReq(`Bearer ${SECRET}`));

  it("stops starting new per-league simulation batches once the time budget is exceeded", async () => {
    // CONCURRENCY (route-internal, not exported) is 5 — 6 leagues means a 2nd batch of 1.
    const leagues = Array.from({ length: 6 }, (_, i) => ({
      league_id: `L${i + 1}`,
      name: `League ${i + 1}`,
      settings: { taxi_slots: 2, best_ball: 0 },
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"],
    }));
    fake.links = { rows: [{ sleeper_user_id: "s1" }], error: null };
    route((u) => u.includes("/user/s1/leagues/"), leagues);
    route((u) => u.includes("/state/nfl"), { season_type: "regular", week: 5, season: "2026" });

    const rosterFetches: string[] = [];
    let now = 1_000_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    route((u) => {
      if (u.includes("/rosters")) {
        rosterFetches.push(u);
        // Mirrors the wall-clock TIME_BUDGET_MS the route enforces (270_000) — simulate the
        // first batch's fan-out taking long enough that the next batch's pre-check trips.
        now += 271_000;
        return true;
      }
      return false;
    }, []);

    try {
      const res = await run();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.leaguesFound).toBe(6);
      // Only the first (CONCURRENCY-sized) batch started before the time-budget check tripped.
      expect(rosterFetches).toHaveLength(5);
      expect(body.leaguesSkippedTimeBudget).toBe(1);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("reports zero leagues skipped for time when the whole run finishes under budget", async () => {
    const leagues = [{
      league_id: "L1", name: "League 1", settings: { taxi_slots: 2, best_ball: 0 },
      roster_positions: ["QB", "RB", "WR", "TE", "FLEX", "SUPER_FLEX", "BN"],
    }];
    fake.links = { rows: [{ sleeper_user_id: "s1" }], error: null };
    route((u) => u.includes("/user/s1/leagues/"), leagues);
    route((u) => u.includes("/state/nfl"), { season_type: "regular", week: 5, season: "2026" });
    route((u) => u.includes("/rosters"), []);

    const res = await run();
    const body = await res.json();
    expect(body.leaguesSkippedTimeBudget).toBe(0);
  });
});
