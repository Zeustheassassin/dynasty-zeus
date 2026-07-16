import { average, rankAgainstLeague } from "../math";

/** Minimal player shape needed for positional value aggregation. */
interface BaselinePlayer {
  position?: string;
}

/** Minimal roster shape needed for positional value aggregation. */
interface BaselineRoster {
  roster_id?: number;
  players?: string[];
}

export interface PositionBaselineEntry {
  pos: string;
  rosterTotals: Array<{ roster_id: number; total: number }>;
  leagueAvg: number;
  leagueMax: number;
}

const DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE"];

/** Computes, for each position, every roster's total dynasty value at that
 *  position plus the league average/max. Shared by the direction profile's
 *  positionRanks (roster.ts) and Phase E's positional strength radar (any
 *  roster vs league average) — single source of truth so both stay in sync. */
export const getLeaguePositionalBaseline = ({
  rosters,
  players,
  dynastyValueForPlayer,
  positions = DEFAULT_POSITIONS,
}: {
  rosters: BaselineRoster[];
  players: Record<string, BaselinePlayer>;
  dynastyValueForPlayer: (id: string) => number;
  positions?: string[];
}): PositionBaselineEntry[] =>
  positions.map((pos) => {
    const rosterTotals = (rosters || []).map((roster) => ({
      roster_id: Number(roster.roster_id),
      total: (roster.players || []).reduce((s: number, id: string) => {
        const player = players?.[id];
        return player && player.position === pos ? s + dynastyValueForPlayer(id) : s;
      }, 0),
    }));
    const totals = rosterTotals.map((r) => r.total);
    return {
      pos,
      rosterTotals,
      leagueAvg: average(totals),
      leagueMax: totals.length ? Math.max(...totals) : 0,
    };
  });

export interface RosterPositionalStrength {
  pos: string;
  total: number;
  leagueAvg: number;
  leagueMax: number;
  /** Roster's total as a percent of the league average (100 = exactly average). */
  pctOfAvg: number;
  rank: number;
}

/** Slices one roster's row out of a positional baseline — total value, rank,
 *  and percent of league average, ready for a radar/bar chart. */
export const getRosterPositionalStrength = (
  rosterId: number,
  baseline: PositionBaselineEntry[]
): RosterPositionalStrength[] =>
  baseline.map((entry) => {
    const total = entry.rosterTotals.find((r) => r.roster_id === Number(rosterId))?.total || 0;
    return {
      pos: entry.pos,
      total,
      leagueAvg: entry.leagueAvg,
      leagueMax: entry.leagueMax,
      pctOfAvg: entry.leagueAvg > 0 ? Math.round((total / entry.leagueAvg) * 100) : 0,
      rank: rankAgainstLeague(entry.rosterTotals.map((r) => r.total), total),
    };
  });
