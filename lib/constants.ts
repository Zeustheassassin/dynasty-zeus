// ============================================================
// DynastyZeus — centralized external API URLs and app-wide
// configuration constants.
//
// All external base URLs and TTL values live here so that a
// provider change or timeout tweak is a one-line edit.
// ============================================================

// ── Sleeper ──────────────────────────────────────────────────
export const SLEEPER_BASE_URL = "https://api.sleeper.app/v1";

/** Sleeper projections (ADP / weekly) live at the host root, NOT under /v1. */
export const SLEEPER_PROJECTIONS_BASE = "https://api.sleeper.app/projections/nfl";

// ── FantasyCalc ───────────────────────────────────────────────
export const FANTASYCALC_BASE_URL = "https://api.fantasycalc.com";

// ── FantasyPros ───────────────────────────────────────────────
export const FANTASYPROS_BASE_URL = "https://www.fantasypros.com";

// ── numberFire (FanDuel Research GraphQL) ─────────────────────
export const NUMBERFIRE_GQL_URL = "https://fdresearch-api.fanduel.com/graphql";

// ── ESPN Fantasy (public, unauthenticated leaguedefaults endpoint) ─────
export const ESPN_FANTASY_BASE_URL = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons";

// ── ESPN Scoreboard (public, unauthenticated live game status) ────────
export const ESPN_SCOREBOARD_BASE_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

/** ESPN public NFL injury report (Out / Doubtful / Questionable / IR / Active per player). */
export const ESPN_INJURIES_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries";

// ── Google Sheets (crowdsourced rookie board) ─────────────────
// This URL is a published CSV export — safe to store in code (not a secret).
// If the sheet is re-published or moved, update here only.
export const ROOKIE_BOARD_SHEET_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vROmAn0k3A92okpYE7UeelIy0vYUMY0NFAGHrI52V68Zm8ff9aruDXB1E6u0hRNr2EHgr54_D7gMBti/pub?output=csv";

// ── Cache TTLs (milliseconds) ─────────────────────────────────
/** FantasyCalc dynasty values — updated at most once per day */
export const FC_VALUES_TTL_MS = 24 * 60 * 60 * 1000;

/** Upstream timeout for a FantasyCalc values fetch (ms) — it normally answers in under a second */
export const FC_FETCH_TIMEOUT_MS = 8_000;

/** A FantasyCalc payload with fewer valued entries than this is treated as an upstream failure
 *  (real payloads carry 200-450) so a truncated / error body is never cached or served as data */
export const FC_MIN_VALID_ENTRIES = 50;

/** Client-side TTL for the shared FantasyCalc values store (lib/fcValuesStore.ts). The server
 *  already caches for 24h (FC_VALUES_TTL_MS) — this only coalesces the burst of near-simultaneous
 *  requests a single page load produces across hooks that all want the same (numQbs, isDynasty)
 *  key, not to track upstream freshness. */
export const FC_VALUES_CLIENT_TTL_MS = 10 * 60_000;

/** Timeout for the client fetching /api/fc-values (lib/fcValuesStore.ts). */
export const FC_VALUES_CLIENT_TIMEOUT_MS = 10_000;

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

/** NFL live scoreboard (kickoff/live/final per game) — changes constantly during games */
export const NFL_SCOREBOARD_REVALIDATE_S = 30;

/** Live per-player stat lines for the Gameday per-stat pace model */
export const NFL_LIVE_STATS_REVALIDATE_S = 30;

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
 * from migration 001/006; migration 036 added paid_2034 – paid_2037.
 *
 * CEILING REMINDER — when `currentYear + PAYMENT_YEARS_FUTURE` exceeds this
 * value, add a NEW migration (next free number after 036) adding
 * paid_<next>..paid_<next+3> on BOTH league_management and
 * commissioner_payments (mirror migration 036, bump the years) AND bump this
 * constant. The app logs a console.warn whenever the window touches or passes
 * the ceiling. Use `ADD COLUMN IF NOT EXISTS … BOOLEAN NOT NULL DEFAULT false`
 * so the migration is additive and idempotent.
 *
 * Current ceiling: 2037 → safe through calendar year 2034. Provision the next
 * batch before Jan 1 2035.
 */
