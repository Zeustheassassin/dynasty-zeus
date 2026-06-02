import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

const log = logger('api/sleeper/league/transactions');

const ID_RE = /^[0-9]{1,30}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; week: string }> }
): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-league-transactions');
  if (!rl.allowed) return rl.response;

  const { leagueId, week } = await ctx.params;
  if (!ID_RE.test(leagueId)) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
  const weekNum = Number(week);
  if (!Number.isInteger(weekNum) || weekNum < 0 || weekNum > 22) {
    return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
  }

  const bypass = req.nextUrl.searchParams.get('bypass') === '1';
  const upstream = `${SLEEPER_BASE_URL}/league/${leagueId}/transactions/${weekNum}`;
  try {
    const res = await fetch(
      upstream,
      bypass ? { cache: 'no-store' } : { next: { revalidate: SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S } },
    );
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, leagueId, week: weekNum });
      return NextResponse.json({ error: "Upstream Sleeper request failed" }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json({ error: "Upstream Sleeper request failed" }, { status: 502 });
  }
}
