// ============================================================
// NFL contract situation: load the sources and build it (SERVER-ONLY)
// ============================================================
// One build reads, in parallel: the active nfl_contracts rows (paged), Sleeper's
// player map (team, depth order, birth date), the DynastyProcess crosswalk
// (PFF id, birth date), ESPN's standings, PFF's NFL offense summary for the
// latest two seasons (two reads, ~5 s each) and the Wikipedia pages for the
// coming draft and the one after. Only the contracts are required; any other
// source that fails leaves a note in the answer and the outlook degrades
// (lib/contractSituation.ts says how). The built answer is held in Next's
// Data Cache for SITUATION_REVALIDATE_S: contracts move weekly, PFF grades
// weekly in season, picks rarely.
// ============================================================

import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SLEEPER_BASE_URL } from "../constants";
import { logger } from "../logger";
import { PLAYER_IDS_CSV_URL, parseCrosswalkIds, type NflContractRow } from "../nflContracts";
import type { PffOffenseRow } from "../nflRooms";
import { getPffClient } from "../pff/client";
import { waitForSleeperSlot } from "./sleeperBudget";
import { fetchDraftCapital } from "./nflDraftPicks";
import {
  buildContractSituation, latestNflSeason, situationSeason, standingsFromEspn,
  type ContractSituationResponse, type SituationInput, type SleeperFacts,
} from "../contractSituation";

const log = logger("lib/server/contractSituation");

export const SITUATION_REVALIDATE_S = 6 * 3600;
export const ESPN_STANDINGS_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/standings";
const PAGE = 1000;
const TIMEOUT_MS = 30_000;

/** Every active nfl_contracts row, a page at a time (PostgREST caps a read at 1,000 rows). */
export async function readActiveContracts(db: SupabaseClient): Promise<NflContractRow[]> {
  const out: NflContractRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from("nfl_contracts").select("*").eq("is_active", true).order("otc_id").range(from, from + PAGE - 1);
    if (error) throw new Error(`nfl_contracts read failed: ${error.message}`);
    out.push(...((data ?? []) as NflContractRow[]));
    if (!data || data.length < PAGE) return out;
  }
}

/** Sleeper's map → the facts the outlook reads, only for the players it needs. */
export function sleeperFacts(raw: Record<string, { team?: unknown; depth_chart_order?: unknown; birth_date?: unknown }>, ids: ReadonlySet<string>): Map<string, SleeperFacts> {
  const out = new Map<string, SleeperFacts>();
  for (const id of ids) {
    const p = raw[id];
    if (!p) continue;
    out.set(id, {
      team: typeof p.team === "string" && p.team ? p.team : null,
      depthOrder: typeof p.depth_chart_order === "number" ? p.depth_chart_order : null,
      birthDate: typeof p.birth_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date) ? p.birth_date : null,
    });
  }
  return out;
}

async function getJson<T>(url: string, fetchFn: typeof fetch): Promise<T> {
  const res = await fetchFn(url, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return (await res.json()) as T;
}

/** A source that may fail: its value, or null with the failure logged and noted. */
async function optional<T>(what: string, notes: string[], load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (err) {
    log.warn(`${what} not read`, { err: String(err) });
    notes.push(`${what} wasn't read (${err instanceof Error ? err.message : String(err)})`);
    return null;
  }
}

/** PFF's NFL offense summary for the latest season with games and the one before (shifted back a season
 *  when the latest has none yet, e.g. the first days of September). */
async function readPff(now: Date): Promise<SituationInput["pff"]> {
  const client = getPffClient();
  if (!client) throw new Error("PFF_API_KEY not configured");
  const read = async (season: number) =>
    (await client.get<{ offense_summary?: PffOffenseRow[] }>("/v1/facet/offense/summary", { league: "nfl", season })).offense_summary ?? [];
  let current = latestNflSeason(now);
  let [cur, prior] = await Promise.all([read(current), read(current - 1)]);
  if (!cur.length) {
    current -= 1;
    [cur, prior] = [prior, await read(current - 1)];
  }
  if (!cur.length) throw new Error("PFF has no NFL grades for the latest seasons");
  return { current: cur, prior, seasons: { current, prior: current - 1 } };
}

/** Builds the situation from every source (see the header). Throws only when the contracts can't be read. */
export async function loadContractSituation(db: SupabaseClient, now = new Date(), fetchFn: typeof fetch = fetch): Promise<ContractSituationResponse> {
  const season = situationSeason(now);
  const notes: string[] = [];
  const [rows, sleeperRaw, crosswalkCsv, standings, pff, capNow, capNext] = await Promise.all([
    readActiveContracts(db),
    optional("Sleeper's player map", notes, async () => {
      await waitForSleeperSlot("background");
      return getJson<Record<string, { team?: unknown; depth_chart_order?: unknown; birth_date?: unknown }>>(`${SLEEPER_BASE_URL}/players/nfl`, fetchFn);
    }),
    optional("The id crosswalk", notes, async () => {
      const res = await fetchFn(PLAYER_IDS_CSV_URL, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) throw new Error(`answered ${res.status}`);
      return res.text();
    }),
    optional("ESPN's standings", notes, () => getJson<unknown>(ESPN_STANDINGS_URL, fetchFn)),
    optional("PFF's offense grades", notes, () => readPff(now)),
    optional(`The ${season} draft page`, notes, () => fetchDraftCapital(season, fetchFn)),
    optional(`The ${season + 1} draft page`, notes, () => fetchDraftCapital(season + 1, fetchFn)),
  ]);
  if (!rows.length) throw new Error("nfl_contracts has no active rows");

  const ids = new Set(rows.map((r) => r.sleeper_id).filter((s): s is string => !!s));
  const built = buildContractSituation({
    now,
    rows,
    sleeper: sleeperRaw ? sleeperFacts(sleeperRaw, ids) : new Map(),
    crosswalk: crosswalkCsv ? parseCrosswalkIds(crosswalkCsv) : new Map(),
    pff,
    records: standings ? standingsFromEspn(standings) : [],
    capital: new Map([[season, capNow], [season + 1, capNext]]),
    contractsUpdatedAt: rows.reduce<string | null>((latest, r) => (r.source_updated_at && (!latest || r.source_updated_at > latest) ? r.source_updated_at : latest), null),
  });
  return { ...built, notes: [...notes, ...built.notes] };
}

/** The situation through the Data Cache (shared by every user: the sources are public football data). */
export function cachedContractSituation(db: SupabaseClient): Promise<ContractSituationResponse> {
  return unstable_cache(() => loadContractSituation(db), ["nfl-contract-situation-v1"], { revalidate: SITUATION_REVALIDATE_S })();
}
