# Season / year handling

DynastyZeus juggles **two related-but-distinct "year" concepts**. Mixing them up
causes off-by-one bugs at the calendar→season boundary (Jan–Feb) and at the
post-draft rollover. Single source of truth: [`lib/helpers/season.ts`](lib/helpers/season.ts).

## The two concepts

| Concept | Value | Rolls over | Used for |
|---|---|---|---|
| **Calendar year** (`BASE_YEAR`) | `new Date().getFullYear()` | **Jan 1** | Rookie-draft **class** year, class/film dropdowns, draft-history buckets — all forward-looking "upcoming class" or historical-by-calendar things. |
| **NFL season year** (`CURRENT_YEAR` / `getSeasonYear`) | see below | **~March** (new league year) | League lookups, pick-year windows, trade-finder pick classification. |

The NFL season year does **not** advance on Jan 1: January and February still
belong to the just-completed season (Super Bowl + the offseason run-up). So from
Jan 1 until the new league year (~March), calendar year is already `N+1` while the
season year is still `N`.

## The API (`lib/helpers/season.ts`)

- `BASE_YEAR` — raw calendar year (`getFullYear()`). Anchors `ROOKIE_YEAR`,
  `CLASS_YEARS`, `FILM_YEARS`.
- `calendarSeasonYear(d = new Date())` — the NFL season year for a date: Jan/Feb
  (`getMonth() <= 1`) count as the **prior** season (`y - 1`), else `y`. Exported so
  it can be unit-tested with injected dates ([`__tests__/lib/helpers/season.test.ts`](__tests__/lib/helpers/season.test.ts)).
- `CURRENT_YEAR` — `String(calendarSeasonYear())`. The season year as a string.
- `getSeasonYear(nflState?)` — **prefer this** wherever Sleeper's live
  `/state/nfl` is available. Returns `nflState.season` when it's a 4-digit string
  (authoritative at the exact rollover edge), else falls back to `CURRENT_YEAR`.
- `YEARS` — 3-year season-year window `[CURRENT_YEAR, +1, +2]`.

## Rules of thumb

- **Pick years / league data / trade-finder pick classification** → season year.
  Use `getSeasonYear(nflState)` if you have `nflState`, otherwise `CURRENT_YEAR`.
  (e.g. `components/tradeHub/finderPipeline.ts`, `TradeFinder.tsx`.)
- **Rookie class / film / draft-class dropdowns** → calendar year (`BASE_YEAR`,
  `CLASS_YEARS`, `FILM_YEARS`). In Jan/Feb you want the *upcoming* calendar class,
  not the just-ended season.
- **Draft *history* compilation** (Draft Hub → Consensus) → raw calendar year
  (`new Date().getFullYear()`), because historical drafts are filed by the calendar
  year they occurred. These sites are annotated in
  `components/draftHub/DraftHistory/*`.
- **Billing / payment years** (`lib/constants.ts` `getPaymentYears`) → calendar year
  by design (dues are tracked per calendar year).

## Why this matters (history)

Audit batch **B7a** decoupled these after they had drifted together: `CURRENT_YEAR`
was switched to the season-year definition (March rollover), while the rookie/class
aliases were explicitly repointed back to `String(BASE_YEAR)` so the upcoming class
still shows in Jan/Feb. `getSeasonYear(nflState)` was added so the live Sleeper
state pins the value exactly at the rollover edge. When adding a new year-sensitive
feature, decide **which concept** you need and pull from the right place above.
