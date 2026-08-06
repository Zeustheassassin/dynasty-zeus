// ============================================================
// Player value history helpers — build "then vs. now" dynasty-value
// comparisons from the daily player_value_history cron (migration 047)
// without ever comparing against same-day or otherwise too-fresh data,
// and without mixing generic (non-league-adjusted) historical values
// with league-adjusted current values.
// ============================================================
import type { PlayerValuePoint } from "../../hooks/usePlayerValueHistory";

export const MIN_TREND_AGE_DAYS = 7;

/** From an ascending-by-date history array, returns the value of the most
 *  recent entry that is at least `minDaysAgo` days older than `now` — e.g.
 *  given entries for the 8th/6th/5th/3rd and `now` = the 10th, returns the
 *  3rd's value (the closest one that still clears the bar), not the oldest
 *  entry available. Returns null if no entry clears the bar yet. */
export function valueAtLeastDaysAgo(
  history: PlayerValuePoint[],
  minDaysAgo: number = MIN_TREND_AGE_DAYS,
  now: Date = new Date()
): number | null {
  if (!history.length) return null;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - minDaysAgo);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date <= cutoffIso) return history[i].value;
  }
  return null;
}

/** Ratio to project a generic (non-league-adjusted) FantasyCalc value onto
 *  this league's adjusted scale, derived from the same player's current
 *  adjusted vs. generic values. Applying this to a historical generic value
 *  gives an apples-to-apples comparison against a league-adjusted "now"
 *  total — no per-league historical value table exists, so this is the only
 *  way to compare on the same scale without one. */
export function leagueAdjustRatio(currentAdjusted: number, currentGeneric: number): number {
  return currentGeneric > 0 ? currentAdjusted / currentGeneric : 1;
}
