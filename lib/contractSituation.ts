// ============================================================
// NFL contract situation (contracts plan, stage 7): one picture per player and team
// ============================================================
// Pure, client-safe: joins stages 3–6 into the shape the app shows. For the
// coming season (the next draft's class season):
//   * every QB / RB / WR / TE on an active deal: his deal (end, guarantees,
//     cap hit), whether the team has invested in him, how much he matters,
//     and his cut risk (signed) or re-sign odds (expiring), with reasons;
//   * every team's rooms: who's signed, open starting spots on contracts
//     (stage 4) and once likely cuts / re-signings are counted (stage 5), and
//     the measured odds of new competition (stage 6), plus its picks and cap.
// Built on the server (lib/server/contractSituation.ts, GET /api/nfl/situation)
// from nfl_contracts, Sleeper's player map, the DynastyProcess id crosswalk,
// PFF's offense summaries, ESPN's standings and the Wikipedia draft pages.
//
// The user's own calls (stays / goes for the coming season, migration 097)
// are applied on the client: `coreWith`, `roomOpenWith`, `callFor`. They
// change who counts in a room, never the competition odds, which were
// measured on the contract-only count (see lib/roomPressure.ts).
// ============================================================

import type { NflContractRow } from "./nflContracts";
import { buildContractRooms, STARTING_SPOTS, type RoomSeason, type TeamCapSeason } from "./contractRooms";
import { contractYearAt, type ContractKind } from "./contractStatus";
import { roomVerdict, type Importance, type PlayerContext, type SeasonBars, type SeasonLine, type TeamContext } from "./contractOutlook";
import { positionBars, snapShares, ROOM_POSITIONS, type PffOffenseRow, type RoomPos } from "./nflRooms";
import { NFL_TEAMS, nflTeamId } from "./nflDraft";
import type { DraftCapital } from "./nflDraftPicks";
import { roomPressure, topTenByTeam, type RoomPressure, type TeamRecord } from "./roomPressure";
import type { PathCall } from "./scouting/teamLanding";

/** The season the situation looks at: the next draft's class season (before May, this year's draft is still to come). */
export function situationSeason(now: Date): number {
  return now.getUTCMonth() < 4 ? now.getUTCFullYear() : now.getUTCFullYear() + 1;
}

/** The NFL season with the latest games: this year from September, else last year. */
export function latestNflSeason(now: Date): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export interface CutSummary {
  level: "low" | "possible" | "likely";
  score: number;
  reasons: string[];
  savings: number | null;
  deadMoney: number | null;
}

export interface StaySummary {
  call: "stays" | "toss-up" | "leaves";
  score: number;
  reasons: string[];
}

/** One player on an active deal, as of the coming season. Money in $M. */
export interface PlayerSituation {
  otcId: number;
  sleeperId: string | null;
  name: string;
  pos: RoomPos;
  teamId: number;
  kind: ContractKind;
  endYear: number | null;
  freeAgency: "UFA" | "RFA" | "ERFA" | null;
  apy: number | null;
  /** His cap hit in the coming season, null when he isn't signed for it. */
  capHit: number | null;
  capHitEstimated: boolean;
  guaranteedThrough: number | null;
  futureGuaranteed: number | null;
  fifthYearOption: "pending" | "exercised" | "declined" | null;
  /** The user's "invested" (stage 4) for the coming season. */
  invested: boolean;
  importance: Importance;
  unavailable: boolean;
  /** Age on Sept 1 of the coming season. */
  age: number | null;
  /** Signed for the coming season: how likely he's released before it. */
  cut: CutSummary | null;
  /** His deal ends before the coming season: how likely he's back. */
  stay: StaySummary | null;
  /** Expected to be one of the room's core players (stage 5's roomVerdict), before the user's calls. */
  core: boolean;
}

export interface RoomSituation {
  pos: RoomPos;
  /** otcIds, biggest cap hit in the coming season first. */
  players: number[];
  /** Contract-only outlook, the coming season first (stage 4). */
  outlook: RoomSeason[];
  /** Core players expected once likely cuts go and likely re-signings stay (stage 5), before the user's calls. */
  expectedCore: number;
  /** STARTING_SPOTS minus expectedCore. */
  openSpots: number;
  /** Odds of new competition, from the contract-only open spots (stage 6). */
  pressure: RoomPressure;
}

