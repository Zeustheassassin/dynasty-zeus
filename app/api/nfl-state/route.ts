import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, NFL_STATE_REVALIDATE_S } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';

const log = logger('api/nfl-state');

// Proxies the Sleeper NFL state (current week, season type, etc.) with 1-hour server cache.
// Keeps loadNflState() and the transaction feed off the Sleeper API directly.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = checkRateLimit(request, 30, 60_000, 'nfl-state');
  if (!rl.allowed) return rl.response;
  try {
    const res = await fetch(
      `${SLEEPER_BASE_URL}/state/nfl`,
      { next: { revalidate: NFL_STATE_REVALIDATE_S } }
    );
    if (!res.ok) {
      log.error('upstream returned non-OK status', { status: res.status });
      return NextResponse.json(null, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { err: String(err) });
    return NextResponse.json(null, { status: 502 });
  }
}
