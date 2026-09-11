import { NextRequest, NextResponse } from 'next/server';
import { ESPN_SCOREBOARD_BASE_URL, NFL_SCOREBOARD_REVALIDATE_S } from '../../../lib/constants';
import { checkRateLimit } from '../../../lib/rateLimit';

// ESPN's public (unauthenticated) scoreboard API — same trust tier as
// app/api/projections/espn/route.ts. Used here purely for real per-game
// kickoff/live/final status, keyed by NFL team abbreviation: kickoff state
// is a property of the game, not any one player, so every player on the
// same team shares one lookup.

// Sleeper and ESPN disagree on a couple of team abbreviations. Populate the
// result under both spellings so a lookup by either source's abbreviation hits.
const TEAM_ABBR_ALIASES: Record<string, string[]> = {
  WSH: ['WAS'],
};

type GameState = 'Upcoming' | 'Live' | 'Final';

function mapState(state: string | undefined): GameState {
  if (state === 'in') return 'Live';
  if (state === 'post') return 'Final';
  return 'Upcoming';
}

interface EspnCompetitor {
  team?: { abbreviation?: string };
}
interface EspnCompetition {
  date?: string;
  competitors?: EspnCompetitor[];
  status?: { type?: { state?: string } };
}
interface EspnEvent {
  date?: string;
  status?: { type?: { state?: string } };
  competitions?: EspnCompetition[];
}

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

    const result: Record<string, { kickoffAt: number; state: GameState }> = {};
    events.forEach((event) => {
      const competition = event.competitions?.[0];
      const rawDate = competition?.date ?? event.date;
      const kickoffAt = rawDate ? Date.parse(rawDate) : NaN;
      const rawState = competition?.status?.type?.state ?? event.status?.type?.state;
      if (!Number.isFinite(kickoffAt) || !rawState) return;

      const entry = { kickoffAt, state: mapState(rawState) };
      (competition?.competitors ?? []).forEach((competitor) => {
        const abbr = competitor.team?.abbreviation;
        if (!abbr) return;
        result[abbr] = entry;
        (TEAM_ABBR_ALIASES[abbr] ?? []).forEach((alias) => { result[alias] = entry; });
      });
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json({});
  }
}
