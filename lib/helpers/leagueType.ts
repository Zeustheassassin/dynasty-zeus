// ============================================================
// Sleeper dynasty-league classification — the one criterion used everywhere
// in the app to decide whether a league counts as dynasty (taxi squad or a
// 20+ man roster, and not best-ball). Was hand-duplicated byte-for-byte in
// 7 places (hooks/useSleeperUser.ts, hooks/useSpyState.ts,
// hooks/useUserTrades.ts, hooks/useCrossLeagueMateIntel.ts,
// app/api/cron/league-transactions/route.ts,
// app/api/cron/simulation-history/route.ts, app/api/compile-consensus/route.ts)
// before being collapsed here (Sept 22 code-review, reuse finding).
// ============================================================

/** Structural subset of SleeperLeague this predicate actually reads — lets
 *  server routes with their own minimal local league types (e.g.
 *  app/api/compile-consensus/route.ts's SleeperLeagueBasic) use this without
 *  depending on the full client-facing SleeperLeague type. */
export interface DynastyLeagueShape {
  settings?: { taxi_slots?: number; best_ball?: number };
  roster_positions?: string[];
}

export function isDynastyLeague(l: DynastyLeagueShape): boolean {
  return (
    ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
    (l.settings?.best_ball ?? 0) === 0
  );
}
