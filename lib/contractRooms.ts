// ============================================================
// NFL contract rooms + team cap (contracts plan, stage 4)
// ============================================================
// Pure: the nfl_contracts table (migration 096) → for every team, its QB / RB
// / WR / TE rooms by contract (who's signed for which seasons, who the team has
// invested in, how many starting spots are open each season, who leaves this
// season) and its cap commitments and space for the coming seasons. Built on
// lib/contractStatus.ts, derived on read, never stored.
//
// The user's goal (2026-11-11): how stable a player's situation is, and how
// likely his team is to bring in competition. Draft picks join in stage 6 and
// team context (cap pressure, direction) in stage 5's cut risk.
//
// Cap rules (checked 2026-11-11 against OverTheCap's 2027 cap table):
//   * A team's commitments for a season = its players' cap hits that season
//     (only the top 51 count in the offseason) + the void-year money already
//     booked there. Deals OTC hasn't broken down yet (mostly 2026 rookies)
//     count their APY instead, flagged as estimated.
//   * Dead money from players already released isn't in nflverse's file, so
//     space reads high by that much (OTC: Packers 2027 $10.0M, Raiders 2026
//     $60.9M), and rollover from the year before isn't known either.
//   * The league cap for a future season is the median of cap number ÷ cap
//     percent over that season's big cap hits: OTC prices future seasons
//     against its projected league cap (2027 ≈ $327.0M, 2028 ≈ $352M; OTC's
//     own Packers 2027 table adds up to $327.0M). The current season's
//     percents are against each team's adjusted cap, so it isn't given.
// ============================================================

import type { NflContractRow } from "./nflContracts";
import { contractStatus, contractYearAt, isRealSeason, type ContractStatus } from "./contractStatus";
import { ROOM_POSITIONS, type RoomPos } from "./nflRooms";
import { NFL_TEAMS } from "./nflDraft";

/** Starting spots per room in 11 personnel: the same count Dynasty+'s vets-ahead reads (lib/scouting/teamLanding.ts). */
export const STARTING_SPOTS: Record<RoomPos, number> = { QB: 1, RB: 1, WR: 3, TE: 1 };
/** In the offseason only a team's 51 biggest cap hits count against the cap. */
export const OFFSEASON_COUNT = 51;
/** The user's bar for a veteran deal the team has invested in, in today's dollars (2026-11-11: "a TE is
 *  invested in around 7-8 mil a year, a WR around 12-13 mil, a RB around 10 mil, a QB around 50 mil, at
 *  least as of today"; the midpoints). Compared as a share of the cap, so a deal signed in an earlier,
 *  smaller-cap year counts in today's money (Jacobs's 2024 $12M is $14.2M today). */
export const INVESTED_APY: Record<RoomPos, number> = { QB: 50, RB: 10, WR: 12.5, TE: 7.5 };
/** The 2026 league cap INVESTED_APY is priced against: $301.1M, from nflverse's inflated APY over cap percent. */
export const INVESTED_APY_CAP = 301.1;
/** Rookie deals from these rounds are an investment (draft capital), whatever they pay (the user, 2026-11-11). */
export const INVESTED_ROUNDS = 3;
/** How many seasons the outlook covers, from the room's season (a rookie's years 1–3). */
export const OUTLOOK_SEASONS = 3;
/** Cap percent at or above this is precise enough to back out the league cap (OTC rounds it to 0.1%). */
const CAP_PCT_FLOOR = 0.05;
const CAP_SAMPLES = 20;

/** One player in a room, with where his deal stands. */
export interface RoomContract {
  otcId: number;
  sleeperId: string | null;
  name: string;
  pos: RoomPos;
  status: ContractStatus;
  /** His cap hit in the room's season ($M), null when he isn't signed for it. */
  capHit: number | null;
  /** True when capHit is his APY because OTC has no yearly breakdown yet. */
  capHitEstimated: boolean;
  /** The team has invested in him for the room's season (the user's definition, 2026-11-11): a round 1–3
   *  rookie deal, or a veteran deal at INVESTED_APY for his position or more. Practice-squad deals never. */
  invested: boolean;
  /** The first season from the room's season on when releasing him before June 1 saves at least what it
   *  leaves in dead money; null when no season does. Money only: whether he WOULD be cut is stage 5. */
  cheapCutYear: number | null;
}

