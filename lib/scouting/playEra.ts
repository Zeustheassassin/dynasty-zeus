// Which rules a charted play is judged by. Two independent questions:
//
//   1. Imported or in-app? Per GAME, by creation time (coverageEra.ts): the
//      2026-04-30 bulk import entered whole games under the old press
//      definition; games created from 2026-05-01 were charted play by play.
//   2. Tagged or not? Per PLAY (migration 062): the per-play tag columns are
//      nullable with no default. NULL = charted before the tags existed; new
//      plays save every tag, defaults included. The four situation tags apply
//      to every play, so a non-null situation tag marks a tagged play. A
//      position tag set on an old play doesn't: migration 067 turned play
//      action on for every RPO, old ones included, and they stay old plays.
//      Editing an old play leaves its tags NULL.
//
// One prospect can have all three kinds of play, and each is judged by its
// own era's rules: a tag can only ever change how a TAGGED play is judged,
// never an old one (the user won't re-chart old games). The WR board's Paste
// Play-by-Play / Paste Summary imports write no tag columns, so those plays
// stay untagged too.
//
// The tag registry below mirrors migration 062's columns and CHECKs. `entry`
// is how the boards ask for each tag (the user's click budget):
//   exception   — off unless clicked
//   preselected — the common answer is filled in (`preset`)
//   sticky      — keeps the previous play's value within a game
//   conditional — shown only when it applies (`when`)
// `appliesTo` is the play fact a tag needs (an exception tag can be scoped too:
// "hit behind the line" only means something on a carry). A tag that doesn't
// apply to a play is stored NULL. `required` = no default exists, so the
// charter picks one whenever it applies. `forced` = always on when a play fact
// holds (an RPO is always play action, the user's rule 2026-10-06). lib/scouting/playTags.ts turns this
// into what the boards write.
import type { ScoutingGame } from "../types";
import { coverageEra } from "./coverageEra";

export type TagPosition = "QB" | "RB" | "WR" | "TE";
export type TagEntry = "exception" | "preselected" | "sticky" | "conditional";

/** What a board knows about the play being charted, as far as the tags care. */
export type PlayFact =
  | "dropback"      // QB: a pass or RPO snap
  | "rpo"           // QB: an RPO snap
  | "throw"         // QB: the ball was thrown (not a sack, scramble or throwaway)
  | "sack"          // QB: sacked
  | "run"           // QB: designed run or scramble; RB: a designed carry
  | "explosiveRun"  // RB: a carry marked Explosive Play
  | "passProLoss"   // RB: a pass-block rep marked Fail
  | "catch"         // RB / WR: targeted and caught
  | "route"         // TE: a route rep
  | "press"         // WR / TE: a route against press
  | "block";        // TE: a run- or pass-block rep

export interface PlayTagSpec {
  /** Column name, identical on every play table that carries it. */
  column: string;
  label: string;
  /** Play-list badge text. */
  short: string;
  entry: TagEntry;
  /** Allowed values for a text tag; absent = boolean. */
  values?: readonly string[];
  /** Button labels: one per `values` entry, or [true, false] for a required boolean. */
  valueLabels?: readonly string[];
  /** The pre-selected answer (entry "preselected" or a conditional one with a default). */
  preset?: string | boolean;
  /** The play fact it needs; absent = every play. */
  appliesTo?: PlayFact;
  /** No default: must be picked whenever it applies. */
  required?: boolean;
  /** When a conditional tag applies. */
  when?: string;
  /** Always on when this play fact holds: written true, the button locked on. */
  forced?: { by: PlayFact; note: string };
}

/** On all four play tables. */
export const SITUATION_TAGS: readonly PlayTagSpec[] = [
  { column: "red_zone",          label: "Red zone",                   short: "RZ",   entry: "sticky" },
  { column: "third_fourth_down", label: "3rd/4th down",               short: "3/4D", entry: "exception" },
  { column: "short_yardage",     label: "Short yardage / goal line",  short: "SY",   entry: "exception" },
  { column: "garbage_time",      label: "Garbage time",               short: "GT",   entry: "sticky" },
];

