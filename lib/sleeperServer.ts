// ============================================================
// Server-only Sleeper helpers
// ============================================================
// Shared by API routes that fan out to Sleeper directly (not via
// the /api/sleeper proxies). Currently used by:
//   - app/api/compile-consensus/route.ts  (consensus draft compile)
//   - app/api/cron/league-transactions    (server-side transactions feed)
//   - app/api/cron/simulation-history     (weekly simulation snapshots)
//   - app/api/simulation-history/route.ts
//
// Why these helpers exist:
//   Sleeper rate-limits aggressive fan-out callers (~1000 req/min
//   ceiling). Direct fetches need 429 backoff and bounded
//   concurrency or they trip the limiter and get IP-banned. The
//   client-side sleeperApi.ts wrapper handles this via the
//   /api/sleeper/* proxy + revalidate, but server-side jobs that
//   bypass the proxy (long-running cron, bulk compile) need their
//   own throttled-fetch primitives.
//
// Do NOT import this module from client code — it has no
// localStorage cache and will hammer Sleeper directly.
// ============================================================

import { SLEEPER_REQUEST_TIMEOUT_MS } from "./constants";

/**
 * Sleeps for `ms` milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with automatic retry on rate-limit (429) or transient
 * network errors. Uses exponential backoff: 600 ms, 1.2 s, 2.4 s
 * between retries on 429s; 400 ms, 800 ms, 1.6 s on network errors.
 *
 * Returns null (rather than throwing) on:
 *   - All retries exhausted
 *   - Non-2xx response that isn't a 429
 *   - JSON parse failure
 *
 * Callers must handle null explicitly — silent failure is the
 * deliberate contract for fan-out scenarios where a single
 * failed request shouldn't abort the whole batch.
 */
export async function safeFetch<T>(
  url: string,
  timeoutMs: number = SLEEPER_REQUEST_TIMEOUT_MS,
  retries = 3
): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        if (attempt < retries) {
          await delay(600 * Math.pow(2, attempt));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      if (attempt < retries) {
        await delay(400 * Math.pow(2, attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

// Re-exported so existing server-side callers (cron routes, compile-consensus) don't need
// an import-path change. The implementation itself is client-safe too — see ./concurrency —
// but this module as a whole is not (see the file header): it bypasses the client
// proxy/cache and will hammer Sleeper directly if imported from client code.
export { withConcurrency } from "./concurrency";
