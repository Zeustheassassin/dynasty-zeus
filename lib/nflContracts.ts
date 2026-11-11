// ============================================================
// NFL contracts (nflverse / OverTheCap): the import shaping
// ============================================================
// Pure functions that turn nflverse's historical_contracts.parquet (one row
// per CONTRACT) into nfl_contracts rows (one row per PLAYER, migration 096):
// clean the yearly cap lines, keep each player's latest deal, name his
// contract type, and resolve his Sleeper id through the DynastyProcess ID
// crosswalk. The cron route (app/api/cron/nfl-contracts) fetches the files
// (lib/server/nflContracts.ts) and writes the rows; this file has no I/O.
//
// Source facts (checked 2026-11-11), see migration 096's header for more:
//   * season_history is the player's whole career, copied onto each of his
//     contract rows, ending with a "Total" row; its years are strings.
//   * Void years stay in: their proration accelerates on a release.
//   * Sleeper's own gsis_id is blank for ~81% of active fantasy players, so
//     the crosswalk is the join (704 of 757 active QB/RB/WR/TE contracts).
// ============================================================

export const CONTRACTS_PARQUET_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/contracts/historical_contracts.parquet";
export const CONTRACTS_TIMESTAMP_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/contracts/timestamp.json";
/** DynastyProcess's player id crosswalk (gsis_id ↔ sleeper_id), committed weekly (Fridays, early UTC). */
export const PLAYER_IDS_CSV_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv";

/** The parquet columns the import reads (the rest — height, college, inflated_* … — are skipped). */
export const CONTRACT_COLUMNS = [
  "player", "position", "team", "is_active", "year_signed", "years", "value", "apy", "guaranteed",
  "apy_cap_pct", "otc_id", "gsis_id", "draft_year", "draft_round", "draft_overall",
  "season_history", "contract_history",
] as const;

/** One season_history entry as the parquet holds it (year is a string, "Total" on the last one). */
export interface RawContractSeason {
  year?: string | null;
  team?: string | null;
  base_salary?: number | null;
  prorated_bonus?: number | null;
  option_bonus?: number | null;
  roster_bonus?: number | null;
  guaranteed_salary?: number | null;
  cap_number?: number | null;
  cap_percent?: number | null;
  cash_paid?: number | null;
  workout_bonus?: number | null;
  per_game_roster_bonus?: number | null;
  other_bonus?: number | null;
}

/** One contract_history entry: every deal the player signed. */
export interface RawContractHistory {
  team?: string | null;
  contract_type?: string | null;
  /** "Active", "Expired", "Extended", "Released", … */
  status?: string | null;
  year_signed?: number | null;
  yrs?: number | null;
}

/** One parquet row (one contract), limited to CONTRACT_COLUMNS. */
export interface RawContract {
  player?: string | null;
  position?: string | null;
  team?: string | null;
  is_active?: boolean | null;
  year_signed?: number | null;
  years?: number | null;
  value?: number | null;
  apy?: number | null;
  guaranteed?: number | null;
  apy_cap_pct?: number | null;
  otc_id?: number | null;
  gsis_id?: string | null;
  draft_year?: number | null;
  draft_round?: number | null;
  draft_overall?: number | null;
  season_history?: RawContractSeason[] | null;
  contract_history?: RawContractHistory[] | null;
}

/** A cleaned yearly cap line (nfl_contracts.seasons). Money in $M, cap_percent a fraction. */
export interface ContractSeason {
  year: number;
  team: string | null;
  base_salary: number | null;
  prorated_bonus: number | null;
  option_bonus: number | null;
  roster_bonus: number | null;
  guaranteed_salary: number | null;
  cap_number: number | null;
  cap_percent: number | null;
  cash_paid: number | null;
  workout_bonus: number | null;
  per_game_roster_bonus: number | null;
  other_bonus: number | null;
}

/** An nfl_contracts row (migration 096). */
export interface NflContractRow {
  otc_id: number;
  gsis_id: string | null;
  sleeper_id: string | null;
  player: string;
  position: string;
  team: string | null;
  is_active: boolean;
  contract_type: string | null;
  year_signed: number | null;
  years: number | null;
  value: number | null;
  apy: number | null;
  guaranteed: number | null;
  apy_cap_pct: number | null;
  draft_year: number | null;
  draft_round: number | null;
  draft_overall: number | null;
  seasons: ContractSeason[];
  source_updated_at: string | null;
  refreshed_at: string;
}

