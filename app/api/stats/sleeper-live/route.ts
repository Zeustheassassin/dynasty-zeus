import { NextRequest, NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, NFL_LIVE_STATS_REVALIDATE_S } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { apiError, parseIntParam } from '../../../../lib/apiHelpers';
import { logger } from '../../../../lib/logger';

const log = logger('api/stats/sleeper-live');

// Live cumulative stat lines for the current week, for the Gameday Hub's
// per-stat pace model. Deliberately separate from /api/stats/sleeper-weekly:
// that route caches finished weeks for 7 days in Supabase, which is exactly
// wrong for an in-progress game. This one keeps only a 30s server cache and
// trims Sleeper's ~500 KB all-players payload to the handful of categories
// projections carry.
//
// Note the URL shape: /stats/nfl/regular/{season}/{week}. The
// /stats/nfl/{season}/{week}?season_type=regular form (used by the weekly
// route) returns an empty object for every player.
const TRACKED = ['pass_yd', 'pass_td', 'pass_int', 'rush_yd', 'rush_td', 'rec', 'rec_yd', 'rec_td'] as const;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 30, 60_000, 'sleeper-live-stats');
  if (!rl.allowed) return rl.response;

  const { searchParams } = req.nextUrl;
  const season = searchParams.get('season');
  const week = parseIntParam(searchParams.get('week'), 1, 22);
  if (!season || !/^\d{4}$/.test(season)) return apiError('season must be a 4-digit year', 400, 'INVALID_SEASON');
  if (week === null) return apiError('week must be an integer between 1 and 22', 400, 'INVALID_WEEK');

  try {
    const res = await fetch(
      `${SLEEPER_BASE_URL}/stats/nfl/regular/${season}/${week}`,
      { next: { revalidate: NFL_LIVE_STATS_REVALIDATE_S } }
    );
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status, season, week });
      return NextResponse.json({}, { status: 502 });
    }
    const raw: Record<string, Record<string, number>> = await res.json();

    const trimmed: Record<string, Record<string, number>> = {};
    for (const [playerId, stats] of Object.entries(raw ?? {})) {
      const kept: Record<string, number> = {};
      for (const key of TRACKED) {
        const value = stats?.[key];
        if (typeof value === 'number' && value !== 0) kept[key] = value;
      }
      if (Object.keys(kept).length > 0) trimmed[playerId] = kept;
    }
    return NextResponse.json(trimmed);
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json({}, { status: 502 });
  }
}
