// ============================================================
// Cron — Weekly simulator odds-snapshot history
// ============================================================
// Runs on a Vercel cron schedule. Discovers every dynasty league any
// registered user belongs to (deduped by league_id — a league shared
// by several registered users is simulated once), reconstructs the
// same inputs the interactive Simulator tab uses (rosters, standings,
// weekly matchup history, league-adjusted FantasyCalc values, Sleeper
// projections/stats, and — offseason only — a projected rookie pool),
// and calls the SAME `simulateLeague` engine the client uses. Results
// are appended (not overwritten) to league_simulation_history so a
// later chart (Phase F stage F2) can plot playoff/title odds over
// time. This is separate from `league_simulations`, the per-user
// "last run" cache the client's "Run All Sims" button writes to —
// that table and flow are untouched.
//
// Deliberate simplifications vs. the interactive tab (both inherent
// to being a shared, non-personalized background job — see
// [[project_platform_upgrade_plan_july15]] Phase F / stage F1):
//   - Projections use the Sleeper source only (FantasyPros/numberFire
//     are per-user opt-in toggles with no server equivalent).
//   - The offseason rookie pool uses the CANONICAL crowdsourced board
//     (sheet + Sleeper ADP + FC Superflex dynasty values), not any
//     individual user's personally-reordered board.
//
// Auth + idempotency mirror app/api/cron/league-transactions:
//   - Authorization: Bearer ${CRON_SECRET}
//   - Service-role Supabase client bypasses RLS
//   - Upsert with onConflict (league_id, roster_id, season, week) so a
//     retried/duplicate run for the same week overwrites cleanly
//     instead of accumulating dupes.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { safeFetch, withConcurrency } from "../../../../lib/sleeperServer";
import {
  CURRENT_YEAR, YEARS, ROUNDS, BASE_YEAR,
  getDraftRoundSlot, computeScoringMultipliers, computeLeagueFpts,
  getLeagueNumQbs, normalizeRookieName, DEFAULT_SCORING,
} from "../../../../lib/helpers";
import {
  SLEEPER_BASE_URL, SLEEPER_PROJECTIONS_BASE, ROOKIE_BOARD_SHEET_URL,
  SLEEPER_PLAYERS_TIMEOUT_MS, SLEEPER_REQUEST_TIMEOUT_MS,
} from "../../../../lib/constants";
import { simulateLeague } from "../../../../lib/helpers/simulation";
import { projectRookiesByRoster } from "../../../../lib/helpers/rookieProjection";
import { logger } from "../../../../lib/logger";
import type {
  SleeperLeague, SleeperRoster, SleeperUser, SleeperDraft, SleeperTradedPick,
  SleeperMatchup, SleeperNFLState, SleeperPlayer, StandingRow, ProjectionRow,
  RookieBoardPlayer, AugmentedPick,
} from "../../../../lib/types";
import type { PlayerUsage } from "../../../../hooks/usePlayerStats";

const log = logger("cron/simulation-history");

export const maxDuration = 300;

// Per-league / per-Sleeper-user concurrency cap — matches the other crons
// so overlapping runs keep a similar load profile against Sleeper.
const CONCURRENCY = 5;

function isDynastyLeague(l: SleeperLeague): boolean {
  return (
    ((l.settings?.taxi_slots ?? 0) > 0 ||
      (l.roster_positions?.length ?? 0) > 20) &&
    (l.settings?.best_ball ?? 0) === 0
  );
}

async function fetchText(url: string, timeoutMs = SLEEPER_REQUEST_TIMEOUT_MS): Promise<string> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  }
}

// ── Slim player shape — mirrors app/api/players/route.ts's SlimPlayer.
// Only the fields simulateLeague/projectRookiesByRoster actually read.
// Cast to Record<string, SleeperPlayer> at the simulateLeague boundary,
// same as the real client players map (which is this same slim shape
// merged with FC `.value`, see app/hooks/useAppState.ts's loadPlayers).
interface SimPlayer {
  player_id: string;
  full_name: string;
  position: string;
  team: string | null;
  years_exp: number | null;
  value?: number;
}

