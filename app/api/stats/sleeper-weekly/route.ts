import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, SLEEPER_STATS_TTL_MS } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { apiError, parseIntParam } from '../../../../lib/apiHelpers';
import { logger } from '../../../../lib/logger';
import { withRetry } from '../../../../lib/withRetry';

const log = logger('api/stats/sleeper-weekly');

// Cache rows are keyed by (season, week). Rows written before the URL fix below
// hold empty stats for every player (Sleeper's old URL shape returned {} per
// player), and they'd be served for their full 7-day TTL. Bumping this prefix
// makes every old row unreachable without deleting anything; the existing 60-day
// cleanup cron ages them out. Bump again if the cached shape ever changes.
const CACHE_KEY_VERSION = 'v2';

/** True when at least one player has at least one stat — an all-empty response
 *  means upstream returned nothing usable and must never be cached. */
function hasAnyStats(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  return Object.values(data as Record<string, unknown>).some(
    (stats) => !!stats && typeof stats === 'object' && Object.keys(stats as object).length > 0
  );
}

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

  const cacheSeason = `${CACHE_KEY_VERSION}-${season}`;

  // ── 1. Check Supabase cache ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('sleeper_stats_cache')
      .select('data, cached_at')
      .eq('season', cacheSeason)
      .eq('week', week)
      .single();

    if (
      cached &&
      hasAnyStats(cached.data) &&
      Date.now() - new Date(cached.cached_at).getTime() < SLEEPER_STATS_TTL_MS
    ) {
      return NextResponse.json(cached.data);
    }
  } catch { /* cache miss */ }

  // ── 2. Fetch from Sleeper ────────────────────────────────
  try {
    // NOTE the path shape: /stats/nfl/regular/{season}/{week}. The older
    // /stats/nfl/{season}/{week}?season_type=regular form returns an empty {} for
    // every player, for every week and season.
    const res = await fetch(
      `${SLEEPER_BASE_URL}/stats/nfl/regular/${season}/${week}`
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
    // Never cache a response with no stats in it: a future/unplayed week or an
    // upstream hiccup would otherwise be pinned as "empty" for the full TTL.
    if (hasAnyStats(data)) {
      withRetry(() =>
        supabase.from('sleeper_stats_cache').upsert({
          season: cacheSeason,
          week,
          data,
          cached_at: new Date().toISOString(),
        }).then(({ error }) => { if (error) throw error; })
      ).catch((err: unknown) => log.error('cache write failed after retries', { err: String(err) }));
    }

    return NextResponse.json(data ?? {});
  } catch (err) {
    log.error('fetch failed', { err: String(err) });
    return NextResponse.json({}, { status: 502 });
  }
}
