// ============================================================
// Cron — Leaguemate trade alerts
// ============================================================
// Runs on a Vercel cron schedule. For every registered user in
// user_sleeper_links, walks the user's OWN dynasty leagues, finds
// trades from the last 14 days, and inserts net-new trade-alert
// rows into the public.alerts table — one row per non-user owner
// involved in each trade.
//
// History:
//   The original implementation also fanned out to leaguemates'
//   *other* dynasty leagues, generating ~1000+ Sleeper requests per
//   user per run and consistently tripping the 5-minute Vercel
//   function timeout (see Vercel anomaly 2026-05-06). The user
//   confirmed they only care about trades in leagues they're
//   actually in, so the leaguemate fan-out was removed: O(L) calls
//   instead of O(L × M × L'), where M is leaguemate count and L'
//   is each leaguemate's own league count.
//
// Auth:
//   Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` when
//   CRON_SECRET is set in the project's env vars.
//
// Idempotency:
//   Uses INSERT … ON CONFLICT DO NOTHING (via supabase upsert with
//   ignoreDuplicates=true) keyed on (user_id, alert_id). Repeat
//   runs are no-ops for already-known trades; user dismiss state
//   on existing rows is never overwritten.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, withConcurrency } from "../../../../lib/sleeperServer";
import { getDraftRoundSlot } from "../../../../lib/helpers/picks";
import { CURRENT_YEAR } from "../../../../lib/helpers/season";
import { SLEEPER_BASE_URL } from "../../../../lib/constants";
import { logger } from "../../../../lib/logger";
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperTransaction,
  SleeperDraft,
  SleeperTradedPick,
} from "../../../../lib/types";

const log = logger("cron/leaguemate-alerts");

// 60s is plenty now that the fan-out is gone — typical run scans
// ~12 leagues × 5 endpoints = 60 Sleeper calls.
export const maxDuration = 60;

// Bounded concurrency for outgoing Sleeper requests. Keeps us well
// under Sleeper's ~1000 req/min ceiling even if safeFetch retries.
const CONCURRENCY = 5;

// Trade alerts surface trades from the last 14 days.
const TRADE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

// Offseason transactions are bucketed under weeks 0–2; week 0 alone misses
// some leagues whose offseason resets land in week 1 or 2.
const TRANSACTION_WEEKS = [0, 1, 2] as const;

// Sleeper transactions can hash adds either by string or numeric roster_id.
type AdHashEntry = [string, number | string];