async function fetchSlimPlayers(): Promise<Record<string, SimPlayer>> {
  const raw = await safeFetch<Record<string, Record<string, unknown>>>(
    `${SLEEPER_BASE_URL}/players/nfl`,
    SLEEPER_PLAYERS_TIMEOUT_MS
  );
  const players: Record<string, SimPlayer> = {};
  if (!raw) return players;
  for (const id of Object.keys(raw)) {
    const p = raw[id];
    if (!p || typeof p !== "object") continue;
    players[id] = {
      player_id: (p.player_id as string) ?? id,
      full_name: (p.full_name as string) ?? "",
      position: (p.position as string) ?? "",
      team: (p.team as string | null) ?? null,
      years_exp: (p.years_exp as number | null) ?? null,
    };
  }
  return players;
}

// ── FantasyCalc raw-entry parsing (fc_values_cache / fc_redraft_values_cache
// store the raw FantasyCalc API response verbatim — see app/api/fc-values).
interface FcRawEntry {
  player?: {
    position?: string; name?: string; firstName?: string; lastName?: string;
    sleeperId?: string | number;
  };
  value?: number;
}

interface FcValueMap {
  bySleeperId: Record<string, number>;
  byName: Map<string, number>;
}

function parseFcRawEntries(raw: FcRawEntry[]): FcValueMap {
  const bySleeperId: Record<string, number> = {};
  const byName = new Map<string, number>();
  raw.forEach((entry) => {
    if (entry.player?.position === "PICK") return;
    if (typeof entry.value !== "number" || entry.value <= 0) return;
    const sid = entry.player?.sleeperId;
    if (sid) bySleeperId[String(sid)] = entry.value;
    const fullName =
      entry.player?.name || `${entry.player?.firstName || ""} ${entry.player?.lastName || ""}`.trim();
    if (fullName) {
      const norm = normalizeRookieName(fullName);
      if (norm) byName.set(norm, entry.value);
    }
  });
  return { bySleeperId, byName };
}

async function readFcTable(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  table: "fc_values_cache" | "fc_redraft_values_cache",
  numQbs: number
): Promise<FcValueMap> {
  const { data } = await supabase.from(table).select("data").eq("num_qbs", numQbs).single();
  const raw = Array.isArray(data?.data) ? (data.data as FcRawEntry[]) : [];
  return parseFcRawEntries(raw);
}

function applyMultipliers(
  values: Record<string, number>,
  multipliers: Record<string, number>,
  players: Record<string, SimPlayer>
): Record<string, number> {
  const adjusted: Record<string, number> = {};
  for (const [id, value] of Object.entries(values)) {
    const pos = players[id]?.position ?? "";
    const mult = multipliers[pos] ?? 1;
    adjusted[id] = Math.round(value * mult);
  }
  return adjusted;
}

// ── Sleeper-only projections (mirrors hooks/useProjections.ts's Sleeper
// branch — raw stats are league-independent; per-league fpts are computed
// per-league below via computeLeagueFpts using each league's own scoring).
interface RawProjItem {
  player_id?: string | number;
  player?: { position?: string };
  stats?: Record<string, number>;
}

const PROJ_POS_PARAMS = "position[]=QB&position[]=RB&position[]=WR&position[]=TE";

async function fetchRawProjections(
  season: string,
  currentWeek: number
): Promise<{ items: RawProjItem[]; isSeasonMode: boolean }> {
  if (currentWeek <= 0) {
    const url = `${SLEEPER_PROJECTIONS_BASE}/${season}?season_type=regular&${PROJ_POS_PARAMS}`;
    const data = await safeFetch<RawProjItem[]>(url);
    return { items: Array.isArray(data) ? data : [], isSeasonMode: true };
  }
  const url = `${SLEEPER_PROJECTIONS_BASE}/${season}/${currentWeek}?season_type=regular&${PROJ_POS_PARAMS}`;
  const data = await safeFetch<RawProjItem[]>(url);
  return { items: Array.isArray(data) ? data : [], isSeasonMode: false };
}

