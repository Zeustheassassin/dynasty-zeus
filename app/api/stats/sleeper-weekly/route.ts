import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../../lib/supabaseclient';
import { SLEEPER_BASE_URL, SLEEPER_STATS_TTL_MS } from '../../../../lib/constants';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const season = searchParams.get('season');
  const week = parseInt(searchParams.get('week') ?? '0', 10);

  if (!season || !week) {
    return NextResponse.json({}, { status: 400 });
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
