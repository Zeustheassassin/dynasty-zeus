// ============================================================
// Cron — League transactions feed
// ============================================================
// Runs on a Vercel cron schedule. Finds every registered user's OWN
// dynasty leagues (user_sleeper_links), fetches each DISTINCT league's
// recent transactions, league users, rosters, and drafts ONCE, annotates
// each transaction (leagueName, leagueId, rosterOwnerMap, draft_picks with
// slot strings), then upserts each user's share into
// league_transactions_cache so the frontend can render the feed from a
// single Supabase query.
//
// Replaces the client-side effect at app/hooks/useAppState.ts:3072
// that fanned out ~240 Sleeper calls per cold session for a
// 34-league user.
//
// Sleeper call budget (Sleeper call-budget plan Stage 2, 2026-10-10):
//   - Leagues are deduped across users. 5 users' 162 user-leagues are
//     only 94 distinct leagues, and the old per-user loop fetched every
//     shared league once per member.
//   - 2 transaction legs a run (current + previous), 4 on the first run
//     of each UTC day — see TRANSACTION_LOOKBACK_LEGS.
//   - Every Sleeper call goes through one createPacer at
//     LEAGUE_TX_CRON_RPM, so the run's request RATE is bounded, not just
//     its concurrency (which bounds nothing once latency drops).
//   ~1,130 unpaced calls a run became ~470 paced ones.
//
// Auth + idempotency (same shape as the other cron routes):
//   - Authorization: Bearer ${CRON_SECRET}
//   - Service-role Supabase client bypasses RLS
//   - Upsert with onConflict (user_id, transaction_id) so repeat
//     runs replace rows when Sleeper data evolves (status changes,
//     draft picks finalising, etc.)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../../../lib/supabaseAdmin";
import { safeFetch, withConcurrency, createPacer } from "../../../../lib/sleeperServer";
import { getDraftRoundSlot } from "../../../../lib/helpers/picks";
import { CURRENT_YEAR } from "../../../../lib/helpers/season";
import { isDynastyLeague } from "../../../../lib/helpers/leagueType";
import { SLEEPER_BASE_URL, LEAGUE_TX_CRON_RPM } from "../../../../lib/constants";
import { logger } from "../../../../lib/logger";
import { verifyCron } from "../../../../lib/server/verifyCron";
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperUser,
  SleeperDraft,
  SleeperTransaction,
  SleeperTradedPick,
} from "../../../../lib/types";

const log = logger("cron/league-transactions");

export const maxDuration = 300;

// Distinct leagues fetched at once. Each league's 5-7 calls are issued
// together, but every one of them waits its turn on the shared pacer, so
// this bounds in-flight work while LEAGUE_TX_CRON_RPM bounds the rate.
const LEAGUE_CONCURRENCY = 3;

// Users whose league lists are fetched, and whose rows are written, at once.
// Writes are Supabase-only; the league-list fetches are paced like
// everything else.
const USER_CONCURRENCY = 2;

// Wall-clock ceiling for starting NEW league fetches, well under
// `maxDuration` (300s) so in-flight leagues can finish and every user's rows
// can still be written before Vercel kills the function outright — which
// would silently drop the whole run (no partial response, nothing in the
// log beyond a generic timeout) rather than the graceful early-stop this
// guard gives. A league not reached is simply missing from this run's rows;
// rows from earlier runs stay in the table.
const TIME_BUDGET_MS = 270_000;

// Transaction legs read per run: the current leg and the one before it.
// Sleeper files a transaction under the leg it was PROPOSED in, not the one
// it completed in, so a trade accepted after the leg flips sits in an older
// leg. Measured on this season's stored rows (2026-10-10): all 215 trades
// and ~2,850 other moves completed in their filing leg or the next one —
// exactly what 2 legs covers on a run every 2h. Rare long negotiations
// (offseason trades took up to 35 days to accept) can complete two or more
// legs after filing, so the first run of each UTC day reads 4 legs, the
// window every run used before; such a trade is stored at most a day late
// instead of never. The offseason is all leg 1 either way.
const TRANSACTION_LOOKBACK_LEGS = 2;
const DEEP_SWEEP_LOOKBACK_LEGS = 4;
const DEEP_SWEEP_UTC_HOUR = 0;