function buildProjectionRows(
  rawItems: RawProjItem[],
  isSeasonMode: boolean,
  scoringSettings: Record<string, number>,
  players: Record<string, SimPlayer>
): ProjectionRow[] {
  const rows: ProjectionRow[] = [];
  rawItems.forEach((item) => {
    const pos = item.player?.position ?? "";
    if (!["QB", "RB", "WR", "TE"].includes(pos) || !item.player_id) return;
    const fpts = computeLeagueFpts(item.stats ?? {}, scoringSettings, pos);
    if (fpts <= 0) return;
    const id = String(item.player_id);
    const p = players[id];
    rows.push({
      sleeperId: id,
      full_name: p?.full_name ?? "",
      position: pos,
      team: p?.team ?? null,
      fpts: isSeasonMode ? fpts / 17 : fpts,
      sources: ["sleeper"],
      kickoffAt: null,
      stats: null,
    });
  });
  return rows;
}

// ── Player usage aggregation — ports hooks/usePlayerStats.ts's pure
// aggregate() logic (that hook itself is "use client" and can't be
// imported here). Only needed in-season.
interface RawStatItem {
  off_snp?: number;
  tm_off_snp?: number;
  rec_tgt?: number;
  rush_att?: number;
}

async function fetchPlayerStats(
  season: string,
  currentWeek: number
): Promise<Record<string, PlayerUsage> | null> {
  if (currentWeek < 2) return null;
  const lookback = 4;
  const weeks: number[] = [];
  for (let w = currentWeek - 1; w >= Math.max(1, currentWeek - lookback); w--) weeks.push(w);
  if (!weeks.length) return null;
  const recentWeeks = weeks.slice(0, 2);

  const weekData = await Promise.all(
    weeks.map((w) =>
      safeFetch<Record<string, RawStatItem>>(`${SLEEPER_BASE_URL}/stats/nfl/${season}/${w}?season_type=regular`)
    )
  );

  const playerMap: Record<string, { targets: number; carries: number; snaps: number; teamSnaps: number; weeks: number }> = {};
  const recentMap: typeof playerMap = {};

  weeks.forEach((w, idx) => {
    const isRecent = recentWeeks.includes(w);
    const data = weekData[idx] ?? {};
    for (const [pid, s] of Object.entries(data)) {
      const snaps = s.off_snp ?? 0;
      const teamSnaps = s.tm_off_snp ?? 0;
      const targets = s.rec_tgt ?? 0;
      const carries = s.rush_att ?? 0;
      if (snaps < 5 && targets === 0 && carries === 0) continue;

      if (!playerMap[pid]) playerMap[pid] = { targets: 0, carries: 0, snaps: 0, teamSnaps: 0, weeks: 0 };
      playerMap[pid].targets += targets;
      playerMap[pid].carries += carries;
      playerMap[pid].snaps += snaps;
      playerMap[pid].teamSnaps += teamSnaps;
      playerMap[pid].weeks += 1;

      if (isRecent) {
        if (!recentMap[pid]) recentMap[pid] = { targets: 0, carries: 0, snaps: 0, teamSnaps: 0, weeks: 0 };
        recentMap[pid].targets += targets;
        recentMap[pid].carries += carries;
        recentMap[pid].snaps += snaps;
        recentMap[pid].teamSnaps += teamSnaps;
        recentMap[pid].weeks += 1;
      }
    }
  });

  const result: Record<string, PlayerUsage> = {};
  for (const [pid, d] of Object.entries(playerMap)) {
    if (d.weeks === 0) continue;
    const avgTargets = d.targets / d.weeks;
    const avgCarries = d.carries / d.weeks;
    const snapPct = d.teamSnaps > 0 ? d.snaps / d.teamSnaps : 0;
    const rd = recentMap[pid];
    const recentTargets = rd && rd.weeks > 0 ? rd.targets / rd.weeks : avgTargets;
    const recentCarries = rd && rd.weeks > 0 ? rd.carries / rd.weeks : avgCarries;
    const recentSnapPct = rd && rd.weeks > 0 && rd.teamSnaps > 0 ? rd.snaps / rd.teamSnaps : snapPct;
    result[pid] = {
      avgTargets, avgCarries, snapPct, gamesPlayed: d.weeks,
      recentTargets, recentCarries, recentSnapPct,
      targetTrend: recentTargets - avgTargets,
      carryTrend: recentCarries - avgCarries,
      snapTrend: recentSnapPct - snapPct,
    };
  }
  return result;
}

