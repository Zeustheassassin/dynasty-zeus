// ============================================================
// Scouting → Chart Next — client-safe, pure.
// ============================================================
// Who to chart next, against the user's goal (2026-11-26): the class's OVR
// top 60 at a full sample and OVR 61–150 at half a sample, top 60 done by mid-
// Feb to early March. Four lists, each in OVR order unless noted:
//
//   Finish top 60   OVR 1–60 still under a full sample.
//   61–150 to half  OVR 61–150 still under half a sample.
//   First looks     no OVR rank, games logged, none charted: the Prospects
//                   lists' ready-to-chart rule (readyToChart.ts), by its PFF
//                   grade, best first.
//   Re-chart        OVR-ranked WRs with routes from imported games (created
//                   before 2026-05-01, coverageEra.ts) and under a full sample
//                   charted in the app.
//
// A sample is the Big Board dot's (sampleTiers.ts SAMPLE_FULL_PLAYS): QB
// graded throws, RB known runs, WR routes (his SAE sample), TE rated routes.
// "Tape in hand" = his logged games with no charted play yet (the Unwatched
// tab's rule). Slow-tape conferences (Big Ten, Big 12, Independents, FCS:
// isRedConference) are marked so the tab can hide them: the user charts the
// "good" Catapult tape first.
// ============================================================

import type { ProspectWithStats, ScoutingGame } from "../types";
import type { PffTotals } from "../pff/totals";
import type { SamplePlays } from "./aggregateMerge";
import { SAMPLE_FULL_PLAYS, samplePct, sampleTier, type SampleTier } from "./sampleTiers";
import { displayConference, isRedConference } from "./schoolConferences";
import { readyToChart } from "./readyToChart";
import { coverageEra } from "./coverageEra";
import type { GameSnapCount } from "./unwatchedGames";

export type ChartNextPos = "QB" | "RB" | "WR" | "TE";
export const CHART_NEXT_POSITIONS: readonly ChartNextPos[] = ["QB", "RB", "WR", "TE"];

// Its own guard (not prospectScores'), so the tab doesn't load the scoring code.
const isChartNextPos = (pos: string): pos is ChartNextPos => (CHART_NEXT_POSITIONS as readonly string[]).includes(pos);

/** OVR 1–60 to a full sample; OVR 61–150 to half a sample (the user's goal, 2026-11-26). */
export const GOAL_FULL_THROUGH = 60;
export const GOAL_HALF_THROUGH = 150;

/** Pace = sample plays charted over the last 4 weeks, per week. */
export const PACE_DAYS = 28;

/** Plays a half sample needs: QB 90, RB 50, WR 80, TE 70. */
export function halfSample(pos: ChartNextPos): number {
  return Math.ceil(SAMPLE_FULL_PLAYS[pos] / 2);
}

export interface ChartNextRow {
  prospect: ProspectWithStats;
  pos: ChartNextPos;
  /** His saved conference, else his school's; null when neither is known. */
  conference: string | null;
  /** Big Ten, Big 12, Independents or FCS: tape that's slow to get. */
  slowTape: boolean;
  /** Sample plays charted (the Big Board dot's count). */
  n: number;
  /** His position's full sample. */
  full: number;
  /** What this list asks of him: a full sample, or half. */
  target: number;
  /** Sample plays short of the target (0 when there). */
  toGo: number;
  /** Whole percent of a full sample (the Big Board's %). */
  pct: number;
  tier: SampleTier;
  /** Every logged game. */
  logged: number;
  /** Logged games with a charted play; null when the play counts didn't load. */
  charted: number | null;
  /** Tape in hand: logged games with no charted play, newest season first (empty when unknown). */
  unwatched: ScoutingGame[];
  /** Sample plays per charted game: his own, else his position's across the hub; null if neither. */
  perGame: number | null;
  /** About how many games of charting cover `toGo` at `perGame`; null without a rate. */
  gamesNeeded: number | null;
  /** First looks: his position's headline PFF grade over his logged games (readyToChart). */
  pffGrade?: number | null;
  /** Re-chart: routes from imported games, how many such games, and routes charted in the app. */
  imported?: { routes: number; games: number; inApp: number };
}

export interface GoalBand {
  /** OVR slots in the band: 60, or 90 (61–150). */
  slots: number;
  /** Prospects ranked in it. */
  ranked: number;
  /** Of them, at the band's target. */
  done: number;
  /** Sample plays the ranked ones are short, all positions. */
  toGo: number;
  /** Of `toGo`, the part in slow-tape conferences. */
  toGoSlow: number;
  byPos: Record<ChartNextPos, number>;
}

export interface ChartNextBoard {
  year: number;
  top: ChartNextRow[];
  half: ChartNextRow[];
  firstLooks: ChartNextRow[];
  rechart: ChartNextRow[];
  /** Re-chart candidates left off because they already have a full sample charted in the app. */
  rechartFullInApp: number;
  /** Unranked prospects in the class with no game logged (not first looks: no tape in hand). */
  unrankedNoGames: number;
  /** False when the per-game play counts didn't load: tape in hand and first looks are unknown. */
  chartedKnown: boolean;
  goals: { full: GoalBand; half: GoalBand };
}