export const POSITION_TAGS: Readonly<Record<TagPosition, readonly PlayTagSpec[]>> = {
  QB: [
    { column: "play_action",          label: "Play action",           short: "PA",        entry: "exception", appliesTo: "dropback", forced: { by: "rpo", note: "always on for an RPO" } },
    { column: "tight_window",         label: "Tight window",          short: "TW",        entry: "exception", appliesTo: "throw" },
    { column: "release_timing",       label: "Release",               short: "Rel",       entry: "preselected", values: ["early", "on_time", "late"], valueLabels: ["Early", "On time", "Late"], preset: "on_time", appliesTo: "throw" },
    { column: "better_option_missed", label: "Better option missed",  short: "BetterOpt", entry: "exception", appliesTo: "dropback" },
    { column: "sack_fault",           label: "Sack fault",            short: "Sack",      entry: "conditional", values: ["qb", "line", "coverage"], valueLabels: ["QB", "Line", "Coverage"], preset: "line", appliesTo: "sack", when: "sacks only" },
    { column: "run_success",          label: "Run result",            short: "Run",       entry: "conditional", valueLabels: ["Success", "Fail"], required: true, appliesTo: "run", when: "runs and scrambles only" },
    { column: "run_broken_tackle",    label: "Broken tackle",         short: "BT",        entry: "conditional", appliesTo: "run", when: "runs and scrambles only" },
    { column: "run_explosive",        label: "Explosive",             short: "Exp",       entry: "conditional", appliesTo: "run", when: "runs and scrambles only" },
  ],
  RB: [
    { column: "hit_behind_line",           label: "Hit behind the line",       short: "HBL", entry: "exception", appliesTo: "run" },
    { column: "missed_read",               label: "Missed read",               short: "MR",  entry: "exception", appliesTo: "run" },
    { column: "pass_pro_loss",             label: "Pass-pro loss",             short: "PP",  entry: "conditional", values: ["wrong_man", "beaten"], valueLabels: ["Wrong man", "Beaten"], required: true, appliesTo: "passProLoss", when: "pass-pro losses only" },
    { column: "broken_tackle_after_catch", label: "Broken tackle after catch", short: "BT",  entry: "conditional", appliesTo: "catch", when: "catches only" },
    { column: "caught_from_behind",        label: "Caught from behind",        short: "CFB", entry: "conditional", appliesTo: "explosiveRun", when: "explosive runs only" },
  ],
  WR: [
    { column: "press_release",             label: "Release vs press",          short: "Press", entry: "conditional", values: ["won", "lost"], valueLabels: ["Won", "Lost"], required: true, appliesTo: "press", when: "press snaps only (one required click)" },
    { column: "broken_tackle_after_catch", label: "Broken tackle after catch", short: "BT",    entry: "conditional", appliesTo: "catch", when: "catches only" },
  ],
  TE: [
    { column: "blocked_defender",     label: "Blocked",               short: "Blk",   entry: "conditional", values: ["dl", "lb", "db"], valueLabels: ["DL", "LB", "DB"], preset: "dl", appliesTo: "block", when: "block reps only" },
    { column: "press_release",        label: "Release vs press",      short: "Press", entry: "conditional", values: ["won", "lost"], valueLabels: ["Won", "Lost"], required: true, appliesTo: "press", when: "press snaps only" },
    { column: "chipped_before_route", label: "Chipped before route",  short: "Chip",  entry: "exception", appliesTo: "route" },
  ],
};

/** Every tag column on a position's play table (situation tags first). */
export function tagColumns(position: TagPosition): readonly string[] {
  return [...SITUATION_TAGS, ...POSITION_TAGS[position]].map((t) => t.column);
}

const SITUATION_COLUMNS: readonly string[] = SITUATION_TAGS.map((t) => t.column);

/**
 * True when the play was charted with the per-play tags: a situation tag is
 * non-null (every tagged play writes all four). A position tag alone doesn't
 * count, so a backfilled one (play action on old RPOs, migration 067) leaves
 * an old play old. A play loaded before migration 062 (columns absent) is
 * untagged. The position is kept for callers; every table has the same four.
 */
export function isTaggedPlay(play: object, _position: TagPosition): boolean {
  const row = play as Record<string, unknown>;
  return SITUATION_COLUMNS.some((c) => row[c] != null);
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