// ── Canonical rookie board — ports the non-personalized portion of
// hooks/useRookieBoardState.ts's loadRookieBoard (sheet + Sleeper ADP +
// FC Superflex dynasty values). Deliberately skips per-user overrides,
// additions, name edits, and saved ordering — see module header.
interface SleeperAdpEntry {
  player_id?: string | number;
  player?: { first_name?: string; last_name?: string; position?: string; team?: string };
  stats?: { adp_dynasty_2qb?: number };
}

async function fetchCanonicalRookieBoard(
  rookieYear: string,
  fc2qb: FcValueMap
): Promise<RookieBoardPlayer[]> {
  const [sheetText, adpRaw] = await Promise.all([
    fetchText(ROOKIE_BOARD_SHEET_URL),
    safeFetch<SleeperAdpEntry[]>(
      `${SLEEPER_PROJECTIONS_BASE}/${encodeURIComponent(rookieYear)}` +
        `?season_type=regular&position=QB&position=RB&position=WR&position=TE&order_by=adp_dynasty_2qb`
    ),
  ]);

  const sheetPlayers = sheetText
    .split("\n")
    .slice(1)
    .map((row) => {
      const cols = row.split(",");
      return {
        name: cols[0]?.replace(/"/g, "").trim() ?? "",
        position: cols[1]?.replace(/"/g, "").trim() ?? "",
      };
    })
    .filter((p) => p.name && p.name !== "Player Invalid");

  const adpByName = new Map<string, { player_id: string; name: string; position: string; team: string; adp: number }>();
  (adpRaw ?? [])
    .filter(
      (entry) =>
        entry?.player &&
        entry?.stats &&
        entry.player.first_name !== "Player" &&
        ["QB", "RB", "WR", "TE"].includes(entry.player.position ?? "") &&
        typeof entry.stats.adp_dynasty_2qb === "number"
    )
    .forEach((entry) => {
      if (!entry.player || !entry.stats) return;
      const playerName = `${entry.player.first_name ?? ""} ${entry.player.last_name ?? ""}`.trim();
      const norm = normalizeRookieName(playerName);
      if (!norm || adpByName.has(norm)) return;
      adpByName.set(norm, {
        player_id: String(entry.player_id),
        name: playerName,
        position: entry.player.position ?? "",
        team: entry.player.team ?? "",
        adp: entry.stats.adp_dynasty_2qb ?? 0,
      });
    });

  return sheetPlayers
    .map((player) => {
      const norm = normalizeRookieName(player.name);
      const adpPlayer = adpByName.get(norm);
      const fcValue =
        fc2qb.byName.get(norm) ??
        fc2qb.byName.get(normalizeRookieName(adpPlayer?.name || "")) ??
        (adpPlayer?.player_id ? (fc2qb.bySleeperId[adpPlayer.player_id] ?? 0) : 0);
      return {
        player_id: adpPlayer?.player_id || null,
        name: adpPlayer?.name || player.name,
        position: adpPlayer?.position || player.position,
        team: adpPlayer?.team || "",
        adp: typeof adpPlayer?.adp === "number" ? adpPlayer.adp : Number.MAX_SAFE_INTEGER,
        fcValue,
      } satisfies RookieBoardPlayer;
    })
    .sort((a, b) => {
      if (b.fcValue !== a.fcValue) return b.fcValue - a.fcValue;
      if (a.adp !== b.adp) return a.adp - b.adp;
      return a.name.localeCompare(b.name);
    });
}

// ── Per-league core data — ports hooks/useLeagueOverview.ts's fetch +
// pick-slot-assignment logic (that hook is "use client" and can't be
// imported here) using safeFetch instead of the client sleeperApi proxy.
interface LeagueCore {
  rosters: SleeperRoster[];
  userNames: Record<string, string>;
  allPicks: AugmentedPick[];
  draftSettings: SleeperDraft | null;
  standings: StandingRow[];
}

async function fetchLeagueCore(league: SleeperLeague): Promise<LeagueCore | null> {
  const [rosters, users, tradedPicks, drafts] = await Promise.all([
    safeFetch<SleeperRoster[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/rosters`),
    safeFetch<SleeperUser[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/users`),
    safeFetch<SleeperTradedPick[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/traded_picks`),
    safeFetch<SleeperDraft[]>(`${SLEEPER_BASE_URL}/league/${league.league_id}/drafts`),
  ]);
  const rosterList = Array.isArray(rosters) ? rosters : [];
  if (!rosterList.length) return null;
  const userList = Array.isArray(users) ? users : [];
  const tradedPicksList = Array.isArray(tradedPicks) ? tradedPicks : [];
  const draftList = Array.isArray(drafts) ? drafts : [];

  const userNames: Record<string, string> = {};
  userList.forEach((u) => {
    userNames[u.user_id] = u.display_name || u.username || "Team";
  });

  const seasonsWithRookieDraft = new Set(
    draftList
      .filter((d) => {
        if (!d?.season) return false;
        const rounds = d.settings?.rounds ?? d.rounds ?? 99;
        return rounds <= 6;
      })
      .map((d) => String(d.season))
  );
  const completedDraftSeasons = new Set<string>();
  draftList.forEach((d) => {
    if (d?.status !== "complete" || !d?.season) return;
    const rounds = d.settings?.rounds ?? d.rounds ?? 99;
    const season = String(d.season);
    if (rounds <= 6) completedDraftSeasons.add(season);
    else if (!seasonsWithRookieDraft.has(season)) completedDraftSeasons.add(season);
  });
  const baseYearNum = Number(YEARS[0]);
  const pickYearWindow: string[] = [];
  for (let offset = 0; pickYearWindow.length < YEARS.length; offset++) {
    const y = String(baseYearNum + offset);
    if (!completedDraftSeasons.has(y)) pickYearWindow.push(y);
  }

  const allPicks: AugmentedPick[] = [];
  const rosterToUser: Record<string, string> = {};
  rosterList.forEach((r) => {
    rosterToUser[String(r.roster_id)] = r.owner_id;
    pickYearWindow.forEach((year) => {
      ROUNDS.forEach((round) => {
        allPicks.push({
          season: year,
          round,
          roster_id: r.roster_id,
          owner_id: r.roster_id,
          previous_owner_id: r.roster_id,
        });
      });
    });
  });
  tradedPicksList.forEach((tp) => {
    const match = allPicks.find(
      (p) => p.season === tp.season && p.round === tp.round && p.roster_id === tp.roster_id
    );
    if (match) match.owner_id = tp.owner_id;
  });

  const currentDraft = draftList.find((d) => d.season === CURRENT_YEAR) ?? null;
  const order = currentDraft?.draft_order || {};
  const totalDraftTeams = rosterList.length || Number(currentDraft?.settings?.teams) || 0;
  allPicks.forEach((pick) => {
    if (pick.season === CURRENT_YEAR) {
      const userId = rosterToUser[String(pick.roster_id)];
      const baseSlot = Number(order[String(userId)] || 0);
      const slot = getDraftRoundSlot(currentDraft ?? {}, Number(pick.round), baseSlot, totalDraftTeams);
      pick.slot = slot
        ? `${pick.round}.${String(slot).padStart(2, "0")}`
        : `${pick.round}`;
    }
  });

  const standings: StandingRow[] = rosterList.map((r) => ({
    roster_id: r.roster_id,
    wins: r.settings?.wins || 0,
    losses: r.settings?.losses || 0,
    ties: r.settings?.ties || 0,
    fpts: r.settings?.fpts || 0,
    max_pf: r.settings?.fpts_max || 0,
    owner_id: r.owner_id,
  }));

  return { rosters: rosterList, userNames, allPicks, draftSettings: currentDraft, standings };
}

interface HistoryRow {
  league_id: string;
  roster_id: number;
  season: string;
  week: number;
  playoff_odds: number;
  title_odds: number;
  expected_wins: number;
  avg_finish: number;
  finish_range: string;
  computed_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error("CRON_SECRET env var is not set — refusing to run");
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const authBuf = Buffer.from(req.headers.get("authorization") ?? "");
  const expectedBuf = Buffer.from(`Bearer ${expected}`);
  if (authBuf.length !== expectedBuf.length || !timingSafeEqual(authBuf, expectedBuf)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    log.error("Supabase service-role env vars not configured");
    return NextResponse.json({ error: "Server misconfiguration" }, { status: 500 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── 1. Discover unique dynasty leagues across every registered user ──
  const { data: links, error: linksErr } = await supabase
    .from("user_sleeper_links")
    .select("sleeper_user_id");
  if (linksErr) {
    log.error("user_sleeper_links read failed", { err: linksErr.message });
    return NextResponse.json({ error: "DB read failed" }, { status: 500 });
  }

  const uniqueSleeperIds = [...new Set((links ?? []).map((l) => l.sleeper_user_id as string))];
  const leagueMap = new Map<string, SleeperLeague>();
  await withConcurrency(
    uniqueSleeperIds,
    async (sleeperUserId) => {
      const userLeagues = await safeFetch<SleeperLeague[]>(
        `${SLEEPER_BASE_URL}/user/${sleeperUserId}/leagues/nfl/${CURRENT_YEAR}`
      );
      (userLeagues ?? []).filter(isDynastyLeague).forEach((l) => leagueMap.set(l.league_id, l));
    },
    CONCURRENCY
  );
  const leagues = [...leagueMap.values()];

  if (!leagues.length) {
    return NextResponse.json({ ok: true, leaguesFound: 0, leaguesSimulated: 0, rowsWritten: 0 });
  }

  // ── 2. Shared, league-independent data — fetched once for the whole run ──
  const [players, nflState] = await Promise.all([
    fetchSlimPlayers(),
    safeFetch<SleeperNFLState>(`${SLEEPER_BASE_URL}/state/nfl`),
  ]);
  const currentWeek =
    nflState?.season_type === "regular" && Number(nflState?.week || 0) > 0 ? Number(nflState.week) : 0;
  const season = nflState?.season ?? CURRENT_YEAR;
  const isOffseason = currentWeek === 0;

  const [fcDyn1, fcDyn2, fcRed1, fcRed2] = await Promise.all([
    readFcTable(supabase, "fc_values_cache", 1),
    readFcTable(supabase, "fc_values_cache", 2),
    readFcTable(supabase, "fc_redraft_values_cache", 1),
    readFcTable(supabase, "fc_redraft_values_cache", 2),
  ]);
  const dynastyByNumQbs: Record<number, FcValueMap> = { 1: fcDyn1, 2: fcDyn2 };
  const redraftByNumQbs: Record<number, FcValueMap> = { 1: fcRed1, 2: fcRed2 };

  const { items: rawProjItems, isSeasonMode: projIsSeasonMode } = await fetchRawProjections(season, currentWeek);
  const playerStats = await fetchPlayerStats(season, currentWeek);
  const rookieYear = String(BASE_YEAR);
  const rookies = isOffseason ? await fetchCanonicalRookieBoard(rookieYear, dynastyByNumQbs[2]) : [];

  // ── 3. Per-league simulate + collect rows ──
  let leaguesSimulated = 0;
  const allRows: HistoryRow[] = [];
  const nowIso = new Date().toISOString();

  await withConcurrency(
    leagues,
    async (league) => {
      try {
        const core = await fetchLeagueCore(league);
        if (!core) return;

        const numQbs = getLeagueNumQbs(league);
        const scoringSettings = league.scoring_settings ?? DEFAULT_SCORING;
        const multipliers = computeScoringMultipliers(scoringSettings);
        const leagueAdjustedFcValues = applyMultipliers(dynastyByNumQbs[numQbs].bySleeperId, multipliers, players);
        const leagueAdjustedRedraftValues = applyMultipliers(redraftByNumQbs[numQbs].bySleeperId, multipliers, players);

        const projectionData = buildProjectionRows(rawProjItems, projIsSeasonMode, scoringSettings, players);
        const projectionWeek = projIsSeasonMode ? 0 : currentWeek;

        let leagueWeeklyMatchups: Record<string, { week: number; matchups: SleeperMatchup[] }[]> = {};
        if (currentWeek > 1) {
          const weeks = Array.from({ length: currentWeek - 1 }, (_, i) => i + 1);
          const results = await Promise.all(
            weeks.map(async (week) => ({
              week,
              matchups:
                (await safeFetch<SleeperMatchup[]>(
                  `${SLEEPER_BASE_URL}/league/${league.league_id}/matchups/${week}`
                )) ?? [],
            }))
          );
          leagueWeeklyMatchups = { [league.league_id]: results };
        }

        const projectedRookiesByRoster = isOffseason
          ? projectRookiesByRoster({
              selectedLeague: league,
              nflState,
              draftSettings: core.draftSettings,
              rosters: core.rosters,
              rookies,
              allPicks: core.allPicks,
              players: players as unknown as Record<string, SleeperPlayer>,
              leagueAdjustedFcValues,
            })
          : new Map();

        const simulation = simulateLeague({
          selectedLeague: league,
          rosters: core.rosters,
          players: players as unknown as Record<string, SleeperPlayer>,
          nflState,
          projectionData,
          projectionWeek,
          playerStats,
          leagueWeeklyMatchups,
          standings: core.standings,
          users: core.userNames,
          leagueAdjustedFcValues,
          leagueAdjustedRedraftValues,
          projectedRookiesByRoster,
          // Deliberately a fresh random seed each run, not the persisted per-
          // browser simSalt_v1 — this is a server cron with no single "the"
          // user session to match (each browser has its own persisted salt).
          // The daily snapshot is a historical trend point, not meant to be
          // byte-for-byte reproducible against any one live session's odds.
          simSalt: Math.floor(Math.random() * 1_000_000),
        });
        if (!simulation) return;

        leaguesSimulated++;
        simulation.rows.forEach((row) => {
          allRows.push({
            league_id: league.league_id,
            roster_id: row.rosterId,
            season,
            week: currentWeek,
            playoff_odds: row.playoffOdds ?? 0,
            title_odds: row.titleOdds ?? 0,
            expected_wins: row.expectedWins ?? 0,
            avg_finish: row.avgFinish ?? 0,
            finish_range: row.finishRange ?? "",
            computed_at: nowIso,
          });
        });
      } catch (err) {
        log.error("league simulation failed", {
          leagueId: league.league_id,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    },
    CONCURRENCY
  );

  // ── 4. Write history rows ──
  let rowsWritten = 0;
  for (let i = 0; i < allRows.length; i += 200) {
    const batch = allRows.slice(i, i + 200);
    const { error, data } = await supabase
      .from("league_simulation_history")
      .upsert(batch, { onConflict: "league_id,roster_id,season,week" })
      .select("id");
    if (error) {
      log.error("league_simulation_history upsert failed", { batchStart: i, err: error.message });
      continue;
    }
    rowsWritten += Array.isArray(data) ? data.length : 0;
  }

  return NextResponse.json({
    ok: true,
    leaguesFound: leagues.length,
    leaguesSimulated,
    rowsWritten,
    season,
    currentWeek,
  });
}
