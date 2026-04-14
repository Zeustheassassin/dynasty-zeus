import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';

// 24-hour cache: FC values update at most once a day
const FC_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const numQbs = parseInt(req.nextUrl.searchParams.get('numQbs') ?? '2', 10);

  // ── 1. Check Supabase cache ──────────────────────────────
  try {
    const { data: cached } = await supabase
      .from('fc_values_cache')
      .select('data, cached_at')
      .eq('num_qbs', numQbs)
      .single();

    if (cached && Date.now() - new Date(cached.cached_at).getTime() < FC_TTL_MS) {
      return NextResponse.json(cached.data);
    }
  } catch { /* cache miss — proceed to fetch */ }

  // ── 2. Fetch from FantasyCalc ────────────────────────────
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`
    );
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();

    // ── 3. Write to Supabase cache (fire-and-forget) ───────
    supabase.from('fc_values_cache').upsert({
      num_qbs: numQbs,
      data,
      cached_at: new Date().toISOString(),
    }).then(() => {});

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
