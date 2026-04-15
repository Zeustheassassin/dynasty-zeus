import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, SLEEPER_STATS_TTL_MS } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { apiError, parseIntParam } from '../../../../lib/apiHelpers';

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, 30, 60_000, 'sleeper-weekly');
  if (!rl.allowed) return rl.response;

  const { searchParams } = req.nextUrl;
  const season = searchParams.get('season');
  const week = parseIntParam(searchParams.get('week'), 1, 18);

  if (!season || !/^\d{4}$/.test(season)) {
    return apiError('season must be a 4-digit year', 400, 'INVALID_SEASON');
  }
  const seasonYear = parseInt(season, 10);
  if (seasonYear < 2015 || seasonYear > 2040) {
    return apiError('season must be between 2015 and 2040', 400, 'INVALID_SEASON');
  }
  if (week === null) {
    return apiError('week must be an integer between 1 and 18', 400, 'INVALID_WEEK');
  }

  // ── 1. Check Supabase cache ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('sleeper_stats_cache')
      .select('data, cached_at')
      .eq('season', season)
      .eq('week', week)
      .single();

    if (cached && Date.now() - new Date(cached.cached_at).getTime() < SLEEPER_STATS_TTL_MS) {
      return NextResponse.json(cached.data);
    }
  } catch { /* cache miss */ }

  // ── 2. Fetch from Sleeper ────────────────────────────────
  try {
    const res = await fetch(
      `${SLEEPER_BASE_URL}/stats/nfl/${season}/${week}?season_type=regular`
    );
    const data = res.ok ? await res.json() : {};

    // ── 3. Write to Supabase cache (non-blocking, errors logged) ──
    supabase.from('sleeper_stats_cache').upsert({
      season,
      week,
      data: data ?? {},
      cached_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error('[sleeper-weekly] cache write failed:', error.message);
    });

    return NextResponse.json(data ?? {});
  } catch {
    return NextResponse.json({});
  }
}
