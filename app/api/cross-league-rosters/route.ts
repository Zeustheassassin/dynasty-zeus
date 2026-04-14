import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';

// 6-hour TTL: rosters change with trades and waiver claims
const ROSTER_TTL_MS = 6 * 60 * 60 * 1000;

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

    if (cached && Date.now() - new Date(cached.cached_at).getTime() < ROSTER_TTL_MS) {
      return NextResponse.json({ roster: cached.roster });
    }
  } catch { /* cache miss */ }

  // ── 2. Fetch from Sleeper ────────────────────────────────
  try {
    const rosters: any[] = await fetch(
      `https://api.sleeper.app/v1/league/${leagueId}/rosters`
    ).then((r) => r.json());

    const myRoster = rosters.find((r) => r.owner_id === sleeperUserId) ?? null;

    // ── 3. Write to Supabase cache (fire-and-forget) ───────
    if (myRoster) {
      supabase.from('cross_league_rosters_cache').upsert({
        sleeper_user_id: sleeperUserId,
        league_id: leagueId,
        roster: myRoster,
        cached_at: new Date().toISOString(),
      }).then(() => {});
    }

    return NextResponse.json({ roster: myRoster });
  } catch {
    return NextResponse.json({ roster: null });
  }
}
