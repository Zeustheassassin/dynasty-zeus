import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_LEAGUE_USERS_REVALIDATE_S } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

const log = logger('api/sleeper/league/users');

const ID_RE = /^[0-9]{1,30}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-league-users');
  if (!rl.allowed) return rl.response;

  const { leagueId } = await ctx.params;
  if (!ID_RE.test(leagueId)) return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });

  const upstream = `${SLEEPER_BASE_URL}/league/${leagueId}/users`;
  try {
    const res = await fetch(upstream, { next: { revalidate: SLEEPER_LEAGUE_USERS_REVALIDATE_S } });
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, leagueId });
      return NextResponse.json([], { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json([], { status: 502 });
  }
}