export interface ChartNextInputs {
  prospects: readonly ProspectWithStats[];
  games: readonly ScoutingGame[];
  /** prospect_game_snap_stats, one row per logged game; null when it didn't load. */
  snapCounts: readonly GameSnapCount[] | null;
  /** QB / RB / TE sample plays (prospect_sample_counts, migration 102). */
  samplePlays: ReadonlyMap<string, SamplePlays>;
  pffTotals: ReadonlyMap<string, PffTotals>;
  /** WR routes per game (prospect_game_route_counts, migration 064), for the imported / in-app split. */
  routeCounts: readonly { game_id: string; routes: number }[];
}

/** Plays charted toward his full sample, as the Big Board's dot counts them. */
export function samplePlaysOf(p: ProspectWithStats, samplePlays: ReadonlyMap<string, SamplePlays>): number {
  if (p.position === "WR") return p.sae_sample?.n ?? p.total_routes ?? 0;
  if (p.position === "QB" || p.position === "RB" || p.position === "TE") return samplePlays.get(p.id)?.[p.position] ?? 0;
  return 0;
}

const emptyByPos = (): Record<ChartNextPos, number> => ({ QB: 0, RB: 0, WR: 0, TE: 0 });

/** OVR order, unranked last, then name. */
const byOvr = (a: ChartNextRow, b: ChartNextRow) =>
  (a.prospect.overall_rank ?? Infinity) - (b.prospect.overall_rank ?? Infinity)
  || a.prospect.name.localeCompare(b.prospect.name);

/** The class's Chart Next lists and goal progress. */
export function buildChartNext(year: number, inputs: ChartNextInputs): ChartNextBoard {
  const { prospects, games, snapCounts, samplePlays, pffTotals, routeCounts } = inputs;
  const snaps = snapCounts ? new Map(snapCounts.map((r) => [r.game_id, r.snaps_charted])) : null;

  // Every prospect's games, logged and charted (all classes: the per-game rate
  // reads the whole hub).
  const gamesBy = new Map<string, ScoutingGame[]>();
  for (const g of games) {
    const list = gamesBy.get(g.prospect_id);
    if (list) list.push(g); else gamesBy.set(g.prospect_id, [g]);
  }
  const chartedOf = (id: string): number | null =>
    snaps ? (gamesBy.get(id) ?? []).filter((g) => (snaps.get(g.id) ?? 0) > 0).length : null;

  // Sample plays per charted game, by position, over every prospect with both.
  const rate = { n: emptyByPos(), games: emptyByPos() };
  if (snaps) {
    for (const p of prospects) {
      if (!isChartNextPos(p.position)) continue;
      const n = samplePlaysOf(p, samplePlays);
      const c = chartedOf(p.id) ?? 0;
      if (n > 0 && c > 0) { rate.n[p.position] += n; rate.games[p.position] += c; }
    }
  }

  const row = (p: ProspectWithStats, pos: ChartNextPos, target: number): ChartNextRow => {
    const n = samplePlaysOf(p, samplePlays);
    const full = SAMPLE_FULL_PLAYS[pos];
    const logged = gamesBy.get(p.id)?.length ?? 0;
    const charted = chartedOf(p.id);
    const unwatched = snaps
      ? (gamesBy.get(p.id) ?? [])
        .filter((g) => (snaps.get(g.id) ?? 0) === 0)
        .sort((a, b) => b.season_year - a.season_year || b.game_slot - a.game_slot)
      : [];
    const own = charted && n > 0 ? n / charted : null;
    const perGame = own ?? (rate.games[pos] > 0 ? rate.n[pos] / rate.games[pos] : null);
    const toGo = Math.max(0, target - n);
    const conference = displayConference(p);
    return {
      prospect: p, pos, conference, slowTape: isRedConference(conference),
      n, full, target, toGo, pct: samplePct(n, full), tier: sampleTier(n, full),
      logged, charted, unwatched, perGame,
      gamesNeeded: perGame && perGame > 0 ? Math.ceil(toGo / perGame) : null,
    };
  };

  const inClass = prospects.filter((p) => p.draft_class_year === year && isChartNextPos(p.position));

  const band = (from: number, through: number, half: boolean) => {
    const rows: ChartNextRow[] = [];
    const goal: GoalBand = { slots: through - from + 1, ranked: 0, done: 0, toGo: 0, toGoSlow: 0, byPos: emptyByPos() };
    for (const p of inClass) {
      const r = p.overall_rank;
      if (r == null || r < from || r > through) continue;
      const pos = p.position as ChartNextPos;
      const it = row(p, pos, half ? halfSample(pos) : SAMPLE_FULL_PLAYS[pos]);
      goal.ranked++;
      if (it.toGo === 0) { goal.done++; continue; }
      goal.toGo += it.toGo;
      if (it.slowTape) goal.toGoSlow += it.toGo;
      goal.byPos[pos] += it.toGo;
      rows.push(it);
    }
    return { rows: rows.sort(byOvr), goal };
  };
  const top = band(1, GOAL_FULL_THROUGH, false);
  const half = band(GOAL_FULL_THROUGH + 1, GOAL_HALF_THROUGH, true);

  // First looks: no OVR rank, logged, none charted. By PFF grade, best first;
  // the ungraded after, soonest Eligible Thru first, then name.
  const unranked = inClass.filter((p) => p.overall_rank == null);
  const chartedGames = snaps ? new Map(unranked.map((p) => [p.id, chartedOf(p.id) ?? 0])) : null;
  const ready = readyToChart(unranked, games, chartedGames, pffTotals, "overall");
  const firstLooks = ready
    ? unranked.filter((p) => ready.has(p.id)).map((p) => {
      const pos = p.position as ChartNextPos;
      return { ...row(p, pos, halfSample(pos)), pffGrade: ready.get(p.id) ?? null };
    }).sort((a, b) =>
      (b.pffGrade ?? -Infinity) - (a.pffGrade ?? -Infinity)
      || (a.prospect.eligible_thru_year ?? Infinity) - (b.prospect.eligible_thru_year ?? Infinity)
      || a.prospect.name.localeCompare(b.prospect.name))
    : [];
  const unrankedNoGames = unranked.filter((p) => !gamesBy.has(p.id)).length;

  // Re-chart: ranked WRs whose routes include imported games' (created before
  // 2026-05-01), still short of a full sample charted in the app.
  const routesByGame = new Map(routeCounts.map((r) => [r.game_id, r.routes]));
  const rechart: ChartNextRow[] = [];
  let rechartFullInApp = 0;
  for (const p of inClass) {
    if (p.position !== "WR" || p.overall_rank == null) continue;
    let routes = 0, importedGames = 0, inApp = 0;
    for (const g of gamesBy.get(p.id) ?? []) {
      const n = routesByGame.get(g.id) ?? 0;
      if (coverageEra(g) === "old") {
        if (n > 0) { routes += n; importedGames++; }
      } else {
        inApp += n;
      }
    }
    if (routes === 0) continue;
    const full = SAMPLE_FULL_PLAYS.WR;
    if (inApp >= full) { rechartFullInApp++; continue; }
    const it = row(p, "WR", full);
    // The goal here is a full sample in the app alone.
    const toGo = full - inApp;
    rechart.push({
      ...it, toGo, imported: { routes, games: importedGames, inApp },
      gamesNeeded: it.perGame && it.perGame > 0 ? Math.ceil(toGo / it.perGame) : null,
    });
  }
  rechart.sort(byOvr);

  return {
    year, top: top.rows, half: half.rows, firstLooks, rechart, rechartFullInApp, unrankedNoGames,
    chartedKnown: snaps != null, goals: { full: top.goal, half: half.goal },
  };
}