export interface TeamPicks {
  year: number;
  byRound: number[];
  byDay: [number, number, number];
  /** Picks held on a condition. */
  conditional: number;
}

export interface TeamSituation {
  teamId: number;
  record: { winPct: number; gamesPlayed: number } | null;
  /** Coming season first, as stage 4 computes it (space reads high by earlier releases' dead money). */
  cap: TeamCapSeason[];
  rooms: Record<RoomPos, RoomSituation>;
  picks: TeamPicks[];
}

/** GET /api/nfl/situation's answer. */
export interface ContractSituationResponse {
  asOf: string;
  /** The coming season everything is judged for. */
  season: number;
  contractYear: number;
  /** The PFF seasons importance was judged on; null when PFF wasn't read. */
  pffSeasons: { current: number; prior: number } | null;
  /** When nflverse last updated the contracts file. */
  contractsUpdatedAt: string | null;
  draft: { year: number; revid: number | null; tradedPicks: number; issues: number }[];
  players: Record<number, PlayerSituation>;
  /** sleeper_id → otcId. */
  bySleeper: Record<string, number>;
  teams: TeamSituation[];
  /** What was missing or estimated this time, in words. */
  notes: string[];
}

/** Sleeper's view of a player (the app's player map). */
export interface SleeperFacts {
  team: string | null;
  depthOrder: number | null;
  birthDate: string | null;
}

/** The DynastyProcess crosswalk's ids for a gsis_id. */
export interface CrosswalkIds {
  pffId: number | null;
  birthDate: string | null;
}

export interface SituationInput {
  now: Date;
  /** Active nfl_contracts rows (every position: the cap needs them). */
  rows: readonly NflContractRow[];
  sleeper: ReadonlyMap<string, SleeperFacts>;
  crosswalk: ReadonlyMap<string, CrosswalkIds>;
  /** PFF NFL offense summaries; null when PFF wasn't read. */
  pff: { current: readonly PffOffenseRow[]; prior: readonly PffOffenseRow[]; seasons: { current: number; prior: number } } | null;
  /** This season's standings by ESPN id; empty when ESPN wasn't read. */
  records: readonly TeamRecord[];
  /** Draft capital by year (the coming draft and the one after); null when the page wasn't read. */
  capital: ReadonlyMap<number, (DraftCapital & { revid?: number | null; tradedPicks?: number }) | null>;
  contractsUpdatedAt?: string | null;
}

