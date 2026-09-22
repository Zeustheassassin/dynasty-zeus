import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, SLEEPER_USER_REVALIDATE_S } from '@/lib/constants';
import { proxySleeper } from '@/lib/server/sleeperProxy';

const USERNAME_RE = /^[A-Za-z0-9_\-.]{1,50}$/;

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ username: string }> }
): Promise<NextResponse> {
  return proxySleeper({
    req,
    logNamespace: 'api/sleeper/user',
    rateLimitKey: 'sleeper-user',
    revalidate: SLEEPER_USER_REVALIDATE_S,
    supportsBypass: false,
    errorMessage: 'Upstream error',
    resolve: async () => {
      const { username } = await ctx.params;
      if (!USERNAME_RE.test(username)) {
        return NextResponse.json({ error: 'Invalid username' }, { status: 400 });
      }
      return {
        upstream: `${SLEEPER_BASE_URL}/user/${encodeURIComponent(username)}`,
        logFields: { username },
      };
    },
  });
}
