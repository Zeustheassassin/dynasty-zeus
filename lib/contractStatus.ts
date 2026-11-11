// ============================================================
// NFL contract status (contracts plan, stage 3)
// ============================================================
// Pure: one nfl_contracts row (lib/nflContracts.ts, migration 096) → where the
// player's deal stands today. The real end year (void years skipped), how many
// seasons are left, how long the money is guaranteed, the deal's kind, the
// 5th-year option, and what releasing him would cost and save in each future
// league year. Derived on read like Roster Crunch's Danger, never stored.
// Cut RISK (team context: cap pressure, importance, age, direction) is stage 5;
// this file only says what a release would cost.
//
// Rules, checked against OverTheCap's own pages on 2026-11-11:
//   * A season is REAL when it has a salary, a cap number and cash paid. OTC
//     books void years with a placeholder salary (Burrow 50, Hurts 99.999999,
//     Bijan 7) or none and $0 cash, and puts the proration that accelerates
//     when the deal voids into the first void year's cap number (Gibbs 2031:
//     22.6446 is exactly his four void years' option proration). End years
//     matched OTC's "Free Agency" year for all 10 players checked.
//   * Dead money if released before June 1 of league year D = the signing-
//     bonus proration of every season from D on (void years too) + the
//     option-bonus proration from option bonuses ALREADY PAID + every
//     guaranteed salary from D on. Option bonuses not yet paid don't count.
//     After June 1: only season D's proration hits now (guarantees still all
//     hit now). This matched OTC to the cent on every one of 36 contract
//     seasons across 10 players (Burrow, Chase, Gibbs, Bijan, Jacobs, Watson,
//     Reed, Smith-Njigba, Love, Hurts).
//   * nflverse's season_history has one combined option-bonus column, so the
//     separate option bonuses are recovered from it: each new one shows as a
//     step up, and each is prorated over up to five seasons (void years count).
//   * A new deal OTC hasn't broken down yet (2026 rookies, some 2026 one-year
//     deals whose history stops in 2025) ends at year_signed + years − 1.
// ============================================================

import type { ContractSeason, NflContractRow } from "./nflContracts";
import { nflTeamId } from "./nflDraft";

/** A new league year starts in mid-March (2026: March 11). Before this date the previous one is still in effect. */
const LEAGUE_YEAR_START = { month: 2, day: 11 } as const; // month is 0-based: March
/** The 5th-year option decision is due in early May of the player's 4th league year. */
const OPTION_DEADLINE = { month: 4, day: 5 } as const; // May 5
/** Signed this many seasons past the current one or more = a long-term deal. */
export const LONG_TERM_YEARS = 3;
/** An APY under this share of the cap is a minimum-level deal (2026: ~$1.5M). */
export const MINIMUM_CAP_SHARE = 0.005;
/** Fallback when apy_cap_pct is missing: $M. */
const MINIMUM_APY = 1.5;
const EPS = 0.005;

export type ContractKind = "rookie" | "udfa" | "extension" | "tag" | "tender" | "veteran" | "practice" | "other";

/** One future league year's release math, in $M. Savings can be negative (cutting him costs cap room). */
export interface CutMath {
  year: number;
  capHit: number;
  deadMoney: number;
  savings: number;
  /** Released with a post-June-1 designation: the dead money that hits this year (the rest moves to next year). */
  deadMoneyPostJune1: number;
  savingsPostJune1: number;
}

export interface ContractStatus {
  /** The league year in effect when this was computed. */
  contractYear: number;
  /** He has a current deal (false = free agent: released, expired or retired). */
  active: boolean;
  kind: ContractKind;
  /** ESPN team id (lib/nflDraft.ts NFL_TEAMS) of his current team by OTC (see contractStatus); null for a
   *  free agent, or a traded player OTC has no season line for. Sleeper's team is fresher when he maps. */
  teamId: number | null;
  /** The last real season of the deal; null for a free agent. */
  endYear: number | null;
  /** Seasons left after the current one (0 = the deal ends after this season). */
  yearsLeft: number | null;
  expiring: boolean;
  longTerm: boolean;
  /** The last season with guaranteed salary (OTC's per-season column). For a deal with no breakdown: the end year when the whole deal is guaranteed, else null. */
  guaranteedThrough: number | null;
  /** $M of guaranteed salary in seasons after the current one; null without a yearly breakdown. */
  futureGuaranteed: number | null;
  /** OTC has a season-by-season breakdown of the current deal (false for most 2026 rookies). */
  yearlyBreakdown: boolean;
  /** Seasons after the end year that only carry void-year money. */
  voidYears: number[];
  minimumLevel: boolean;
  /** First-round rookie deals only. */
  fifthYearOption: "pending" | "exercised" | "declined" | null;
  /** What he'd be when the deal ends, from his draft year (accrued seasons approximated: practice-squad years don't really accrue). */
  freeAgency: "UFA" | "RFA" | "ERFA" | null;
  /** Each real season after the current one: what a release would cost and save. Empty without a breakdown. */
  cuts: CutMath[];
}

