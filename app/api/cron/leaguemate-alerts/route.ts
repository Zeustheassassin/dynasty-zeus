// ============================================================
// Cron — Leaguemate trade alerts
// ============================================================
// Runs on a Vercel cron schedule. For every registered user in
// user_sleeper_links, walks the user's leaguemates → leaguemates'
// dynasty leagues → recent transactions, then inserts net-new
// trade-alert rows into the public.alerts table.
//
// Replaces the client-side fan-out in app/hooks/useAppState.ts that
// fired 1000+ Sleeper calls per session and tripped Sleeper's rate
// limiter. The frontend now reads pre-built alerts from Supabase
// (see Stage S3.5).
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
//
// Throttling:
//   safeFetch backs off on 429s; withConcurrency caps in-flight
//   Sleeper requests at CONCURRENCY per batch. Users are processed
//   sequentially so one slow user can't starve another.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, withConcurrency } from "../../../../lib/sleeperServer";
import { getDraftRoundSlot } from "../../../../lib/helpers/picks";
import { CURRENT_YEAR } from "../../../../lib/helpers/season";
import {
  SLEEPER_BASE_URL,
  SLEEPER_PLAYERS_TIMEOUT_MS,
} from "../../../../lib/constants";
import { logger } from "../../../../lib/logger";
import type {
  SleeperLeague,
  SleeperRoster,
  SleeperTransaction,
  SleeperDraft,
  SleeperTradedPick,
} from "../../../../lib/types";

const log = logger("cron/leaguemate-alerts");

// Allow up to 5 minutes — large user pools with many leaguemates can take a while.
export const maxDuration = 300;

// Bounded concurrency for outgoing Sleeper requests within a single user's
// fan-out. Keeps us well under Sleeper's ~1000 req/min ceiling even when
// safeFetch retries land near the same window.
const CONCURRENCY = 5;

// Trade alerts surface trades from the last 14 days (matches the prior
// client-side window in app/hooks/useAppState.ts:1007).
const TRADE_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

// Offseason transactions are bucketed under weeks 0–2; week 0 alone misses
// some leagues whose offseason resets land in week 1 or 2.
const TRANSACTION_WEEKS = [0, 1, 2] as const;

// Server-side player record only needs the bits used to label trade contents.
interface SleeperPlayerBasic {
  first_name?: string;
  last_name?: string;
  full_name?: string;
}

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

function resolvePlayerName(
  players: Record<string, SleeperPlayerBasic>,
  pid: string
): string {
  const p = players[pid];
  if (!p) return pid;
  if (p.full_name) return p.full_name;
  const first = (p.first_name ?? "").trim();
  const last = (p.last_name ?? "").trim();
  const name = `${first} ${last}`.trim();
  return name || pid;
}

/**
 * Walks one registered user's leaguemates and collects net-new trade alerts.
 * Returns the number of rows inserted (after ON CONFLICT DO NOTHING).
 */
