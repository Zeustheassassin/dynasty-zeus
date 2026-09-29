import { NextRequest, NextResponse } from 'next/server';
import { ESPN_CORE_NFL_URL, ESPN_FANTASY_BASE_URL } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';
import { logger } from '../../../../lib/logger';
import {
  matchEspnAthlete,
  seasonForDate,
  toInjuryDetail,
  type EspnListPlayer,
  type InjuryDetail,
} from '../../../../lib/helpers/espnInjuryDetail';

const log = logger('api/injuries/detail');

// One player's current ESPN injury record — type, side, "Strain"/"Surgery",
// projected return date, and the news blurb — for the Alert Hub's injury
// summary. ESPN's league-wide feed caps at 25 reports per team (long-term IR
// players fall off), so this looks the player up individually:
//   1. name → ESPN athlete id via ESPN's fantasy player list (cached 12h per
//      instance; ~660 KB, and Sleeper's espn_id is empty for most players)
//   2. that athlete's injuries for the season (Data Cache, 30 min)
// Free, unauthenticated endpoints; if they fail the client falls back to
// Sleeper's own injury fields.
//
//   GET /api/injuries/detail?name=Jordyn%20Tyson&team=NO&pos=WR[&last=Tyson]

const INDEX_TTL_MS = 12 * 60 * 60_000;
const DETAIL_REVALIDATE_S = 30 * 60;

let indexCache: { season: number; at: number; players: EspnListPlayer[] } | null = null;

async function loadPlayerIndex(season: number): Promise<{ season: number; players: EspnListPlayer[] }> {
  if (indexCache && Date.now() - indexCache.at < INDEX_TTL_MS && indexCache.season <= season) {
    return indexCache;
  }
  // A new season's list can be empty until ESPN opens it — fall back a year.
  for (const s of [season, season - 1]) {
    const res = await fetch(`${ESPN_FANTASY_BASE_URL}/${s}/players?view=players_wl`, {
      // Without filterActive the endpoint returns only 50 players.
      headers: { 'X-Fantasy-Filter': JSON.stringify({ filterActive: { value: true } }) },
      cache: 'no-store',
    });
    if (!res.ok) { log.warn('player list non-OK', { season: s, status: res.status }); continue; }
    const players = (await res.json()) as EspnListPlayer[];
    if (Array.isArray(players) && players.length > 0) {
      indexCache = { season: s, at: Date.now(), players };
      return indexCache;
    }
  }
  throw new Error('ESPN player list unavailable');
}

async function loadInjury(athleteId: number, season: number): Promise<InjuryDetail> {
  for (const s of [season, season - 1]) {
    const res = await fetch(`${ESPN_CORE_NFL_URL}/seasons/${s}/athletes/${athleteId}/injuries?limit=5`, {
      next: { revalidate: DETAIL_REVALIDATE_S },
    });
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`ESPN injuries ${res.status}`);
    const body = await res.json();
    const detail = toInjuryDetail(Array.isArray(body?.items) ? body.items : [], s);
    if (detail.found) return detail;
  }
  return { found: false };
}

const clip = (v: string | null, max: number) => (v ? v.trim().slice(0, max) : null);

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 60, 60_000, 'injury-detail');
  if (!rl.allowed) return rl.response;

  const q = req.nextUrl.searchParams;
  const name = clip(q.get('name'), 80);
  const team = clip(q.get('team'), 4)?.toUpperCase() ?? null;
  const position = clip(q.get('pos'), 4)?.toUpperCase() ?? null;
  const lastName = clip(q.get('last'), 40);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
  if (team && !/^[A-Z]{2,4}$/.test(team)) return NextResponse.json({ error: 'bad team' }, { status: 400 });

  try {
    const { season, players } = await loadPlayerIndex(seasonForDate(new Date()));
    const athleteId = matchEspnAthlete(players, { name, team, position, lastName });
    const detail: InjuryDetail = athleteId == null ? { found: false } : await loadInjury(athleteId, season);
    return NextResponse.json(detail, {
      headers: { 'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600' },
    });
  } catch (err) {
    log.error('lookup failed', { error: String(err), name });
    // Non-OK so the client neither caches it nor shows it — it falls back to Sleeper.
    return NextResponse.json({ found: false }, { status: 502 });
  }
}
