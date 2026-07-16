/** Minimal player shape needed for the roster age curve. */
interface AgeCurvePlayer {
  full_name?: string;
  position?: string;
  age?: number | null;
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
      const age = Number(player?.age);
      if (!player || !positions.includes(player.position ?? "") || !Number.isFinite(age) || age <= 0) {
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
