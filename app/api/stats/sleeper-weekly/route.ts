import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, SLEEPER_STATS_TTL_MS } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { apiError, parseIntParam } from '../../../../lib/apiHelpers';
import { logger } from '../../../../lib/logger';
import { withRetry } from '../../../../lib/withRetry';

const log = logger('api/stats/sleeper-weekly');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 30, 60_000, 'sleeper-weekly');
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
    if (!res.ok) {
      // Never cache a transient upstream failure — the 7-day TTL would
      // otherwise serve empty stats for a full week. Return non-OK so the
      // client (usePlayerStats.ts) leaves this week uncached and retries.
      log.error('upstream returned non-OK status', { status: res.status, season, week });
      return NextResponse.json({}, { status: 502 });
    }
    const data = await res.json();

    // ── 3. Write to Supabase cache (non-blocking, retries up to 3x) ──
    withRetry(() =>
      supabase.from('sleeper_stats_cache').upsert({
        season,
        week,
        data: data ?? {},
        cached_at: new Date().toISOString(),
      }).then(({ error }) => { if (error) throw error; })
    ).catch((err: unknown) => log.error('cache write failed after retries', { err: String(err) }));

    return NextResponse.json(data ?? {});
  } catch (err) {
    log.error('fetch failed', { err: String(err) });
    return NextResponse.json({}, { status: 502 });
  }
}