/** A room's look at one season. */
export interface RoomSeason {
  year: number;
  /** Players signed for that season. */
  underContract: number;
  /** Of them, the ones the team has invested in (see RoomContract.invested, judged for that season). */
  invested: number;
  /** STARTING_SPOTS minus the invested players, floored at 0. */
  openSpots: number;
  /** The position's cap hits that season ($M). */
  capCommitted: number;
}

export interface PositionRoom {
  pos: RoomPos;
  /** Everyone at the position on a current deal, biggest cap hit in the room's season first. */
  players: RoomContract[];
  /** From the room's season, OUTLOOK_SEASONS seasons. */
  outlook: RoomSeason[];
  /** Deals that end before the room's season: this season's expiring (status.freeAgency says UFA / RFA / ERFA). */
  leaving: RoomContract[];
}

/** A team's cap for one season ($M). */
export interface TeamCapSeason {
  year: number;
  /** OTC's projected league cap, null when it can't be backed out. */
  leagueCap: number | null;
  /** Top-51 cap hits + void-year money (see the header). */
  committed: number;
  /** Of committed, the part that is APY estimates for deals without a breakdown. */
  estimated: number;
  /** Void-year money already booked that season. */
  voidMoney: number;
  /** Contracts with a cap hit that season. */
  contracts: number;
  /** leagueCap − committed; reads high by dead money from earlier releases and without rollover. */
  space: number | null;
}

export interface TeamContractRooms {
  /** ESPN team id (lib/nflDraft.ts NFL_TEAMS). */
  teamId: number;
  rooms: Record<RoomPos, PositionRoom>;
  cap: TeamCapSeason[];
}

export interface ContractRooms {
  contractYear: number;
  /** The season the rooms look at first (by default the next one: the coming draft class's rookie year). */
  season: number;
  leagueCap: Record<number, number>;
  teams: TeamContractRooms[];
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** OTC's position code → room (FB and everything else isn't a room). */
const ROOM_OF: Record<string, RoomPos | undefined> = { QB: "QB", RB: "RB", WR: "WR", TE: "TE" };

