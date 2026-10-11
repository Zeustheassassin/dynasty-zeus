import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  NFL_STATE_REVALIDATE_S,
  RECENT_TRADE_WINDOW_DAYS,
  SLEEPER_BASE_URL,
  SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S,
} from '@/lib/constants';
import { SLEEPER_ID_RE } from '@/lib/apiHelpers';
import { checkSleeperProxyRateLimit, sleeperUpstreamRateLimited } from '@/lib/server/sleeperProxy';
import { isValidNflState, recentTransactionLegs } from '@/lib/helpers/season';
import { logger } from '@/lib/logger';
import type { SleeperTransaction } from '@/lib/types';

const log = logger('api/sleeper/league/trades');

const FAIL = { error: 'Upstream Sleeper request failed' };

/**
 * A league's completed trades from the last RECENT_TRADE_WINDOW_DAYS days, gathered from every
 * transaction leg that window can reach (recentTransactionLegs). Built so each league costs the
 * browser ONE rate-limited request rather than one per leg: a 36-league Trade Log at 7 legs a
 * league would otherwise be ~250 calls against the Sleeper proxies' rate limit, and every 429
 * there silently drops that leg's trades. The per-leg upstream URLs are the same ones the
 * per-week transactions proxy fetches, so the two share Next's Data Cache entries.
 *
 * Draws from the same per-IP bucket as every other /api/sleeper/* route (one token per request,
 * however many legs it reads — those mostly come out of the Data Cache).
 *
 * Any leg failing returns a 502 rather than a partial list — a missing leg reads as "no trades" —
 * except Sleeper's own 429, which goes back as a 429 with a Retry-After like the other proxies.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
): Promise<NextResponse> {
  const rl = await checkSleeperProxyRateLimit(req);
  if (!rl.allowed) return rl.response;

  const { leagueId } = await ctx.params;
  if (!SLEEPER_ID_RE.test(leagueId)) {
    return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
  }
  const bypass = req.nextUrl.searchParams.get('bypass') === '1';

  try {
    const stateRes = await fetch(`${SLEEPER_BASE_URL}/state/nfl`, {
      next: { revalidate: NFL_STATE_REVALIDATE_S },
    });
    if (stateRes.status === 429) {
      log.error('nfl state rate limited by Sleeper', { leagueId });
      return sleeperUpstreamRateLimited(stateRes);
    }
    const nflState: unknown = stateRes.ok ? await stateRes.json() : null;
    if (!isValidNflState(nflState)) {
      log.error('nfl state unavailable or malformed', { status: stateRes.status, leagueId });
      return NextResponse.json(FAIL, { status: 502 });
    }

    const legs = recentTransactionLegs(nflState, RECENT_TRADE_WINDOW_DAYS);
    // A leg Sleeper 429s is remembered rather than thrown, so the response can carry its
    // Retry-After instead of collapsing into the generic 502 below. A holder, not a `let`: TS
    // doesn't see assignments made inside the map callbacks and would narrow a `let` to null.
    const limited: { res: Response | null } = { res: null };
    const pages = await Promise.all(
      legs.map(async (leg) => {
        const res = await fetch(
          `${SLEEPER_BASE_URL}/league/${leagueId}/transactions/${leg}`,
          bypass ? { cache: 'no-store' } : { next: { revalidate: SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S } }
        );
        if (res.status === 429) {
          limited.res ??= res;
          return null;
        }
        if (!res.ok) throw new Error(`leg ${leg} upstream ${res.status}`);
        return (await res.json()) as SleeperTransaction[] | null;
      })
    );
    if (limited.res) {
      log.error('leg rate limited by Sleeper', { leagueId });
      return sleeperUpstreamRateLimited(limited.res);
    }

    const since = Date.now() - RECENT_TRADE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const trades = pages
      .flatMap((page) => (Array.isArray(page) ? page : []))
      .filter((t) => t?.type === 'trade' && t.status === 'complete' && Number(t.created || 0) >= since);
    return NextResponse.json(trades);
  } catch (err) {
    log.error('fetch failed', { leagueId, error: String(err) });
    return NextResponse.json(FAIL, { status: 502 });
  }
}
