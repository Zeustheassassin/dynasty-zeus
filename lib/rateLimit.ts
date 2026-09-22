/**
 * Rate limiter for Next.js API routes.
 *
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, requests are counted in
 * Upstash Redis — distributed across all serverless function instances, so limits are
 * enforced globally.
 *
 * Without those vars — OR whenever an Upstash call fails or times out — this falls back to an
 * in-process map that is accurate within a single process but resets per cold start. Upstash
 * is a resilience layer here, never a hard dependency: all 15 route files call checkRateLimit
 * BEFORE their own try/catch (and app/api/fc-values has none at all), so letting a Redis error
 * escape would turn a rate-limiter hiccup into a 500 on every rate-limited route.
 *
 * ── What actually runs in production (verified 2026-09-22) ──────────────────────────────────
 * NEITHER var is set in ANY Vercel environment. `vercel env ls` lists only CFD_API_KEY,
 * CRON_SECRET, SUPABASE_SERVICE_ROLE_KEY and the two NEXT_PUBLIC_SUPABASE_* vars. Production
 * has therefore always used the in-process fallback, which means every limit below is really
 * "N per window per IP **per warm lambda instance**", resetting on cold start — the effective
 * ceiling is N times however many instances Vercel happens to have warm, not N.
 *
 * Left that way on purpose rather than by oversight. At current user counts the looser limit
 * causes no harm, and switching Upstash on would make limits STRICTER than the app currently
 * tolerates: the cross-league Dashboard already draws occasional 429s from a single IP running
 * several sessions back to back. Enabling Upstash is therefore a two-part job — set the vars
 * AND re-tune the per-route numbers upward — not a drop-in. The Upstash path above is kept
 * working and tested so that remains a live option.
 *
 * Usage:
 *   import { checkRateLimit } from '../../../lib/rateLimit';
 *   const result = await checkRateLimit(req, 30, 60_000); // 30 req / 60s
 *   if (!result.allowed) return result.response;
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from './logger';

const log = logger('lib/rateLimit');

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; response: NextResponse };

// ── Upstash path ──────────────────────────────────────────────────────────────

let upstashModule: typeof import('@upstash/ratelimit') | null = null;
let redisModule: typeof import('@upstash/redis') | null = null;

async function tryLoadUpstash() {
  if (
    !process.env.UPSTASH_REDIS_REST_URL ||
    !process.env.UPSTASH_REDIS_REST_TOKEN
  )
    return null;
  try {
    [upstashModule, redisModule] = await Promise.all([
      import('@upstash/ratelimit'),
      import('@upstash/redis'),
    ]);
    return true;
  } catch {
    return null;
  }
}

// Cache one Ratelimiter instance per (limit, windowMs, keyPrefix) combo
const upstashLimiters = new Map<string, import('@upstash/ratelimit').Ratelimit>();

// `limiter.limit()` is a network round trip and @upstash/redis sets no default timeout, so an
// Upstash outage that hangs rather than erroring would stall every rate-limited request until
// the whole function timed out. Bound it ourselves and treat a timeout as a failure, which
// falls through to the in-process limiter below.
const UPSTASH_TIMEOUT_MS = 2_000;

// After a failure, skip Upstash entirely for this long rather than paying the timeout again on
// every subsequent request. Per-lambda-instance, the same scope as the in-process store below —
// a sustained outage therefore costs each warm instance one timeout per cooldown window, not
// one per request.
const UPSTASH_FAILURE_COOLDOWN_MS = 30_000;
let upstashUnavailableUntil = 0;

/** Reject with a timeout error if `promise` hasn't settled within `ms`. The timer is always
 *  cleared so a fast success can't leave a pending handle behind. */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function checkUpstash(
  ip: string,
  limit: number,
  windowMs: number,
  keyPrefix: string
): Promise<RateLimitResult | null> {
  // A recent failure means Upstash is presumed down; don't re-probe it on every request.
  if (Date.now() < upstashUnavailableUntil) return null;

  const loaded = await tryLoadUpstash();
  if (!loaded || !upstashModule || !redisModule) return null;

  // Everything from here on is network- or config-dependent, so a failure must degrade to the
  // in-process limiter (return null) rather than propagate. Returning null deliberately makes
  // limits per-instance for the duration of an outage — weaker than intended, but the app stays
  // up, which is the trade the module docblock already promises.
  try {
    const cacheKey = `${keyPrefix}:${limit}:${windowMs}`;
    let limiter = upstashLimiters.get(cacheKey);
    if (!limiter) {
      const redis = new redisModule.Redis({
        url: process.env.UPSTASH_REDIS_REST_URL!,
        token: process.env.UPSTASH_REDIS_REST_TOKEN!,
      });
      const windowSec = Math.ceil(windowMs / 1000);
      limiter = new upstashModule.Ratelimit({
        redis,
        limiter: upstashModule.Ratelimit.slidingWindow(limit, `${windowSec} s`),
        prefix: keyPrefix || 'rl',
      });
      upstashLimiters.set(cacheKey, limiter);
    }

    const { success, remaining, reset } = await withTimeout(
      limiter.limit(ip),
      UPSTASH_TIMEOUT_MS,
      'Upstash rate-limit check'
    );
    if (success) return { allowed: true, remaining };

    const retryAfterSec = Math.ceil((reset - Date.now()) / 1000);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(reset / 1000)),
          },
        }
      ),
    };
  } catch (err) {
    upstashUnavailableUntil = Date.now() + UPSTASH_FAILURE_COOLDOWN_MS;
    log.warn('Upstash rate-limit check failed — falling back to the in-process limiter', {
      keyPrefix,
      cooldownMs: UPSTASH_FAILURE_COOLDOWN_MS,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// ── In-process fallback ────────────────────────────────────────────────────────

interface BucketEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, BucketEntry>();

function pruneStore(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function checkInProcess(
  ip: string,
  limit: number,
  windowMs: number,
  keyPrefix: string
): RateLimitResult {
  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;
  const now = Date.now();

  if (store.size > 500 || Math.random() < 0.01) pruneStore();

  let entry = store.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count++;

  if (entry.count > limit) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    return {
      allowed: false,
      response: NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSec),
            'X-RateLimit-Limit': String(limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
          },
        }
      ),
    };
  }

  return { allowed: true, remaining: limit - entry.count };
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check whether the incoming request is within its rate-limit budget.
 *
 * @param req       The incoming Next.js request
 * @param limit     Max number of requests per window (default: 60)
 * @param windowMs  Window duration in milliseconds (default: 60_000 = 1 minute)
 * @param keyPrefix Optional prefix to namespace limits per route
 */
export async function checkRateLimit(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  keyPrefix = ''
): Promise<RateLimitResult> {
  // x-forwarded-for is a comma-separated hop chain that each proxy APPENDS to
  // (client, proxy1, proxy2, ...) — the first entry is whatever the original
  // client claimed and is fully attacker-controlled (a client can send any
  // fake/rotating value there to generate unlimited distinct rate-limit
  // buckets). The last entry is the address the platform's own edge network
  // saw the request arrive from, which a client cannot forge by setting
  // headers, so it's the one to trust.
  const xff = req.headers.get('x-forwarded-for');
  const lastHop = xff?.split(',').map((s) => s.trim()).filter(Boolean).pop();
  const ip = lastHop || req.headers.get('x-real-ip') || 'unknown';

  const upstashResult = await checkUpstash(ip, limit, windowMs, keyPrefix);
  if (upstashResult !== null) return upstashResult;

  return checkInProcess(ip, limit, windowMs, keyPrefix);
}
