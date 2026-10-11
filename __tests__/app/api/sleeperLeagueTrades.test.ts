import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import * as C from "@/lib/constants";
import { GET } from "@/app/api/sleeper/league/[leagueId]/trades/route";

// Oct 7 2026: the Trade Log, leaguemate trade intel and cross-league intel all fetched fixed
// transaction legs (1-2, or 0-2), so from week 3 on every trade made in the last two-plus weeks
// was invisible. This route picks the legs from /state/nfl and returns one league's completed
// trades from the last RECENT_TRADE_WINDOW_DAYS days in a single request.

const h = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: h.checkRateLimit }));

const B = C.SLEEPER_BASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 7, 16);

type Tx = { transaction_id: string; type: string; status: string; created: number };
const tx = (id: string, daysAgo: number, type = "trade", status = "complete"): Tx =>
  ({ transaction_id: id, type, status, created: NOW - daysAgo * DAY });

let state: unknown;
let legs: Record<number, Tx[] | null | number>;
const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
  if (url === `${B}/state/nfl`) return new Response(JSON.stringify(state));
  const leg = Number(url.match(/\/transactions\/(\d+)$/)?.[1]);
  const body = legs[leg] ?? [];
  if (typeof body === "number") return new Response("nope", { status: body });
  return new Response(JSON.stringify(body));
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  h.checkRateLimit.mockReset();
  h.checkRateLimit.mockResolvedValue({ allowed: true, remaining: 59 });
  state = { season_type: "regular", week: 5, leg: 5, season: "2026" };
  legs = {};
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const call = (leagueId: string, qs = "") =>
  GET(new NextRequest(`http://localhost/api/sleeper/league/${leagueId}/trades${qs}`), {
    params: Promise.resolve({ leagueId }),
  });
const legUrls = () =>
  fetchMock.mock.calls.map(([url]) => url).filter((url) => url.includes("/transactions/"));

describe("/api/sleeper/league/[leagueId]/trades", () => {
  it("fetches every leg a 30-day window can reach, through the next leg", async () => {
    const res = await call("123");
    expect(res.status).toBe(200);
    expect(legUrls()).toEqual([1, 2, 3, 4, 5, 6].map((leg) => `${B}/league/123/transactions/${leg}`));
    // The same per-IP bucket as every other /api/sleeper/* route (10/10; was its own 60/min).
    expect(h.checkRateLimit.mock.calls[0].slice(1)).toEqual([
      C.SLEEPER_PROXY_RPM_PER_IP, 60_000, C.SLEEPER_PROXY_RATE_LIMIT_KEY,
    ]);
  });

  it("returns only completed trades inside the window, from every leg", async () => {
    legs = {
      1: [tx("old", 31), tx("leg1", 29), tx("waiver", 29, "waiver")],
      3: [tx("leg3", 12), tx("failed", 12, "trade", "failed")],
      5: [tx("today", 0), tx("fa", 0, "free_agent")],
      6: null,
    };
    const res = await call("123");
    const ids = ((await res.json()) as Tx[]).map((t) => t.transaction_id);
    expect(ids).toEqual(["leg1", "leg3", "today"]);
  });

  it("uses the server fetch caches, and skips the leg cache (not the state cache) on ?bypass=1", async () => {
    await call("123");
    expect(fetchMock.mock.calls[0]).toEqual([`${B}/state/nfl`, { next: { revalidate: C.NFL_STATE_REVALIDATE_S } }]);
    expect(fetchMock.mock.calls[1][1]).toEqual({ next: { revalidate: C.SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S } });

    fetchMock.mockClear();
    await call("123", "?bypass=1");
    expect(fetchMock.mock.calls[0][1]).toEqual({ next: { revalidate: C.NFL_STATE_REVALIDATE_S } });
    expect(fetchMock.mock.calls[1][1]).toEqual({ cache: "no-store" });
  });

  it("returns 502 rather than a partial list when any leg fails", async () => {
    legs = { 2: [tx("a", 20)], 4: 500 };
    const res = await call("123");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Upstream Sleeper request failed" });
  });

  it("passes Sleeper's 429 on a leg through as a 429 with a Retry-After, not a partial list", async () => {
    legs = { 2: [tx("a", 20)], 4: 429 };
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(C.SLEEPER_UPSTREAM_RETRY_AFTER_S));
  });

  it("passes Sleeper's 429 on /state/nfl through without fetching any leg", async () => {
    fetchMock.mockImplementationOnce(async () =>
      new Response("slow", { status: 429, headers: { "Retry-After": "7" } }));
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("7");
    expect(legUrls()).toEqual([]);
  });

  it("returns 502 without fetching any leg when /state/nfl is unavailable or malformed", async () => {
    for (const bad of [null, {}, { week: 5 }]) {
      state = bad;
      fetchMock.mockClear();
      const res = await call("123");
      expect(res.status, JSON.stringify(bad)).toBe(502);
      expect(legUrls()).toEqual([]);
    }
  });

  it("rejects an invalid league id with 400 and never calls Sleeper", async () => {
    for (const bad of ["abc", "12a", "", "1".repeat(31), "1/2"]) {
      const res = await call(bad);
      expect(res.status, bad).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the rate-limit response without fetching when limited", async () => {
    h.checkRateLimit.mockResolvedValue({
      allowed: false,
      response: NextResponse.json({ error: "slow down" }, { status: 429 }),
    });
    const res = await call("123");
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
