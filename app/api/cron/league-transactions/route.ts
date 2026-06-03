// ============================================================
// Cron — League transactions feed
// ============================================================
// Runs on a Vercel cron schedule. For every registered user in
// user_sleeper_links, fans out the user's OWN dynasty leagues to
// fetch the last 4 weeks of transactions, league users, rosters,
// and drafts. Each transaction is annotated (leagueName, leagueId,
// rosterOwnerMap, draft_picks with slot strings) and upserted into
// league_transactions_cache so the frontend can render the feed
// from a single Supabase query.
//
// Replaces the client-side effect at app/hooks/useAppState.ts:3072
// that fanned out ~240 Sleeper calls per cold session for a
// 34-league user.
//
// Auth + idempotency mirror app/api/cron/leaguemate-alerts:
//   - Authorization: Bearer ${CRON_SECRET}
//   - Service-role Supabase client bypasses RLS
//   - Upsert with onConflict (user_id, transaction_id) so repeat
//     runs replace rows when Sleeper data evolves (status changes,
//     draft picks finalising, etc.)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, withConcurrency } from "../../../../lib/sleeperServer";
import { getDraftRoundSlot } from "../../../../lib/helpers/picks";
import { CURRENT_YEAR } from "../../../../lib/helpers/season";
import { SLEEPER_BASE_URL } from "../../../../lib/constants";
import { logger } from "../../../../lib/logger";
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

// Per-user concurrency cap for the per-league fan-out. Same value as
// the leaguemate-alerts cron so the two crons keep similar load
// profiles when they run in overlapping windows.
const CONCURRENCY = 5;

// Mirror the client effect's lookback window — current week + 3 prior.
// Captures both in-progress and recently-completed transactions. During
// offseason all four weeks are likely "weeks 0/1/2" buckets but Sleeper
// is forgiving about high-numbered week queries (returns []).
const TRANSACTION_LOOKBACK_WEEKS = 4;

// How many transactions to keep per user. The frontend query slices to
// the top 200 by created DESC; we don't need to store more than that.
// Older rows aren't deleted by the cron (no cleanup policy here) — they
// just stop being read once the 200th row is newer than them.
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

function isDynastyLeague(l: SleeperLeague): boolean {
  return (
    ((l.settings?.taxi_slots ?? 0) > 0 ||
      (l.roster_positions?.length ?? 0) > 20) &&
    (l.settings?.best_ball ?? 0) === 0
  );
}

/**
 * Fan out one user's leagues, fetch + annotate transactions,
 * write to league_transactions_cache. Returns inserted-or-updated
 * row count.
 */
async function processUser(
  authUserId: string,
  sleeperUserId: string,
  weeks: number[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<number> {
  const userLeagues =
    (await safeFetch<SleeperLeague[]>(
      `${SLEEPER_BASE_URL}/user/${sleeperUserId}/leagues/nfl/${CURRENT_YEAR}`
    )) ?? [];
  const dynastyLeagues = userLeagues.filter(isDynastyLeague);
  if (!dynastyLeagues.length) return 0;

  const collected: CacheRow[] = [];
  const nowIso = new Date().toISOString();

  await withConcurrency(
    dynastyLeagues,
    async (league) => {
      const [txArrays, usersData, rostersData, draftsData] = await Promise.all([
        Promise.all(
          weeks.map((w) =>
            safeFetch<SleeperTransaction[]>(
              `${SLEEPER_BASE_URL}/league/${league.league_id}/transactions/${w}`
            )
          )
        ),
        safeFetch<SleeperUser[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/users`
        ),
        safeFetch<SleeperRoster[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/rosters`
        ),
        safeFetch<SleeperDraft[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/drafts`
        ),
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

      for (const tx of completed) {
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

        const payload: AnnotatedTransactionPayload = {
          ...tx,
          leagueName: league.name ?? "League",
          leagueId: league.league_id,
          rosterOwnerMap,
          draft_picks: annotatedPicks,
        };

        collected.push({
          user_id: authUserId,
          transaction_id: tx.transaction_id,
          league_id: league.league_id,
          created: tx.created ?? 0,
          payload,
          updated_at: nowIso,
        });
      }
    },
    CONCURRENCY
  );

  if (!collected.length) return 0;

  // Keep only the freshest PER_USER_TX_CAP rows in memory before write,
  // so a user with many old transactions doesn't generate a huge upsert.
  collected.sort((a, b) => b.created - a.created);
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
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_SECRET env var is not set — refusing to run");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 }
    );
  }
  // Constant-time comparison so a timing side-channel can't reveal the secret.
  // timingSafeEqual throws on length mismatch, so guard the length first.
  const authBuf = Buffer.from(req.headers.get("authorization") ?? "");
  const expectedBuf = Buffer.from(`Bearer ${expected}`);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    log.error("Supabase service-role env vars not configured");
    return NextResponse.json(
      { error: "Server misconfiguration" },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: links, error: linksErr } = await supabase
    .from("user_sleeper_links")
    .select("user_id, sleeper_user_id");
  if (linksErr) {
    log.error("user_sleeper_links read failed", { err: linksErr.message });
    return NextResponse.json({ error: "DB read failed" }, { status: 500 });
  }

  // Fetch NFL state once per run for the week-window calculation. Mirrors
  // the client effect's `nflState?.leg ?? nflState?.week ?? 1` fallback.
  const nflState = await safeFetch<SleeperNflStateBasic>(
    `${SLEEPER_BASE_URL}/state/nfl`
  );
  const curWeek = Math.max(
    1,
    Math.min(18, nflState?.leg ?? nflState?.week ?? 1)
  );
  const weeks: number[] = [];
  for (let i = 0; i < TRANSACTION_LOOKBACK_WEEKS; i++) {
    const w = curWeek - i;
    if (w >= 1) weeks.push(w);
  }

  let usersProcessed = 0;
  let rowsWritten = 0;
  for (const link of links ?? []) {
    try {
      rowsWritten += await processUser(
        link.user_id,
        link.sleeper_user_id,
        weeks,
        supabase
      );
      usersProcessed++;
    } catch (err) {
      log.error("processUser threw", {
        authUserId: link.user_id,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: true,
    linksFound: links?.length ?? 0,
    usersProcessed,
    rowsWritten,
    weeks,
  });
}
