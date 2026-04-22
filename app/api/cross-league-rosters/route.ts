import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, CROSS_LEAGUE_ROSTERS_TTL_MS } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';
import { withRetry } from '../../../lib/withRetry';

const log = logger('api/cross-league-rosters');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'cross-league-rosters');
  if (!rl.allowed) return rl.response;

  const { searchParams } = req.nextUrl;
  const sleeperUserId = searchParams.get('sleeper_user_id');
  const leagueId = searchParams.get('league_id');

  // Validate: Sleeper IDs are Discord-style snowflakes — numeric strings up to 20 digits.
  // (64-bit unsigned integers have at most 20 decimal digits; 19 is common for recent IDs.)
  const ID_RE = /^\d{1,20}$/;
  if (!sleeperUserId || !leagueId || !ID_RE.test(sleeperUserId) || !ID_RE.test(leagueId)) {
    return NextResponse.json({ error: 'Invalid sleeper_user_id or league_id', roster: null }, { status: 400 });
  }

  // ── 1. Check Supabase cache ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('cross_league_rosters_cache')
      .select('roster, cached_at')
      .eq('sleeper_user_id', sleeperUserId)
      .eq('league_id', leagueId)
      .single();

    if (cached && Date.now() - new Date(cached.cached_at).getTime() < CROSS_LEAGUE_ROSTERS_TTL_MS) {
      return NextResponse.json({ roster: cached.roster });
    }
  } catch { /* cache miss */ }

  // ── 2. Fetch from Sleeper ────────────────────────────────
  try {
    interface SleeperRosterBasic { owner_id: string; [key: string]: unknown }
    const res = await fetch(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`);
    if (!res.ok) return NextResponse.json({ roster: null }, { status: 502 });
    const rosters: SleeperRosterBasic[] = await res.json();

    const myRoster = rosters.find((r) => r.owner_id === sleeperUserId) ?? null;

    // ── 3. Write to Supabase cache (non-blocking, retries up to 3x) ──
    if (myRoster) {
      withRetry(() =>
        supabase.from('cross_league_rosters_cache').upsert({
          sleeper_user_id: sleeperUserId,
          league_id: leagueId,
          roster: myRoster,
          cached_at: new Date().toISOString(),
        }).then(({ error }) => { if (error) throw error; })
      ).catch((err: unknown) => log.error('cache write failed after retries', { err: String(err) }));
    }

    return NextResponse.json({ roster: myRoster });
  } catch {
    return NextResponse.json({ roster: null });
  }
}
