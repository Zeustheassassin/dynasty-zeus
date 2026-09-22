// ============================================================
// Cron — Daily dynasty-value history snapshot
// ============================================================
// Runs on a Vercel cron schedule. Loads the shared FantasyCalc 2QB
// dynasty values through getFcValues (lib/server/fcValues.ts) — the
// exact same table/row app/hooks/useAppState.ts's loadPlayers merges
// onto players[id].value for every user, regardless of league or
// personal numQbs preference (see that file's loadPlayers) — and
// appends one row per player into player_value_history (migration 047)
// for today's date. Upserted on (player_id, snapshot_date) so a
// retried/duplicate run for the same day overwrites cleanly instead of
// accumulating dupes, same idempotency pattern as the other crons.
//
// The cron refreshes FantasyCalc ITSELF when the cached row is older than
// SNAPSHOT_MAX_AGE_MS, and refuses stale data: if it can't get values from
// the last few hours it writes NOTHING and answers 502. Previously it read
// whatever fc_values_cache held, so once cache writes broke (Sept 21 2026
// audit) it stamped the same frozen payload every day — a fake, flat trend.
//
// This is deliberately NOT per-user: player_value_snapshots (the
// existing single-row-per-user table) stores this same generic value,
// not a league-adjusted one, so a single shared daily row per player
// serves every user — same reasoning as league_simulation_history
// (migration 044) being a shared cache rather than per-user.
//
// Feeds the Phase D stage D4 (PlayerProfilePanel) / D5 (PowerRankingsTab)
// value-trend charts, which have been 2-point comparisons since Phase D
// shipped because no dated history table existed yet — see the
// project_platform_upgrade_phase_d_july16 memory.
//
// Auth mirrors app/api/cron/league-transactions and
// app/api/cron/simulation-history:
//   - Authorization: Bearer ${CRON_SECRET}
//   - Service-role Supabase client bypasses RLS (table has RLS disabled
//     anyway, but writes are still restricted to service_role by GRANT)
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { logger } from "../../../../lib/logger";
import { getFcValues, type FcRawEntry } from "../../../../lib/server/fcValues";
import { verifyCron } from "../../../../lib/server/verifyCron";

const log = logger("cron/player-value-history");

export const maxDuration = 60;

/** A cached FantasyCalc row older than this is refreshed before the snapshot is taken, so each daily
 *  row reflects values from the last few hours rather than a day-old cache. */
const SNAPSHOT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function parsePlayerValues(raw: FcRawEntry[]): { player_id: string; value: number }[] {
  const rows: { player_id: string; value: number }[] = [];
  raw.forEach((entry) => {
    if (entry.player?.position === "PICK") return;
    if (typeof entry.value !== "number" || entry.value <= 0) return;
    const sid = entry.player?.sleeperId;
    if (!sid) return;
    rows.push({ player_id: String(sid), value: Math.round(entry.value) });
  });
  return rows;
}

export async function GET(req: NextRequest): Promise<Response> {
  const unauthorized = verifyCron(req, log);
  if (unauthorized) return unauthorized;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    log.error("Supabase service-role env vars not configured");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // allowStale:false — a history row must never be stamped with values older than the freshness window.
  const fc = await getFcValues(2, true, { maxAgeMs: SNAPSHOT_MAX_AGE_MS, allowStale: false });
  if (!fc) {
    log.error("FantasyCalc values unavailable — skipping today's snapshot instead of stamping stale values");
    return NextResponse.json({ ok: false, error: "FantasyCalc values unavailable" }, { status: 502 });
  }

  const values = parsePlayerValues(fc.data);
  if (!values.length) {
    return NextResponse.json({ ok: true, playersFound: 0, rowsWritten: 0 });
  }

  const snapshotDate = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const rows = values.map((v) => ({
    player_id: v.player_id,
    snapshot_date: snapshotDate,
    value: v.value,
    computed_at: nowIso,
  }));

  let rowsWritten = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const { error, data } = await supabase
      .from("player_value_history")
      .upsert(batch, { onConflict: "player_id,snapshot_date" })
      .select("id");
    if (error) {
      log.error("player_value_history upsert failed", { batchStart: i, err: error.message });
      continue;
    }
    rowsWritten += Array.isArray(data) ? data.length : 0;
  }

  return NextResponse.json({
    ok: true,
    playersFound: values.length,
    rowsWritten,
    snapshotDate,
    fcSource: fc.source,
    fcFetchedAt: fc.fetchedAt,
  });
}
