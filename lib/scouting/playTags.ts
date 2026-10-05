// What the charting boards write for the per-play tags (tape-grading
// expansion, Stage 3). The registry is in playEra.ts; this turns it into a
// fresh play's values, which tags apply to the play being charted, the
// columns to write and what still needs a pick.
//
// Write rules (the user's, 2026-10-04):
//   - A NEW play writes every tag column of its position. A tag that applies
//     gets a value (its default if untouched); one that doesn't apply is NULL.
//     The four situation tags apply to every play, so a tagged play always
//     has non-null columns and isTaggedPlay() can tell it apart.
//   - Editing a play charted before the tags writes NO tag column, so its tags
//     stay NULL and it keeps being judged by its own era's rules.
//   - Editing a tagged play rewrites all of them by the same rules.
// Defaults: exception = off, preselected = its preset, sticky = the game's
// last charted value (off in a new game), required = nothing (must be picked).
// Nothing here feeds a grade yet (Stage 4).
import {
  POSITION_TAGS, SITUATION_TAGS,
  type PlayFact, type PlayTagSpec, type TagPosition,
} from "./playEra";

export type TagValue = boolean | string | null;
export type TagValues = Readonly<Record<string, TagValue>>;
export type PlayFacts = Partial<Record<PlayFact, boolean>>;

const SPECS: Readonly<Record<TagPosition, readonly PlayTagSpec[]>> = {
  QB: [...SITUATION_TAGS, ...POSITION_TAGS.QB],
  RB: [...SITUATION_TAGS, ...POSITION_TAGS.RB],
  WR: [...SITUATION_TAGS, ...POSITION_TAGS.WR],
  TE: [...SITUATION_TAGS, ...POSITION_TAGS.TE],
};

/** Every tag of a position, situation tags first. */
export function tagSpecs(position: TagPosition): readonly PlayTagSpec[] {
  return SPECS[position];
}

export function isSituationTag(spec: PlayTagSpec): boolean {
  return SITUATION_TAGS.some((s) => s.column === spec.column);
}

/** An untouched tag's value: NULL only for a required tag (no default exists). */
export function tagDefault(spec: PlayTagSpec): TagValue {
  if (spec.required) return null;
  if (spec.values) return typeof spec.preset === "string" ? spec.preset : null;
  return typeof spec.preset === "boolean" ? spec.preset : false;
}

export function tagApplies(spec: PlayTagSpec, facts: PlayFacts): boolean {
  return spec.appliesTo == null || facts[spec.appliesTo] === true;
}

/** Keeps a value only if it fits the tag (a known value, or a boolean). */
function validValue(spec: PlayTagSpec, v: TagValue | undefined): TagValue {
  if (v == null) return null;
  if (spec.values) return typeof v === "string" && spec.values.includes(v) ? v : null;
  return typeof v === "boolean" ? v : null;
}

/** A fresh play's values, before sticky carry-over. */
export function defaultTagValues(position: TagPosition): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const spec of SPECS[position]) out[spec.column] = tagDefault(spec);
  return out;
}

/**
 * Sticky tags' carried values: the latest value charted in this game. Plays
 * must be in charting order; plays without the tag (charted before tags, or
 * pasted in) are skipped. A game with none starts at the default.
 */
export function carriedStickyValues(
  position: TagPosition,
  gamePlays: readonly object[],
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const spec of SPECS[position]) {
    if (spec.entry !== "sticky") continue;
    let v: TagValue = null;
    for (let i = gamePlays.length - 1; i >= 0 && v == null; i--) {
      v = validValue(spec, (gamePlays[i] as Record<string, TagValue | undefined>)[spec.column]);
    }
    out[spec.column] = v ?? tagDefault(spec);
  }
  return out;
}

/**
 * A tagged play's values for editing: its own, with defaults filling the
 * tags that didn't apply (so they're ready if an edit makes them apply).
 */
export function tagValuesFromPlay(play: object, position: TagPosition): Record<string, TagValue> {
  const row = play as Record<string, TagValue | undefined>;
  const out: Record<string, TagValue> = {};
  for (const spec of SPECS[position]) out[spec.column] = validValue(spec, row[spec.column]) ?? tagDefault(spec);
  return out;
}

/**
 * Every tag column of the position, for a new play's insert or a tagged
 * play's update: the value where the tag applies (its default if unset),
 * NULL where it doesn't. A required tag with no pick stays NULL here, so
 * check missingTags() before writing.
 */
export function tagPayload(
  position: TagPosition,
  values: TagValues,
  facts: PlayFacts,
): Record<string, TagValue> {
  const out: Record<string, TagValue> = {};
  for (const spec of SPECS[position]) {
    out[spec.column] = tagApplies(spec, facts)
      ? validValue(spec, values[spec.column]) ?? tagDefault(spec)
      : null;
  }
  return out;
}

/** Required tags that apply to this play and have no pick yet. */
export function missingTags(
  position: TagPosition,
  values: TagValues,
  facts: PlayFacts,
): PlayTagSpec[] {
  return SPECS[position].filter(
    (spec) => spec.required && tagApplies(spec, facts) && validValue(spec, values[spec.column]) == null,
  );
}

/** The tags to show for this play: the situation row, or the play's own tags. */
export function visibleTags(
  position: TagPosition,
  facts: PlayFacts,
  part: "situation" | "play",
): PlayTagSpec[] {
  return SPECS[position].filter(
    (spec) => isSituationTag(spec) === (part === "situation") && tagApplies(spec, facts),
  );
}

/** The buttons for a picked tag: its values, or true / false for a required boolean. */
export function tagOptions(spec: PlayTagSpec): { value: string | boolean; label: string }[] {
  if (spec.values) return spec.values.map((v, i) => ({ value: v, label: spec.valueLabels?.[i] ?? v }));
  return [
    { value: true,  label: spec.valueLabels?.[0] ?? "Yes" },
    { value: false, label: spec.valueLabels?.[1] ?? "No" },
  ];
}

export interface TagBadge { column: string; text: string; title: string }

/**
 * The play list's badges for a charted play: tags that are on, picks that
 * differ from the preset, and every required pick. Untouched defaults (an
 * on-time release, a sack on the line, a DL block) show nothing.
 */
export function tagBadges(play: object, position: TagPosition): TagBadge[] {
  const row = play as Record<string, TagValue | undefined>;
  const out: TagBadge[] = [];
  for (const spec of SPECS[position]) {
    const v = validValue(spec, row[spec.column]);
    if (v == null) continue;
    if (spec.values) {
      if (!spec.required && v === spec.preset) continue;
      const label = tagOptions(spec).find((o) => o.value === v)?.label ?? String(v);
      out.push({ column: spec.column, text: `${spec.short} ${label}`, title: `${spec.label}: ${label}` });
    } else if (spec.required) {
      const label = tagOptions(spec).find((o) => o.value === v)?.label ?? String(v);
      out.push({ column: spec.column, text: `${spec.short} ${v ? "✓" : "✗"}`, title: `${spec.label}: ${label}` });
    } else if (v === true) {
      out.push({ column: spec.column, text: spec.short, title: spec.label });
    }
  }
  return out;
}
