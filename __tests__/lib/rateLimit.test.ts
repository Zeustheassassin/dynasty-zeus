import { describe, it, expect, beforeEach, vi } from "vitest";

// No UPSTASH_REDIS_REST_URL/TOKEN in the test env, so checkRateLimit always
// falls through to the in-process fallback — exactly what we want to exercise
// the IP-key extraction logic directly.

import { checkRateLimit } from "@/lib/rateLimit";

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
