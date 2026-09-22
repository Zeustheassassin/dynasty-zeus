// ============================================================
// Service-role Supabase client — SERVER-ONLY.
// ============================================================
// The shared cache tables (fc_values_cache, fc_redraft_values_cache, sleeper_stats_cache,
// cross_league_rosters_cache) give anon/authenticated a SELECT policy and nothing else (migrations
// 026/053), so a write through the anon client in lib/supabaseclient.ts is denied by RLS. Those writes
// must come from the service role, on the server — NOT from an anon INSERT/UPDATE policy, which would
// let any browser poison the cache every user reads.
//
// The key is read from SUPABASE_SERVICE_ROLE_KEY (deliberately not NEXT_PUBLIC_-prefixed, so Next never
// inlines it into a client bundle — it is `undefined` there). Import this module only from route
// handlers / server code; __tests__/lib/supabaseAdmin.test.ts enforces that boundary.
// ============================================================

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { logger } from "./logger";
import { withRetry } from "./withRetry";
import type { CacheTable } from "./supabaseclient";

const log = logger("lib/supabaseAdmin");

let admin: SupabaseClient | null = null;
let warnedMissingKey = false;

/** The service-role client (bypasses RLS), or null when SUPABASE_SERVICE_ROLE_KEY isn't configured
 *  (local dev, previews) so callers can serve live data and skip the write instead of crashing.
 *  Prefer `upsertCacheRow` for cache writes; reach for this only for a genuine server-side need. */
export function getSupabaseAdmin(): SupabaseClient | null {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      log.warn("SUPABASE_SERVICE_ROLE_KEY is not configured — shared cache writes are disabled");
    }
    return null;
  }
  admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return admin;
}

/** PostgrestError is a plain object, not an Error, so `String(err)` would log "[object Object]". */
function describeError(err: unknown): { err: string; code?: string } {
  if (err && typeof err === "object" && "message" in err) {
    const { message, code } = err as { message: unknown; code?: unknown };
    return { err: String(message), code: typeof code === "string" ? code : undefined };
  }
  return { err: String(err) };
}

/** Upserts one row into a shared cache table with the service role, retrying transient failures.
 *  Resolves true on success and false when skipped (no key) or failed after retries — it never
 *  throws, so it is safe to fire from `afterResponse` or to await inside a cron. */
export async function upsertCacheRow(table: CacheTable, row: Record<string, unknown>): Promise<boolean> {
  const client = getSupabaseAdmin();
  if (!client) return false;
  try {
    await withRetry(() =>
      client.from(table).upsert(row).then(({ error }) => { if (error) throw error; })
    );
    return true;
  } catch (err) {
    log.error("cache write failed after retries", { table, ...describeError(err) });
    return false;
  }
}
