// @vitest-environment node
import { afterEach, describe, it, expect, vi } from "vitest";
import { createPffClient, findRestricted, getPffClient, PffError } from "@/lib/pff/client";

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** A fetch that answers from a script and records each call. */
function scripted(replies: Reply[]) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
    const r = replies.shift();
    if (!r) throw new Error("no scripted reply left");
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function client(replies: Reply[], extra: Partial<Parameters<typeof createPffClient>[0]> = {}) {
  const s = scripted(replies);
  const sleeps: number[] = [];
  const c = createPffClient({
    apiKey: "ak_test",
    fetchImpl: s.fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); },
    now: () => 1_000_000,
    ...extra,
  });
  return { c, calls: s.calls, sleeps };
}

describe("createPffClient", () => {
  it("sends the key as a bearer token and the params as a query string", async () => {
    const { c, calls } = client([{ body: { players: [] } }]);
    expect(await c.get("/v1/players", { league: "ncaa", name: "Jeremiah Smith", skip: undefined })).toEqual({ players: [] });
    expect(calls[0].auth).toBe("Bearer ak_test");
    expect(calls[0].url).toBe("https://api.pff.com/v1/players?league=ncaa&name=Jeremiah+Smith");
  });

  it("waits for the budget window to reset when the remaining reads hit the reserve", async () => {
    const reset = { "x-ratelimit-remaining": "2", "x-ratelimit-reset": String(1_000_000 / 1000 + 30) };
    const { c, sleeps } = client([{ headers: reset }, { body: { ok: 1 } }]);
    await c.get("/v1/a");
    expect(sleeps).toEqual([]);
    await c.get("/v1/b");
    expect(sleeps).toEqual([30_250]);
  });

  it("fails instead of waiting longer than maxWaitMs", async () => {
    const reset = { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(1_000_000 / 1000 + 600) };
    const { c } = client([{ headers: reset }], { maxWaitMs: 65_000 });
    await c.get("/v1/a");
    await expect(c.get("/v1/b")).rejects.toMatchObject({ status: 429, code: "rate_limited" });
  });

  it("retries a 429 after its Retry-After and a 502 with back-off", async () => {
    const { c, sleeps, calls } = client([
      { status: 429, body: { error: { code: "rate_limited", message: "slow down" } }, headers: { "retry-after": "3" } },
      { status: 502, body: { error: { code: "upstream_error", message: "bad gateway" } } },
      { body: { ok: true } },
    ]);
    expect(await c.get("/v1/x")).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(sleeps).toEqual([3000, 2000]);
  });

  it("gives up after the retries and surfaces PFF's error code", async () => {
    const err = { status: 503, body: { error: { code: "upstream_error", message: "down" } } };
    const { c } = client([err, err, err]);
    await expect(c.get("/v1/x")).rejects.toMatchObject({ status: 503, code: "upstream_error", message: "down" });
  });

  it("doesn't retry a request PFF refused", async () => {
    const { c, calls } = client([{ status: 400, body: { error: { code: "invalid_parameter", message: "name or id" } } }]);
    const e = await c.get("/v1/players").catch((x) => x);
    expect(e).toBeInstanceOf(PffError);
    expect(e).toMatchObject({ status: 400, code: "invalid_parameter" });
    expect(calls).toHaveLength(1);
  });

  it("runs one request at a time", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchImpl = (async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const c = createPffClient({ apiKey: "k", fetchImpl });
    await Promise.all([c.get("/a"), c.get("/b"), c.get("/c")]);
    expect(maxInFlight).toBe(1);
  });
});

describe("findRestricted", () => {
  it("finds withheld columns at the top level or one report down", () => {
    expect(findRestricted({ restricted: ["grades_pass"] })).toEqual(["grades_pass"]);
    expect(findRestricted({ passing_summary: { weeks: [], restricted: ["btt_rate"] } })).toEqual(["btt_rate"]);
  });

  it("ignores empty or missing lists", () => {
    expect(findRestricted({ offense_summary: { weeks: [] } })).toBeNull();
    expect(findRestricted({ restricted: [] })).toBeNull();
    expect(findRestricted([1, 2])).toBeNull();
    expect(findRestricted(null)).toBeNull();
  });
});

describe("getPffClient", () => {
  const saved = process.env.PFF_API_KEY;
  afterEach(() => { process.env.PFF_API_KEY = saved; });

  it("is null without PFF_API_KEY", () => {
    delete process.env.PFF_API_KEY;
    expect(getPffClient()).toBeNull();
  });
});
