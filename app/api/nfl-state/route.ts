import { NextResponse } from 'next/server';

// Proxies the Sleeper NFL state (current week, season type, etc.) with 1-hour server cache.
// Keeps loadNflState() and the transaction feed off the Sleeper API directly.
export async function GET() {
  try {
    const res = await fetch(
      'https://api.sleeper.app/v1/state/nfl',
      { next: { revalidate: 3600 } } // 1 hour
    );
    if (!res.ok) return NextResponse.json(null);
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json(null);
  }
}
