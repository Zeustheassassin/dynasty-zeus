/**
 * Rate limiter for Next.js API routes.
 *
 * When UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set (production),
 * requests are counted in Upstash Redis — distributed across all serverless
 * function instances, so limits are enforced globally.
 *
 * Without those vars (local dev, CI), falls back to an in-process map that is
 * accurate within a single process but resets per cold start.
 *
 * Usage:
 *   import { checkRateLimit } from '../../../lib/rateLimit';
 *   const result = await checkRateLimit(req, 30, 60_000); // 30 req / 60s
 *   if (!result.allowed) return result.response;
 */

import { NextRequest, NextResponse } from 'next/server';

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

async function checkUpstash(
  ip: string,
  limit: number,
  windowMs: number,
  keyPrefix: string
): Promise<RateLimitResult | null> {
  const loaded = await tryLoadUpstash();
  if (!loaded || !upstashModule || !redisModule) return null;

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

  const { success, remaining, reset } = await limiter.limit(ip);
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
