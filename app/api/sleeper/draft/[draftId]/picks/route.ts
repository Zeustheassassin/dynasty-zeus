import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_DRAFT_PICKS_REVALIDATE_S } from '@/lib/constants';
import { SLEEPER_ID_RE } from '@/lib/apiHelpers';
import { proxySleeper } from '@/lib/server/sleeperProxy';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ draftId: string }> }
): Promise<NextResponse> {
  return proxySleeper({
    req,
    logNamespace: 'api/sleeper/draft/picks',
    rateLimitKey: 'sleeper-draft-picks',
    revalidate: SLEEPER_DRAFT_PICKS_REVALIDATE_S,
    supportsBypass: false,
    resolve: async () => {
      const { draftId } = await ctx.params;
      if (!SLEEPER_ID_RE.test(draftId)) {
        return NextResponse.json({ error: 'Invalid draftId' }, { status: 400 });
      }
      return { upstream: `${SLEEPER_BASE_URL}/draft/${draftId}/picks`, logFields: { draftId } };
    },
  });
}
