import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';
import { FANTASYCALC_BASE_URL, FC_VALUES_TTL_MS } from '../../../lib/constants';

export async function GET(req: NextRequest) {
  const numQbs = parseInt(req.nextUrl.searchParams.get('numQbs') ?? '2', 10);

  // ── 1. Check Supabase cache ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('fc_values_cache')
      .select('data, cached_at')
      .eq('num_qbs', numQbs)
      .single();

    if (cached && Date.now() - new Date(cached.cached_at).getTime() < FC_VALUES_TTL_MS) {
      return NextResponse.json(cached.data);
    }
  } catch { /* cache miss — proceed to fetch */ }

  // ── 2. Fetch from FantasyCalc ────────────────────────────
  try {
    const res = await fetch(
      `${FANTASYCALC_BASE_URL}/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`
    );
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();

    // ── 3. Write to Supabase cache (non-blocking, errors logged) ──
    supabase.from('fc_values_cache').upsert({
      num_qbs: numQbs,
      data,
      cached_at: new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.error('[fc-values] cache write failed:', error.message);
    });

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
