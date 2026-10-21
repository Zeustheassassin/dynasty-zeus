// How each route plays against each coverage, beyond what the route and the
// coverage say on their own: WR's route × coverage pattern, lent to TE-SAER
// (aboveExpected.ts). Pure.
//
// Route and coverage effects alone just add, so a nine would be the same
// amount harder than a curl whatever the coverage. The WR charting says routes
// don't work that way: against press a nine is open 48% of the time and a curl
// 66%, where the two effects added up say 38% and 78%. WR's model carries its
// own route × coverage term for this (aggregateMerge.ts). TEs run the same
// routes against the same coverages but have far too few reps to learn it
// (378 rated routes on 2026-10-21, most route × coverage pairs under 20), so
// they borrow the SHAPE from WR's 12,570 routes:
//
//   - WR's model (route + coverage per era + alignment + on the line at λ 3,
//     route × coverage at λ 30), fit on 12,570 routes from 92 WRs, had its
//     route × coverage term centered, each route's row and each coverage's column
//     averaging 0 over WR's own routes. So nothing here says a route or a
//     coverage is harder in general: TE's own route and coverage levels, and
//     its overall level, all still come from TE data alone (the user, 10/21:
//     "TE's are their own data set so the win rates can't be compared to
//     WR's"). Only "this route against this coverage, compared with the rest"
//     carries over.
//   - A pair under 30 WR routes is left at 0 (every double, and press on
//     comebacks, flats, screens, corners and other). Too little to lend.
//
// Held out by TE (leave one TE out, 378 routes), route + coverage with this
// pattern predicted 0.65% better than without it, the biggest gain of anything
// tested for TE-SAER on 2026-10-21. (Lending WR's route levels as well scored
// 2.2% but would judge TEs on WR open rates, which the user ruled out.)
//
// Values are log-odds added to a route's expected odds of being open. A frozen
// copy of the WR model's term (the TE screens don't load WR's route cells):
// refit it from them when WR charting has grown a lot (the method is in
// memory, project_te_ae_data_check_oct19).
export const ROUTE_COVERAGE_PATTERN: Readonly<Record<string, Readonly<Partial<Record<string, number>>>>> = {
  nine:     { man: -0.03, press: 0.39, zone: -0.07 },
  post:     { man: 0.17, press: 0.19, zone: -0.1 },
  dig:      { man: 0.06, press: -0.05, zone: -0.02 },
  curl:     { man: 0.02, press: -0.44, zone: 0.05 },
  slant:    { man: 0.1, press: -0.05, zone: -0.05 },
  screen:   { man: -0.14, zone: 0.06 },
  flat:     { man: -0.2, zone: 0.09 },
  comeback: { man: 0.03, zone: -0.01 },
  out:      { man: -0.07, press: -0.05, zone: 0.04 },
  corner:   { man: -0.04, zone: 0.02 },
  other:    { man: -0.26, zone: 0.14 },
};

/** The pattern's log-odds for a route against a coverage; 0 when either is
 *  missing or the pair isn't in the table. */
export function routeCoverageOffset(route: string | null | undefined, coverage: string | null | undefined): number {
  if (!route || !coverage) return 0;
  return ROUTE_COVERAGE_PATTERN[route]?.[coverage] ?? 0;
}
