import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { logger } from "@/lib/logger";

/** What a route's own param validation resolves to: either the upstream URL to
 *  fetch (plus fields to attach to an error log line), or an early 400 response. */
export type SleeperProxyResolution =
  | { upstream: string; logFields?: Record<string, unknown> }
  | NextResponse;

export interface SleeperProxyOptions {
  req: NextRequest;
  /** Logger context, e.g. "api/sleeper/league/rosters". */
  logNamespace: string;
  /** Rate-limit bucket key, e.g. "sleeper-league-rosters". */
  rateLimitKey: string;
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

/** Shared body of the 10 /api/sleeper/* proxy routes: rate limit, validate, fetch upstream,
 *  map non-OK/thrown errors to a 502. Preserves each route's own rate-limit key, revalidate
 *  window, bypass support, and error message exactly as before this was extracted. */
export async function proxySleeper(opts: SleeperProxyOptions): Promise<NextResponse> {
  const rl = await checkRateLimit(opts.req, 60, 60_000, opts.rateLimitKey);
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
      return NextResponse.json(errorBody, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error("fetch failed", { error: String(err) });
    return NextResponse.json(errorBody, { status: 502 });
  }
}
