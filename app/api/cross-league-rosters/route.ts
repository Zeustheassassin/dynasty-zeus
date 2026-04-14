import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, CROSS_LEAGUE_ROSTERS_TTL_MS } from '../../../lib/constants';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const sleeperUserId = searchParams.get('sleeper_user_id');
  const leagueId = searchParams.get('league_id');

  if (!sleeperUserId || !leagueId) {
    return NextResponse.json({ roster: null }, { status: 400 });
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
    const rosters: any[] = await fetch(
      `${SLEEPER_BASE_URL}/league/${leagueId}/rosters`
    ).then((r) => r.json());

    const myRoster = rosters.find((r) => r.owner_id === sleeperUserId) ?? null;

    // ── 3. Write to Supabase cache (non-blocking, errors logged) ──
    if (myRoster) {
      supabase.from('cross_league_rosters_cache').upsert({
        sleeper_user_id: sleeperUserId,
        league_id: leagueId,
        roster: myRoster,
        cached_at: new Date().toISOString(),
      }).then(({ error }) => {
        if (error) console.error('[cross-league-rosters] cache write failed:', error.message);
      });
    }

    return NextResponse.json({ roster: myRoster });
  } catch {
    return NextResponse.json({ roster: null });
  }
}
