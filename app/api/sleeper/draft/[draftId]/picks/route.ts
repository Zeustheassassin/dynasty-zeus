import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_DRAFT_PICKS_REVALIDATE_S } from '@/lib/constants';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rateLimit';

const log = logger('api/sleeper/draft/picks');

const ID_RE = /^[0-9]{1,30}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-draft-picks');
  if (!rl.allowed) return rl.response;

  const { draftId } = await ctx.params;
  if (!ID_RE.test(draftId)) return NextResponse.json({ error: 'Invalid draftId' }, { status: 400 });

  const upstream = `${SLEEPER_BASE_URL}/draft/${draftId}/picks`;
  try {
    const res = await fetch(upstream, { next: { revalidate: SLEEPER_DRAFT_PICKS_REVALIDATE_S } });
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, draftId });
      return NextResponse.json([], { status: 502 });
    }
    return NextResponse.json(await res.json());
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json([], { status: 502 });
  }
}
