/** Minimal player shape needed for the roster age curve. */
interface AgeCurvePlayer {
  full_name?: string;
  position?: string;
  age?: number | null;
  birth_date?: string | null;
}

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

/** Continuous age in years when birth_date is available, falling back to
 *  Sleeper's whole-year `age` otherwise. Whole-year age makes two players
 *  born a couple of days apart look a full year apart on either side of
 *  a birthday — a real effect, but a misleading one on a scatter chart's
 *  continuous x-axis, so this chart specifically wants the precise value. */
function getPreciseAge(player: AgeCurvePlayer): number | null {
  if (player.birth_date) {
    const born = new Date(player.birth_date).getTime();
    if (Number.isFinite(born)) {
      const preciseAge = (Date.now() - born) / MS_PER_YEAR;
      if (preciseAge > 0) return preciseAge;
    }
  }
  const fallback = Number(player.age);
  return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
}

/** Minimal roster shape needed for the roster age curve. */
interface AgeCurveRoster {
  players?: string[];
}

export interface RosterAgeCurvePoint {
  player_id: string;
  full_name: string;
  pos: string;
  age: number;
  value: number;
}

const DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE"];

/** One point per roster player with a valid age, ready for a scatter chart
 *  (age vs. dynasty value) — Phase E's roster age curve (any roster). */
export const getRosterAgeCurve = ({
  roster,
  players,
  dynastyValueForPlayer,
  positions = DEFAULT_POSITIONS,
}: {
  roster: AgeCurveRoster | null | undefined;
  players: Record<string, AgeCurvePlayer>;
  dynastyValueForPlayer: (id: string) => number;
  positions?: string[];
}): RosterAgeCurvePoint[] =>
  (roster?.players || [])
    .map((id: string): RosterAgeCurvePoint | null => {
      const player = players?.[id];
      const age = player ? getPreciseAge(player) : null;
      if (!player || !positions.includes(player.position ?? "") || age == null) {
        return null;
      }
      return {
        player_id: id,
        full_name: player.full_name ?? id,
        pos: player.position ?? "",
        age,
        value: dynastyValueForPlayer(id),
      };
    })
    .filter((p): p is RosterAgeCurvePoint => p !== null);
