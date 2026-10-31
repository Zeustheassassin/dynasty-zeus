import { NextRequest, NextResponse } from 'next/server';
import { readCacheRow } from '../../../../lib/supabaseclient';
import {
  SLEEPER_PROJECTIONS_BASE, SLEEPER_REQUEST_TIMEOUT_MS, SLEEPER_WEEKLY_PROJECTIONS_TTL_MS,
} from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { apiError, parseIntParam } from '../../../../lib/apiHelpers';
import { logger } from '../../../../lib/logger';
import { upsertCacheRow } from '../../../../lib/supabaseAdmin';
import { afterResponse } from '../../../../lib/afterResponse';
import { waitForSleeperSlot } from '../../../../lib/server/sleeperBudget';
import { trimSleeperProjectionWeek, type SleeperProjectionRow } from '../../../../lib/helpers/weeklyProjections';

const log = logger('api/projections/sleeper-week');

// One week of Sleeper's projections, trimmed for the season simulator (see
// lib/helpers/weeklyProjections.ts). Cached in sleeper_stats_cache under its own season prefix,
// so it never collides with the weekly stats rows ('v2-<season>') and needs no table of its own;
// the 60-day cleanup cron ages these out with the rest. Bump the prefix if the trimmed shape changes.
const CACHE_KEY_PREFIX = 'proj-v1';

const POSITION_PARAMS = 'position[]=QB&position[]=RB&position[]=WR&position[]=TE';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'sleeper-week-projections');
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

  const cacheSeason = `${CACHE_KEY_PREFIX}-${season}`;

  // ── 1. Check Supabase cache ──────────────────────────────
  const cached = await readCacheRow<{ data: unknown; cached_at: unknown }>(
    'sleeper_stats_cache',
    [['season', cacheSeason], ['week', week]],
    'data, cached_at'
  );
  if (
    cached &&
    cached.data &&
    typeof cached.data === 'object' &&
    Object.keys(cached.data).length > 0 &&
    Date.now() - new Date(String(cached.cached_at)).getTime() < SLEEPER_WEEKLY_PROJECTIONS_TTL_MS
  ) {
    return NextResponse.json(cached.data);
  }

  // ── 2. Fetch from Sleeper ────────────────────────────────
  try {
    await waitForSleeperSlot('interactive');
    const res = await fetch(
      `${SLEEPER_PROJECTIONS_BASE}/${season}/${week}?season_type=regular&${POSITION_PARAMS}`,
      { signal: AbortSignal.timeout(SLEEPER_REQUEST_TIMEOUT_MS) }
    );
    if (!res.ok) {
      log.error('upstream returned non-OK status', { status: res.status, season, week });
      return NextResponse.json({}, { status: 502 });
    }
    const rows: unknown = await res.json();
    const data = trimSleeperProjectionWeek(Array.isArray(rows) ? (rows as SleeperProjectionRow[]) : []);

    // An empty week means Sleeper had nothing usable (an upstream hiccup, or a week it hasn't
    // projected yet). Answer non-OK so the simulator falls back instead of reading every player
    // as out, and never cache it.
    if (Object.keys(data).length === 0) {
      log.warn('upstream returned no projected players', { season, week });
      return NextResponse.json({}, { status: 502 });
    }

    // ── 3. Write to Supabase cache (service role, after the response) ──
    afterResponse(() =>
      upsertCacheRow('sleeper_stats_cache', {
        season: cacheSeason,
        week,
        data,
        cached_at: new Date().toISOString(),
      })
    );

    return NextResponse.json(data);
  } catch (err) {
    log.error('fetch failed', { err: String(err), season, week });
    return NextResponse.json({}, { status: 502 });
  }
}