interface AlertRow {
  user_id: string;
  alert_id: string;
  category: "league";
  source: "internal";
  severity: "medium";
  title: string;
  detail: string;
  actionable: boolean;
  dismissed: boolean;
  league_id: string | null;
  player_id: string | null;
  payload: Record<string, unknown>;
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
 * Walks one registered user's own dynasty leagues and collects net-new trade
 * alerts. Returns the number of rows inserted (after ON CONFLICT DO NOTHING).
 *
 * Player names are NOT resolved server-side — the cron writes raw player IDs
 * into payload.acquiredPlayerIds / payload.sentPlayerIds and the FeedTab
 * resolver renders names from the client's already-loaded players map. This
 * skips a 5 MB /players/nfl fetch per cron run.
 *
 * One alert is emitted per non-user owner involved in each trade — so a
 * two-team trade in a shared league produces one alert ("Bob made a trade")
 * from the user's perspective. The user's own trades aren't duplicated.
 */
async function processUser(
  authUserId: string,
  sleeperUserId: string,
  // Service-role client — cannot type the schema generically without a generated db.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<number> {
  const userLeagues =
    (await safeFetch<SleeperLeague[]>(
      `${SLEEPER_BASE_URL}/user/${sleeperUserId}/leagues/nfl/${CURRENT_YEAR}`
    )) ?? [];
  const userDynastyLeagues = userLeagues.filter(isDynastyLeague);
  if (!userDynastyLeagues.length) return 0;

  const fourteenDaysAgo = Date.now() - TRADE_LOOKBACK_MS;
  const collected: AlertRow[] = [];
  const seenAlertIds = new Set<string>();

  await withConcurrency(
    userDynastyLeagues,
    async (league) => {
      const [rosters, txn0, txn1, txn2, drafts] = await Promise.all([
        safeFetch<SleeperRoster[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/rosters`
        ),
        safeFetch<SleeperTransaction[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/transactions/${TRANSACTION_WEEKS[0]}`
        ),
        safeFetch<SleeperTransaction[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/transactions/${TRANSACTION_WEEKS[1]}`
        ),
        safeFetch<SleeperTransaction[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/transactions/${TRANSACTION_WEEKS[2]}`
        ),
        safeFetch<SleeperDraft[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/drafts`
        ),
      ]);

      if (!Array.isArray(rosters)) return;

      // Build slot resolver for current-year picks only — past/future picks
      // fall back to "{season} Rd {round}" labelling.
      const currentDraft =
        (Array.isArray(drafts) ? drafts : []).find(
          (d) => String(d.season) === CURRENT_YEAR
        ) ?? null;
      const draftOrder: Record<string, number> =
        currentDraft?.draft_order ?? {};
      const numTeams = rosters.length;
      const rosterToOwner: Record<number, string> = {};
      rosters.forEach((r) => {
        if (r.owner_id) rosterToOwner[r.roster_id] = String(r.owner_id);
      });
      const labelPick = (p: SleeperTradedPick): string => {
        if (String(p.season) === CURRENT_YEAR && currentDraft) {
          const userId = rosterToOwner[p.roster_id];
          const baseSlot = Number(draftOrder[String(userId)] ?? 0);
          const slot = getDraftRoundSlot(
            currentDraft,
            Number(p.round),
            baseSlot,
            numTeams
          );
          if (slot)
            return `${p.season} ${p.round}.${String(slot).padStart(2, "0")}`;
        }
        return `${p.season} Rd ${p.round}`;
      };

      const allTxns = [
        ...(Array.isArray(txn0) ? txn0 : []),
        ...(Array.isArray(txn1) ? txn1 : []),
        ...(Array.isArray(txn2) ? txn2 : []),
      ];

      const recentTrades = allTxns.filter(
        (t) =>
          t.type === "trade" &&
          t.status === "complete" &&
          (t.updated || t.created || 0) > fourteenDaysAgo
      );

      const leagueName = league.name || "League";

      for (const trade of recentTrades) {
        // One alert per non-user owner involved in the trade.
        const involvedRosterIds = trade.roster_ids ?? [];
        const involvedOwnerIds = involvedRosterIds
          .map((rid) => rosterToOwner[rid])
          .filter((oid): oid is string => !!oid && oid !== String(sleeperUserId));

        for (const ownerId of involvedOwnerIds) {
          const ownerRoster = rosters.find(
            (r) => String(r.owner_id) === ownerId
          );
          if (!ownerRoster) continue;

          const alertId = `trade-${trade.transaction_id}-${ownerId}`;
          if (seenAlertIds.has(alertId)) continue;

          const addsEntries = Object.entries(trade.adds ?? {}) as AdHashEntry[];
          const acquiredPlayerIds = addsEntries
            .filter(([, rid]) => Number(rid) === ownerRoster.roster_id)
            .map(([pid]) => pid);
          const sentPlayerIds = addsEntries
            .filter(([, rid]) => Number(rid) !== ownerRoster.roster_id)
            .map(([pid]) => pid);
          const picksReceived = (trade.draft_picks ?? [])
            .filter((p) => p.owner_id === ownerRoster.roster_id)
            .map(labelPick);
          const picksSent = (trade.draft_picks ?? [])
            .filter((p) => p.previous_owner_id === ownerRoster.roster_id)
            .map(labelPick);

          const hasAcquired = acquiredPlayerIds.length || picksReceived.length;
          const hasSent = sentPlayerIds.length || picksSent.length;
          if (!hasAcquired && !hasSent) continue;

          const ts = trade.updated || trade.created || Date.now();
          const acquiredAll = [...acquiredPlayerIds, ...picksReceived];
          const sentAll = [...sentPlayerIds, ...picksSent];

          seenAlertIds.add(alertId);
          collected.push({
            user_id: authUserId,
            alert_id: alertId,
            category: "league",
            source: "internal",
            severity: "medium",
            title: `Leaguemate trade — ${leagueName}`,
            detail: hasAcquired
              ? `Received ${acquiredAll.join(", ")}${
                  hasSent ? `, sent ${sentAll.join(", ")}` : ""
                } in ${leagueName}.`
              : `Sent ${sentAll.join(", ")} in ${leagueName}.`,
            actionable: true,
            dismissed: false,
            league_id: league.league_id,
            player_id: null,
            payload: {
              ownerId,
              leagueName,
              acquiredPlayerIds,
              sentPlayerIds,
              picksReceived,
              picksSent,
            },
            updated_at: new Date(ts).toISOString(),
          });
        }
      }
    },
    CONCURRENCY
  );

  if (!collected.length) return 0;

  // Insert in batches of 200 to stay under Supabase request size limits.
  // ignoreDuplicates: true → ON CONFLICT DO NOTHING, preserving any existing
  // dismiss state set by the user.
  let inserted = 0;
  for (let i = 0; i < collected.length; i += 200) {
    const batch = collected.slice(i, i + 200);
    const { error, data } = await supabase
      .from("alerts")
      .upsert(batch, { onConflict: "user_id,alert_id", ignoreDuplicates: true })
      .select("alert_id");
    if (error) {
      log.error("alerts upsert failed", {
        authUserId,
        batchStart: i,
        err: error.message,
      });
      continue;
    }
    inserted += Array.isArray(data) ? data.length : 0;
  }
  return inserted;
}

export async function GET(req: NextRequest): Promise<Response> {
  // Vercel cron sends `Authorization: Bearer ${CRON_SECRET}` when the env var
  // is set. We also accept manual hits with the same header for testing.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_SECRET env var is not set — refusing to run");
    return NextResponse.json(
      { error: "CRON_SECRET not configured on server" },
      { status: 500 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${expected}`) {
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
    return NextResponse.json(
      { error: "DB read failed" },
      { status: 500 }
    );
  }

  let usersProcessed = 0;
  let alertsInserted = 0;
  for (const link of links ?? []) {
    try {
      alertsInserted += await processUser(
        link.user_id,
        link.sleeper_user_id,
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
    alertsInserted,
  });
}
