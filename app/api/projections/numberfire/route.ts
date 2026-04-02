import { NextRequest, NextResponse } from 'next/server';

// numberFire projections are now served via FanDuel Research's GraphQL API.
// No authentication required. All skill positions returned in one call.
const GQL_ENDPOINT = 'https://fdresearch-api.fanduel.com/graphql';

const GQL_QUERY = `
  query GetProjections($input: ProjectionsInput!) {
    getProjections(input: $input) {
      ... on NflSkill {
        player { name position }
        team { abbreviation }
        fantasy
        receptions
      }
    }
  }
`;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  // week=draft or week=0 → season/yearly; any other value → weekly
  const week = searchParams.get('week') ?? 'draft';
  const isSeason = week === 'draft' || week === '0';

  // PPR type for full PPR base scoring; TE premium applied below via receptions.
  // YEARLY is the full-season variant; WEEKLY is single-week.
  const projectionType = isSeason ? 'YEARLY' : 'WEEKLY';

  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://www.fanduel.com',
        Referer: 'https://www.fanduel.com/research/nfl/fantasy/fantasy-football-projections/qb',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: JSON.stringify({
        query: GQL_QUERY,
        variables: {
          input: {
            type: projectionType,
            sport: 'NFL',
            position: 'NFL_SKILL', // covers QB, RB, WR, TE in one call
          },
        },
      }),
      next: { revalidate: 3600 },
    });

    if (!res.ok) return NextResponse.json([]);

    const json = await res.json();
    const raw: any[] = json?.data?.getProjections ?? [];

    const results = raw
      .filter((p: any) => {
        const pos: string = p.player?.position ?? '';
        return ['QB', 'RB', 'WR', 'TE'].includes(pos) && p.fantasy > 0;
      })
      .map((p: any) => {
        const pos: string = p.player.position;
        const baseFpts: number = p.fantasy ?? 0;
        // Apply 0.5 TE premium: TEs earn an extra 0.5 pts per reception on top
        // of the PPR base so that the scoring matches the app's TEP format exactly.
        const tePremium: number = pos === 'TE' ? (p.receptions ?? 0) * 0.5 : 0;
        return {
          name: p.player.name as string,
          position: pos,
          fpts: baseFpts + tePremium,
        };
      });

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}
