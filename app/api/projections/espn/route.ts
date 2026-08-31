import { NextRequest, NextResponse } from 'next/server';
import { ESPN_FANTASY_BASE_URL, FANTASYPROS_REVALIDATE_S } from '../../../../lib/constants';
import { checkRateLimit } from '../../../../lib/rateLimit';

// ESPN's public (unauthenticated) fantasy football API. Undocumented but
// stable — used by the espn-api open-source project for years. No API key,
// no league ID required: "leaguedefaults/3" is ESPN's generic default-scoring
// player pool, independent of any real league.

// defaultPositionId -> our position codes (validated against a live 2026 pull).
const POSITION_MAP: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE' };
// Roster slot IDs for the X-Fantasy-Filter position filter (QB/RB/WR/TE).
const SLOT_IDS = [0, 2, 4, 6];

// ESPN stat-category ID -> our scoring-key names (matches computeLeagueFpts's
// expected fields). Validated against a live pull: reconstructing Jahmyr
// Gibbs's appliedTotal from these raw categories under standard PPR scoring
// matched ESPN's own total within rounding.
const STAT_ID_MAP: Record<string, string> = {
  '3': 'pass_yd',
  '4': 'pass_td',
  '20': 'pass_int',
  '19': 'pass_2pt',
  '24': 'rush_yd',
  '25': 'rush_td',
  '26': 'rush_2pt',
  '53': 'rec',
  '42': 'rec_yd',
  '43': 'rec_td',
  '44': 'rec_2pt',
};

interface EspnStatBlock {
  scoringPeriodId?: number;
  seasonId?: number;
  statSourceId?: number;
  appliedTotal?: number;
  stats?: Record<string, number>;
}

interface EspnPlayerEntry {
  player?: {
    fullName?: string;
    defaultPositionId?: number;
    proTeamId?: number;
    stats?: EspnStatBlock[];
  };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit(req, 20, 60_000, 'espn');
  if (!rl.allowed) return rl.response;

  const { searchParams } = new URL(req.url);
  // week=draft or week=0 → season-long; week=1-18 → specific week
  const rawWeek = searchParams.get('week') ?? 'draft';
  const isSeason = rawWeek === 'draft' || rawWeek === '0';
  let week = 0;
  if (!isSeason) {
    week = parseInt(rawWeek, 10);
    if (isNaN(week) || week < 1 || week > 18) return NextResponse.json([]);
  }

  const year = new Date().getFullYear();
  const filter = {
    players: {
      filterSlotIds: { value: SLOT_IDS },
      // ESPN only includes the season-total block when its stat id is
      // explicitly requested via additionalValue — "00{year}"/"10{year}" are
      // the actual/projected season-total ids (confirmed against a live
      // pull). `value: 20` widens the window so recent weekly blocks (and,
      // once ESPN publishes them, this season's weekly-projected blocks)
      // come back in the same call.
      filterStatsForTopScoringPeriodIds: {
        value: 20,
        additionalValue: [`00${year}`, `10${year}`],
      },
      limit: 600,
      sortPercOwned: { sortPriority: 1, sortAsc: false },
    },
  };

  try {
    const res = await fetch(
      `${ESPN_FANTASY_BASE_URL}/${year}/segments/0/leaguedefaults/3?view=kona_player_info`,
      {
        headers: {
          Accept: 'application/json',
          'X-Fantasy-Filter': JSON.stringify(filter),
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        next: { revalidate: FANTASYPROS_REVALIDATE_S },
      }
    );

    if (!res.ok) return NextResponse.json([]);

    const json = await res.json();
    const raw: EspnPlayerEntry[] = json?.players ?? [];

    const results = raw
      .map((entry) => {
        const p = entry.player;
        const pos = POSITION_MAP[p?.defaultPositionId ?? -1];
        if (!pos || !p?.fullName) return null;

        // Projected (statSourceId===1) block matching the requested scope:
        // season-total is scoringPeriodId 0, a specific week matches that week.
        const block = (p.stats ?? []).find(
          (s) =>
            s.statSourceId === 1 &&
            s.seasonId === year &&
            s.scoringPeriodId === week
        );
        if (!block?.stats) return null;

        const stats: Record<string, number> = {};
        for (const [id, key] of Object.entries(STAT_ID_MAP)) {
          const v = block.stats[id];
          if (typeof v === 'number' && v !== 0) stats[key] = v;
        }
        if (Object.keys(stats).length === 0) return null;

        return {
          name: p.fullName,
          position: pos,
          fpts: block.appliedTotal ?? 0,
          stats,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null && r.fpts > 0);

    return NextResponse.json(results);
  } catch {
    return NextResponse.json([]);
  }
}
