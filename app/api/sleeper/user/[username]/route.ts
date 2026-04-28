import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_USER_REVALIDATE_S } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

const log = logger('api/sleeper/user');

const USERNAME_RE = /^[A-Za-z0-9_\-.]{1,50}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ username: string }> }
): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-user');
  if (!rl.allowed) return rl.response;

  const { username } = await ctx.params;
  if (!USERNAME_RE.test(username)) {
    return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
  }

  const upstream = `${SLEEPER_BASE_URL}/user/${encodeURIComponent(username)}`;
  try {
    const res = await fetch(upstream, { next: { revalidate: SLEEPER_USER_REVALIDATE_S } });
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, username });
      return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
  }
}
