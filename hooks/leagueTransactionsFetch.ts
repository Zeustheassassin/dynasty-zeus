"use client";
// ============================================================
// Alerts Hub transactions feed — read from league_transactions_cache
// ============================================================
// The league-transactions cron (app/api/cron/league-transactions) keeps every
// completed move it has ever seen. The feed used to read the newest 200 rows of
// every type at once, and waiver / free-agent moves are ~90% of a season's
// volume: across a 36-league account 200 rows reached back only ~3-4 days, so
// every older trade fell off the Trades tab. Trades are now read as their own
// window (last RECENT_TRADE_WINDOW_DAYS, newest ALERTS_HUB_TRADE_LIMIT) and the
// other moves as theirs.
// ============================================================
import { supabase } from "../lib/supabaseclient";
import {
  ALERTS_HUB_MOVE_LIMIT,
  ALERTS_HUB_TRADE_LIMIT,
  RECENT_TRADE_WINDOW_DAYS,
} from "../lib/constants";
import type { AnnotatedTransaction } from "../lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;

type CacheRow = { payload: unknown; created: number };

/**
 * The user's cached transactions, newest first: trades from the last
 * RECENT_TRADE_WINDOW_DAYS (at most ALERTS_HUB_TRADE_LIMIT) plus the newest
 * ALERTS_HUB_MOVE_LIMIT other moves. Throws when either read fails — half a
 * feed would show an empty Trades or Waivers tab as if nothing happened.
 */
export async function fetchCachedLeagueTransactions(
  uid: string,
  now: number = Date.now()
): Promise<AnnotatedTransaction[]> {
  const rows = () =>
    supabase.from("league_transactions_cache").select("payload, created").eq("user_id", uid);

  const [trades, moves] = await Promise.all([
    rows()
      .eq("payload->>type", "trade")
      .gte("created", now - RECENT_TRADE_WINDOW_DAYS * DAY_MS)
      .order("created", { ascending: false })
      .limit(ALERTS_HUB_TRADE_LIMIT),
    rows()
      .neq("payload->>type", "trade")
      .order("created", { ascending: false })
      .limit(ALERTS_HUB_MOVE_LIMIT),
  ]);
  if (trades.error) throw new Error(`trades read failed: ${trades.error.message}`);
  if (moves.error) throw new Error(`moves read failed: ${moves.error.message}`);

  return [...((trades.data ?? []) as CacheRow[]), ...((moves.data ?? []) as CacheRow[])]
    .sort((a, b) => Number(b.created) - Number(a.created))
    .map((r) => r.payload as AnnotatedTransaction);
}