/** OTC's projected league cap for each future season it has percents for, backed out of its big cap hits. */
export function leagueCapByYear(rows: readonly NflContractRow[], fromYear: number): Record<number, number> {
  const byYear = new Map<number, number[]>();
  for (const r of rows) {
    for (const s of r.seasons ?? []) {
      if (s.year < fromYear || s.cap_percent == null || s.cap_percent < CAP_PCT_FLOOR || n(s.cap_number) <= 0) continue;
      const list = byYear.get(s.year) ?? [];
      list.push(n(s.cap_number) / s.cap_percent);
      byYear.set(s.year, list);
    }
  }
  const out: Record<number, number> = {};
  for (const [year, list] of byYear) {
    if (list.length < CAP_SAMPLES) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted.length / 2;
    out[year] = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return out;
}

/** His cap hit in `year`: the real season's cap number, or his APY when OTC has no breakdown and he's signed through it. */
export function capHitIn(row: NflContractRow, st: ContractStatus, year: number): { hit: number; estimated: boolean } | null {
  if (!st.active || st.endYear == null || year > st.endYear || year < st.contractYear) return null;
  const line = row.seasons.find((s) => s.year === year);
  if (line && isRealSeason(line)) return { hit: n(line.cap_number), estimated: false };
  if (!st.yearlyBreakdown && row.apy != null) return { hit: row.apy, estimated: true };
  return null;
}

/** Whether the team has invested in him for `year` (see RoomContract.invested): a round 1–3 rookie deal,
 *  or a deal whose APY was at least INVESTED_APY for his position as a share of the cap when signed. */
export function isInvested(row: NflContractRow, st: ContractStatus, year: number): boolean {
  const pos = ROOM_OF[row.position];
  if (!pos || !st.active || st.endYear == null || st.endYear < year || st.kind === "practice") return false;
  if (st.kind === "rookie" && row.draft_round != null && row.draft_round <= INVESTED_ROUNDS) return true;
  const share = row.apy_cap_pct ?? (row.apy != null ? row.apy / INVESTED_APY_CAP : null);
  return share != null && share >= INVESTED_APY[pos] / INVESTED_APY_CAP - 1e-9;
}

/** The first season from `fromYear` on when a release before June 1 saves at least the dead money it
 *  leaves. Post-June-1 designations are left out on purpose: a team gets two a year, and counting them
 *  would call nearly every veteran "cheap to cut" a year early (Kraft, just extended, in 2027). */
export function cheapCutYear(st: ContractStatus, fromYear: number): number | null {
  for (const c of st.cuts) {
    if (c.year >= fromYear && c.savings >= c.deadMoney) return c.year;
  }
  return null;
}

export interface ContractRoomsOptions {
  /** The season the rooms look at first (default: the next league year). */
  season?: number;
  /** His current team when the app knows better than OTC (Sleeper's team for a mapped player: OTC lags
   *  some moves); null or absent falls back to contractStatus's teamId. */
  teamOf?: (row: NflContractRow) => number | null;
}

/** Every team's contract rooms and cap. */
export function buildContractRooms(rows: readonly NflContractRow[], now: Date, opts: ContractRoomsOptions = {}): ContractRooms {
  const contractYear = contractYearAt(now);
  const first = opts.season ?? contractYear + 1;
  const leagueCap = leagueCapByYear(rows, contractYear + 1);
  const years = Array.from({ length: OUTLOOK_SEASONS }, (_, i) => first + i);

  const byTeam = new Map<number, { row: NflContractRow; st: ContractStatus }[]>();
  for (const row of rows) {
    if (!row.is_active) continue;
    const st = contractStatus(row, now);
    const teamId = opts.teamOf?.(row) ?? st.teamId;
    if (teamId == null) continue;
    const list = byTeam.get(teamId) ?? [];
    list.push({ row, st });
    byTeam.set(teamId, list);
  }

  const teams: TeamContractRooms[] = [];
  for (const id of Object.keys(NFL_TEAMS).map(Number)) {
    const members = byTeam.get(id) ?? [];

    const rooms = {} as Record<RoomPos, PositionRoom>;
    for (const pos of ROOM_POSITIONS) {
      const atPos = members.filter(({ row }) => ROOM_OF[row.position] === pos);
      const players: RoomContract[] = atPos.map(({ row, st }) => {
        const hit = capHitIn(row, st, first);
        return {
          otcId: row.otc_id, sleeperId: row.sleeper_id, name: row.player, pos, status: st,
          capHit: hit?.hit ?? null, capHitEstimated: hit?.estimated ?? false,
          invested: isInvested(row, st, first),
          cheapCutYear: cheapCutYear(st, first),
        };
      }).sort((a, b) => (b.capHit ?? -1) - (a.capHit ?? -1) || a.name.localeCompare(b.name));
      const outlook: RoomSeason[] = years.map((year) => {
        const signed = atPos.filter(({ st }) => st.endYear != null && st.endYear >= year);
        const invested = signed.filter(({ row, st }) => isInvested(row, st, year)).length;
        return {
          year,
          underContract: signed.length,
          invested,
          openSpots: Math.max(0, STARTING_SPOTS[pos] - invested),
          capCommitted: signed.reduce((sum, { row, st }) => sum + (capHitIn(row, st, year)?.hit ?? 0), 0),
        };
      });
      rooms[pos] = { pos, players, outlook, leaving: players.filter((p) => p.status.endYear != null && p.status.endYear < first) };
    }

    const cap: TeamCapSeason[] = years.map((year) => {
      const hits: { hit: number; estimated: boolean }[] = [];
      let voidMoney = 0;
      for (const { row, st } of members) {
        const hit = capHitIn(row, st, year);
        if (hit) { hits.push(hit); continue; }
        const line = row.seasons.find((s) => s.year === year);
        if (line && !isRealSeason(line) && n(line.cap_number) > 0) voidMoney += n(line.cap_number);
      }
      const counted = hits.sort((a, b) => b.hit - a.hit).slice(0, OFFSEASON_COUNT);
      const committed = counted.reduce((sum, h) => sum + h.hit, 0) + voidMoney;
      const lc = leagueCap[year] ?? null;
      return {
        year, leagueCap: lc, committed, voidMoney, contracts: hits.length,
        estimated: counted.filter((h) => h.estimated).reduce((sum, h) => sum + h.hit, 0),
        space: lc == null ? null : lc - committed,
      };
    });

    teams.push({ teamId: id, rooms, cap });
  }
  return { contractYear, season: first, leagueCap, teams };
}
