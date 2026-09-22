import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_USER_LEAGUES_REVALIDATE_S } from '@/lib/constants';
import { SLEEPER_ID_RE } from '@/lib/apiHelpers';
import { proxySleeper } from '@/lib/server/sleeperProxy';

const YEAR_RE = /^[0-9]{4}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ userId: string; year: string }> }
): Promise<NextResponse> {
  return proxySleeper({
    req,
    logNamespace: 'api/sleeper/user-leagues',
    rateLimitKey: 'sleeper-user-leagues',
    revalidate: SLEEPER_USER_LEAGUES_REVALIDATE_S,
    supportsBypass: false,
    resolve: async () => {
      const { userId, year } = await ctx.params;
      if (!SLEEPER_ID_RE.test(userId)) {
        return NextResponse.json({ error: 'Invalid userId' }, { status: 400 });
      }
      if (!YEAR_RE.test(year)) {
        return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
      }
      return { upstream: `${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${year}`, logFields: { userId, year } };
    },
  });
}
