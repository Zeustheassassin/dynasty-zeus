// ============================================================
// Season / year / round constants.
// Single source of truth for the current NFL season year and
// the rolling pick-round list used across draft-related views.
// ============================================================

const BASE_YEAR = new Date().getFullYear();

/** The current NFL season year as a string (e.g. "2026") */
export const CURRENT_YEAR = String(BASE_YEAR);

/** Three-year window starting from the current year (e.g. ["2026","2027","2028"]) */
export const YEARS = Array.from({ length: 3 }, (_, i) => String(BASE_YEAR + i));

/** Standard four-round rookie draft round list. The board trims this to
 *  the league's actual round count at render time via draftSettings. */
export const ROUNDS = [1, 2, 3, 4];
