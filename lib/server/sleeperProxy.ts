import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimit, type RateLimitResult } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";
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
  /** Next.js fetch cache revalidate window, in seconds. */
  revalidate: number;
  /** Whether this route honors `?bypass=1` (cache: "no-store"). */
  supportsBypass: boolean;
  /** JSON body `error` message on a 502. Routes differ here historically — pinned per-route. */
  errorMessage?: string;
}

/** The one per-IP bucket every /api/sleeper/* route draws from (SLEEPER_PROXY_RPM_PER_IP a minute),
 *  so a League Overview pass spread over rosters/users/drafts/traded-picks counts as one budget. */
export function checkSleeperProxyRateLimit(req: NextRequest): Promise<RateLimitResult> {
  return checkRateLimit(req, SLEEPER_PROXY_RPM_PER_IP, 60_000, SLEEPER_PROXY_RATE_LIMIT_KEY);
}

/** Sleeper's own 429, passed through with a Retry-After (Sleeper's when it sends a plain number of
 *  seconds, else SLEEPER_UPSTREAM_RETRY_AFTER_S) — a 502 would read as a blip and get retried at
 *  200/400ms, straight back into a limit that covers every user on this server's IP. */
export function sleeperUpstreamRateLimited(upstream: Response): NextResponse {
  const header = upstream.headers.get("Retry-After")?.trim();
  const retryAfter = header && /^\d+$/.test(header) ? header : String(SLEEPER_UPSTREAM_RETRY_AFTER_S);
  return NextResponse.json(
    { error: "Sleeper is rate limiting requests. Please slow down." },
    { status: 429, headers: { "Retry-After": retryAfter } }
  );
}

/** Shared body of the 10 /api/sleeper/* proxy routes: rate limit, validate, fetch upstream,
 *  map Sleeper's 429 through and any other non-OK/thrown error to a 502. Preserves each route's
 *  own revalidate window, bypass support, and error message exactly as before this was extracted;
 *  the rate limit is the one shared Sleeper bucket (per-route 60/min buckets until 2026-10-10). */
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
    const res = await fetch(
      upstream,
      bypass ? { cache: "no-store" } : { next: { revalidate: opts.revalidate } }
    );
    if (!res.ok) {
      log.error("upstream non-OK", { status: res.status, ...logFields });
      if (res.status === 429) return sleeperUpstreamRateLimited(res);
      return NextResponse.json(errorBody, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error("fetch failed", { error: String(err) });
    return NextResponse.json(errorBody, { status: 502 });
  }
}
