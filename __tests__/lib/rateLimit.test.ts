import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// No UPSTASH_REDIS_REST_URL/TOKEN in the test env, so checkRateLimit always
// falls through to the in-process fallback — exactly what we want to exercise
// the IP-key extraction logic directly. The Upstash-failure describe at the
// bottom sets those vars itself and re-imports the module to exercise the
// other path.

import { checkRateLimit } from "@/lib/rateLimit";

// Stand-ins for the real Upstash clients. These are only ever loaded when the env vars above
// are set, so the IP-extraction tests are unaffected by these mocks existing.
const upstash = vi.hoisted(() => ({
  limit: null as null | ((ip: string) => Promise<{ success: boolean; remaining: number; reset: number }>),
  limitCalls: 0,
}));

vi.mock("@upstash/redis", () => ({
  Redis: class { constructor(_cfg: unknown) { /* no-op */ } },
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    static slidingWindow(limit: number, window: string) { return { limit, window }; }
    constructor(_cfg: unknown) { /* no-op */ }
    limit(ip: string) {
      upstash.limitCalls++;
      return upstash.limit!(ip);
    }
  }
  return { Ratelimit };
});

function reqWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/whatever", { headers });
}

beforeEach(() => {
  vi.resetModules();
});

describe("checkRateLimit — IP extraction", () => {
  it("keys on the LAST x-forwarded-for hop (the platform-appended, trustworthy one), not the first (client-controlled)", async () => {
    // A client claiming a fake first hop, with the real edge-appended IP last.
    const attacker = reqWithHeaders({ "x-forwarded-for": "9.9.9.9, 203.0.113.5" });
    const real = reqWithHeaders({ "x-forwarded-for": "203.0.113.5" });

    // Exhaust a limit of 1 using the real IP directly.
    const r1 = await checkRateLimit(real as never, 1, 60_000, "rl-test-last-hop");
    expect(r1.allowed).toBe(true);

    // The "attacker" request spoofs a different first hop but shares the same
    // real last hop — if the limiter correctly keys on the last hop, this
    // must be rejected (same bucket, already exhausted).
    const r2 = await checkRateLimit(attacker as never, 1, 60_000, "rl-test-last-hop");
    expect(r2.allowed).toBe(false);
  });

  it("a spoofed/rotating first hop can no longer manufacture unlimited distinct buckets", async () => {
    const realIp = "198.51.100.7";
    const limit = 3;

    for (let i = 0; i < limit; i++) {
      const req = reqWithHeaders({ "x-forwarded-for": `${i}.${i}.${i}.${i}, ${realIp}` });
      const res = await checkRateLimit(req as never, limit, 60_000, "rl-test-spoof");
      expect(res.allowed).toBe(true);
    }

    // One more request, still a fresh fake first hop but the same real last hop,
    // must now be blocked — proving the fake first-hop values aren't creating
    // fresh buckets.
    const over = reqWithHeaders({ "x-forwarded-for": `99.99.99.99, ${realIp}` });
    const res = await checkRateLimit(over as never, limit, 60_000, "rl-test-spoof");
    expect(res.allowed).toBe(false);
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", async () => {
    const req1 = reqWithHeaders({ "x-real-ip": "192.0.2.50" });
    const req2 = reqWithHeaders({ "x-real-ip": "192.0.2.50" });

    const r1 = await checkRateLimit(req1 as never, 1, 60_000, "rl-test-real-ip");
    expect(r1.allowed).toBe(true);
    const r2 = await checkRateLimit(req2 as never, 1, 60_000, "rl-test-real-ip");
    expect(r2.allowed).toBe(false);
  });

  it("ignores blank entries when picking the last hop (trailing comma / stray whitespace)", async () => {
    const req1 = reqWithHeaders({ "x-forwarded-for": "203.0.113.9, " });
    const req2 = reqWithHeaders({ "x-forwarded-for": "203.0.113.9" });

    const r1 = await checkRateLimit(req1 as never, 1, 60_000, "rl-test-trailing-comma");
    expect(r1.allowed).toBe(true);
    // Same real IP once the trailing blank hop is stripped — must share the bucket.
    const r2 = await checkRateLimit(req2 as never, 1, 60_000, "rl-test-trailing-comma");
    expect(r2.allowed).toBe(false);
  });
});

describe("checkRateLimit — Upstash failure handling", () => {
  // Upstash is a resilience layer, never a hard dependency. Every one of the 16 callers invokes
  // checkRateLimit BEFORE its own try/catch (see app/api/players/route.ts), so a Redis error
  // escaping here would surface as a 500 on a rate-limited route rather than a degraded limit.
  // @upstash/redis also sets no default timeout, so an unreachable Upstash would hang the
  // request instead of erroring at all.

  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  const ip = { "x-forwarded-for": "203.0.113.42" };

  // A fresh module instance per test, so one test's failure-cooldown state can't leak.
  const loadChecker = async () => (await import("@/lib/rateLimit")).checkRateLimit;

  beforeEach(() => {
    process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
    process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";
    upstash.limit = null;
    upstash.limitCalls = 0;
    vi.resetModules();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (ORIGINAL_URL === undefined) delete process.env.UPSTASH_REDIS_REST_URL;
    else process.env.UPSTASH_REDIS_REST_URL = ORIGINAL_URL;
    if (ORIGINAL_TOKEN === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN;
    else process.env.UPSTASH_REDIS_REST_TOKEN = ORIGINAL_TOKEN;
  });

  it("uses Upstash's verdict when it works, rather than the in-process counter", async () => {
    // A 429 verdict on the very FIRST request in this process is only possible if the Upstash
    // result is really being used — the in-process limiter would have allowed it.
    upstash.limit = async () => ({ success: false, remaining: 0, reset: Date.now() + 30_000 });
    const checkRateLimit = await loadChecker();

    const res = await checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-ok");

    expect(res.allowed).toBe(false);
    if (!res.allowed) expect(res.response.status).toBe(429);
    expect(upstash.limitCalls).toBe(1);
  });

  it("falls back to the in-process limiter when Upstash rejects, instead of throwing", async () => {
    upstash.limit = async () => { throw new Error("WRONGPASS: invalid token"); };
    const checkRateLimit = await loadChecker();

    const res = await checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-reject");

    expect(res.allowed).toBe(true);
    if (res.allowed) expect(res.remaining).toBe(4); // served by the in-process bucket
    expect(upstash.limitCalls).toBe(1);
  });

  it("times out a hanging Upstash call rather than stalling the request", async () => {
    upstash.limit = () => new Promise(() => { /* never settles */ });
    const checkRateLimit = await loadChecker();

    vi.useFakeTimers();
    const pending = checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-hang");
    await vi.advanceTimersByTimeAsync(2_000);

    const res = await pending;
    expect(res.allowed).toBe(true); // degraded to in-process, not left hanging
  });

  it("skips Upstash for a cooldown window after a failure instead of re-probing every request", async () => {
    upstash.limit = async () => { throw new Error("ECONNREFUSED"); };
    const checkRateLimit = await loadChecker();

    await checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-cooldown");
    expect(upstash.limitCalls).toBe(1);

    // Without the cooldown, a sustained outage would pay a full timeout on every request.
    await checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-cooldown");
    await checkRateLimit(reqWithHeaders(ip) as never, 5, 60_000, "rl-upstash-cooldown");
    expect(upstash.limitCalls).toBe(1);
  });
});
