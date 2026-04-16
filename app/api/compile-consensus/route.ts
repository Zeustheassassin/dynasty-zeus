import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../../../lib/rateLimit";
import { apiError } from "../../../lib/apiHelpers";
import {
  SLEEPER_BASE_URL,
  COMPILE_CONCURRENCY,
  COMPILE_PICKS_CONCURRENCY,
  SLEEPER_REQUEST_TIMEOUT_MS,
  SLEEPER_PLAYERS_TIMEOUT_MS,
  getCompilationYearRange,
} from "../../../lib/constants";

// Allow up to 5 minutes for large networks (Vercel Pro/Enterprise)
export const maxDuration = 300;

const SLEEPER_BASE        = SLEEPER_BASE_URL;
const CONCURRENCY         = COMPILE_CONCURRENCY;
const PICKS_CONCURRENCY   = COMPILE_PICKS_CONCURRENCY;
const REQUEST_TIMEOUT_MS  = SLEEPER_REQUEST_TIMEOUT_MS;
const PLAYERS_TIMEOUT_MS  = SLEEPER_PLAYERS_TIMEOUT_MS;

// ── Local types for Sleeper API responses ─────────────────────────────────────

interface SleeperLeagueBasic {
  league_id: string;
  settings?: { taxi_slots?: number; best_ball?: number };
  roster_positions?: string[];
}

interface SleeperRosterBasic {
  roster_id: number;
  owner_id?: string;
  players?: string[];
}

interface SleeperDraftBasic {
  draft_id: string;
  season: string;
  status: string;
  settings?: { rounds?: number; teams?: number };
}

interface SleeperPickBasic {
  player_id?: string;
  pick_no?: number;
  metadata?: {
    first_name?: string;
    last_name?: string;
    position?: string;
    team?: string;
    years_exp?: string | number | null;
  };
}

interface SleeperPlayerBasic {
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch with automatic retry on rate-limit (429) or transient network errors.
 * Uses exponential backoff: 600 ms, 1.2 s, 2.4 s between retries.
 */
async function safeFetch<T>(url: string, timeoutMs = REQUEST_TIMEOUT_MS, retries = 3): Promise<T | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) {
        // Rate limited — back off before retrying
        if (attempt < retries) {
          await delay(600 * Math.pow(2, attempt));
          continue;
        }
        return null;
      }
      if (!res.ok) return null;
      return await res.json() as T;
    } catch {
      if (attempt < retries) {
        await delay(400 * Math.pow(2, attempt));
        continue;
      }
      return null;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Runs `fn` over all `items` with at most `limit` concurrent operations.
 * Processes in strict batches so we don't flood the API with all requests at once.
 */
async function withConcurrency<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number
): Promise<void> {
  for (let i = 0; i < items.length; i += limit) {
    await Promise.all(items.slice(i, i + limit).map(fn));
  }
}

function isDynastyLeague(l: SleeperLeagueBasic): boolean {
  return (
    ((l.settings?.taxi_slots ?? 0) > 0 || (l.roster_positions?.length ?? 0) > 20) &&
    (l.settings?.best_ball ?? 0) === 0
  );
}

function isSuperflex(l: SleeperLeagueBasic): boolean {
  return Array.isArray(l.roster_positions) && l.roster_positions.includes("SUPER_FLEX");
}

const IDP_POSITIONS = new Set(["DB", "DL", "LB", "IDP_FLEX", "DE", "DT", "CB", "S"]);
function hasIDP(l: SleeperLeagueBasic): boolean {
  return Array.isArray(l.roster_positions) &&
    l.roster_positions.some((pos: string) => IDP_POSITIONS.has(pos));
}

// ── Main compilation function ─────────────────────────────────────────────────

