// ============================================================
// Paginated Supabase row fetch for scouting play tables.
// ============================================================
// PostgREST caps a single select at 1000 rows. The charting boards load
// per-game plays and (for QB) league-wide baselines that can exceed that, so a
// plain `.select('*').in(...)` silently truncates at 1000. This helper loops
// .range() until a short page is returned. The WR board already did this inline;
// QB/RB/TE now share this implementation instead of each re-truncating.

const PAGE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Runs `buildPage(from, to)` repeatedly, accumulating every row across pages
 * until a page returns fewer than PAGE rows. Throws on the first query error so
 * the caller can surface it (rather than silently returning a partial set).
 */
export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  // Bounded by data size; each iteration advances by PAGE.
  for (;;) {
    const { data, error } = await buildPage(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (data && data.length) all.push(...data);
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}
