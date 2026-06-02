// ============================================================
// Season / year / round constants.
// Single source of truth for the current NFL season year and
// the rolling pick-round list used across draft-related views.
// ============================================================

/** Current calendar year as a number (e.g. 2026). */
export const BASE_YEAR = new Date().getFullYear();

/** The current NFL season year as a string (e.g. "2026") */
export const CURRENT_YEAR = String(BASE_YEAR);

/** Three-year window starting from the current year (e.g. ["2026","2027","2028"]) */
export const YEARS = Array.from({ length: 3 }, (_, i) => String(BASE_YEAR + i));

/** Standard four-round rookie draft round list. The board trims this to
 *  the league's actual round count at render time via draftSettings. */
export const ROUNDS = [1, 2, 3, 4];

/** Max rounds a draft can have to still count as a rookie (not startup) draft.
 *  Single source of truth — Draft Scout, Draft History, and the consensus
 *  compiler MUST all use this so a legal 6-round rookie draft is treated
 *  consistently everywhere (previously Draft Scout used 5 and silently
 *  dropped 6-round rookie drafts that History/Consensus accepted). */
export const ROOKIE_DRAFT_MAX_ROUNDS = 6;

/** Forward window for the Add-Prospect draft-class-year dropdown.
 *  [BASE_YEAR, BASE_YEAR+1, BASE_YEAR+2, BASE_YEAR+3] — current class plus
 *  the next three so scouts can stash early notes on future classes. */
export const CLASS_YEARS: number[] = Array.from({ length: 4 }, (_, i) => BASE_YEAR + i);

/** Trailing window for charting-board NFL film year selectors.
 *  [BASE_YEAR-3, BASE_YEAR-2, BASE_YEAR-1, BASE_YEAR] — you can chart
 *  current-year tape and recent prior seasons. Older film stays viewable
 *  on existing records because the year is stored on the row. */
export const FILM_YEARS: number[] = Array.from({ length: 4 }, (_, i) => BASE_YEAR - 3 + i);

/** Return a class-year option list that includes `existing` if it falls
 *  outside the standard forward window. Used by edit forms so a record
 *  saved with an out-of-window year (e.g. opening a 2025 prospect in 2032)
 *  still shows its original year as a selectable option. */
export function classYearOptionsWith(existing: number | null | undefined): number[] {
  if (existing == null || CLASS_YEARS.includes(existing)) return CLASS_YEARS;
  return [existing, ...CLASS_YEARS].sort((a, b) => a - b);
}

/** Same idea for the film-year (NFL season) dropdown. */
export function filmYearOptionsWith(existing: number | null | undefined): number[] {
  if (existing == null || FILM_YEARS.includes(existing)) return FILM_YEARS;
  return [existing, ...FILM_YEARS].sort((a, b) => a - b);
}
