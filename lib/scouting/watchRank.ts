// ============================================================
// Watch Rank: which prospects' games to watch first (migration 085,
// prospects.watch_rank + watch_score). Copied by a one-time import from the
// user's "2027 Scouting Board" Google Sheet; the sheet is never read by the
// app. 1 = watch first within the position.
// ============================================================

/** Rank given to prospects with no Watch Rank, so they sort after every ranked one. */
const UNRANKED = 99_999;

/** Numeric sort key for the "Watch" sort: ascending = Watch Rank 1 first,
 *  prospects not on the sheet last. */
export function watchSortValue(p: { watch_rank?: number | null }): number {
  return p.watch_rank ?? UNRANKED;
}

/** The Watch Score as the sheet shows it (one decimal), or "—" when absent. */
export function formatWatchScore(score: number | null | undefined): string {
  return score == null || !Number.isFinite(Number(score)) ? "—" : Number(score).toFixed(1);
}
