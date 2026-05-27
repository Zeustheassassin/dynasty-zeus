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

// ── Sleeper proxy revalidate windows (seconds) ────────────────
// Server-side Next.js Data Cache TTLs for `/api/sleeper/*` routes.
// Client-side TTLs (used with cachedFetch) live in lib/sleeperApi.ts
// alongside the call sites in Stage M3.
/** username → user_id mapping rarely changes */
export const SLEEPER_USER_REVALIDATE_S = 3600;
/** league list updates at draft / season change */
export const SLEEPER_USER_LEAGUES_REVALIDATE_S = 1800;
/** rosters change on trades / waivers — 10m balances freshness vs Sleeper load */
export const SLEEPER_LEAGUE_ROSTERS_REVALIDATE_S = 600;
/** matchups update live during games — keep short for in-game freshness */
export const SLEEPER_LEAGUE_MATCHUPS_REVALIDATE_S = 300;
/** transactions for a given week — 15m is fine in offseason; consider lowering during regular-season game days */
export const SLEEPER_LEAGUE_TRANSACTIONS_REVALIDATE_S = 900;
/** traded picks (past + future) */
export const SLEEPER_LEAGUE_TRADED_PICKS_REVALIDATE_S = 1800;
/** drafts associated with a league */
export const SLEEPER_LEAGUE_DRAFTS_REVALIDATE_S = 3600;
/** picks made in a draft — live drafts bypass cache client-side */
export const SLEEPER_DRAFT_PICKS_REVALIDATE_S = 60;
/** league users (display names) — rarely change */
export const SLEEPER_LEAGUE_USERS_REVALIDATE_S = 1800;
/** single-league info (settings, previous_league_id) — only changes at season rollover */
export const SLEEPER_LEAGUE_INFO_REVALIDATE_S = 3600;

/** FantasyPros projections — refreshed every hour */
export const FANTASYPROS_REVALIDATE_S = 3600;

/** Crowdsourced rookie board sheet — refreshed every 6 hours */
export const ROOKIE_BOARD_REVALIDATE_S = 21600;

// ── Year / season config ──────────────────────────────────────
/** How many past years of payment tracking to include (0 = current year only, auto-advances each Jan 1) */
export const PAYMENT_YEARS_PAST = 0;

/** How many future years of payment tracking to include (ahead of current year) */
export const PAYMENT_YEARS_FUTURE = 3;

/**
 * Highest `paid_<year>` column currently provisioned in the database.
 * Migration 002 added paid_2030 – paid_2033 on top of paid_2026 – paid_2029
 * from migration 001/006.
 *
 * MIGRATION 003 REMINDER — when `currentYear + PAYMENT_YEARS_FUTURE` exceeds
 * this value, you must run a new migration adding paid_<next>..paid_<next+3>
 * (mirror migration 002, bump the years) AND bump this constant. The app
 * logs a console.warn whenever the window touches or passes the ceiling.
 *
 * Current ceiling: 2033 → safe through calendar year 2030. Run migration
 * 003 before Jan 1 2031.
 */
export const MAX_PROVISIONED_PAYMENT_YEAR = 2033;

let _paymentCeilingWarned = false;

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
  const highestNeeded = current + PAYMENT_YEARS_FUTURE;
  if (highestNeeded >= MAX_PROVISIONED_PAYMENT_YEAR && !_paymentCeilingWarned) {
    _paymentCeilingWarned = true;
    const overflow = highestNeeded > MAX_PROVISIONED_PAYMENT_YEAR;
    // eslint-disable-next-line no-console
    console.warn(
      `[dynastyzeus] Payment-year window reached the provisioned ceiling.\n` +
      `  highest column the app will write to: paid_${highestNeeded}\n` +
      `  highest column provisioned in DB:     paid_${MAX_PROVISIONED_PAYMENT_YEAR}\n` +
      (overflow
        ? `  STATUS: OVERFLOW — writes to paid_${highestNeeded} will fail. Run migration 003 NOW.\n`
        : `  STATUS: At ceiling — run migration 003 before Jan 1 ${current + 1} to add paid_${MAX_PROVISIONED_PAYMENT_YEAR + 1}..paid_${MAX_PROVISIONED_PAYMENT_YEAR + 4}.\n`) +
      `  See supabase/migrations/002_extended_years_and_cleanup.sql and bump MAX_PROVISIONED_PAYMENT_YEAR in lib/constants.ts.`
    );
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
