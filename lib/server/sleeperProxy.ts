import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { checkRateLimit, type RateLimitResult } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
import { waitForSleeperSlot } from "@/lib/server/sleeperBudget";
import {
  SLEEPER_PROXY_RATE_LIMIT_KEY,
  SLEEPER_PROXY_RPM_PER_IP,
  SLEEPER_UPSTREAM_RETRY_AFTER_S,
} from "@/lib/constants";

/** What a route's own param validation resolves to: either the upstream URL to
 *  fetch (plus fields to attach to an error log line), or an early 400 response. */
export type SleeperProxyResolution =
  | { upstream: string; logFields?: Record<string, unknown> }
  | NextResponse;

export interface SleeperProxyOptions {
  req: NextRequest;
  /** Logger context, e.g. "api/sleeper/league/rosters". */
  logNamespace: string;
  /** Validates path params (after the rate-limit check, matching prior per-route order) and
   *  builds the upstream URL, or returns a 400 NextResponse directly. */
  resolve: () => SleeperProxyResolution | Promise<SleeperProxyResolution>;
  /** Next.js Data Cache revalidate window, in seconds. */
  revalidate: number;
  /** Whether this route honors `?bypass=1` (straight to Sleeper, nothing cached). */
  supportsBypass: boolean;
  /** JSON body `error` message on a 502. Routes differ here historically — pinned per-route. */
  errorMessage?: string;
}

/** Sleeper answered non-OK. `retryAfter` is its Retry-After header, kept for a 429. */
export class SleeperUpstreamError extends Error {
  constructor(readonly status: number, readonly retryAfter: string | null) {
    super(`Sleeper upstream ${status}`);
    this.name = "SleeperUpstreamError";
  }
}

/** The one call that actually reaches Sleeper: takes an interactive slot in the global budget
 *  (lib/server/sleeperBudget.ts) first, then fetches uncached. Throws SleeperUpstreamError on a
 *  non-OK answer so nothing gets cached from it. */
async function callSleeper<T>(url: string): Promise<T> {
  await waitForSleeperSlot("interactive");
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new SleeperUpstreamError(res.status, res.headers.get("Retry-After"));
  return (await res.json()) as T;
}

/**
 * One Sleeper GET from a route handler, kept in Next's Data Cache for `revalidate` seconds, keyed by
 * URL — so routes asking for the same URL share an entry (the trades route and the per-week
 * transactions proxy; /api/nfl-state and the trades route's NFL state).
 *
 * Built on unstable_cache rather than fetch's own `next: { revalidate }` so the global Sleeper budget
 * counts only calls that reach Sleeper: the function inside runs on a miss, or for a stale entry's
 * background refresh, and never for a hit. With fetch-level caching there's no way to tell a hit from
 * a real call before it goes out, and a stale refresh calls Sleeper without passing through here.
 * Same stale-while-revalidate behavior either way; a failed refresh keeps serving the stale entry.
 *
 * `bypass` goes straight to Sleeper and caches nothing (what `cache: "no-store"` did before).
 * Throws SleeperUpstreamError for a non-OK answer — never cached — and lets network errors through.
 */
export function fetchSleeperJson<T>(url: string, opts: { revalidate: number; bypass?: boolean }): Promise<T> {
  if (opts.bypass) return callSleeper<T>(url);
  return unstable_cache(() => callSleeper<T>(url), ["sleeper-json", url], { revalidate: opts.revalidate })();
}

/** The one per-IP bucket every /api/sleeper/* route draws from (SLEEPER_PROXY_RPM_PER_IP a minute),
 *  so a League Overview pass spread over rosters/users/drafts/traded-picks counts as one budget. */
export function checkSleeperProxyRateLimit(req: NextRequest): Promise<RateLimitResult> {
  return checkRateLimit(req, SLEEPER_PROXY_RPM_PER_IP, 60_000, SLEEPER_PROXY_RATE_LIMIT_KEY);
}

/** Sleeper's own 429, passed through with a Retry-After (Sleeper's when it sends a plain number of
 *  seconds, else SLEEPER_UPSTREAM_RETRY_AFTER_S) — a 502 would read as a blip and get retried at
 *  200/400ms, straight back into a limit that covers every user on this server's IP. */
export function sleeperUpstreamRateLimited(retryAfterHeader: string | null): NextResponse {
  const header = retryAfterHeader?.trim();
  const retryAfter = header && /^\d+$/.test(header) ? header : String(SLEEPER_UPSTREAM_RETRY_AFTER_S);
  return NextResponse.json(
    { error: "Sleeper is rate limiting requests. Please slow down." },
    { status: 429, headers: { "Retry-After": retryAfter } }
  );
}

/** Shared body of the 10 /api/sleeper/* proxy routes: rate limit, validate, fetch through the
 *  Data Cache (fetchSleeperJson), map Sleeper's 429 through and any other non-OK/thrown error to a
 *  502. Preserves each route's own revalidate window, bypass support, and error message exactly as
 *  before this was extracted; the rate limit is the one shared Sleeper bucket (per-route 60/min
 *  buckets until 2026-10-10). */
export async function proxySleeper(opts: SleeperProxyOptions): Promise<NextResponse> {
  const rl = await checkSleeperProxyRateLimit(opts.req);
  if (!rl.allowed) return rl.response;

  const resolved = await opts.resolve();
  if (resolved instanceof NextResponse) return resolved;
  const { upstream, logFields } = resolved;

  const log = logger(opts.logNamespace);
  const errorBody = { error: opts.errorMessage ?? "Upstream Sleeper request failed" };
  const bypass = opts.supportsBypass && opts.req.nextUrl.searchParams.get("bypass") === "1";

  try {
    return NextResponse.json(await fetchSleeperJson<unknown>(upstream, { revalidate: opts.revalidate, bypass }));
  } catch (err) {
    if (err instanceof SleeperUpstreamError) {
      log.error("upstream non-OK", { status: err.status, ...logFields });
      if (err.status === 429) return sleeperUpstreamRateLimited(err.retryAfter);
      return NextResponse.json(errorBody, { status: 502 });
    }
    log.error("fetch failed", { error: String(err) });
    return NextResponse.json(errorBody, { status: 502 });
  }
}
