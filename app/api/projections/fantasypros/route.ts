import { NextRequest, NextResponse } from 'next/server';

const POSITIONS = ['qb', 'rb', 'wr', 'te'] as const;

function parseFPProjections(
  html: string,
  position: string
): Array<{ name: string; position: string; fpts: number }> {
  const results: Array<{ name: string; position: string; fpts: number }> = [];

  // Match player rows by mpb-player-XXXX class (confirmed structure from FantasyPros)
  const rowPattern = /<tr[^>]*class="[^"]*mpb-player-\d+[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowPattern.exec(html)) !== null) {
    const rowHtml = rowMatch[1];

    // Player name lives in the fp-player-name attribute on the <a> tag
    const nameMatch = rowHtml.match(/fp-player-name="([^"]+)"/i);
    if (!nameMatch) continue;
    const name = nameMatch[1].trim();
    if (!name) continue;

    // FPTS lives in data-sort-value on the last <td> that has it
    const sortValues = [...rowHtml.matchAll(/data-sort-value="([^"]+)"/gi)];
    if (sortValues.length > 0) {
      const fpts = parseFloat(sortValues[sortValues.length - 1][1]);
      if (fpts > 0) results.push({ name, position: position.toUpperCase(), fpts });
      continue;
    }

    // Fallback: last <td class="center"> text content (strip commas for e.g. "1,683.6")
    const centerTds = [...rowHtml.matchAll(/<td[^>]*class="center"[^>]*>([^<]*)<\/td>/gi)];
    if (centerTds.length > 0) {
      const fpts = parseFloat(centerTds[centerTds.length - 1][1].replace(/,/g, ''));
      if (fpts > 0) results.push({ name, position: position.toUpperCase(), fpts });
    }
  }

  return results;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // week=draft → full-season projections; week=1-18 → specific week
  const week = searchParams.get('week') ?? 'draft';

  const allProjections: Array<{ name: string; position: string; fpts: number }> = [];

  await Promise.all(
    POSITIONS.map(async (pos) => {
      try {
        // PPR scoring for all positions. TE premium (extra 0.5/rec) is applied
        // in the client after combining sources, using the rec stat from Sleeper.
        const url = `https://www.fantasypros.com/nfl/projections/${pos}.php?week=${week}&scoring=PPR`;
        const res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            Referer: 'https://www.fantasypros.com/',
          },
          // Cache for 1 hour server-side — projections don't change minute-to-minute
          next: { revalidate: 3600 },
        });

        if (!res.ok) return;
        const html = await res.text();
        allProjections.push(...parseFPProjections(html, pos));
      } catch {
        // silently skip; caller handles partial results
      }
    })
  );

  return NextResponse.json(allProjections);
}
