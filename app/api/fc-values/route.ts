import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '../../../lib/supabaseclient';
import { FANTASYCALC_BASE_URL, FC_VALUES_TTL_MS } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';
import { logger } from '../../../lib/logger';
import { withRetry } from '../../../lib/withRetry';

const log = logger('api/fc-values');

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 30, 60_000, 'fc-values');
  if (!rl.allowed) return rl.response;

  const numQbsRaw = parseInt(req.nextUrl.searchParams.get('numQbs') ?? '2', 10);
  // Only 1QB and 2QB formats are valid FantasyCalc endpoints
  if (!Number.isInteger(numQbsRaw) || numQbsRaw < 1 || numQbsRaw > 2) {
    return NextResponse.json({ error: 'numQbs must be 1 or 2' }, { status: 400 });
  }
  const numQbs = numQbsRaw;

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

    // ── 3. Write to Supabase cache (non-blocking, retries up to 3x) ──
    withRetry(() =>
      supabase.from('fc_values_cache').upsert({
        num_qbs: numQbs,
        data,
        cached_at: new Date().toISOString(),
      }).then(({ error }) => { if (error) throw error; })
    ).catch((err: unknown) => log.error('cache write failed after retries', { err: String(err) }));

    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