/** A finite number, or null (parquet INT64 would arrive as a bigint). */
function num(v: unknown): number | null {
  if (typeof v === "bigint") return Number(v);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t : null;
}

/** season_history without its "Total" row or the empty placeholder a player with no breakdown carries, oldest first. */
export function cleanSeasons(raw: readonly RawContractSeason[] | null | undefined): ContractSeason[] {
  const out: ContractSeason[] = [];
  for (const s of raw ?? []) {
    const year = Number(text(s?.year));
    if (!Number.isInteger(year) || year < 1900) continue;
    out.push({
      year,
      team: text(s.team),
      base_salary: num(s.base_salary),
      prorated_bonus: num(s.prorated_bonus),
      option_bonus: num(s.option_bonus),
      roster_bonus: num(s.roster_bonus),
      guaranteed_salary: num(s.guaranteed_salary),
      cap_number: num(s.cap_number),
      cap_percent: num(s.cap_percent),
      cash_paid: num(s.cash_paid),
      workout_bonus: num(s.workout_bonus),
      per_game_roster_bonus: num(s.per_game_roster_bonus),
      other_bonus: num(s.other_bonus),
    });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** Which of two contract rows of the same player is his current one: an active deal beats an
 *  ended one, then the later signing, then the bigger APY (a few players carry two active one-year
 *  rows, e.g. a practice-squad deal beside the 53-man one). */
function isNewer(a: RawContract, b: RawContract): boolean {
  const activeA = a.is_active === true, activeB = b.is_active === true;
  if (activeA !== activeB) return activeA;
  const ysA = num(a.year_signed) ?? 0, ysB = num(b.year_signed) ?? 0;
  if (ysA !== ysB) return ysA > ysB;
  return (num(a.apy) ?? 0) > (num(b.apy) ?? 0);
}

/** Each player's latest contract, keyed by OverTheCap id. Rows without an otc_id or a name are dropped. */
export function pickLatestContracts<T extends RawContract>(rows: readonly T[]): Map<number, T> {
  const best = new Map<number, T>();
  for (const r of rows) {
    const id = num(r.otc_id);
    if (id == null || !text(r.player)) continue;
    const cur = best.get(id);
    if (!cur || isNewer(r, cur)) best.set(id, r);
  }
  return best;
}

/** The deal's type ("Drafted", "Extension", "Franchise", "UDFA", …) from contract_history: the entry
 *  signed the same year with the same team, else the Active one for an active deal, else the latest. */
export function contractTypeOf(r: RawContract): string | null {
  const hist = (r.contract_history ?? []).filter((h): h is RawContractHistory => !!h);
  if (!hist.length) return null;
  const ys = num(r.year_signed);
  const team = text(r.team);
  const same = hist.find((h) => num(h.year_signed) === ys && text(h.team) === team);
  if (same) return text(same.contract_type);
  if (r.is_active) {
    const active = hist.find((h) => text(h.status) === "Active");
    if (active) return text(active.contract_type);
  }
  const latest = [...hist].sort((a, b) => (num(b.year_signed) ?? 0) - (num(a.year_signed) ?? 0))[0];
  return text(latest?.contract_type);
}

/** Who the table keeps: everyone on an active deal, plus anyone whose deal reached last season
 *  or was signed since (this year's free agents and recent releases, so a released player's row
 *  flips to is_active = false instead of going stale). Long-retired players are left out. */
export function keepContract(r: RawContract, seasons: readonly ContractSeason[], now: Date): boolean {
  if (r.is_active === true) return true;
  const since = now.getUTCFullYear() - 1;
  if ((num(r.year_signed) ?? 0) >= since) return true;
  return seasons.some((s) => s.year >= since);
}

/** RFC 4180-ish CSV: quoted fields may hold commas ("Miami, O."), doubled quotes and line breaks. */
export function parseCsv(textIn: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < textIn.length; i++) {
    const c = textIn[i];
    if (quoted) {
      if (c === '"') {
        if (textIn[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && textIn[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** gsis_id → sleeper_id from DynastyProcess's db_playerids.csv ("NA" = missing). Empty if the header lacks either column. */
export function parsePlayerIdsCsv(csv: string): Map<string, string> {
  const rows = parseCsv(csv);
  const out = new Map<string, string>();
  const header = rows[0] ?? [];
  const gi = header.indexOf("gsis_id");
  const si = header.indexOf("sleeper_id");
  if (gi < 0 || si < 0) return out;
  const ok = (v: string | undefined): v is string => !!v && v !== "NA";
  for (const r of rows.slice(1)) {
    const g = r[gi]?.trim(), s = r[si]?.trim();
    if (ok(g) && ok(s) && !out.has(g)) out.set(g, s);
  }
  return out;
}

/** gsis_id → PFF id and birth date (YYYY-MM-DD) from the same crosswalk, for the contracts outlook (stage 7).
 *  A row with neither is left out; "NA" is missing. */
export function parseCrosswalkIds(csv: string): Map<string, { pffId: number | null; birthDate: string | null }> {
  const rows = parseCsv(csv);
  const out = new Map<string, { pffId: number | null; birthDate: string | null }>();
  const header = rows[0] ?? [];
  const gi = header.indexOf("gsis_id");
  const pi = header.indexOf("pff_id");
  const bi = header.indexOf("birthdate");
  if (gi < 0) return out;
  for (const r of rows.slice(1)) {
    const g = r[gi]?.trim();
    if (!g || g === "NA" || out.has(g)) continue;
    const pff = pi >= 0 ? Number(r[pi]) : NaN;
    const birth = bi >= 0 ? r[bi]?.trim() ?? "" : "";
    const ids = {
      pffId: Number.isInteger(pff) && pff > 0 ? pff : null,
      birthDate: /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : null,
    };
    if (ids.pffId != null || ids.birthDate != null) out.set(g, ids);
  }
  return out;
}

/** nflverse's timestamp.json `last_updated` ("2026-11-10 10:31:04 EST") as an ISO string, or null. */
export function parseNflverseTimestamp(lastUpdated: unknown): string | null {
  const m = typeof lastUpdated === "string"
    ? /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) (EST|EDT|UTC|GMT)$/.exec(lastUpdated.trim())
    : null;
  if (!m) return null;
  const offset = { EST: "-05:00", EDT: "-04:00", UTC: "Z", GMT: "Z" }[m[3] as "EST" | "EDT" | "UTC" | "GMT"];
  const d = new Date(`${m[1]}T${m[2]}${offset}`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The nfl_contracts rows for one import: each kept player's latest deal with his Sleeper id. */
export function buildContractRows(
  raw: readonly RawContract[],
  gsisToSleeper: ReadonlyMap<string, string>,
  opts: { now: Date; sourceUpdatedAt: string | null },
): NflContractRow[] {
  const refreshedAt = opts.now.toISOString();
  const out: NflContractRow[] = [];
  for (const [otcId, r] of pickLatestContracts(raw)) {
    const seasons = cleanSeasons(r.season_history);
    if (!keepContract(r, seasons, opts.now)) continue;
    const gsis = text(r.gsis_id);
    out.push({
      otc_id: otcId,
      gsis_id: gsis,
      sleeper_id: gsis ? gsisToSleeper.get(gsis) ?? null : null,
      player: text(r.player) as string,
      position: text(r.position) ?? "",
      team: text(r.team),
      is_active: r.is_active === true,
      contract_type: contractTypeOf(r),
      year_signed: num(r.year_signed),
      years: num(r.years),
      value: num(r.value),
      apy: num(r.apy),
      guaranteed: num(r.guaranteed),
      apy_cap_pct: num(r.apy_cap_pct),
      draft_year: num(r.draft_year),
      draft_round: num(r.draft_round),
      draft_overall: num(r.draft_overall),
      seasons,
      source_updated_at: opts.sourceUpdatedAt,
      refreshed_at: refreshedAt,
    });
  }
  return out;
}
