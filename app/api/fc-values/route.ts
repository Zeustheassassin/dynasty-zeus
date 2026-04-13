import { NextRequest, NextResponse } from 'next/server';

// Proxies FantasyCalc dynasty values with a 6-hour server-side cache.
// All clients share one upstream fetch per 6-hour window instead of each
// browser hitting FC directly on every page load.
export async function GET(req: NextRequest) {
  const numQbs = req.nextUrl.searchParams.get('numQbs') ?? '2';
  try {
    const res = await fetch(
      `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${numQbs}&numTeams=12&ppr=1`,
      { next: { revalidate: 21600 } } // 6 hours
    );
    if (!res.ok) return NextResponse.json([]);
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
