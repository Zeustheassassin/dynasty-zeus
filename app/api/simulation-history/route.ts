import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../../../lib/rateLimit";
import { apiError, isValidSleeperId } from "../../../lib/apiHelpers";
import { safeFetch } from "../../../lib/sleeperServer";
import { SLEEPER_BASE_URL } from "../../../lib/constants";
import { logger } from "../../../lib/logger";

// ============================================================
// POST /api/simulation-history
// ============================================================
// Client-triggered sibling to app/api/cron/simulation-history. The weekly
// cron discovers leagues server-side and is a non-personalized fallback,
// but every registered user already runs "Run All Sims" every few days
// (far more often than weekly) and that click already computes the exact
// same SimulationTeamRow[] the cron would produce (see
// app/hooks/useSimulatorState.ts's selectedLeagueSimulation). This route
// lets that click also persist a history snapshot, so the odds-tracker
// chart/sparklines (Phase F stage F2, Dashboard Phase J) get real data
// driven by actual usage instead of depending solely on the cron.
//
// league_simulation_history is NOT user-scoped (migration 044 disables
// RLS and restricts INSERT/UPDATE to service_role — it's a shared,
// non-personalized cache, same trust model as fc_values_cache). A logged
// -in user's browser only has the anon key, so it can't write it
// directly; this route re-verifies the caller's Supabase session, then
// writes with the service-role key, mirroring compile-consensus's
// accessToken pattern.
// ============================================================

const log = logger("api/simulation-history");

interface HistoryRowInput {
  rosterId: number;
  playoffOdds: number;
  titleOdds: number;
  expectedWins: number;
  avgFinish: number;
  finishRange: string;
}

function isValidRow(r: unknown): r is HistoryRowInput {
  if (!r || typeof r !== "object") return false;
  const row = r as Record<string, unknown>;
  return (
    typeof row.rosterId === "number" && Number.isFinite(row.rosterId) &&
    typeof row.playoffOdds === "number" && Number.isFinite(row.playoffOdds) &&
    typeof row.titleOdds === "number" && Number.isFinite(row.titleOdds) &&
    typeof row.expectedWins === "number" && Number.isFinite(row.expectedWins) &&
    typeof row.avgFinish === "number" && Number.isFinite(row.avgFinish) &&
    typeof row.finishRange === "string"
  );
}

export async function POST(req: NextRequest): Promise<Response> {
  const rl = await checkRateLimit(req, 60, 10 * 60_000, "simulation-history");
  if (!rl.allowed) return rl.response;

  let body: {
    accessToken?: string;
    leagueId?: string;
    season?: string;
    week?: number;
    rows?: unknown[];
  };
  try {
    body = await req.json();
  } catch {
    return apiError("Bad JSON in request body", 400, "INVALID_JSON");
  }

  const { accessToken, leagueId, season, week, rows } = body;

  if (!accessToken) return apiError("Missing accessToken", 400, "MISSING_PARAMS");
  if (typeof leagueId !== "string" || !isValidSleeperId(leagueId)) return apiError("Missing or invalid leagueId", 400, "MISSING_PARAMS");
  if (typeof season !== "string" || !/^\d{4}$/.test(season)) return apiError("Invalid season", 400, "INVALID_SEASON");
  if (typeof week !== "number" || !Number.isInteger(week) || week < 0 || week > 25) {
    return apiError("Invalid week", 400, "INVALID_WEEK");
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 40 || !rows.every(isValidRow)) {
    return apiError("Invalid rows", 400, "INVALID_ROWS");
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    log.error("Supabase env vars not configured");
    return apiError("Server misconfiguration", 500, "SERVER_MISCONFIGURED");
  }

  // Verify the caller's session with the anon key + their token (never trust
  // a client-supplied user id) before touching the service-role client.
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: { user: authUser } } = await authClient.auth.getUser();
  if (!authUser) {
    return apiError("Unauthorized — invalid or expired access token", 401, "UNAUTHORIZED");
  }

  // league_simulation_history has no per-row owner (shared, non-personalized
  // cache — see the header comment) and is written with the service-role
  // key, so without this check any authenticated user could POST fabricated
  // odds for a league they aren't even in. Resolve the caller's linked
  // Sleeper account, then confirm they actually own a roster in this league.
  const { data: link } = await authClient
    .from("user_sleeper_links")
    .select("sleeper_user_id")
    .eq("user_id", authUser.id)
    .maybeSingle();
  if (!link?.sleeper_user_id) {
    return apiError("No linked Sleeper account", 403, "NO_SLEEPER_LINK");
  }

  const rosters = await safeFetch<Array<{ owner_id?: string; co_owners?: string[] | null }>>(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`);
  const isMember = Array.isArray(rosters) && rosters.some((r) =>
    String(r.owner_id) === String(link.sleeper_user_id) ||
    (r.co_owners ?? []).some((id) => String(id) === String(link.sleeper_user_id))
  );
  if (!isMember) {
    return apiError("You are not a member of this league", 403, "LEAGUE_ACCESS_DENIED");
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const computedAt = new Date().toISOString();
  const dbRows = (rows as HistoryRowInput[]).map((row) => ({
    league_id: leagueId,
    roster_id: row.rosterId,
    season,
    week,
    playoff_odds: row.playoffOdds,
    title_odds: row.titleOdds,
    expected_wins: row.expectedWins,
    avg_finish: row.avgFinish,
    finish_range: row.finishRange,
    computed_at: computedAt,
  }));

  const { error, data } = await serviceClient
    .from("league_simulation_history")
    .upsert(dbRows, { onConflict: "league_id,roster_id,season,week" })
    .select("id");

  if (error) {
    log.error("league_simulation_history upsert failed", { leagueId, err: error.message });
    return apiError("Write failed", 500, "WRITE_FAILED");
  }

  return Response.json({ ok: true, rowsWritten: Array.isArray(data) ? data.length : 0 });
}
