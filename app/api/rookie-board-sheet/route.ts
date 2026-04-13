import { NextResponse } from 'next/server';

// Proxies the crowdsourced rookie board Google Sheet with a 6-hour server cache.
// Google Sheets CSV exports can be slow (500ms–2s); this ensures only one upstream
// request per 6-hour window regardless of how many clients load the rookie board.
const SHEET_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?output=csv';

export async function GET() {
  try {
    const res = await fetch(SHEET_URL, { next: { revalidate: 21600 } }); // 6 hours
    if (!res.ok) return new NextResponse('', { status: res.status });
    const text = await res.text();
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  } catch {
    return new NextResponse('', { status: 500 });
  }
}