/** The league year in effect on `now` (a league year runs from mid-March to mid-March). */
export function contractYearAt(now: Date): number {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const beforeStart = m < LEAGUE_YEAR_START.month || (m === LEAGUE_YEAR_START.month && now.getUTCDate() < LEAGUE_YEAR_START.day);
  return beforeStart ? y - 1 : y;
}

export function contractKind(type: string | null | undefined): ContractKind {
  switch ((type ?? "").trim().toLowerCase()) {
    case "drafted": return "rookie";
    case "udfa": return "udfa";
    case "extension": return "extension";
    case "franchise": case "transition": return "tag";
    case "rfa": case "erfa": return "tender";
    case "ufa": case "sfa": return "veteran";
    case "practice": return "practice";
    default: return "other";
  }
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Salary plus every bonus that counts on the cap that season. */
function bookedTotal(s: ContractSeason): number {
  return n(s.base_salary) + n(s.prorated_bonus) + n(s.option_bonus) + n(s.roster_bonus)
    + n(s.workout_bonus) + n(s.per_game_roster_bonus) + n(s.other_bonus);
}

/** A season the player is actually under contract for: a salary, a cap number, and cash paid that
 *  season. Void years pay no cash, whatever placeholder salary OTC shows (Bijan 2031, Hurts 2029,
 *  Burrow 2030, Love 2029, Darnold 2028 all read $0). Cash, not "cap = salary + bonuses", is the test
 *  because some real seasons carry cap items the yearly columns don't break out (Love 2028 is $7M
 *  under the sum, Maye 2027 $1M over). Without a cash figure, fall back to that sum, with slack. */
export function isRealSeason(s: ContractSeason): boolean {
  const base = n(s.base_salary);
  const cap = n(s.cap_number);
  if (base <= EPS || cap <= EPS) return false;
  if (s.cash_paid != null) return s.cash_paid > EPS;
  return Math.abs(cap - bookedTotal(s)) <= Math.max(0.5, 0.05 * cap);
}

/** One option bonus recovered from the combined column: prorated `perYear` from `start` through `end`. */
export interface OptionBonus { start: number; end: number; perYear: number }

/** Splits season_history's combined option-bonus proration into the separate option bonuses: each new
 *  one is a step up from what the earlier ones still prorate, spread over up to five seasons, never past
 *  the last season that carries option proration. */
export function splitOptionBonuses(seasons: readonly ContractSeason[]): OptionBonus[] {
  const withOption = seasons.filter((s) => n(s.option_bonus) > EPS);
  if (!withOption.length) return [];
  const last = Math.max(...withOption.map((s) => s.year));
  const bonuses: OptionBonus[] = [];
  for (const s of [...seasons].sort((a, b) => a.year - b.year)) {
    if (s.year > last) break;
    const expected = bonuses.filter((b) => s.year <= b.end).reduce((sum, b) => sum + b.perYear, 0);
    const step = n(s.option_bonus) - expected;
    if (step > EPS) bonuses.push({ start: s.year, end: Math.min(s.year + 4, last), perYear: step });
  }
  return bonuses;
}

/** Releasing him in league year `year`, with option bonuses paid through `paidThrough` (the current league year). */
export function cutMath(seasons: readonly ContractSeason[], year: number, paidThrough: number): CutMath | null {
  const season = seasons.find((s) => s.year === year);
  if (!season || !isRealSeason(season)) return null;
  const fromYear = seasons.filter((s) => s.year >= year);
  const signingProration = fromYear.reduce((sum, s) => sum + n(s.prorated_bonus), 0);
  const guaranteed = fromYear.reduce((sum, s) => sum + n(s.guaranteed_salary), 0);
  const paidOptions = splitOptionBonuses(seasons).filter((b) => b.start <= paidThrough);
  const optionProration = paidOptions.reduce((sum, b) => sum + b.perYear * Math.max(0, b.end - Math.max(year, b.start) + 1), 0);
  const optionThisYear = paidOptions.filter((b) => year >= b.start && year <= b.end).reduce((sum, b) => sum + b.perYear, 0);
  const capHit = n(season.cap_number);
  const deadMoney = signingProration + optionProration + guaranteed;
  const deadMoneyPostJune1 = n(season.prorated_bonus) + optionThisYear + guaranteed;
  return {
    year, capHit, deadMoney, savings: capHit - deadMoney,
    deadMoneyPostJune1, savingsPostJune1: capHit - deadMoneyPostJune1,
  };
}

/** The real seasons from the current league year on, stopping at the first one that isn't real. */
function realRun(seasons: readonly ContractSeason[], contractYear: number): ContractSeason[] {
  const run: ContractSeason[] = [];
  for (const s of seasons.filter((x) => x.year >= contractYear).sort((a, b) => a.year - b.year)) {
    if (!isRealSeason(s) || (run.length && s.year !== run[run.length - 1].year + 1)) {
      if (run.length) break;
      continue;
    }
    run.push(s);
  }
  return run;
}

/** Where a player's deal stands on `now`. */
export function contractStatus(row: NflContractRow, now: Date): ContractStatus {
  const cy = contractYearAt(now);
  const seasons = [...(row.seasons ?? [])].sort((a, b) => a.year - b.year);
  const kind = contractKind(row.contract_type);
  const active = row.is_active;
  const run = active ? realRun(seasons, cy) : [];
  const yearlyBreakdown = run.length > 0;

  let endYear: number | null = null;
  if (active) {
    if (yearlyBreakdown) endYear = run[run.length - 1].year;
    else if (row.year_signed != null && row.years != null) endYear = Math.max(cy, row.year_signed + row.years - 1);
  }

  const money = (s: ContractSeason) => n(s.base_salary) + n(s.prorated_bonus) + n(s.option_bonus) + n(s.cap_number);
  const voidYears = endYear == null || !yearlyBreakdown
    ? []
    : seasons.filter((s) => s.year > endYear! && money(s) > EPS).map((s) => s.year);

  let guaranteedThrough: number | null = null;
  let futureGuaranteed: number | null = null;
  if (yearlyBreakdown) {
    const withGuarantee = run.filter((s) => n(s.guaranteed_salary) > EPS);
    guaranteedThrough = withGuarantee.length ? withGuarantee[withGuarantee.length - 1].year : null;
    futureGuaranteed = run.filter((s) => s.year > cy).reduce((sum, s) => sum + n(s.guaranteed_salary), 0);
  } else if (active && endYear != null && row.guaranteed != null && row.value != null && row.value > 0
    && row.guaranteed >= row.value - 0.01) {
    guaranteedThrough = endYear;
  }

  const yearsLeft = endYear == null ? null : endYear - cy;

  let fifthYearOption: ContractStatus["fifthYearOption"] = null;
  if (active && kind === "rookie" && row.draft_round === 1 && row.draft_year != null) {
    const optionYear = row.draft_year + 4;
    const deadline = Date.UTC(row.draft_year + 3, OPTION_DEADLINE.month, OPTION_DEADLINE.day);
    if (endYear != null && endYear >= optionYear) fifthYearOption = "exercised";
    else fifthYearOption = now.getTime() >= deadline ? "declined" : "pending";
  }

  let freeAgency: ContractStatus["freeAgency"] = null;
  if (endYear != null && row.draft_year != null) {
    const accrued = endYear - row.draft_year + 1;
    freeAgency = accrued >= 4 ? "UFA" : accrued === 3 ? "RFA" : "ERFA";
  }

  const minimumLevel = row.apy_cap_pct != null ? row.apy_cap_pct < MINIMUM_CAP_SHARE : n(row.apy) < MINIMUM_APY;

  // `team` is the team on his latest contract, so a signing elsewhere shows there first (Estime: "Saints",
  // his 2026 line still "Browns"). A trade writes both teams in no fixed order ("GB/DAL" Kenny Clark, now
  // a Cowboy; "NE/PHI" A.J. Brown, now a Patriot); then this season's line names the current one. Checked
  // against Sleeper's teams 2026-11-11: 1,731 of 1,747 matched players agree; the rest are moves OTC
  // hasn't caught up with, and a traded 2026 rookie without a season line (3) has no team.
  const lineTeam = seasons.find((s) => s.year === cy)?.team ?? null;
  const teamId = !active ? null
    : row.team?.includes("/") ? nflTeamId(lineTeam)
    : nflTeamId(row.team) ?? nflTeamId(lineTeam);

  const cuts: CutMath[] = [];
  for (const s of run) {
    if (s.year <= cy) continue;
    const c = cutMath(seasons, s.year, cy);
    if (c) cuts.push(c);
  }

  return {
    contractYear: cy, active, kind, teamId, endYear, yearsLeft,
    expiring: active && yearsLeft === 0,
    longTerm: yearsLeft != null && yearsLeft >= LONG_TERM_YEARS,
    guaranteedThrough, futureGuaranteed, yearlyBreakdown, voidYears, minimumLevel,
    fifthYearOption, freeAgency, cuts,
  };
}
