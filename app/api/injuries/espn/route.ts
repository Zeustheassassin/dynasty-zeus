import { NextRequest, NextResponse } from 'next/server';
import { ESPN_INJURIES_URL } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logger } from '../../../../lib/logger';

const log = logger('api/injuries/espn');

// ESPN's public NFL injury report. Fresher than Sleeper's players map (which the
// app caches for up to 24h), so the Gameday Hub uses it to catch Sunday-morning
// Out/Doubtful/inactive changes. The raw payload is ~9 MB (long comments, links,
// headshots) — over Next's 2 MB Data Cache item limit — so it's trimmed to
// skill positions here and cached in module memory instead.

const CACHE_MS = 5 * 60_000;
const SKILL_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);

interface EspnInjuryAthlete {
  displayName?: string;
  position?: { abbreviation?: string };
  team?: { abbreviation?: string };
}
interface EspnInjury {
  status?: string;
  date?: string;
  athlete?: EspnInjuryAthlete;
}
interface EspnInjuryTeam {
  injuries?: EspnInjury[];
}

export interface InjuryRow {
  name: string;
  position: string;
  team: string;
  status: string;
  date: string | null;
}

let cache: { at: number; players: InjuryRow[] } | null = null;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 20, 60_000, 'espn-injuries');
  if (!rl.allowed) return rl.response;

  if (cache && Date.now() - cache.at < CACHE_MS) {
    return NextResponse.json({ players: cache.players });
  }

  try {
    const res = await fetch(ESPN_INJURIES_URL, { cache: 'no-store' });
    if (!res.ok) {
      log.error('upstream non-OK', { status: res.status });
      return NextResponse.json({ players: cache?.players ?? [] });
    }
    const json = await res.json();
    const teams: EspnInjuryTeam[] = Array.isArray(json?.injuries) ? json.injuries : [];

    const players: InjuryRow[] = [];
    for (const team of teams) {
      for (const injury of team.injuries ?? []) {
        const athlete = injury.athlete;
        const position = athlete?.position?.abbreviation ?? '';
        if (!athlete?.displayName || !injury.status || !SKILL_POSITIONS.has(position)) continue;
        players.push({
          name: athlete.displayName,
          position,
          team: athlete.team?.abbreviation ?? '',
          status: injury.status,
          date: injury.date ?? null,
        });
      }
    }
    cache = { at: Date.now(), players };
    return NextResponse.json({ players });
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    // Serve the last good copy rather than nothing.
    return NextResponse.json({ players: cache?.players ?? [] });
  }
}