/** Sample plays charted in the pace window, by position. */
export type PaceCounts = Record<ChartNextPos, number>;

/** Sample plays a week over the pace window. */
export function pacePerWeek(counts: PaceCounts, days = PACE_DAYS): number {
  const total = CHART_NEXT_POSITIONS.reduce((s, pos) => s + (counts[pos] ?? 0), 0);
  return days > 0 ? (total * 7) / days : 0;
}

/** Weeks to chart `plays` at `perWeek`; null with no pace. */
export function weeksAtPace(plays: number, perWeek: number): number | null {
  if (plays <= 0) return 0;
  return perWeek > 0 ? plays / perWeek : null;
}

/**
 * The class the tab opens on: the one being scouted. The NFL draft (late
 * April) closes a class, so from May on that's next year's. Falls to the
 * first class on the board after it, else the latest one. `years` ascending.
 */
export function chartNextDefaultClass(years: readonly number[], now = new Date()): number | null {
  if (years.length === 0) return null;
  const scouting = scoutingClassYear(now);
  return years.find((y) => y >= scouting) ?? years[years.length - 1];
}

/** The class being scouted at `now`: this year's until the draft closes it, next year's from May. */
export function scoutingClassYear(now = new Date()): number {
  return now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear();
}

/**
 * Whole weeks from `now` to the goal window (the user's "mid Feb / early
 * March"): Feb 15 and Mar 1 of the class year. Null once both have passed.
 */
export function weeksToGoal(year: number, now = new Date()): { from: number; to: number } | null {
  const week = 7 * 24 * 60 * 60 * 1000;
  const weeks = (month: number, day: number) => Math.max(0, Math.floor((new Date(year, month, day).getTime() - now.getTime()) / week));
  const to = weeks(2, 1);
  if (to <= 0) return null;
  return { from: weeks(1, 15), to };
}
