import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SLEEPER_BASE_URL, PLAYERS_REVALIDATE_S, NFL_STATE_REVALIDATE_S } from '../../../lib/constants';
import { logger } from '../../../lib/logger';
import { checkRateLimit } from '../../../lib/rateLimit';

const log = logger('api/players');

// Proxies the Sleeper player map + NFL state with server-side caching.
// Slims the player map server-side so clients download ~500 KB instead of ~5 MB raw.
// Players cached 24 hours, NFL state cached 1 hour.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(request, 10, 60_000, 'players');
  if (!rl.allowed) return rl.response;
  try {
    const [playersRes, stateRes] = await Promise.all([
      fetch(`${SLEEPER_BASE_URL}/players/nfl`, { next: { revalidate: PLAYERS_REVALIDATE_S } }),
      fetch(`${SLEEPER_BASE_URL}/state/nfl`,   { next: { revalidate: NFL_STATE_REVALIDATE_S } }),
    ]);

    if (!playersRes.ok) {
      log.error('players upstream returned non-OK', { status: playersRes.status });
      return NextResponse.json(
        { error: 'Failed to fetch player data', players: {}, nflState: null },
        { status: 502 }
      );
    }
    if (!stateRes.ok) {
      log.warn('nfl-state upstream returned non-OK', { status: stateRes.status });
      // Degrade gracefully — return players without nflState rather than failing entirely
    }

    const rawPlayers = await playersRes.json() as Record<string, Record<string, unknown>>;
    const nflState   = stateRes.ok ? await stateRes.json() : null;

    interface SlimPlayer {
      player_id: string; full_name: string; position: string; team: string | null;
      age: number | null; birth_date: string | null; years_exp: number | null; search_rank: number | null;
      fantasy_positions: string[]; active: boolean; status: string;
      injury_status: string | null;
    }
    // Only keep the fields the app actually uses — strips ~90% of the payload.
    // injury_status is needed by Gameday badges, alerts, and the Roster
    // Overview's IR-eligible flag — without it those views silently miss
    // every injury. birth_date lets age-sensitive charts (e.g. the roster
    // age-curve scatter) compute a continuous age instead of Sleeper's
    // whole-year `age`, which can make two players a couple of days apart
    // in age look a full year apart on either side of a birthday.
    const players: Record<string, SlimPlayer> = {};
    for (const id of Object.keys(rawPlayers)) {
      const p = rawPlayers[id];
      if (!p || typeof p !== 'object') continue;
      players[id] = {
        player_id:         p.player_id        as string,
        full_name:         p.full_name         as string,
        position:          p.position          as string,
        team:              (p.team ?? null)     as string | null,
        age:               (p.age ?? null)      as number | null,
        birth_date:        (p.birth_date ?? null) as string | null,
        years_exp:         (p.years_exp ?? null) as number | null,
        search_rank:       (p.search_rank ?? null) as number | null,
        fantasy_positions: (p.fantasy_positions ?? []) as string[],
        active:            (p.active ?? false)  as boolean,
        status:            (p.status ?? '')     as string,
        injury_status:     (p.injury_status ?? null) as string | null,
      };
    }

    return NextResponse.json({ players, nflState });
  } catch (err) {
    log.error('fetch failed', { error: String(err) });
    return NextResponse.json(
      { error: 'Failed to fetch player data', players: {}, nflState: null },
      { status: 502 }
    );
  }
}
