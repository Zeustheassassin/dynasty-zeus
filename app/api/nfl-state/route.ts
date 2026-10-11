import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, NFL_STATE_REVALIDATE_S } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';
import { fetchSleeperJson, SleeperUpstreamError } from '../../../lib/server/sleeperProxy';

const log = logger('api/nfl-state');

// Proxies the Sleeper NFL state (current week, season type, etc.) with 1-hour server cache
// (fetchSleeperJson: shared with the trades route's NFL state; a cache miss takes a global budget slot).
// Keeps loadNflState() and the transaction feed off the Sleeper API directly.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(request, 30, 60_000, 'nfl-state');
  if (!rl.allowed) return rl.response;
  try {
    return NextResponse.json(
      await fetchSleeperJson<unknown>(`${SLEEPER_BASE_URL}/state/nfl`, { revalidate: NFL_STATE_REVALIDATE_S })
    );
  } catch (err) {
    if (err instanceof SleeperUpstreamError) {
      log.error('upstream returned non-OK status', { status: err.status });
    } else {
      log.error('fetch failed', { err: String(err) });
    }
    return NextResponse.json(null, { status: 502 });
  }
}