// How many transactions to write per user per run: the 200 most recently
// COMPLETED (status_updated), which is everything that can have appeared since
// the last run 2-6h ago. Rows from earlier runs stay in the table (no cleanup
// policy here) and the Alerts Hub reads them by its own windows
// (hooks/leagueTransactionsFetch.ts). Not by `created`: a trade's `created` is
// its proposal, often a day and sometimes weeks before acceptance, and in
// season 200 rows by `created` reach back only ~3-4 days, so a slow-accepted
// trade fell outside the cap the first time it showed up complete and was
// never stored.
const PER_USER_TX_CAP = 200;

interface SleeperNflStateBasic {
  week?: number;
  leg?: number;
}

// Shape stored in payload jsonb — matches the AnnotatedTransaction
// shape consumed by the frontend at useAppState.ts (extended via the
// type alias in lib/types.ts). The cron writes this verbatim and the
// frontend casts it back on read.
interface AnnotatedDraftPick extends SleeperTradedPick {
  slot: string;
}

interface AnnotatedTransactionPayload extends Omit<SleeperTransaction, "draft_picks"> {
  leagueName: string;
  leagueId: string;
  rosterOwnerMap: Record<number, string>;
  draft_picks: AnnotatedDraftPick[];
}

interface CacheRow {
  user_id: string;
  transaction_id: string;
  league_id: string;
  created: number;
  payload: AnnotatedTransactionPayload;
  updated_at: string;
}

/** A league's annotated transactions, shared by every user in it. */
type LeagueRow = Omit<CacheRow, "user_id">;

type PacedFetch = <T>(url: string) => Promise<T | null>;

/**
 * Fetch one league's transactions (the given legs) + users + rosters +
 * drafts and annotate every completed transaction. Done once per league per
 * run, however many registered users share it.
 */
