// ============================================================
// Sleeper's week-by-week projections, trimmed for the season simulator.
//
// Sleeper projects every remaining week separately, and a player projects to nothing in a week he
// won't play: his team's bye, or every week until the one Sleeper expects him back from an injury
// (checked 2026-10-30: Romeo Doubs on IR projected 0 through week 11 and back in week 12, Carnell
// Tate "Out" back in week 10, C.J. Stroud 0 only in Houston's week-8 bye). Backups who aren't
// expected to play project 0 too. simulateLeague reads which players are projected to score in
// each simulated week, so byes, injury return dates and backups all come straight from Sleeper —
// the same source as the app's injury designations.
//
// A raw Sleeper week is ~2 MB; the trimmed week (skill positions projected to score, scoring stats
// only) is ~100 KB, served by /api/projections/sleeper-week and fetched directly by the
// simulation-history cron.
// ============================================================

import { computeLeagueFpts } from "./scoring";
import { fantasySkillPosition, isSkillPosition } from "./playerPosition";

/** One player's projected stat line for one week. */
export interface WeeklyProjectionEntry {
  position: string;
  stats: Record<string, number>;
}

/** One week: player_id → projection, only players projected to score that week. */
export type WeeklyProjectionWeek = Record<string, WeeklyProjectionEntry>;

/** Week → (player_id → league-scored points), only players projected to score. */
export type ScoredWeeklyProjections = Record<number, Record<string, number>>;

/** A row of Sleeper's /projections/nfl/{season}/{week} response (only the fields read here). */
export interface SleeperProjectionRow {
  player_id?: string | number;
  player?: { position?: string; fantasy_positions?: string[] };
  stats?: Record<string, number | null | undefined>;
}

// Sleeper's own fantasy totals, ADP and ranking fields — never a league scoring key.
const NON_SCORING_STAT = /^(adp_|pos_adp_|pts_|rank|pos_rank|gp$|gms_active$|gs$|cmp_pct$)/;

/** Keeps the QB / RB / WR / TE rows Sleeper projects to score (any of its PPR, half-PPR or standard
 *  totals above 0), with only the stats a league can score, rounded to 0.01. */
export function trimSleeperProjectionWeek(rows: readonly SleeperProjectionRow[]): WeeklyProjectionWeek {
  const week: WeeklyProjectionWeek = {};
  rows.forEach((row) => {
    const id = row.player_id == null ? "" : String(row.player_id);
    const position = fantasySkillPosition(row.player?.position, row.player?.fantasy_positions);
    const raw = row.stats ?? {};
    if (!id || !isSkillPosition(position)) return;
    const projectedPoints = Math.max(Number(raw.pts_ppr) || 0, Number(raw.pts_half_ppr) || 0, Number(raw.pts_std) || 0);
    if (projectedPoints <= 0) return;
    const stats: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (NON_SCORING_STAT.test(key) || typeof value !== "number" || !value) continue;
      stats[key] = Math.round(value * 100) / 100;
    }
    week[id] = { position, stats };
  });
  return week;
}

/** Scores each week under one league's rules. A player whose projection comes to 0 or less there is
 *  left out, the same as one Sleeper doesn't project at all. */
export function scoreWeeklyProjections(
  weeks: Record<number, WeeklyProjectionWeek>,
  scoringSettings: Record<string, number>,
): ScoredWeeklyProjections {
  const scored: ScoredWeeklyProjections = {};
  for (const [week, players] of Object.entries(weeks)) {
    const points: Record<string, number> = {};
    for (const [id, entry] of Object.entries(players)) {
      const fpts = computeLeagueFpts(entry.stats, scoringSettings, entry.position);
      if (fpts > 0) points[id] = fpts;
    }
    scored[Number(week)] = points;
  }
  return scored;
}

/** The regular-season weeks a sim still has to play: this week through the last week before the
 *  playoffs. Empty outside the regular season or once it's over. */
export function remainingRegularSeasonWeeks(currentWeek: number, regularSeasonWeeks: number): number[] {
  if (currentWeek <= 0) return [];
  return Array.from({ length: Math.max(regularSeasonWeeks - currentWeek + 1, 0) }, (_, idx) => currentWeek + idx);
}
