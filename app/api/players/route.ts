import { NextResponse } from 'next/server';

// Proxies the Sleeper player map + NFL state with server-side caching.
// Slims the player map server-side so clients download ~500 KB instead of ~5 MB raw.
// Players cached 24 hours, NFL state cached 1 hour.
export async function GET() {
  try {
    const [playersRes, stateRes] = await Promise.all([
      fetch('https://api.sleeper.app/v1/players/nfl', { next: { revalidate: 86400 } }),
      fetch('https://api.sleeper.app/v1/state/nfl',   { next: { revalidate: 3600  } }),
    ]);

    const rawPlayers = await playersRes.json();
    const nflState   = await stateRes.json();

    // Only keep the fields the app actually uses — strips ~90% of the payload
    const players: Record<string, any> = {};
    Object.keys(rawPlayers).forEach((id) => {
      const p = rawPlayers[id];
      if (!p) return;
      players[id] = {
        player_id:        p.player_id,
        full_name:        p.full_name,
        position:         p.position,
        team:             p.team,
        age:              p.age,
        years_exp:        p.years_exp,
        search_rank:      p.search_rank,
        fantasy_positions: p.fantasy_positions,
        active:           p.active,
        status:           p.status,
      };
    });

    return NextResponse.json({ players, nflState });
  } catch {
    return NextResponse.json({ players: {}, nflState: null }, { status: 500 });
  }
}
