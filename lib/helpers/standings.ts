/**
 * Display ordering for the league standings table.
 *
 * The playoff race and the race below it are answering different questions, so
 * they are not ranked the same way:
 *
 *   - **At or above the playoff cut line** — record first, then points for.
 *     This is the actual seeding: it is what decides who makes the playoffs.
 *   - **Below the cut line** — **max PF, highest first.** Once a team is
 *     eliminated its record has stopped meaning anything, and points for
 *     punishes a team that kept losing with points on its bench. Max PF ranks
 *     the eliminated teams by the roster they actually had, not by how well
 *     they set their lineup, which is the more useful read on who is closest to
 *     being good.
 *
 * Nothing here changes the *source* ordering. The `standings` array that
 * useAppState / useSpyState build (wins desc, then fpts desc) also feeds the
 * season simulator, which seeds playoffs from it — this is a display transform
 * applied at the table, deliberately, so the two can't drift.
 */

/** Only the fields the ordering reads — callers pass their full standings row. */
export interface StandingsOrderRow {
  max_pf: number;
}

/**
 * Re-order `standings` for display: the top `playoffTeams` keep their seeding,
 * everyone below is sorted by max PF descending.
 *
 * @param standings    Already sorted by the real seeding rule (wins, then fpts).
 * @param playoffTeams How many teams make the playoffs — the cut line index.
 * @returns A new array; the input is not mutated.
 */
export function orderStandingsForDisplay<T extends StandingsOrderRow>(
  standings: readonly T[],
  playoffTeams: number,
): T[] {
  // A cut line past the end (or a nonsensical one) leaves the table untouched
  // rather than reordering the whole league.
  const cut = Math.max(0, Math.floor(playoffTeams));
  if (cut >= standings.length) return [...standings];

  const seeded = standings.slice(0, cut);
  // Array.prototype.sort is stable (ES2019+), so teams tied on max PF keep the
  // order they arrived in — i.e. they fall back to the real seeding rule.
  const eliminated = standings.slice(cut).sort((a, b) => b.max_pf - a.max_pf);
  return [...seeded, ...eliminated];
}
