import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_LEAGUE_MATCHUPS_REVALIDATE_S } from '@/lib/constants';
import { SLEEPER_ID_RE } from '@/lib/apiHelpers';
import { proxySleeper } from '@/lib/server/sleeperProxy';

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ leagueId: string; week: string }> }
): Promise<NextResponse> {
  return proxySleeper({
    req,
    logNamespace: 'api/sleeper/league/matchups',
    rateLimitKey: 'sleeper-league-matchups',
    revalidate: SLEEPER_LEAGUE_MATCHUPS_REVALIDATE_S,
    // Live scoring polls pass ?bypass=1 — the server cache would otherwise
    // make scores look several minutes stale.
    supportsBypass: true,
    resolve: async () => {
      const { leagueId, week } = await ctx.params;
      if (!SLEEPER_ID_RE.test(leagueId)) {
        return NextResponse.json({ error: 'Invalid leagueId' }, { status: 400 });
      }
      const weekNum = Number(week);
      if (!Number.isInteger(weekNum) || weekNum < 1 || weekNum > 22) {
        return NextResponse.json({ error: 'Invalid week' }, { status: 400 });
      }
      return {
        upstream: `${SLEEPER_BASE_URL}/league/${leagueId}/matchups/${weekNum}`,
        logFields: { leagueId, week: weekNum },
      };
    },
  });
}
