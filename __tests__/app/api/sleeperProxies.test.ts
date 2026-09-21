import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import * as C from "@/lib/constants";

// Characterization of the 10 /api/sleeper/* proxy routes, written BEFORE they are collapsed
// into a shared helper (audit Batch 6). Pins per-route: param validation, upstream URL,
// revalidate window, ?bypass behavior, rate-limit key, and 502 shape.

const h = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

const B = C.SLEEPER_BASE_URL;
const BAD_ID = ["abc", "12a", "", "1".repeat(31), "1/2", "..%2f"];

interface Spec {
  name: string;
  // ctx is `never` so every route's own params shape is assignable; the call site casts.
  load: () => Promise<{ GET: (req: NextRequest, ctx: never) => Promise<NextResponse> }>;
  rlKey: string;
  params: Record<string, string>;
  upstream: string;
  revalidate: number;
  bypass: boolean;
  errorBody: unknown;
  badParams: Record<string, string>[];
}

const FAIL = { error: "Upstream Sleeper request failed" };
const specs: Spec[] = [
  {
    name: "draft picks", rlKey: "sleeper-draft-picks", params: { draftId: "999" },
    load: () => import("@/app/api/sleeper/draft/[draftId]/picks/route"),
    upstream: `${B}/draft/999/picks`, revalidate: C.SLEEPER_DRAFT_PICKS_REVALIDATE_S, bypass: false, errorBody: FAIL,
    badParams: BAD_ID.map((draftId) => ({ draftId })),
  },
  {
    name: "league drafts", rlKey: "sleeper-league-drafts", params: { leagueId: "123" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/drafts/route"),
    upstream: `${B}/league/123/drafts`, revalidate: C.SLEEPER_LEAGUE_DRAFTS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    badParams: BAD_ID.map((leagueId) => ({ leagueId })),
  },
  {
    name: "league matchups", rlKey: "sleeper-league-matchups", params: { leagueId: "123", week: "5" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/matchups/[week]/route"),
    upstream: `${B}/league/123/matchups/5`, revalidate: C.SLEEPER_LEAGUE_MATCHUPS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    badParams: [
      ...BAD_ID.map((leagueId) => ({ leagueId, week: "5" })),
      ...["0", "23", "1.5", "x", "-1"].map((week) => ({ leagueId: "123", week })),
    ],
  },
  {
    name: "league rosters", rlKey: "sleeper-league-rosters", params: { leagueId: "123" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/rosters/route"),
    upstream: `${B}/league/123/rosters`, revalidate: C.SLEEPER_LEAGUE_ROSTERS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    badParams: BAD_ID.map((leagueId) => ({ leagueId })),
  },
  {
    name: "league info", rlKey: "sleeper-league-info", params: { leagueId: "123" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/route"),
    upstream: `${B}/league/123`, revalidate: C.SLEEPER_LEAGUE_INFO_REVALIDATE_S, bypass: false, errorBody: { error: "Upstream error" },
    badParams: BAD_ID.map((leagueId) => ({ leagueId })),
  },
  {
    name: "league traded picks", rlKey: "sleeper-league-traded-picks", params: { leagueId: "123" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/traded-picks/route"),
    upstream: `${B}/league/123/traded_picks`, revalidate: C.SLEEPER_LEAGUE_TRADED_PICKS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    badParams: BAD_ID.map((leagueId) => ({ leagueId })),
  },
  {
    name: "league transactions", rlKey: "sleeper-league-transactions", params: { leagueId: "123", week: "0" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/transactions/[week]/route"),
    upstream: `${B}/league/123/transactions/0`, revalidate: C.SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    // week 0 is valid here (offseason), unlike matchups
    badParams: [
      ...BAD_ID.map((leagueId) => ({ leagueId, week: "5" })),
      ...["23", "1.5", "x", "-1"].map((week) => ({ leagueId: "123", week })),
    ],
  },
  {
    name: "league users", rlKey: "sleeper-league-users", params: { leagueId: "123" },
    load: () => import("@/app/api/sleeper/league/[leagueId]/users/route"),
    upstream: `${B}/league/123/users`, revalidate: C.SLEEPER_LEAGUE_USERS_REVALIDATE_S, bypass: true, errorBody: FAIL,
    badParams: BAD_ID.map((leagueId) => ({ leagueId })),
  },
  {
    name: "user leagues", rlKey: "sleeper-user-leagues", params: { userId: "456", year: "2026" },
    load: () => import("@/app/api/sleeper/user-leagues/[userId]/[year]/route"),
    upstream: `${B}/user/456/leagues/nfl/2026`, revalidate: C.SLEEPER_USER_LEAGUES_REVALIDATE_S, bypass: false, errorBody: FAIL,
    badParams: [
      ...BAD_ID.map((userId) => ({ userId, year: "2026" })),
      ...["26", "20260", "abcd", ""].map((year) => ({ userId: "456", year })),
    ],
  },
  {
    name: "user by username", rlKey: "sleeper-user", params: { username: "john_doe-1.x" },
    load: () => import("@/app/api/sleeper/user/[username]/route"),
    upstream: `${B}/user/john_doe-1.x`, revalidate: C.SLEEPER_USER_REVALIDATE_S, bypass: false, errorBody: { error: "Upstream error" },
    badParams: ["", "a b", "a/b", "x".repeat(51), "a?b"].map((username) => ({ username })),
  },
];

const fetchMock = vi.fn();
beforeEach(() => {
  h.checkRateLimit.mockReset();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ok: 1 })));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const call = (s: Spec, params: Record<string, string>, qs = "") =>
  s.load().then((m) => m.GET(new NextRequest(`http://localhost/api/sleeper/x${qs}`), { params: Promise.resolve(params) } as never));

describe.each(specs)("/api/sleeper proxy: $name", (s) => {
  it("proxies the upstream URL with the configured revalidate window and a 60/min limiter", async () => {
    const res = await call(s, s.params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(s.upstream);
    expect(opts).toEqual({ next: { revalidate: s.revalidate } });
    expect(s.revalidate).toBeGreaterThan(0);
    expect(h.checkRateLimit.mock.calls[0].slice(1)).toEqual([60, 60_000, s.rlKey]);
  });

  it("returns the rate-limit response without fetching when limited", async () => {
    const limited = NextResponse.json({ error: "slow down" }, { status: 429 });
    h.checkRateLimit.mockResolvedValue({ allowed: false, response: limited });
    const res = await call(s, s.params);
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid params with 400 and never calls Sleeper", async () => {
    for (const bad of s.badParams) {
      const res = await call(s, bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it(s.bypass ? "?bypass=1 skips the fetch cache" : "ignores ?bypass (always uses the fetch cache)", async () => {
    await call(s, s.params, "?bypass=1");
    const opts = fetchMock.mock.calls[0][1];
    expect(opts).toEqual(s.bypass ? { cache: "no-store" } : { next: { revalidate: s.revalidate } });
  });

  it("maps upstream non-OK to 502 with the route's error body", async () => {
    fetchMock.mockImplementation(async () => new Response("nope", { status: 500 }));
    const res = await call(s, s.params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(s.errorBody);
  });

  it("maps a thrown fetch to 502", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const res = await call(s, s.params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual(s.errorBody);
  });
});
