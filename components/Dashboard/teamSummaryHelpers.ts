/** Best playoff odds first; an entry with no known odds yet sorts last. Array#sort is stable,
 *  so ties (most commonly two "no data" entries) keep their original relative order. */
export function sortByPlayoffOdds<T>(rows: { entry: T; playoffOdds: number | undefined }[]): T[] {
  return [...rows]
    .sort((a, b) => {
      if (a.playoffOdds == null && b.playoffOdds == null) return 0;
      if (a.playoffOdds == null) return 1;
      if (b.playoffOdds == null) return -1;
      return b.playoffOdds - a.playoffOdds;
    })
    .map((r) => r.entry);
}
