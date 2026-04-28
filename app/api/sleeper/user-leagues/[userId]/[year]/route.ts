import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_USER_LEAGUES_REVALIDATE_S } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

const log = logger('api/sleeper/user-leagues');

const ID_RE = /^[0-9]{1,30}$/;
const YEAR_RE = /^[0-9]{4}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string; year: string }> }
): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-user-leagues');
  if (!rl.allowed) return rl.response;

  const { userId, year } = await ctx.params;
  if (!ID_RE.test(userId)) return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
  if (!YEAR_RE.test(year)) return NextResponse.json({ error: 'Invalid year' }, { status: 400 });

  const upstream = `${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${year}`;
  try {
    const res = await fetch(upstream, { next: { revalidate: SLEEPER_USER_LEAGUES_REVALIDATE_S } });
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, userId, year });
      return NextResponse.json([], { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json([], { status: 502 });
  }
}
