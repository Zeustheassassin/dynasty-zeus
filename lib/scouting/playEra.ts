// Which rules a charted play is judged by. Two independent questions:
//
//   1. Imported or in-app? Per GAME, by creation time (coverageEra.ts): the
//      2026-04-30 bulk import entered whole games under the old press
//      definition; games created from 2026-05-01 were charted play by play.
//   2. Tagged or not? Per PLAY (migration 062): the per-play tag columns are
//      nullable with no default. NULL = charted before the tags existed; new
//      plays save every tag, defaults included, so any non-null tag column
//      marks a tagged play. Editing an old play leaves its tags NULL.
//
// One prospect can have all three kinds of play, and each is judged by its
// own era's rules: a tag can only ever change how a TAGGED play is judged,
// never an old one (the user won't re-chart old games).
//
// The tag registry below mirrors migration 062's columns and CHECKs. `entry`
// is how the Stage 3 boards will ask for each tag (the user's click budget):
//   exception   — off unless clicked
//   preselected — the common answer is filled in (`preset`)
//   sticky      — keeps the previous play's value within a game
//   conditional — shown only when it applies (`when`)
import type { ScoutingGame } from "../types";
import { coverageEra } from "./coverageEra";

export type TagPosition = "QB" | "RB" | "WR" | "TE";
export type TagEntry = "exception" | "preselected" | "sticky" | "conditional";

export interface PlayTagSpec {
  /** Column name, identical on every play table that carries it. */
  column: string;
  label: string;
  entry: TagEntry;
  /** Allowed values for a text tag; absent = boolean. */
  values?: readonly string[];
  /** The pre-selected answer (entry "preselected" or a conditional one with a default). */
  preset?: string | boolean;
  /** When a conditional tag applies. */
  when?: string;
}

/** On all four play tables. */
export const SITUATION_TAGS: readonly PlayTagSpec[] = [
  { column: "red_zone",          label: "Red zone",                   entry: "sticky" },
  { column: "third_fourth_down", label: "3rd/4th down",               entry: "exception" },
  { column: "short_yardage",     label: "Short yardage / goal line",  entry: "exception" },
  { column: "garbage_time",      label: "Garbage time",               entry: "sticky" },
];

export const POSITION_TAGS: Readonly<Record<TagPosition, readonly PlayTagSpec[]>> = {
  QB: [
    { column: "play_action",          label: "Play action",           entry: "exception" },
    { column: "tight_window",         label: "Tight window",          entry: "exception" },
    { column: "release_timing",       label: "Release",               entry: "preselected", values: ["early", "on_time", "late"], preset: "on_time" },
    { column: "better_option_missed", label: "Better option missed",  entry: "exception" },
    { column: "sack_fault",           label: "Sack fault",            entry: "conditional", values: ["qb", "line", "coverage"], preset: "line", when: "sacks only" },
    { column: "run_success",          label: "Run success",           entry: "conditional", when: "runs and scrambles only" },
    { column: "run_broken_tackle",    label: "Run broken tackle",     entry: "conditional", when: "runs and scrambles only" },
    { column: "run_explosive",        label: "Run explosive",         entry: "conditional", when: "runs and scrambles only" },
  ],
  RB: [
    { column: "hit_behind_line",           label: "Hit behind the line",       entry: "exception" },
    { column: "missed_read",               label: "Missed read",               entry: "exception" },
    { column: "pass_pro_loss",             label: "Pass-pro loss",             entry: "conditional", values: ["wrong_man", "beaten"], when: "pass-pro losses only" },
    { column: "broken_tackle_after_catch", label: "Broken tackle after catch", entry: "conditional", when: "catches only" },
    { column: "caught_from_behind",        label: "Caught from behind",        entry: "conditional", when: "explosive runs only" },
  ],
  WR: [
    { column: "press_release",             label: "Release vs press",          entry: "conditional", values: ["won", "lost"], when: "press snaps only (one required click)" },
    { column: "broken_tackle_after_catch", label: "Broken tackle after catch", entry: "conditional", when: "catches only" },
  ],
  TE: [
    { column: "blocked_defender",     label: "Blocked",               entry: "conditional", values: ["dl", "lb", "db"], preset: "dl", when: "block reps only" },
    { column: "press_release",        label: "Release vs press",      entry: "conditional", values: ["won", "lost"], when: "press snaps only" },
    { column: "chipped_before_route", label: "Chipped before route",  entry: "exception" },
  ],
};

/** Every tag column on a position's play table (situation tags first). */
export function tagColumns(position: TagPosition): readonly string[] {
  return [...SITUATION_TAGS, ...POSITION_TAGS[position]].map((t) => t.column);
}

const COLUMNS: Readonly<Record<TagPosition, readonly string[]>> = {
  QB: tagColumns("QB"),
  RB: tagColumns("RB"),
  WR: tagColumns("WR"),
  TE: tagColumns("TE"),
};

/**
 * True when the play was charted with the per-play tags: any tag column is
 * non-null. A play loaded before migration 062 (columns absent) is untagged.
 */
export function isTaggedPlay(play: object, position: TagPosition): boolean {
  const row = play as Record<string, unknown>;
  return COLUMNS[position].some((c) => row[c] != null);
}

export type GameSource = "imported" | "in_app";
export type PlayEra = GameSource | "tagged";

/** Imported (whole-game import, old press definition) vs in-app, per game. */
export function gameSource(game: Pick<ScoutingGame, "created_at"> | undefined): GameSource {
  return coverageEra(game) === "old" ? "imported" : "in_app";
}

/**
 * One label per play: "tagged" when it carries tags, else its game's source.
 * Coverage rules still follow the game (coverageEra); a tagged play added to
 * an imported game keeps that game's press definition.
 */
export function playEra(
  play: object,
  game: Pick<ScoutingGame, "created_at"> | undefined,
  position: TagPosition,
): PlayEra {
  return isTaggedPlay(play, position) ? "tagged" : gameSource(game);
}

/** Play counts per era for one position's plays (game_id → game lookup). */
export function countPlayEras(
  plays: readonly { game_id: string }[],
  gamesById: ReadonlyMap<string, Pick<ScoutingGame, "created_at">>,
  position: TagPosition,
): Record<PlayEra, number> {
  const out: Record<PlayEra, number> = { imported: 0, in_app: 0, tagged: 0 };
  for (const p of plays) out[playEra(p, gamesById.get(p.game_id), position)]++;
  return out;
}