async function fetchLeagueRows(
  league: SleeperLeague,
  legs: number[],
  paced: PacedFetch,
  nowIso: string
): Promise<LeagueRow[]> {
  const [txArrays, usersData, rostersData, draftsData] = await Promise.all([
    Promise.all(
      legs.map((w) =>
        paced<SleeperTransaction[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/transactions/${w}`
        )
      )
    ),
    paced<SleeperUser[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/users`),
    paced<SleeperRoster[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/rosters`),
    paced<SleeperDraft[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/drafts`),
  ]);

  const users = Array.isArray(usersData) ? usersData : [];
  const rosters = Array.isArray(rostersData) ? rostersData : [];
  const drafts = Array.isArray(draftsData) ? draftsData : [];

  // Build roster_id → display_name and roster_id → user_id maps,
  // matching the original client logic at useAppState.ts:3092.
  const rosterOwnerMap: Record<number, string> = {};
  const rosterToUser: Record<number, string> = {};
  rosters.forEach((r) => {
    const u = users.find((u) => u.user_id === r.owner_id);
    rosterOwnerMap[r.roster_id] =
      u?.display_name || u?.username || `Team ${r.roster_id}`;
    if (r.owner_id) rosterToUser[r.roster_id] = String(r.owner_id);
  });

  const currentDraft = drafts.find((d) => d.season === CURRENT_YEAR);
  const draftOrder: Record<string, number> =
    currentDraft?.draft_order ?? {};
  const totalTeams = rosters.length;

  // txArrays is (SleeperTransaction[] | null)[] — null when safeFetch
  // returns null on failure. Flatten while skipping null entries.
  const allTxs: SleeperTransaction[] = [];
  for (const arr of txArrays) {
    if (Array.isArray(arr)) allTxs.push(...arr);
  }

  // Mirror the client-side filter: skip incomplete and waiver_failed.
  const completed = allTxs.filter(
    (tx) => tx.status === "complete" && tx.type !== "waiver_failed"
  );

  return completed.map((tx) => {
    const annotatedPicks: AnnotatedDraftPick[] = (tx.draft_picks ?? []).map(
      (pick) => {
        if (pick.season === CURRENT_YEAR && currentDraft) {
          const userId = rosterToUser[pick.roster_id];
          const baseSlot = Number(draftOrder[String(userId)] ?? 0);
          const slot = getDraftRoundSlot(
            currentDraft,
            Number(pick.round),
            baseSlot,
            totalTeams
          );
          return {
            ...pick,
            slot: slot
              ? `${pick.round}.${String(slot).padStart(2, "0")}`
              : `${pick.round}.${String(pick.roster_id).padStart(2, "0")}`,
          };
        }
        return { ...pick, slot: String(pick.round) };
      }
    );

    return {
      transaction_id: tx.transaction_id,
      league_id: league.league_id,
      created: tx.created ?? 0,
      payload: {
        ...tx,
        leagueName: league.name ?? "League",
        leagueId: league.league_id,
        rosterOwnerMap,
        draft_picks: annotatedPicks,
      },
      updated_at: nowIso,
    };
  });
}

/**
 * Write one user's share — the rows of every league they're in that was
 * fetched this run — to league_transactions_cache, capped at
 * PER_USER_TX_CAP most recently completed. Returns inserted-or-updated row
 * count.
 */
async function writeUserRows(
  authUserId: string,
  leagueIds: string[],
  rowsByLeague: Map<string, LeagueRow[]>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<number> {
  const collected: CacheRow[] = [];
  for (const leagueId of leagueIds) {
    for (const row of rowsByLeague.get(leagueId) ?? []) {
      collected.push({ ...row, user_id: authUserId });
    }
  }
  if (!collected.length) return 0;

  // Keep only the PER_USER_TX_CAP most recently completed rows in memory before
  // write, so a user with many old transactions doesn't generate a huge upsert.
  const completedAt = (r: CacheRow) => r.payload.status_updated ?? r.created;
  collected.sort((a, b) => completedAt(b) - completedAt(a));
  const toWrite = collected.slice(0, PER_USER_TX_CAP);

  let written = 0;
  for (let i = 0; i < toWrite.length; i += 200) {
    const batch = toWrite.slice(i, i + 200);
    const { error, data } = await supabase
      .from("league_transactions_cache")
      .upsert(batch, { onConflict: "user_id,transaction_id" })
      .select("transaction_id");
    if (error) {
      log.error("league_transactions_cache upsert failed", {
        authUserId,
        batchStart: i,
        err: error.message,
      });
      continue;
    }
    written += Array.isArray(data) ? data.length : 0;
  }
  return written;
}

export async function GET(req: NextRequest): Promise<Response> {
  const unauthorized = verifyCron(req, log);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    log.error("Supabase service-role env vars not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  const { data: links, error: linksErr } = await supabase
    .from("user_sleeper_links")
    .select("user_id, sleeper_user_id");
  if (linksErr) {
    log.error("user_sleeper_links read failed", { err: linksErr.message });
    return NextResponse.json({ error: "DB read failed" }, { status: 500 });
  }

  const runStartedAt = Date.now();
  const outOfTime = () => Date.now() - runStartedAt > TIME_BUDGET_MS;

  // Every Sleeper request this run waits its turn here.
  const pace = createPacer(LEAGUE_TX_CRON_RPM);
  let sleeperCalls = 0;
  const paced: PacedFetch = async <T,>(url: string) => {
    await pace();
    sleeperCalls++;
    return safeFetch<T>(url);
  };

  // Fetch NFL state once per run for the leg-window calculation. Mirrors
  // the client effect's `nflState?.leg ?? nflState?.week ?? 1` fallback.
  const nflState = await paced<SleeperNflStateBasic>(`${SLEEPER_BASE_URL}/state/nfl`);
  const curWeek = Math.max(
    1,
    Math.min(18, nflState?.leg ?? nflState?.week ?? 1)
  );
  const deepSweep = new Date(runStartedAt).getUTCHours() === DEEP_SWEEP_UTC_HOUR;
  const lookback = deepSweep ? DEEP_SWEEP_LOOKBACK_LEGS : TRANSACTION_LOOKBACK_LEGS;
  const weeks: number[] = [];
  for (let i = 0; i < lookback; i++) {
    const w = curWeek - i;
    if (w >= 1) weeks.push(w);
  }

  const allLinks = links ?? [];

  // ── 1. Each linked Sleeper user's dynasty leagues (once per Sleeper id) ──
  const leagueById = new Map<string, SleeperLeague>();
  const leagueIdsBySleeperId = new Map<string, string[]>();
  const sleeperIds = [...new Set(allLinks.map((l) => String(l.sleeper_user_id)))];
  await withConcurrency(
    sleeperIds,
    async (sleeperUserId) => {
      const userLeagues =
        (await paced<SleeperLeague[]>(
          `${SLEEPER_BASE_URL}/user/${sleeperUserId}/leagues/nfl/${CURRENT_YEAR}`
        )) ?? [];
      const dynastyLeagues = (Array.isArray(userLeagues) ? userLeagues : []).filter(isDynastyLeague);
      dynastyLeagues.forEach((l) => leagueById.set(l.league_id, l));
      leagueIdsBySleeperId.set(sleeperUserId, dynastyLeagues.map((l) => l.league_id));
    },
    USER_CONCURRENCY
  );

  // ── 2. Each distinct league's transactions, once ──
  const leagues = [...leagueById.values()];
  const rowsByLeague = new Map<string, LeagueRow[]>();
  const nowIso = new Date().toISOString();
  let leaguesFailed = 0;
  const dispatched = await withConcurrency(
    leagues,
    async (league) => {
      try {
        rowsByLeague.set(league.league_id, await fetchLeagueRows(league, weeks, paced, nowIso));
      } catch (err) {
        leaguesFailed++;
        log.error("league fetch threw", {
          leagueId: league.league_id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
    LEAGUE_CONCURRENCY,
    { shouldBail: outOfTime }
  );
  // Only leagues actually dispatched produce a result, so anything missing
  // from the tail was skipped by the time-budget bail above.
  const leaguesSkippedTimeBudget = leagues.length - dispatched.length;
  if (leaguesSkippedTimeBudget > 0) {
    log.error("league-transactions cron hit its time budget — stopping early", {
      leaguesProcessed: dispatched.length,
      leaguesSkippedTimeBudget,
      sleeperCalls,
    });
  }

  // ── 3. Each user's share of those rows ──
  // The try/catch gives per-user fault isolation (withConcurrency itself is
  // fail-fast); a user whose write threw is the only one not counted.
  const userResults = await withConcurrency(
    allLinks,
    async (link) => {
      try {
        return await writeUserRows(
          link.user_id,
          leagueIdsBySleeperId.get(String(link.sleeper_user_id)) ?? [],
          rowsByLeague,
          supabase
        );
      } catch (err) {
        log.error("writing a user's rows threw", {
          authUserId: link.user_id,
          err: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    },
    USER_CONCURRENCY
  );

  let usersProcessed = 0;
  let rowsWritten = 0;
  for (const written of userResults) {
    if (written === null) continue;
    usersProcessed++;
    rowsWritten += written;
  }

  return NextResponse.json({
    ok: true,
    linksFound: links?.length ?? 0,
    usersProcessed,
    rowsWritten,
    weeks,
    deepSweep,
    leaguesFound: leagues.length,
    leaguesFailed,
    leaguesSkippedTimeBudget,
    sleeperCalls,
  });
}