export const MAX_PROVISIONED_PAYMENT_YEAR = 2037;

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
    console.warn(
      `[dynastyzeus] Payment-year window reached the provisioned ceiling.\n` +
      `  highest column the app will write to: paid_${highestNeeded}\n` +
      `  highest column provisioned in DB:     paid_${MAX_PROVISIONED_PAYMENT_YEAR}\n` +
      (overflow
        ? `  STATUS: OVERFLOW — writes to paid_${highestNeeded} will fail. Add the next payment-year migration NOW.\n`
        : `  STATUS: At ceiling — add a new migration before Jan 1 ${current + 1} to add paid_${MAX_PROVISIONED_PAYMENT_YEAR + 1}..paid_${MAX_PROVISIONED_PAYMENT_YEAR + 4}.\n`) +
      `  See supabase/migrations/036_extend_payment_years_2034_2037.sql for the template (additive ADD COLUMN IF NOT EXISTS) and bump MAX_PROVISIONED_PAYMENT_YEAR in lib/constants.ts.`
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

/**
 * Trade Finder's cross-league intel (useCrossLeagueMateIntel) profiles every OTHER roster
 * owner in the league, and for each owner fans out across every OTHER dynasty league that
 * owner is in — uncapped, this was owners x leagues x ~5 calls (hundreds at once against a
 * 60/min/route limiter; Sept 21 audit finding #5). Only this many owners are computed per
 * effect pass; the rest stay "missing" and are picked up on the next pass.
 *
 * Raised from 4 (Sept 22 code-review 50-league-scalability finding, Tier 3 #10, folded into
 * Batch 4): this only controls how many owners' cheap getUserLeagues calls fire per pass — the
 * real Sleeper-call burst stays capped by CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY below
 * regardless of this number, so raising it doesn't raise the peak burst, just how many owners a
 * normal-sized league (typically <=12 OTHER owners) can finish in a single pass instead of 3
 * sequential ones. Since the queue below is keyed by unique league, a wider owner batch now also
 * makes the dedup MORE effective (more owners sharing the same leagues in one pass), rather than
 * lengthening the queue proportionally the way the old (owner, league) pair queue did.
 */
export const CROSS_LEAGUE_INTEL_OWNER_BATCH = 12;

/**
 * GLOBAL cap (across every owner in the current batch, not per-owner) on how many "other
 * dynasty league" fetches run concurrently. Each one costs 5 Sleeper calls (rosters, 3x
 * transactions, drafts), so this bounds the real burst size the browser fires at once — live
 * testing against a 36-league account with OWNER_BATCH=4 and a naive PER-OWNER cap of 3 still
 * produced 60 concurrent calls (4 owners x 3 leagues x 5 calls) and tripped 429s; capping the
 * flattened queue globally instead keeps the worst-case burst at this number x 5.
 *
 * Sept 22 deferred follow-up #1: that queue now holds UNIQUE LEAGUES, not (owner, league)
 * pairs. The unit this number counts therefore changed, but what it bounds did NOT — a queue
 * item still costs exactly 5 Sleeper calls either way, so the peak burst is the same 2 x 5 = 10.
 * The dedup shortens the queue (every owner in the batch shares at least the current league),
 * which makes the same cap drain faster; it deliberately does not widen it. Raise this only on
 * real 429 evidence, exactly as before.
 */
export const CROSS_LEAGUE_INTEL_LEAGUE_CONCURRENCY = 2;

/**
 * League Overview (useLeagueOverview) loads every one of the current user's OWN leagues at
 * once, and each league costs 4 concurrent Sleeper calls (rosters, traded picks, drafts,
 * users) — the same unbounded-fan-out shape that caused Batch 5's cross-league-intel 429s
 * (Sept 22 code-review P1 finding #3), just with no per-owner fan-out on top of it. Capping
 * the outer per-league loop keeps the worst-case burst at this number x 4.
 */
export const LEAGUE_OVERVIEW_CONCURRENCY = 3;

/**
 * Gameday Dashboard (useGamedayDashboard) loads rosters + users + matchups for every one of
 * the current user's leagues at once — 3 concurrent Sleeper calls per league — and the live
 * refresh loop re-runs that same fan-out every poll tick during a live slate. Same unbounded
 * shape as LEAGUE_OVERVIEW_CONCURRENCY above (Sept 22 code-review 50-league-scalability
 * finding, Tier 1 #1-2); capping the outer per-league loop keeps the worst-case burst at this
 * number x 3.
 */
export const GAMEDAY_DASHBOARD_CONCURRENCY = 3;

/**
 * OverviewTab's manual "Refresh Rosters" button (handleRefreshAllRosters /
 * refreshAllLeagueRosters) force-bypasses cache for every one of the current user's leagues at
 * once — 4 concurrent Sleeper calls per league, all guaranteed real requests since bypass:true
 * rules out a cache hit. Same unbounded shape as LEAGUE_OVERVIEW_CONCURRENCY above (Sept 22
 * code-review 50-league-scalability finding, Tier 1 #3); capping the outer per-league loop
 * keeps the worst-case burst at this number x 4.
 */
export const OVERVIEW_REFRESH_ROSTERS_CONCURRENCY = 3;

/**
 * Shared cap for the three "look up one target user" fan-outs — Trade Hub (useUserTrades, 5
 * Sleeper calls/league: rosters, 2x transactions, drafts, users), Shares/Exposure
 * (useUserExposure, 1 call/league: rosters), and Draft Scout (useDraftScout, 1-2 calls/league:
 * drafts, then draft picks if a rookie draft is found) — each previously fanned out across
 * every league the TARGET user (not the viewer) is in, uncapped. Since these scale with a
 * looked-up leaguemate's or opponent's league count rather than the viewer's own, even a
 * small-league viewer can trip this by looking up a whale (Sept 22 code-review 50-league-
 * scalability finding, Tier 1 #4). One shared constant since all three are single-shot,
 * user-triggered lookups (never run concurrently with each other) rather than a repeating
 * background fan-out; 3 keeps the worst case (useUserTrades, this number x 5) well short of the
 * burst sizes already proven safe elsewhere in this file.
 */
export const TARGET_USER_LEAGUE_CONCURRENCY = 3;

/**
 * Two jobs (Sept 22 code-review 50-league-scalability finding, Tier 1 #5, Batch 4): (1) a batch
 * pass where nobody makes progress never changes `crossLeagueMateIntel`, which is the load
 * effect's only dependency that advances it to a new attempt — without an explicit retry timer,
 * those owners would be silently dropped for the rest of the session instead of retried once
 * Sleeper recovers; (2) throttles how soon a still-incomplete owner (one with a persistently
 * failing league) can be re-selected into a batch, so their one bad league doesn't get hammered
 * on every render triggered by OTHER owners' progress.
 */
export const CROSS_LEAGUE_INTEL_RETRY_COOLDOWN_MS = 60_000;

/**
 * Hard ceiling on distinct connected Sleeper users expanded to per compile
 * run. Without this, a caller's own real network (or a fabricated
 * sleeperUserId, prior to the ownership check) can drive the Step 2
 * expansion to thousands of (user, year) pairs — an unbounded sequential
 * crawl against Sleeper's IP-level rate limit. Users beyond the cap are
 * simply not expanded; the compile still runs on the rest.
 */
export const COMPILE_MAX_CONNECTED_USERS = 500;

/**
 * Hard ceiling on distinct leagues scanned for rookie drafts per compile
 * run (Step 3). Same rationale as COMPILE_MAX_CONNECTED_USERS — bounds
 * total Sleeper request volume regardless of how large the underlying
 * network is.
 */
export const COMPILE_MAX_LEAGUES = 4000;

/** Default request timeout for Sleeper API calls (ms) */
export const SLEEPER_REQUEST_TIMEOUT_MS = 15_000;

/** Extended timeout for the ~5 MB Sleeper players payload */
export const SLEEPER_PLAYERS_TIMEOUT_MS = 45_000;
