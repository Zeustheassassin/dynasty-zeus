import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_LEAGUE_INFO_REVALIDATE_S } from '@/lib/constants';
import { SLEEPER_ID_RE } from '@/lib/apiHelpers';
import { proxySleeper } from '@/lib/server/sleeperProxy';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string }> }
): Promise<NextResponse> {
  return proxySleeper({
    req,
    logNamespace: 'api/sleeper/league/info',
    rateLimitKey: 'sleeper-league-info',
    revalidate: SLEEPER_LEAGUE_INFO_REVALIDATE_S,
    supportsBypass: false,
    errorMessage: 'Upstream error',
    resolve: async () => {
      const { leagueId } = await ctx.params;
      if (!SLEEPER_ID_RE.test(leagueId)) {
        return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
      }
      return { upstream: `${SLEEPER_BASE_URL}/league/${leagueId}`, logFields: { leagueId } };
    },
  });
}
