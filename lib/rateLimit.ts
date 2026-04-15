/**
 * Simple in-process rate limiter for Next.js API routes.
 *
 * NOTE: This works correctly in local dev and single-process deploys.
 * On Vercel (serverless), each invocation may land on a different function
 * instance, so the counter resets per instance. For true distributed rate
 * limiting across Vercel functions you would need a Redis-backed solution
 * (e.g., Upstash). This helper still protects against naive bots that hammer
 * the same cold function repeatedly within a TTL window.
 *
 * Usage:
 *   import { checkRateLimit } from '../../../lib/rateLimit';
 *   const result = checkRateLimit(req, 30, 60_000); // 30 req / 60s
 *   if (!result.allowed) return result.response;
 */

import { NextRequest, NextResponse } from 'next/server';

interface BucketEntry {
  count: number;
  resetAt: number;
}

// Module-level store — lives for the lifetime of the process/function instance
const store = new Map<string, BucketEntry>();

/** Prune entries older than their reset time to avoid unbounded memory growth. */
function pruneStore(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
  // Only prune when the store is large to keep the hot path fast
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; response: NextResponse };

/**
 * Check whether the incoming request is within its rate-limit budget.
 *
 * @param req       The incoming Next.js request
 * @param limit     Max number of requests per window (default: 60)
 * @param windowMs  Window duration in milliseconds (default: 60_000 = 1 minute)
 * @param keyPrefix Optional prefix to namespace limits per route
 */
export function checkRateLimit(
  req: NextRequest,
  limit = 60,
  windowMs = 60_000,
  keyPrefix = ''
): RateLimitResult {
  // Derive a client key from IP headers (Vercel sets x-forwarded-for)
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  const key = keyPrefix ? `${keyPrefix}:${ip}` : ip;

  const now = Date.now();

  // Prune on ~1% of requests and whenever the store grows large.
  // The 1% random check keeps memory bounded without slowing the hot path.
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
