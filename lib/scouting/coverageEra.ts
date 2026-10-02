// Which definition of PRESS coverage a game was charted under. The user
// redefined press right after the 2026-04-30 bulk import of older charting
// (confirmed 2026-10-01), so many reps charted "man" before then would be
// "press" now. Man without them is an easier look: on real data a curl was
// expected open 75.8% vs man under the old definition and 82.3% under the
// new one. Imported players can't be re-charted, so the WR model judges each
// rep's coverage against reps charted under the same definition
// (aggregateMerge.ts).
//
// A game's era comes from when it was created: the import finished
// 2026-04-30 20:07 UTC and in-app charting started 2026-05-01 14:09 UTC. Era
// is per game (the per-game route cells carry no play times); one play added
// to an imported game afterwards counts as old.
import type { ScoutingGame } from "../types";

export type CoverageEra = "old" | "new";
export const COVERAGE_ERAS: readonly CoverageEra[] = ["old", "new"];
export const PRESS_REDEFINED_AT = Date.parse("2026-05-01T00:00:00Z");

/** A game with no creation time counts as the current definition. */
export function coverageEra(game: Pick<ScoutingGame, "created_at"> | undefined): CoverageEra {
  const t = game?.created_at ? Date.parse(game.created_at) : NaN;
  return t < PRESS_REDEFINED_AT ? "old" : "new";
}

/** Game id → its coverage era. */
export function coverageEras(games: readonly Pick<ScoutingGame, "id" | "created_at">[]): Map<string, CoverageEra> {
  return new Map(games.map((g) => [g.id, coverageEra(g)]));
}
