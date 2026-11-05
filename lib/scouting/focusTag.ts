// ============================================================
// Focus Tag: which prospects are worth charting first (migration 084,
// prospects.focus_tag). First filled by a one-time import from the user's
// "2027 Scouting Board" Google Sheet (2026-11-05); edited on the Roster tab
// after that. The sheet is never read by the app.
//
// Separate from ChartingDecision (charting progress), so the two never
// overwrite each other.
// ============================================================

import { STATUS_CLASSES } from "../uiTheme";
import type { FocusTag } from "../types";

export interface FocusTagDef {
  value: FocusTag;
  /** The sheet's wording, used in the Roster dropdown and tooltips. */
  label: string;
  /** Short chip text for the prospect lists. */
  chip: string;
  /** Tailwind classes for the chip (border + background + text). */
  classes: string;
}

/** In priority order: Focus now first, Off 2027 board last. */
export const FOCUS_TAGS: readonly FocusTagDef[] = [
  { value: "focus_now",    label: "Focus now",      chip: "Focus",     classes: STATUS_CLASSES.good },
  { value: "monitor",      label: "Monitor",        chip: "Monitor",   classes: "border-sky-800 bg-sky-950/40 text-sky-300" },
  { value: "low_priority", label: "Low priority",   chip: "Low",       classes: "border-slate-700 bg-slate-800/40 text-slate-400" },
  { value: "off_board",    label: "Off 2027 board", chip: "Off board", classes: "border-slate-800 bg-transparent text-slate-500" },
];

const BY_VALUE = new Map(FOCUS_TAGS.map((d, i) => [d.value, { def: d, order: i }]));

/** The tag's definition, or null for untagged / an unknown value. */
export function focusTagDef(tag: string | null | undefined): FocusTagDef | null {
  return (tag ? BY_VALUE.get(tag as FocusTag)?.def : undefined) ?? null;
}

/** Narrow a stored or selected string to a FocusTag; anything else is untagged (null). */
export function parseFocusTag(v: string | null | undefined): FocusTag | null {
  return focusTagDef(v)?.value ?? null;
}

/** 0 = Focus now … 3 = Off 2027 board; untagged sorts after every tag. */
export function focusTagOrder(tag: string | null | undefined): number {
  return (tag ? BY_VALUE.get(tag as FocusTag)?.order : undefined) ?? FOCUS_TAGS.length;
}

/** Numeric sort key for the lists' "Focus" sort: priority first, then the
 *  user's position rank (unranked last) within each tag. Ascending = Focus now
 *  first. Ranks are small integers, so one number holds both. */
export function focusSortValue(p: { focus_tag?: string | null; personal_rank: number | null }): number {
  return focusTagOrder(p.focus_tag) * 100_000 + (p.personal_rank ?? 99_999);
}
