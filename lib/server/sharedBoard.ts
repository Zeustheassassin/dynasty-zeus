// Reads one shared Big Board for the public /board/{token} page (migration 105).
// The anon key is enough: get_shared_big_board is SECURITY DEFINER and returns
// only the class year, the rows and when they were saved, for the one token.

import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../logger";
import { parseSharedBoardRows, SHARE_TOKEN_RE, type SharedBoardResult } from "../scouting/sharedBoard";

const log = logger("lib/server/sharedBoard");

interface SharedBoardRpcRow {
  class_year: number;
  rows: unknown;
  updated_at: string;
}

/** The board a token names. Deduped per request (the page and its metadata both ask). */
export const loadSharedBoard = cache(async (token: string): Promise<SharedBoardResult> => {
  if (!SHARE_TOKEN_RE.test(token)) return { status: "missing" };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    log.error("shared board: Supabase env missing");
    return { status: "error" };
  }
  const supabase = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await supabase.rpc("get_shared_big_board", { p_token: token });
  if (error) {
    // Before migration 105 the function doesn't exist: every link reads as not found.
    const missingFn = error.code === "PGRST202" || error.code === "42883";
    if (missingFn) {
      log.warn("get_shared_big_board missing (apply migration 105)");
      return { status: "missing" };
    }
    log.error("shared board load", { msg: error.message, code: error.code });
    return { status: "error" };
  }
  const row = (Array.isArray(data) ? data[0] : null) as SharedBoardRpcRow | null | undefined;
  if (!row || typeof row.class_year !== "number") return { status: "missing" };
  return {
    status: "ready",
    board: { classYear: row.class_year, rows: parseSharedBoardRows(row.rows), updatedAt: String(row.updated_at) },
  };
});
