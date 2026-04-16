import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { ROOKIE_BOARD_SHEET_URL, ROOKIE_BOARD_REVALIDATE_S } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';

// Proxies the crowdsourced rookie board Google Sheet with a 6-hour server cache.
// Google Sheets CSV exports can be slow (500ms–2s); this ensures only one upstream
// request per 6-hour window regardless of how many clients load the rookie board.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = checkRateLimit(request, 20, 60_000, 'rookie-board');
  if (!rl.allowed) return rl.response;
  try {
    const res = await fetch(ROOKIE_BOARD_SHEET_URL, { next: { revalidate: ROOKIE_BOARD_REVALIDATE_S } });
    if (!res.ok) return new NextResponse('', { status: res.status });
    const text = await res.text();
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new NextResponse('', { status: 500 });
  }
}
