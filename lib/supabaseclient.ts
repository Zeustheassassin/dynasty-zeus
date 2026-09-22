import { createClient } from "@supabase/supabase-js";
import { logger } from "./logger";

const log = logger("lib/supabaseclient");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. " +
    "Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/** Tables shared between the anon-read / service-role-write cache pattern (see readCacheRow
 *  below and the row-write helper in the service-role client module) — a closed list so
 *  neither helper can be pointed at user data. */
export type CacheTable =
  | "fc_values_cache"
  | "fc_redraft_values_cache"
  | "sleeper_stats_cache"
  | "cross_league_rosters_cache";

/** PostgrestError is a plain object, not an Error, so `String(err)` would log "[object Object]". */
function describeReadError(err: unknown): { err: string; code?: string } {
  if (err && typeof err === "object" && "message" in err) {
    const { message, code } = err as { message: unknown; code?: unknown };
    return { err: String(message), code: typeof code === "string" ? code : undefined };
  }
  return { err: String(err) };
}

/** Reads one row from a shared cache table with the anon client — these tables grant anon
 *  SELECT (migrations 026/053), so no service role is needed for a read, only a write (see
 *  the row-write helper in the service-role client module). `filters` are applied as `.eq()`
 *  in order. Resolves null on a miss OR any read failure; callers decide freshness/validity
 *  from there — this never throws.
 *
 *  Logs any error that isn't PostgREST's "no rows" code (PGRST116, the ordinary cache-miss
 *  shape `.single()` returns) — an RLS policy regression on one of these tables (the exact
 *  failure class in project memory: RLS enabled with zero policies silently broke 3 cache
 *  tables) resolves `{data: null, error}` rather than throwing, so without this check it was
 *  indistinguishable from a normal cache miss and never showed up anywhere (code-review catch). */
export async function readCacheRow<T extends Record<string, unknown>>(
  table: CacheTable,
  filters: [string, string | number][],
  columns: string
): Promise<T | null> {
  try {
    const base = supabase.from(table).select(columns);
    const filtered = filters.reduce((q, [col, val]) => q.eq(col, val), base);
    const { data, error } = await filtered.single();
    if (error && error.code !== "PGRST116") {
      log.error("cache read failed", { table, ...describeReadError(error) });
    }
    return (data as T | null) ?? null;
  } catch (err) {
    log.error("cache read threw", { table, ...describeReadError(err) });
    return null; // cache read failed — treat as a miss
  }
}
