import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// /api/players: Sleeper's raw map exceeds the Data Cache item limit, so the route relies on a
// CDN Cache-Control header. `?fresh=1` (manual injury refresh) must bypass every cache layer.

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true, remaining: 9 })),
}));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) =>
    url.includes("/players/nfl")
      ? new Response(JSON.stringify({ "1": { player_id: "1", full_name: "A B", position: "WR", injury_status: "Out", extra: "x" } }))
      : new Response(JSON.stringify({ season: "2026", week: 3 }))
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function get(qs = "") {
  const { GET } = await import("@/app/api/players/route");
  return GET(new NextRequest(`http://localhost/api/players${qs}`));
}

describe("GET /api/players", () => {
  it("normal requests are CDN-cacheable and use fetch revalidation", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("s-maxage=300");
    const body = await res.json();
    expect(body.players["1"].injury_status).toBe("Out");
    expect(body.players["1"].extra).toBeUndefined();
    for (const [, opts] of fetchMock.mock.calls) {
      expect(opts.next?.revalidate).toBeGreaterThan(0);
      expect(opts.cache).toBeUndefined();
    }
  });

  it("?fresh=1 is never cached and bypasses the fetch cache", async () => {
    const res = await get("?fresh=1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    for (const [, opts] of fetchMock.mock.calls) {
      expect(opts.cache).toBe("no-store");
      expect(opts.next).toBeUndefined();
    }
  });

  it("upstream failure returns 502 without a cacheable header", async () => {
    fetchMock.mockImplementation(async () => new Response("no", { status: 500 }));
    const res = await get();
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });
});