const n =(v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function lines(rows: readonly PffOffenseRow[]): Map<number, SeasonLine> {
  const shares = snapShares(rows);
  const out = new Map<number, SeasonLine>();
  for (const r of rows) {
    out.set(r.player_id, { grade: n(r.grades_offense), share: shares.get(r.player_id) ?? null, games: n(r.player_game_count) });
  }
  return out;
}

/** The whole picture (see the header). */
export function buildContractSituation(input: SituationInput): ContractSituationResponse {
  const { now, rows, sleeper, crosswalk, pff, records } = input;
  const season = situationSeason(now);
  const contractYear = contractYearAt(now);
  const notes: string[] = [];

  const sleeperOf = (r: NflContractRow) => (r.sleeper_id ? sleeper.get(r.sleeper_id) ?? null : null);
  const teamOf = (r: NflContractRow) => nflTeamId(sleeperOf(r)?.team ?? null);
  const rooms = buildContractRooms(rows, now, { season, teamOf });

  const current = pff ? lines(pff.current) : new Map<number, SeasonLine>();
  const prior = pff ? lines(pff.prior) : new Map<number, SeasonLine>();
  const bars: Record<RoomPos, SeasonBars> = { QB: { current: null, prior: null }, RB: { current: null, prior: null }, WR: { current: null, prior: null }, TE: { current: null, prior: null } };
  if (pff) {
    const cb = positionBars(pff.current);
    const pb = positionBars(pff.prior);
    for (const pos of ROOM_POSITIONS) bars[pos] = { current: cb[pos], prior: pb[pos] };
  } else {
    notes.push("PFF wasn't read: importance comes from Sleeper's depth chart only");
  }
  if (!records.length) notes.push("ESPN's standings weren't read: no team direction or draft-slot odds");

  const rowByOtc = new Map(rows.map((r) => [r.otc_id, r]));
  const contextOf = (otcId: number): PlayerContext | null => {
    const r = rowByOtc.get(otcId);
    if (!r) return null;
    const ids = r.gsis_id ? crosswalk.get(r.gsis_id) ?? null : null;
    const sl = sleeperOf(r);
    const pffId = ids?.pffId ?? null;
    return {
      birthDate: sl?.birthDate ?? ids?.birthDate ?? null,
      current: pffId != null ? current.get(pffId) ?? null : null,
      prior: pffId != null ? prior.get(pffId) ?? null : null,
      depthOrder: sl?.depthOrder ?? null,
    };
  };

  const recordOf = new Map(records.map((r) => [r.teamId, r]));
  // The standings are the latest season's; they set the order only of the draft right after it.
  const slotOdds = records.length && latestNflSeason(now) === season - 1 ? topTenByTeam(records) : null;
  const capitalNow = input.capital.get(season) ?? null;
  if (!capitalNow) notes.push(`The ${season} draft page wasn't read: no pick odds`);

  const players: Record<number, PlayerSituation> = {};
  const bySleeper: Record<string, number> = {};
  const teams: TeamSituation[] = [];

  for (const team of rooms.teams) {
    const rec = recordOf.get(team.teamId) ?? null;
    const capSpace = team.cap[0]?.space ?? null;
    const teamCtx: TeamContext = { winPct: rec?.winPct ?? null, gamesPlayed: rec?.gamesPlayed ?? 0, capSpace };
    const capitalTeam = capitalNow?.teams.find((t) => t.teamId === team.teamId) ?? null;

    const roomOut = {} as Record<RoomPos, RoomSituation>;
    for (const pos of ROOM_POSITIONS) {
      const room = team.rooms[pos];
      const verdict = roomVerdict(room, season, (p) => contextOf(p.otcId), teamCtx, bars[pos]);
      for (const v of verdict.players) {
        const p = v.player;
        const cutYear = v.cut?.cut ?? null;
        players[p.otcId] = {
          otcId: p.otcId, sleeperId: p.sleeperId, name: p.name, pos, teamId: team.teamId,
          kind: p.status.kind, endYear: p.status.endYear, freeAgency: p.status.freeAgency,
          apy: rowByOtc.get(p.otcId)?.apy ?? null, capHit: p.capHit, capHitEstimated: p.capHitEstimated,
          guaranteedThrough: p.status.guaranteedThrough, futureGuaranteed: p.status.futureGuaranteed,
          fifthYearOption: p.status.fifthYearOption,
          invested: p.invested, importance: v.importance, unavailable: v.unavailable,
          age: v.age != null ? Math.round(v.age * 10) / 10 : null,
          cut: v.cut ? { level: v.cut.level, score: v.cut.score, reasons: v.cut.reasons, savings: cutYear?.savings ?? null, deadMoney: cutYear?.deadMoney ?? null } : null,
          stay: v.stay ? { call: v.stay.call, score: v.stay.score, reasons: v.stay.reasons } : null,
          core: v.core,
        };
        if (p.sleeperId) bySleeper[p.sleeperId] = p.otcId;
      }
      roomOut[pos] = {
        pos,
        players: room.players.map((p) => p.otcId),
        outlook: room.outlook,
        expectedCore: verdict.expectedCore,
        openSpots: verdict.openSpots,
        pressure: roomPressure({ pos, openSpots: room.outlook[0]?.openSpots ?? 0, capital: capitalTeam, topTenOf: slotOdds ? (t) => slotOdds.get(t) : undefined }),
      };
    }

    const picks: TeamPicks[] = [];
    for (const [year, cap] of input.capital) {
      const t = cap?.teams.find((x) => x.teamId === team.teamId);
      if (t) picks.push({ year, byRound: t.byRound, byDay: t.byDay, conditional: t.picks.filter((p) => p.conditional).length });
    }
    picks.sort((a, b) => a.year - b.year);
    teams.push({ teamId: team.teamId, record: rec ? { winPct: rec.winPct, gamesPlayed: rec.gamesPlayed } : null, cap: team.cap, rooms: roomOut, picks });
  }

  const draft = [...input.capital.entries()]
    .filter((e): e is [number, NonNullable<typeof e[1]>] => e[1] != null)
    .map(([year, cap]) => ({ year, revid: cap.revid ?? null, tradedPicks: cap.tradedPicks ?? 0, issues: cap.issues.filter((i) => i.kind !== "relabeled").length }))
    .sort((a, b) => a.year - b.year);

  return {
    asOf: now.toISOString(), season, contractYear,
    pffSeasons: pff?.seasons ?? null,
    contractsUpdatedAt: input.contractsUpdatedAt ?? null,
    draft, players, bySleeper, teams, notes,
  };
}

// ── The user's calls (migration 097) ───────────────────────────────────────

export type OverrideCall = "stays" | "goes";
/** nfl_contract_overrides.overrides: otcId → the user's call for one season (ignored for any other season). */
export type ContractOverrides = Record<string, { call: OverrideCall; season: number }>;

/** The user's call for him this season, if any. */
export function overrideFor(overrides: ContractOverrides | null | undefined, otcId: number, season: number): OverrideCall | null {
  const o = overrides?.[String(otcId)];
  return o && o.season === season && (o.call === "stays" || o.call === "goes") ? o.call : null;
}

/** Whether he's one of the room's core players with the user's call applied (stage 5's rule otherwise). */
export function coreWith(p: PlayerSituation, call: OverrideCall | null): boolean {
  if (!call) return p.core;
  if (call === "goes") return false;
  const counts = p.importance === "star" || p.importance === "established";
  return p.cut ? p.invested || counts : counts;
}

/** A room's expected core and open spots with the user's calls applied. */
export function roomOpenWith(room: RoomSituation, players: Readonly<Record<number, PlayerSituation>>, overrides: ContractOverrides | null | undefined, season: number): { expectedCore: number; openSpots: number } {
  let core = 0;
  for (const id of room.players) {
    const p = players[id];
    if (p && coreWith(p, overrideFor(overrides, id, season))) core++;
  }
  return { expectedCore: core, openSpots: Math.max(0, STARTING_SPOTS[room.pos] - core) };
}

export type CallTone = "good" | "warn" | "bad" | "neutral";
export interface CallLabel { label: string; tone: CallTone; source: "yours" | "model"; reasons: string[] }

/** What the app says about him for the coming season: the user's call, else the model's cut risk / re-sign odds. */
export function callFor(p: PlayerSituation, call: OverrideCall | null): CallLabel | null {
  if (call) return { label: call === "stays" ? "Stays" : "Goes", tone: call === "stays" ? "good" : "bad", source: "yours", reasons: ["your call"] };
  if (p.cut) {
    if (p.cut.level === "likely") return { label: "Likely cut", tone: "bad", source: "model", reasons: p.cut.reasons };
    if (p.cut.level === "possible") return { label: "Cut risk", tone: "warn", source: "model", reasons: p.cut.reasons };
    return null;
  }
  if (p.stay) {
    if (p.stay.call === "stays") return { label: "Likely back", tone: "good", source: "model", reasons: p.stay.reasons };
    if (p.stay.call === "leaves") return { label: "Likely leaves", tone: "bad", source: "model", reasons: p.stay.reasons };
    return { label: "Toss-up", tone: "warn", source: "model", reasons: p.stay.reasons };
  }
  return null;
}

const yy = (y: number) => `'${String(y).slice(-2)}`;

/** The short contract chip: "Exp '26 RFA", "thru '29 · gtd '27", "FA". */
export function contractChip(p: Pick<PlayerSituation, "endYear" | "freeAgency" | "guaranteedThrough">, season: number): string {
  if (p.endYear == null) return "FA";
  if (p.endYear < season) return `Exp ${yy(p.endYear)}${p.freeAgency && p.freeAgency !== "UFA" ? ` ${p.freeAgency}` : ""}`;
  const g = p.guaranteedThrough != null && p.guaranteedThrough >= season ? ` · gtd ${yy(p.guaranteedThrough)}` : "";
  return `thru ${yy(p.endYear)}${g}`;
}

// ── Dynasty+'s Path by year 2 (inputs only) ────────────────────────────────

/** A hint saved on a drafted prospect (prospects.landing_inputs.contract), read by teamLanding's path suggestion. */
export interface ContractPathHint {
  /** The season the calls were made for: his year 2. */
  season: number;
  call: PathCall;
  why: string;
  asOf: string;
}

/** The share of teams whose day 1–2 / veteran odds at a position are at or below this team's (0–1). */
export function pressureRank(teams: readonly TeamSituation[], teamId: number, pos: RoomPos): number | null {
  const all = teams.map((t) => t.rooms[pos].pressure.any);
  const mine = teams.find((t) => t.teamId === teamId)?.rooms[pos].pressure.any;
  if (mine == null || !all.length) return null;
  return all.filter((v) => v <= mine).length / all.length;
}

/** A team in this top share of its position's competition odds suggests a path that closes. */
export const CLOSES_RANK = 0.75;

/**
 * Path by year 2 from contracts, for a rookie of `classYear` whose vets ahead are `ahead` (matched in his team's
 * room): OPENS when one of them is expected gone in year 2 (the user's "goes", a likely cut, or a likely
 * departure in free agency); else CLOSES when his team is in the top quarter of the league for adding competition
 * at his position (a day 1–2 pick or an invested veteran); else nothing (the saved room's suggestion stands).
 * Only when the situation is judged for his year 2.
 */
export function contractPathHint(input: {
  classYear: number;
  pos: RoomPos;
  teamId: number;
  ahead: readonly PlayerSituation[];
  situation: Pick<ContractSituationResponse, "season" | "teams" | "asOf">;
  overrides?: ContractOverrides | null;
}): ContractPathHint | null {
  const { classYear, pos, teamId, ahead, situation, overrides } = input;
  const year2 = classYear + 1;
  if (situation.season !== year2) return null;
  const base = { season: year2, asOf: situation.asOf };
  for (const v of ahead) {
    const call = overrideFor(overrides, v.otcId, year2);
    if (call === "goes") return { ...base, call: "opens", why: `${v.name}: your call, gone in ${year2}` };
    if (call === "stays") continue;
    if (v.cut?.level === "likely") return { ...base, call: "opens", why: `${v.name}: a likely cut before ${year2}` };
    if (v.stay?.call === "leaves") return { ...base, call: "opens", why: `${v.name}: his deal ends, likely gone in ${year2}` };
  }
  const rank = pressureRank(situation.teams, teamId, pos);
  if (rank != null && rank > CLOSES_RANK) {
    const pr = situation.teams.find((t) => t.teamId === teamId)!.rooms[pos].pressure;
    return { ...base, call: "closes", why: `${Math.round(pr.any * 100)}% odds of a day 1–2 ${pos} or an invested veteran in ${year2}: top quarter of the league` };
  }
  return null;
}

/** ESPN's standings (site.api.espn.com/apis/v2/sports/football/nfl/standings) as records by ESPN team id. */
export function standingsFromEspn(body: unknown): TeamRecord[] {
  const out: TeamRecord[] = [];
  const children = (body as { children?: unknown[] } | null)?.children;
  for (const conf of Array.isArray(children) ? children : []) {
    const entries = (conf as { standings?: { entries?: unknown[] } }).standings?.entries;
    for (const e of Array.isArray(entries) ? entries : []) {
      const entry = e as { team?: { id?: unknown }; stats?: { name?: unknown; value?: unknown }[] };
      const teamId = Number(entry.team?.id);
      if (!NFL_TEAMS[teamId]) continue;
      const stat = (name: string) => {
        const v = entry.stats?.find((s) => s.name === name)?.value;
        return typeof v === "number" && Number.isFinite(v) ? v : null;
      };
      const games = (stat("wins") ?? 0) + (stat("losses") ?? 0) + (stat("ties") ?? 0);
      const winPct = stat("winPercent");
      if (winPct == null) continue;
      out.push({ teamId, winPct, pointDiff: stat("pointDifferential") ?? 0, gamesPlayed: games });
    }
  }
  return out;
}

/** Names compared loosely: case, punctuation and Jr./III suffixes ignored. */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "").replace(/[^a-z]/g, "");
  return norm(a) === norm(b);
}

/** ESPN team ids that exist (for validating a request). */
export const TEAM_IDS: readonly number[] = Object.keys(NFL_TEAMS).map(Number);