async function compileDrafts(
  sleeperUserId: string,
  years: number[],
  authUserId: string,
  // The client is created at runtime without a schema type — `any` avoids the
  // "never" overload errors that Supabase emits for untyped table names.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseClient: ReturnType<typeof createClient<any>>,
  emit: (event: object) => void
): Promise<void> {

  // ── Step 1: Collect user's leagues + connected user IDs ──────────────────
  emit({ type: "status", message: "Collecting your dynasty leagues across all years…", progress: 2 });

  const connectedUserIds = new Set<string>();
  const userLeagueIdsByYear: Record<number, string[]> = {};

  await Promise.all(
    years.map(async (year) => {
      const leagues = await safeFetch<SleeperLeagueBasic[]>(`${SLEEPER_BASE}/user/${sleeperUserId}/leagues/nfl/${year}`);
      if (!Array.isArray(leagues)) return;
      const dynLeagues = leagues.filter(isDynastyLeague).filter(isSuperflex).filter((l) => !hasIDP(l));
      userLeagueIdsByYear[year] = dynLeagues.map((l: SleeperLeagueBasic) => l.league_id);

      // Fetch rosters in parallel to gather owner IDs
      await Promise.all(
        dynLeagues.map(async (league: SleeperLeagueBasic) => {
          const rosters = await safeFetch<SleeperRosterBasic[]>(`${SLEEPER_BASE}/league/${league.league_id}/rosters`);
          if (!Array.isArray(rosters)) return;
          rosters.forEach((r: SleeperRosterBasic) => {
            if (r.owner_id && String(r.owner_id) !== String(sleeperUserId)) {
              connectedUserIds.add(String(r.owner_id));
            }
          });
        })
      );
    })
  );

  emit({
    type: "status",
    message: `Found ${connectedUserIds.size} connected users across your leagues. Scanning all their leagues…`,
    progress: 15,
  });

  // ── Step 2: Expand to all connected users' leagues ───────────────────────
  const allLeagueIds = new Set<string>();
  // Seed with user's own leagues
  Object.values(userLeagueIdsByYear).forEach((ids) => ids.forEach((id) => allLeagueIds.add(id)));

  // Build (userId, year) pairs for expansion
  const userYearPairs: Array<[string, number]> = [];
  connectedUserIds.forEach((uid) => years.forEach((yr) => userYearPairs.push([uid, yr])));

  let pairsDone = 0;
  await withConcurrency(
    userYearPairs,
    async ([uid, yr]) => {
      const leagues = await safeFetch<SleeperLeagueBasic[]>(`${SLEEPER_BASE}/user/${uid}/leagues/nfl/${yr}`);
      if (Array.isArray(leagues)) {
        leagues.filter(isDynastyLeague).filter(isSuperflex).filter((l) => !hasIDP(l)).forEach((l: SleeperLeagueBasic) => allLeagueIds.add(l.league_id));
      }
      pairsDone++;
      if (pairsDone % 50 === 0 || pairsDone === userYearPairs.length) {
        emit({
          type: "status",
          message: `Scanned ${pairsDone}/${userYearPairs.length} user-year combinations — ${allLeagueIds.size} unique leagues found…`,
          progress: 15 + Math.floor((pairsDone / userYearPairs.length) * 25),
        });
      }
    },
    CONCURRENCY
  );

  emit({
    type: "status",
    message: `Identified ${allLeagueIds.size} unique dynasty leagues. Scanning for completed rookie drafts…`,
    progress: 40,
  });

  // ── Step 3: Collect completed rookie draft IDs per year ──────────────────
  const draftIdsByYear: Record<number, Set<string>> = {};
  years.forEach((yr) => { draftIdsByYear[yr] = new Set(); });

  const leagueIdArray = Array.from(allLeagueIds);
  let leaguesDone = 0;

  await withConcurrency(
    leagueIdArray,
    async (leagueId) => {
      const drafts = await safeFetch<SleeperDraftBasic[]>(`${SLEEPER_BASE}/league/${leagueId}/drafts`);
      if (Array.isArray(drafts)) {
        const currentYear = new Date().getFullYear();
        drafts.forEach((d: SleeperDraftBasic) => {
          const season = parseInt(String(d.season), 10);
          if (!years.includes(season)) return;
          // Never compile the current calendar year — the NFL Draft hasn't happened yet
          // so any "complete" drafts are startup/veteran drafts, not rookie drafts
          if (season >= currentYear) return;
          if (d.status !== "complete") return;
          // Rookie-only drafts have ≤6 rounds; skip startup/full-roster drafts
          const rounds = d.settings?.rounds ?? 99;
          if (rounds > 6) return;
          draftIdsByYear[season]?.add(d.draft_id);
        });
      }
      leaguesDone++;
      if (leaguesDone % 100 === 0 || leaguesDone === leagueIdArray.length) {
        const totalFound = Object.values(draftIdsByYear).reduce((s, d) => s + d.size, 0);
        emit({
          type: "status",
          message: `Scanned ${leaguesDone}/${leagueIdArray.length} leagues — ${totalFound} rookie drafts found so far…`,
          progress: 40 + Math.floor((leaguesDone / leagueIdArray.length) * 25),
        });
      }
    },
    CONCURRENCY
  );

  const totalDrafts = Object.values(draftIdsByYear).reduce((s, d) => s + d.size, 0);
  emit({
    type: "status",
    message: `Found ${totalDrafts} total completed rookie drafts. Loading Sleeper player database…`,
    progress: 65,
  });

  // ── Fetch full Sleeper player map once — used as fallback for picks with empty metadata ──
  // Many 2024/2025 picks have no metadata.first_name/last_name because the player was added
  // to Sleeper's database after the dynasty draft was held. Without this fallback those picks
  // are silently skipped, causing the compiled draft count to be correct but the player list empty.
  const sleeperPlayers = await safeFetch<Record<string, SleeperPlayerBasic>>(
    `${SLEEPER_BASE}/players/nfl`,
    PLAYERS_TIMEOUT_MS
  ) ?? {};

  const playerDbSize = Object.keys(sleeperPlayers).length;
  if (playerDbSize < 100) {
    emit({ type: "status", message: "Warning: Sleeper player database failed to load — names/positions may be incomplete. Try recompiling.", progress: 67 });
  } else {
    emit({
      type: "status",
      message: `Loaded ${playerDbSize.toLocaleString()} players from Sleeper database. Fetching picks…`,
      progress: 67,
    });
  }

  // ── Step 4: Fetch picks and compile per year ──────────────────────────────
  for (const year of years) {
    const draftIds = Array.from(draftIdsByYear[year]);

    if (draftIds.length === 0) {
      emit({
        type: "year_done",
        year,
        draftCount: 0,
        leagueCount: 0,
        playerCount: 0,
        connectedUserCount: connectedUserIds.size,
      });
      continue;
    }

    emit({
      type: "status",
      message: `Fetching picks from ${draftIds.length} ${year} rookie drafts (this may take a few minutes)…`,
      progress: 67,
    });

    // player_id → aggregated data
    const playerMap = new Map<string, {
      player_name: string;
      position: string;
      team: string;
      picks: number[];
    }>();

    let draftsOk = 0, draftsFailed = 0, picksSkippedVet = 0;

    await withConcurrency(
      draftIds,
      async (draftId) => {
        const picks = await safeFetch<SleeperPickBasic[]>(`${SLEEPER_BASE}/draft/${draftId}/picks`);
        if (!Array.isArray(picks)) { draftsFailed++; return; }
        draftsOk++;

        picks.forEach((pick: SleeperPickBasic) => {
          if (!pick.player_id || !pick.pick_no) return;

          // Filter out veterans — only count players who were rookies (years_exp === 0)
          // when this pick was made. years_exp is stored in pick metadata at draft time.
          const yearsExpRaw = pick.metadata?.years_exp;
          if (yearsExpRaw !== undefined && yearsExpRaw !== null && yearsExpRaw !== "") {
            const yearsExp = parseInt(String(yearsExpRaw), 10);
            if (!isNaN(yearsExp) && yearsExp > 0) { picksSkippedVet++; return; }
          }

          // Use pick metadata first, fall back to full Sleeper player database
          const fullPlayer = sleeperPlayers[pick.player_id];
          const firstName  = (pick.metadata?.first_name ?? fullPlayer?.first_name ?? "").trim();
          const lastName   = (pick.metadata?.last_name  ?? fullPlayer?.last_name  ?? "").trim();
          const name       = `${firstName} ${lastName}`.trim();
          if (!name) return; // truly unknown player — skip

          const position = (pick.metadata?.position ?? fullPlayer?.position ?? "").trim();
          const team     = (pick.metadata?.team     ?? fullPlayer?.team     ?? "").trim();

          if (!playerMap.has(pick.player_id)) {
            playerMap.set(pick.player_id, { player_name: name, position, team, picks: [] });
          }
          const entry = playerMap.get(pick.player_id)!;
          entry.picks.push(Number(pick.pick_no));
          if (position)                               entry.position    = position;
          if (team)                                   entry.team        = team;
          if (name.length > entry.player_name.length) entry.player_name = name;
        });
      },
      PICKS_CONCURRENCY
    );

    emit({
      type: "status",
      message: `${year}: ${draftsOk} drafts fetched, ${draftsFailed} failed, ${playerMap.size} unique players found (${picksSkippedVet} vet picks filtered). Saving…`,
      progress: 85,
    });

    // Build rows sorted by average pick number
    const rows = Array.from(playerMap.entries())
      .map(([player_id, data]) => ({
        user_id:      authUserId,
        year,
        player_id,
        player_name:  data.player_name,
        position:     data.position,
        team:         data.team,
        avg_pick_no:  data.picks.reduce((s, p) => s + p, 0) / data.picks.length,
        draft_count:  data.picks.length,
      }))
      .sort((a, b) => a.avg_pick_no - b.avg_pick_no);

    // Delete old data for this user+year, then insert fresh rows
    await supabaseClient
      .from("consensus_draft_cache")
      .delete()
      .eq("user_id", authUserId)
      .eq("year", year);

    // Insert in batches of 200 to stay under Supabase request size limits
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await supabaseClient.from("consensus_draft_cache").insert(rows.slice(i, i + 200));
      if (error) {
        emit({ type: "status", message: `Warning: save error for ${year} batch ${i}: ${error.message}`, progress: 85 });
      }
    }

    // Save/update metadata for this year
    await supabaseClient.from("consensus_draft_meta").upsert(
      {
        user_id:              authUserId,
        year,
        total_drafts:         draftIds.length,
        total_leagues:        allLeagueIds.size,
        connected_user_count: connectedUserIds.size,
        compiled_at:          new Date().toISOString(),
      },
      { onConflict: "user_id,year" }
    );

    emit({
      type: "year_done",
      year,
      draftCount:          draftIds.length,
      leagueCount:         allLeagueIds.size,
      playerCount:         rows.length,
      connectedUserCount:  connectedUserIds.size,
    });
  }

  emit({ type: "done", message: "Compilation complete!", progress: 100 });
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<Response> {
  // Compile is very expensive — strict rate limit: 5 compilations per 10 minutes per IP
  const rl = checkRateLimit(req, 5, 10 * 60_000, 'compile-consensus');
  if (!rl.allowed) return rl.response;

  let body: { sleeperUserId?: string; accessToken?: string; years?: number[] };
  try {
    body = await req.json();
  } catch {
    return apiError("Bad JSON in request body", 400, "INVALID_JSON");
  }

  const { sleeperUserId, accessToken, years } = body;

  if (!sleeperUserId || !accessToken || !Array.isArray(years) || years.length === 0) {
    return apiError("Missing required params: sleeperUserId, accessToken, years[]", 400, "MISSING_PARAMS");
  }

  // Guard against absurdly large arrays before filtering (issue #40)
  if (years.length > 20) {
    return apiError("years array must contain at most 20 entries", 400, "YEARS_TOO_MANY");
  }

  // Validate year range — anchored dynamically so no code change needed each year
  const { min: YEAR_MIN, max: YEAR_MAX } = getCompilationYearRange();
  const validYears = years.filter(
    (y) => typeof y === "number" && Number.isInteger(y) && y >= YEAR_MIN && y <= YEAR_MAX
  );
  if (validYears.length === 0) {
    return apiError(`No valid years. Must be integers between ${YEAR_MIN} and ${YEAR_MAX}`, 400, "INVALID_YEARS");
  }

  // Build an authenticated Supabase client using the caller's access token
  // This ensures RLS policies (auth.uid() = user_id) are respected.
  const supabaseClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
  );

  // Verify the token is valid and get the auth user ID
  const { data: { user: authUser } } = await supabaseClient.auth.getUser();
  if (!authUser) {
    return apiError("Unauthorized — invalid or expired access token", 401, "UNAUTHORIZED");
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: object) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Stream may be closed if client disconnected — swallow
        }
      };

      try {
        await compileDrafts(sleeperUserId, validYears, authUser.id, supabaseClient, emit);
      } catch (err: unknown) {
        emit({ type: "error", message: err instanceof Error ? err.message : "Unknown compilation error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":      "application/x-ndjson",
      "Cache-Control":     "no-cache",
      "X-Accel-Buffering": "no",   // Disable nginx buffering for streaming
      "Transfer-Encoding": "chunked",
    },
  });
}
