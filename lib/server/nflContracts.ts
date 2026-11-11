// ============================================================
// NFL contracts: fetch + parse the sources (SERVER-ONLY)
// ============================================================
// Downloads nflverse's historical_contracts.parquet (~11 MB, Snappy, one row
// group), its timestamp.json, and DynastyProcess's id crosswalk (~2.6 MB
// CSV), all with no-store: they're far over Next's 2 MB Data Cache limit and
// the cron runs at most daily. The shaping lives in lib/nflContracts.ts.
//
// Why parquet-wasm + Apache Arrow and not a pure-JS reader: the file's two
// nested columns (season_history, contract_history) cost hyparquet ~2.9 GB
// peak RSS — and it failed outright under a 1.5 GB heap — which would sink a
// 2 GB Vercel function. parquet-wasm decodes into columnar Arrow memory: the
// whole file reads in ~0.6 s at ~500 MB peak and works under a 256 MB heap
// (checked 2026-11-11). Nested values are only turned into plain objects for
// each player's latest contract (~4,000 of the 53,701 rows are kept).
// ============================================================

import { readParquet } from "parquet-wasm/node";
import { tableFromIPC } from "apache-arrow";
import {
  CONTRACTS_PARQUET_URL, CONTRACTS_TIMESTAMP_URL, PLAYER_IDS_CSV_URL, CONTRACT_COLUMNS,
  parsePlayerIdsCsv, parseNflverseTimestamp, pickLatestContracts,
  type RawContract, type RawContractHistory, type RawContractSeason,
} from "../nflContracts";

const FETCH_TIMEOUT_MS = 60_000;

export interface ContractSources {
  /** Each player's latest contract (one per otc_id), nested columns included. */
  contracts: RawContract[];
  /** Active contracts in the whole file, before keeping one per player (the cron's sanity check). */
  activeInFile: number;
  gsisToSleeper: Map<string, string>;
  /** nflverse's own last-updated time for the parquet, or null if timestamp.json failed. */
  sourceUpdatedAt: string | null;
}

/** The read surface of an Arrow column this file uses. */
interface ArrowColumn { get(i: number): unknown }
/** An Arrow struct row (one season_history / contract_history entry). */
interface ArrowStructRow { toJSON(): unknown }

/** An Arrow list cell → plain objects (null entries dropped), or null for a null cell. */
function listToJson<T>(cell: unknown): T[] | null {
  if (cell == null || typeof (cell as Iterable<unknown>)[Symbol.iterator] !== "function") return null;
  const out: T[] = [];
  for (const e of cell as Iterable<ArrowStructRow | null>) if (e) out.push(e.toJSON() as T);
  return out;
}

const asText = (v: unknown): string | null => (typeof v === "string" ? v : null);
const asNum = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : null;

/** The parquet's contracts, one per player (his latest), from the file's bytes. */
export function contractsFromParquet(bytes: Uint8Array): { contracts: RawContract[]; activeInFile: number } {
  const table = tableFromIPC(readParquet(bytes, { columns: [...CONTRACT_COLUMNS] }).intoIPCStream());
  const col = (name: (typeof CONTRACT_COLUMNS)[number]): ArrowColumn =>
    (table.getChild(name) as ArrowColumn | null) ?? { get: () => null };
  const c = {
    player: col("player"), position: col("position"), team: col("team"), is_active: col("is_active"),
    year_signed: col("year_signed"), years: col("years"), value: col("value"), apy: col("apy"),
    guaranteed: col("guaranteed"), apy_cap_pct: col("apy_cap_pct"), otc_id: col("otc_id"),
    gsis_id: col("gsis_id"), draft_year: col("draft_year"), draft_round: col("draft_round"),
    draft_overall: col("draft_overall"), season_history: col("season_history"),
    contract_history: col("contract_history"),
  };

  // Pass 1: the flat fields of every row, enough to pick each player's latest contract.
  const flat: (RawContract & { row: number })[] = [];
  let activeInFile = 0;
  for (let i = 0; i < table.numRows; i++) {
    const isActive = c.is_active.get(i) === true;
    if (isActive) activeInFile++;
    flat.push({
      row: i,
      player: asText(c.player.get(i)), position: asText(c.position.get(i)), team: asText(c.team.get(i)),
      is_active: isActive, year_signed: asNum(c.year_signed.get(i)), years: asNum(c.years.get(i)),
      value: asNum(c.value.get(i)), apy: asNum(c.apy.get(i)), guaranteed: asNum(c.guaranteed.get(i)),
      apy_cap_pct: asNum(c.apy_cap_pct.get(i)), otc_id: asNum(c.otc_id.get(i)), gsis_id: asText(c.gsis_id.get(i)),
      draft_year: asNum(c.draft_year.get(i)), draft_round: asNum(c.draft_round.get(i)),
      draft_overall: asNum(c.draft_overall.get(i)),
    });
  }

  // Pass 2: the nested columns, only for the rows kept.
  const contracts: RawContract[] = [];
  for (const { row, ...r } of pickLatestContracts(flat).values()) {
    contracts.push({
      ...r,
      season_history: listToJson<RawContractSeason>(c.season_history.get(row)),
      contract_history: listToJson<RawContractHistory>(c.contract_history.get(row)),
    });
  }
  return { contracts, activeInFile };
}

async function get(url: string, fetchFn: typeof fetch): Promise<Response> {
  const res = await fetchFn(url, { cache: "no-store", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

/** All three sources. Throws if the parquet or the crosswalk can't be loaded; the timestamp is optional. */
export async function fetchContractSources(fetchFn: typeof fetch = fetch): Promise<ContractSources> {
  const [parquetRes, idsRes, stamp] = await Promise.all([
    get(CONTRACTS_PARQUET_URL, fetchFn),
    get(PLAYER_IDS_CSV_URL, fetchFn),
    get(CONTRACTS_TIMESTAMP_URL, fetchFn)
      .then((r) => r.json() as Promise<{ last_updated?: unknown }>)
      .catch(() => null),
  ]);
  const { contracts, activeInFile } = contractsFromParquet(new Uint8Array(await parquetRes.arrayBuffer()));
  const gsisToSleeper = parsePlayerIdsCsv(await idsRes.text());
  return { contracts, activeInFile, gsisToSleeper, sourceUpdatedAt: parseNflverseTimestamp(stamp?.last_updated) };
}
