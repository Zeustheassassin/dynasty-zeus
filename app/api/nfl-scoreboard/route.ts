import { NextRequest, NextResponse } from 'next/server';
import { ESPN_SCOREBOARD_BASE_URL, NFL_SCOREBOARD_REVALIDATE_S } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';
import { parseEspnScoreboard, findIncompleteLiveGames, type EspnEvent } from '../../../lib/espnScoreboard';
import { logger } from '../../../lib/logger';

const log = logger('api/nfl-scoreboard');

// ESPN's public (unauthenticated) scoreboard API — same trust tier as
// app/api/projections/espn/route.ts. Used here for real per-game
// kickoff/live/final status plus live clock, score and possession, keyed by
// NFL team abbreviation: game state is a property of the game, not any one
// player, so every player on the same team shares one lookup. Parsing lives
// in lib/espnScoreboard.ts.

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 30, 60_000, 'nfl-scoreboard');
  if (!rl.allowed) return rl.response;

  const { searchParams } = req.nextUrl;
  const week = parseInt(searchParams.get('week') || '', 10);
  if (!Number.isFinite(week) || week < 1 || week > 22) {
    return NextResponse.json({});
  }

  try {
    const res = await fetch(
      `${ESPN_SCOREBOARD_BASE_URL}?week=${week}&seasontype=2`,
      { next: { revalidate: NFL_SCOREBOARD_REVALIDATE_S } }
    );
    if (!res.ok) return NextResponse.json({});

    const json = await res.json();
    const events: EspnEvent[] = Array.isArray(json?.events) ? json.events : [];
    const parsed = parseEspnScoreboard(events);
    const incomplete = findIncompleteLiveGames(parsed);
    if (incomplete.length > 0) {
      // The live-clock model falls back to a cruder formula for these teams.
      log.warn('live game missing period/clock — ESPN shape may have changed', { teams: incomplete, week });
    }
    return NextResponse.json(parsed);
  } catch {
    return NextResponse.json({});
  }
}
