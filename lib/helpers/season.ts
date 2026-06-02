// ============================================================
// Season / year / round constants.
// Single source of truth for two RELATED-BUT-DISTINCT year concepts:
//   • BASE_YEAR  — the raw CALENDAR year (rolls over Jan 1). Anchors the
//     rookie-draft class year (ROOKIE_YEAR) and the class-/film-year
//     dropdowns, which are forward-looking (the upcoming draft class), so
//     they track the calendar — NOT the NFL season.
//   • CURRENT_YEAR / YEARS — the NFL SEASON year. Unlike the calendar, the
//     NFL season year does NOT advance on Jan 1: January and February still
//     belong to the just-ended season (Super Bowl + the offseason run-up to
//     the new league year in ~March). Drives league lookups, pick-year
//     windows, and trade-finder pick classification. Where Sleeper's live
//     /state/nfl is available, prefer getSeasonYear(nflState) for the
//     authoritative value at the exact rollover edge.
// ============================================================

/** Current CALENDAR year as a number (e.g. 2026). Rolls over Jan 1. */
export const BASE_YEAR = new Date().getFullYear();

/** The NFL season year for a given date. Jan/Feb count as the PRIOR season
 *  year (the just-completed season), so the value rolls over in ~March rather
 *  than on Jan 1. Exported so it can be unit-tested with injected dates. */
export function calendarSeasonYear(d = new Date()): number {
  const y = d.getFullYear();
  // getMonth() is 0-indexed: Jan(0)/Feb(1) belong to the previous NFL season.
  return d.getMonth() <= 1 ? y - 1 : y;
}

/** The current NFL season year as a string (e.g. "2026"). See module header. */
export const CURRENT_YEAR = String(calendarSeasonYear());

/** Prefer Sleeper's authoritative season from /state/nfl when present; fall
 *  back to the calendar-derived CURRENT_YEAR (correct except possibly at the
 *  exact season-rollover edge, which only the live nflState can pin down). */
export function getSeasonYear(
  nflState?: { season?: string | null } | null,
): string {
  const s = nflState?.season;
  return s && /^\d{4}$/.test(String(s)) ? String(s) : CURRENT_YEAR;
}

/** Three-year NFL-season-year window starting from the current season year
 *  (e.g. ["2026","2027","2028"]). */
export const YEARS = Array.from({ length: 3 }, (_, i) => String(Number(CURRENT_YEAR) + i));

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
