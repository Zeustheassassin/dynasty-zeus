import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '../../../lib/rateLimit';
import { getFcValues } from '../../../lib/server/fcValues';

// Serves the raw FantasyCalc values array. All the caching / refresh / fallback logic lives in
// getFcValues (shared with the crons): fresh cache -> live fetch (timeout, validated, cached with the
// service role) -> expired cache if FantasyCalc is down. Only when there is nothing usable at all does
// this answer non-200 — clients (fetchFantasyCalcValues, useCalcValues) treat that as an error and
// retry instead of caching "no values". X-FC-Source says where the payload came from.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 30, 60_000, 'fc-values');
  if (!rl.allowed) return rl.response;

  const numQbsRaw = parseInt(req.nextUrl.searchParams.get('numQbs') ?? '2', 10);
  // Only 1QB and 2QB formats are valid FantasyCalc endpoints
  if (numQbsRaw !== 1 && numQbsRaw !== 2) {
    return NextResponse.json({ error: 'numQbs must be 1 or 2' }, { status: 400 });
  }
  const isDynasty = req.nextUrl.searchParams.get('isDynasty') !== 'false';

  const result = await getFcValues(numQbsRaw, isDynasty);
  if (!result) {
    return NextResponse.json({ error: 'FantasyCalc values unavailable' }, { status: 502 });
  }
  return NextResponse.json(result.data, {
    headers: { 'X-FC-Source': result.source, 'X-FC-Fetched-At': result.fetchedAt },
  });
}