async function processUser(
  authUserId: string,
  sleeperUserId: string,
  players: Record<string, SleeperPlayerBasic>,
  // Service-role client — cannot type the schema generically without a generated db.ts.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>
): Promise<number> {
  // ── 1. The user's own dynasty leagues for the current year ─────────────────
  const userLeagues =
    (await safeFetch<SleeperLeague[]>(
      `${SLEEPER_BASE_URL}/user/${sleeperUserId}/leagues/nfl/${CURRENT_YEAR}`
    )) ?? [];
  const userDynastyLeagues = userLeagues.filter(isDynastyLeague);
  if (!userDynastyLeagues.length) return 0;

  // ── 2. Gather leaguemate owner IDs across all the user's leagues ───────────
  const leaguemateOwnerIds = new Set<string>();
  await withConcurrency(
    userDynastyLeagues,
    async (league) => {
      const rosters =
        (await safeFetch<SleeperRoster[]>(
          `${SLEEPER_BASE_URL}/league/${league.league_id}/rosters`
        )) ?? [];
      rosters.forEach((r) => {
        if (r.owner_id && String(r.owner_id) !== String(sleeperUserId)) {
          leaguemateOwnerIds.add(String(r.owner_id));
        }
      });
    },
    CONCURRENCY
  );

  if (!leaguemateOwnerIds.size) return 0;

  // ── 3. For each leaguemate: walk their dynasty leagues and find trades ─────
  // Sleeper transactions return updated/created as ms epoch — same shape the
  // client builder at app/hooks/useAppState.ts:1083 assumes.
  const fourteenDaysAgo = Date.now() - TRADE_LOOKBACK_MS;

  const collected: AlertRow[] = [];
  const seenAlertIds = new Set<string>();

  for (const ownerId of leaguemateOwnerIds) {
    const ownerLeagues =
      (await safeFetch<SleeperLeague[]>(
        `${SLEEPER_BASE_URL}/user/${ownerId}/leagues/nfl/${CURRENT_YEAR}`
      )) ?? [];
    const ownerDynastyLeagues = ownerLeagues.filter(isDynastyLeague);
    if (!ownerDynastyLeagues.length) continue;

    await withConcurrency(
      ownerDynastyLeagues,
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
        const ownerRoster = rosters.find(
          (r) => String(r.owner_id) === ownerId
        );
        if (!ownerRoster) return;

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
            (t.updated || t.created || 0) > fourteenDaysAgo &&
            (t.roster_ids ?? []).includes(ownerRoster.roster_id)
        );

        for (const trade of recentTrades) {
          const alertId = `trade-${trade.transaction_id}-${ownerId}`;
          if (seenAlertIds.has(alertId)) continue;

          const addsEntries = Object.entries(trade.adds ?? {}) as AdHashEntry[];
          const acquired = addsEntries
            .filter(([, rid]) => Number(rid) === ownerRoster.roster_id)
            .map(([pid]) => resolvePlayerName(players, pid));
          const sent = addsEntries
            .filter(([, rid]) => Number(rid) !== ownerRoster.roster_id)
            .map(([pid]) => resolvePlayerName(players, pid));
          const picksReceived = (trade.draft_picks ?? [])
            .filter((p) => p.owner_id === ownerRoster.roster_id)
            .map(labelPick);
          const picksSent = (trade.draft_picks ?? [])
            .filter((p) => p.previous_owner_id === ownerRoster.roster_id)
            .map(labelPick);

          const acquiredAll = [...acquired, ...picksReceived];
          const sentAll = [...sent, ...picksSent];
          if (!acquiredAll.length && !sentAll.length) continue;

          const leagueName = league.name || "League";
          // Same fallback chain as the client builder at useAppState.ts:1118.
          const ts = trade.updated || trade.created || Date.now();

          // Owner display name isn't on the roster — pull from league users
          // would add another fetch per league. The client used the league
          // users map; without it the cron stores ownerId so the frontend can
          // resolve the display name on render.
          seenAlertIds.add(alertId);
          collected.push({
            user_id: authUserId,
            alert_id: alertId,
            category: "league",
            source: "internal",
            severity: "medium",
            title: `Leaguemate trade — ${leagueName}`,
            detail: acquiredAll.length
              ? `Received ${acquiredAll.join(", ")}${
                  sentAll.length ? `, sent ${sentAll.join(", ")}` : ""
                } in ${leagueName}.`
              : `Sent ${sentAll.join(", ")} in ${leagueName}.`,
            actionable: true,
            dismissed: false,
            league_id: league.league_id,
            player_id: null,
            payload: {
              ownerId,
              leagueName,
              acquired: acquiredAll,
              sent: sentAll,
            },
            updated_at: new Date(ts).toISOString(),
          });
        }
      },
      CONCURRENCY
    );
  }

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

  // One Sleeper player-map fetch covers the whole run — ~5 MB payload, so
  // not something to repeat per user. Used only for resolving player IDs in
  // trade.adds to readable names.
  const players =
    (await safeFetch<Record<string, SleeperPlayerBasic>>(
      `${SLEEPER_BASE_URL}/players/nfl`,
      SLEEPER_PLAYERS_TIMEOUT_MS
    )) ?? {};

  let usersProcessed = 0;
  let alertsInserted = 0;
  for (const link of links ?? []) {
    try {
      alertsInserted += await processUser(
        link.user_id,
        link.sleeper_user_id,
        players,
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
