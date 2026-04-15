// ============================================================
// DynastyZeus — centralized external API URLs and app-wide
// configuration constants.
//
// All external base URLs and TTL values live here so that a
// provider change or timeout tweak is a one-line edit.
// ============================================================

// ── Sleeper ──────────────────────────────────────────────────
export const SLEEPER_BASE_URL = "https://api.sleeper.app/v1";

// ── FantasyCalc ───────────────────────────────────────────────
export const FANTASYCALC_BASE_URL = "https://api.fantasycalc.com";

// ── FantasyPros ───────────────────────────────────────────────
export const FANTASYPROS_BASE_URL = "https://www.fantasypros.com";

// ── numberFire (FanDuel Research GraphQL) ─────────────────────
export const NUMBERFIRE_GQL_URL = "https://fdresearch-api.fanduel.com/graphql";

// ── ESPN ──────────────────────────────────────────────────────
export const ESPN_NFL_NEWS_URL =
  "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news";

// ── Google Sheets (crowdsourced rookie board) ─────────────────
// This URL is a published CSV export — safe to store in code (not a secret).
// If the sheet is re-published or moved, update here only.
export const ROOKIE_BOARD_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?output=csv";

// ── Cache TTLs (milliseconds) ─────────────────────────────────
/** FantasyCalc dynasty values — updated at most once per day */
export const FC_VALUES_TTL_MS = 24 * 60 * 60 * 1000;

/** Cross-league roster lookups — rosters change with trades/waivers */
export const CROSS_LEAGUE_ROSTERS_TTL_MS = 6 * 60 * 60 * 1000;

/** Sleeper weekly stats — completed weeks never change; 7-day TTL is conservative */
export const SLEEPER_STATS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ── Cache TTLs (seconds, for Next.js revalidate) ──────────────
/** Sleeper NFL state — refreshed every hour */
export const NFL_STATE_REVALIDATE_S = 3600;

/** Sleeper player map — refreshed every 24 hours */
export const PLAYERS_REVALIDATE_S = 86400;

/** FantasyPros projections — refreshed every hour */
export const FANTASYPROS_REVALIDATE_S = 3600;

/** Crowdsourced rookie board sheet — refreshed every 6 hours */
export const ROOKIE_BOARD_REVALIDATE_S = 21600;

/** ESPN news — refreshed every 30 seconds (near-realtime) */
export const ESPN_NEWS_REVALIDATE_S = 30;

// ── Beat Writer RSS Feeds ─────────────────────────────────────
/** Pro Football Talk (NBC Sports) — Mike Florio, Charean Williams, Josh Alper */
export const PFT_RSS_URL = "https://www.nbcsports.com/profootballtalk.rss";

/** CBS Sports NFL news feed */
export const CBS_NFL_RSS_URL = "https://www.cbssports.com/rss/headlines/nfl/";

/** Beat writer feeds revalidate every 5 minutes */
export const BEAT_REPORTS_REVALIDATE_S = 300;

// ── Year / season config ──────────────────────────────────────
/** How many past years of payment tracking to include (0 = current year only, auto-advances each Jan 1) */
export const PAYMENT_YEARS_PAST = 0;

/** How many future years of payment tracking to include (ahead of current year) */
export const PAYMENT_YEARS_FUTURE = 3;

/**
 * Returns the full range of payment years shown in ManagementHub.
 * Rolling window: [currentYear - PAST, ..., currentYear + FUTURE]
 * This drives both the UI column generation and the DB upsert payload.
 */
export function getPaymentYears(): number[] {
  const current = new Date().getFullYear();
  const years: number[] = [];
  for (let y = current - PAYMENT_YEARS_PAST; y <= current + PAYMENT_YEARS_FUTURE; y++) {
    years.push(y);
  }
  return years;
}

/**
 * Valid year range for rookie draft compilation.
 * Anchored 10 years back; extends 6 years into the future so it
 * never needs updating as long as the code stays maintained.
 */
export function getCompilationYearRange(): { min: number; max: number } {
  const current = new Date().getFullYear();
  return { min: current - 10, max: current + 6 };
}

// ── Positions ─────────────────────────────────────────────────
/** Skill positions shown in the rookie board and projection tables */
export const SKILL_POSITIONS = ["QB", "RB", "WR", "TE"] as const;

// ── Compile-consensus networking ──────────────────────────────
/** Max parallel league expansions during consensus compilation */
export const COMPILE_CONCURRENCY = 15;

/** Max parallel pick fetches (lower to avoid Sleeper rate limits) */
export const COMPILE_PICKS_CONCURRENCY = 8;

/** Default request timeout for Sleeper API calls (ms) */
export const SLEEPER_REQUEST_TIMEOUT_MS = 15_000;

/** Extended timeout for the ~5 MB Sleeper players payload */
export const SLEEPER_PLAYERS_TIMEOUT_MS = 45_000;
