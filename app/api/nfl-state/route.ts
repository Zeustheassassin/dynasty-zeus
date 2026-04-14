import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, NFL_STATE_REVALIDATE_S } from '../../../lib/constants';

// Proxies the Sleeper NFL state (current week, season type, etc.) with 1-hour server cache.
// Keeps loadNflState() and the transaction feed off the Sleeper API directly.
export async function GET() {
  try {
    const res = await fetch(
      `${SLEEPER_BASE_URL}/state/nfl`,
      { next: { revalidate: NFL_STATE_REVALIDATE_S } }
    );
    if (!res.ok) return NextResponse.json(null);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null);
  }
}
