// ============================================================
// Count in sample — which of a player's games count toward HIS numbers.
// Client-safe, pure.
// ============================================================
// Stage 3 of the 2026-11-26 scouting plan (the user approved answer 10): an
// imported game (created before 2026-05-01, the bulk import charted under the
// old press definition, coverageEra.ts) can be set aside from the player's own
// sample once he has half a sample charted in the app. The switch is
// scouting_games.count_in_sample (migration 107; before it every game counts,
// and nothing can be switched).
//
// The rule, everywhere: anything that groups plays BY PLAYER (his sample
// count, his stats, his AE metrics and AE Score, role buckets, tag stats,
// charted components, the Analysis / Compare rows, the Big Board's charted
// columns, the board's Breakdown, the radars and the pools they rank against,
// the opponent / context effects measured from players' samples) reads his
// sample games only: `sampleGameToProspect`, `inSample`, `sampleGames`.
// Anything fit straight from the plays (the difficulty models, their tag
// corrections, league rates) keeps every game: those never go through a
// player's games. So do the tape-work counts (games logged, charted games,
// tape in hand, the hub header's snaps), the per-game views and badges, PFF's
// numbers (PFF's grades, not the user's charting) and season weighting.
//
// The per-player SQL views (prospect_route_stats, prospect_rb/qb/te_stats,
// prospect_sample_counts) skip set-aside games themselves (migration 107), so
// what they return already agrees with this.

import type { ScoutingGame } from "../types";
import { coverageEra } from "./coverageEra";
import { halfSamplePlays } from "./sampleTiers";

export type SamplePos = "QB" | "RB" | "WR" | "TE";

/** What the sample counts at each position (the Big Board dot's plays). */
export const SAMPLE_UNIT: Record<SamplePos, string> = { QB: "graded throws", RB: "runs", WR: "routes", TE: "rated routes" };

/** An imported game: created before 2026-05-01 (coverageEra "old"). Only these can be set aside. */
export function isImportedGame(g: Pick<ScoutingGame, "created_at">): boolean {
  return coverageEra(g) === "old";
}

/** His plays in this game count toward his sample: every game unless switched off. */
export function countsInSample(g: Pick<ScoutingGame, "count_in_sample">): boolean {
  return g.count_in_sample !== false;
}

/** Ids of the set-aside games. */
export function setAsideGameIds(games: readonly Pick<ScoutingGame, "id" | "count_in_sample">[]): Set<string> {
  const out = new Set<string>();
  for (const g of games) if (!countsInSample(g)) out.add(g.id);
  return out;
}

/** The games in his sample (all of them when none is set aside). */
export function sampleGames<G extends Pick<ScoutingGame, "count_in_sample">>(games: readonly G[]): G[] {
  return games.every(countsInSample) ? [...games] : games.filter(countsInSample);
}

/** Game id → player id, over the games in each player's sample. */
export function sampleGameToProspect(
  games: readonly Pick<ScoutingGame, "id" | "prospect_id" | "count_in_sample">[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of games) if (countsInSample(g)) m.set(g.id, g.prospect_id);
  return m;
}

/** Per-game rows or plays from games in the sample. The same array back when
 *  nothing is set aside (callers read it, never write to it). */
export function inSample<T extends { game_id: string }>(rows: readonly T[], setAside: ReadonlySet<string>): T[] {
  return setAside.size === 0 ? (rows as T[]) : rows.filter((r) => !setAside.has(r.game_id));
}

/** Each player's sample games: his logged games minus the set-aside ones. */
export function sampleGameCounts(games: readonly Pick<ScoutingGame, "prospect_id" | "count_in_sample">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const g of games) if (countsInSample(g)) m.set(g.prospect_id, (m.get(g.prospect_id) ?? 0) + 1);
  return m;
}

/** Migration 107 is in: the loaded games carry the column. Null when no game has loaded. */
export function countInSampleReady(games: readonly Pick<ScoutingGame, "count_in_sample">[]): boolean | null {
  if (games.length === 0) return null;
  return typeof games[0].count_in_sample === "boolean";
}

/** One player's "Count in sample" switch, from his games and plays. */
export interface SampleSwitch {
  pos: SamplePos;
  /** His imported games, and his sample plays in them. */
  importedGames: number;
  importedPlays: number;
  /** Sample plays in his in-app games (created from 2026-05-01). */
  inAppPlays: number;
  /** The in-app floor: half a sample (QB 90, RB 50, WR 80, TE 70). */
  half: number;
  /** He has half a sample in the app, so his imported games' switches show. */
  open: boolean;
  /** Imported games set aside, and the sample plays they hold. */
  setAsideGames: number;
  setAsidePlays: number;
  /** Sample plays per game, every game of his. */
  playsByGame: Map<string, number>;
}

/**
 * The switch's state. `isSamplePlay` is the position's sample count (the Big
 * Board dot's): QB isQBGradedThrow, RB isKnownRun, WR a route run, TE
 * isRatedTERoute (aboveExpected.ts).
 */
export function sampleSwitchFor<P extends { game_id: string }>(
  pos: SamplePos,
  games: readonly Pick<ScoutingGame, "id" | "created_at" | "count_in_sample">[],
  plays: readonly P[],
  isSamplePlay: (pl: P) => boolean,
): SampleSwitch {
  const playsByGame = new Map<string, number>();
  for (const pl of plays) if (isSamplePlay(pl)) playsByGame.set(pl.game_id, (playsByGame.get(pl.game_id) ?? 0) + 1);
  let importedGames = 0, importedPlays = 0, inAppPlays = 0, setAsideGames = 0, setAsidePlays = 0;
  for (const g of games) {
    const n = playsByGame.get(g.id) ?? 0;
    if (!isImportedGame(g)) { inAppPlays += n; continue; }
    importedGames++; importedPlays += n;
    if (!countsInSample(g)) { setAsideGames++; setAsidePlays += n; }
  }
  const half = halfSamplePlays(pos);
  return { pos, importedGames, importedPlays, inAppPlays, half, open: inAppPlays >= half, setAsideGames, setAsidePlays, playsByGame };
}

/**
 * A game shows its switch when it's imported and either he has half a sample
 * in the app or it's already set aside: a game switched off stays off (the
 * user's call) and can always be switched back on, even if deleted in-app
 * plays have since taken him under the floor.
 */
export function showsSampleSwitch(g: Pick<ScoutingGame, "created_at" | "count_in_sample">, sw: Pick<SampleSwitch, "open">): boolean {
  return isImportedGame(g) && (sw.open || !countsInSample(g));
}
