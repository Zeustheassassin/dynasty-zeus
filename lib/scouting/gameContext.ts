// Each charted game's automatic context, as the screens and the grading use
// it (tape-grading expansion, Stage 5). Pure; client-safe.
//
// ScoutingHub loads three things (migration 065): the user's
// scouting_game_context rows (his CFD game, the two teams, his supporting
// cast from PFF, and from migration 103 the season unit grades), the shared
// cfd_games rows those point at (kickoff, venue, score, weather) and
// cfd_team_seasons (SP+). resolveGameContexts joins
// them per charted game; gameCovariates turns them into the numbers the
// context effects are fit on (contextEffects.ts).
//
// Opponent strength reads the opponent's DEFENSIVE SP+ for that season
// (points allowed per game against an average offense: lower = tougher). FCS
// teams have no SP+: an FCS opponent counts as the average charted G5 defense
// (the tiers' rule that FCS is at least as easy as G5) and is flagged, so any
// extra FCS effect can be measured on top.
import type { ScoutingGame } from "../types";
import type { CfdGameWithWeather, CfdTeamSeasonRow, WeatherStatus } from "../cfd/types";
import { MIN_SEASON_GAMES, seasonReportStale, type CoverageSpot } from "../pff/teamUnits";
import { blendCoverage, type AlignmentMix } from "./alignmentMix";
import type { CovariateSpec, GameCovariates } from "./contextEffects";
import type { OpponentTier } from "./opponentTier";

/** scouting_game_context (migration 065), as loaded. */
export interface GameContextRow {
  game_id: string;
  prospect_id: string;
  cfd_game_id: number | null;
  cfd_match_status: "auto" | "no_match" | null;
  cfd_match_note: string | null;
  team_school: string | null;
  opponent_school: string | null;
  cast_status: "ok" | "no_pff" | "no_team" | null;
  pff_franchise_id: number | null;
  team_snaps: number | null;
  his_snaps: number | null;
  ol_pass_block: number | null;
  ol_pass_block_snaps: number | null;
  ol_run_block: number | null;
  ol_run_block_snaps: number | null;
  qb_pass_grade: number | null;
  qb_name: string | null;
  qb_pff_id: number | null;
  qb_dropbacks: number | null;
  fetched_at: string;
  // Season unit grades (migration 103; absent until it's applied). Full-season
  // PFF grades for that game's season, never the same game's.
  opp_pff_franchise_id?: number | null;
  /** His team's OL season run-block grade (RB games) and the snaps behind it. */
  ol_run_block_season?: number | null;
  ol_run_block_season_snaps?: number | null;
  /** The opponent's front seven (DI + ED + LB) season run-defense grade. */
  opp_front7_run_def?: number | null;
  opp_front7_run_def_snaps?: number | null;
  /** The opponent's season coverage grade by alignment (lib/pff/teamUnits.ts). */
  opp_cov_outside?: number | null;
  opp_cov_outside_snaps?: number | null;
  opp_cov_slot?: number | null;
  opp_cov_slot_snaps?: number | null;
  opp_cov_box?: number | null;
  opp_cov_box_snaps?: number | null;
  /** The opponent's season missed-tackle rate (%) and the attempts behind it. */
  opp_mt_rate?: number | null;
  opp_tackle_attempts?: number | null;
  /** Games PFF charted the opponent / his team that season (thin reports aren't used). */
  opp_season_games?: number | null;
  team_season_games?: number | null;
  season_units_status?: SeasonUnitsStatus | null;
  /** When the oldest report behind them was read from PFF. */
  season_units_at?: string | null;
}

/** ok; no_pff = not linked to PFF; no_team = a team unknown; no_data = PFF had no defense report; n/a = QB game. */
export type SeasonUnitsStatus = "ok" | "no_pff" | "no_team" | "no_data" | "n/a";

/** The context columns before migration 103 (the fallback load while it isn't applied). */
export const CONTEXT_ROW_SELECT_BEFORE_103 =
  "game_id,prospect_id,cfd_game_id,cfd_match_status,cfd_match_note,team_school,opponent_school,cast_status,pff_franchise_id,team_snaps,his_snaps,ol_pass_block,ol_pass_block_snaps,ol_run_block,ol_run_block_snaps,qb_pass_grade,qb_name,qb_pff_id,qb_dropbacks,fetched_at";
export const CONTEXT_ROW_SELECT = `${CONTEXT_ROW_SELECT_BEFORE_103},opp_pff_franchise_id,ol_run_block_season,ol_run_block_season_snaps,opp_front7_run_def,opp_front7_run_def_snaps,opp_cov_outside,opp_cov_outside_snaps,opp_cov_slot,opp_cov_slot_snaps,opp_cov_box,opp_cov_box_snaps,opp_mt_rate,opp_tackle_attempts,opp_season_games,team_season_games,season_units_status,season_units_at`;

/** True when a load failed only because migration 103's columns aren't there yet. */
export function isMissingSeasonUnitColumns(err: unknown): boolean {
  const s = String(err instanceof Error ? err.message : err);
  return /(season_units_|opp_pff_franchise_id|ol_run_block_season|opp_front7|opp_cov_|opp_mt_rate|opp_tackle_attempts|_season_games)/.test(s)
    && /(does not exist|schema cache|not find)/i.test(s);
}

/**
 * A game whose season units the context fill should (re)compute: linked to
 * PFF and never looked up, or filled from a report of the season in progress
 * that's now over a week old. Only meaningful once migration 103 is in.
 */
export function needsSeasonUnits(row: Pick<GameContextRow, "season_units_status" | "season_units_at">, season: number, now = Date.now()): boolean {
  const s = row.season_units_status ?? null;
  if (s == null) return true;
  return (s === "ok" || s === "no_data") && seasonReportStale(season, row.season_units_at ?? null, now);
}
export const CFD_GAME_SELECT =
  "id,season,week,season_type,start_date,start_time_tbd,completed,neutral_site,venue_id,venue,home_team,home_classification,home_points,away_team,away_classification,away_points,weather_status,temperature_f,wind_mph,humidity,gust_mph,precip_in,snow_in,weather_code,weather_fetched_at";
export const TEAM_SEASON_SELECT = "season,school,conference,sp_rating,sp_offense,sp_defense,sp_ranking,sp_defense_ranking";

export interface GameContextData {
  rows: readonly GameContextRow[];
  cfdGames: readonly CfdGameWithWeather[];
  teamSeasons: readonly CfdTeamSeasonRow[];
  /** True when the rows carry the season-unit columns (migration 103 applied). */
  seasonUnits?: boolean;
}
export const EMPTY_CONTEXT_DATA: GameContextData = { rows: [], cfdGames: [], teamSeasons: [] };

export interface GameWeather {
  status: WeatherStatus;
  temperatureF: number | null;
  windMph: number | null;
  gustMph: number | null;
  precipIn: number | null;
  snowIn: number | null;
  code: number | null;
}

export interface GameContext {
  gameId: string;
  matched: boolean;
  note: string | null;
  teamSchool: string | null;
  opponentSchool: string | null;
  opponentFcs: boolean;
  /** The opponent's defensive SP+ that season (lower = tougher) and its national rank. */
  oppDefSp: number | null;
  oppDefRank: number | null;
  /** The opponent's overall SP+ and rank. */
  oppSp: number | null;
  oppSpRank: number | null;
  kickoff: string | null;
  venue: string | null;
  home: boolean | null;
  neutral: boolean | null;
  teamPoints: number | null;
  oppPoints: number | null;
  weather: GameWeather | null;
  /** PFF supporting cast; null when not filled (no PFF link, or not run yet). */
  cast: {
    olPassBlock: number | null;
    olRunBlock: number | null;
    qbPassGrade: number | null;
    qbName: string | null;
  } | null;
  hisSnaps: number | null;
  teamSnaps: number | null;
  /** His snaps ÷ the team's offensive snaps. */
  snapShare: number | null;
  /** PFF FULL-SEASON unit grades for that game's season (migration 103); null when not filled. */
  units: SeasonUnits | null;
}

/** A game's season units, each with the games behind its report. */
export interface SeasonUnits {
  /** His team's OL run block (RB games). */
  olRunBlock: number | null;
  teamGames: number | null;
  /** The opponent's front seven run defense, coverage by alignment, missed-tackle rate (%). */
  oppFront7: number | null;
  oppCoverage: Record<CoverageSpot, number | null>;
  oppMtRate: number | null;
  oppGames: number | null;
  /** Each report covers MIN_SEASON_GAMES+ games (thin ones aren't used as inputs). */
  teamFull: boolean;
  oppFull: boolean;
}

const n = (v: unknown): number | null => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/** Every charted game with a context row, joined with its CFD game and the opponent's SP+. */
export function resolveGameContexts(
  games: readonly Pick<ScoutingGame, "id" | "season_year">[],
  data: GameContextData,
): Map<string, GameContext> {
  const cfd = new Map(data.cfdGames.map((g) => [g.id, g]));
  const sp = new Map(data.teamSeasons.map((t) => [`${t.season}|${t.school}`, t]));
  const rows = new Map(data.rows.map((r) => [r.game_id, r]));
  const out = new Map<string, GameContext>();
  for (const g of games) {
    const r = rows.get(g.id);
    if (!r) continue;
    const cg = r.cfd_game_id != null ? cfd.get(r.cfd_game_id) : undefined;
    const opp = r.opponent_school;
    const oppSp = opp ? sp.get(`${g.season_year}|${opp}`) : undefined;
    const home = cg && r.team_school ? cg.home_team === r.team_school : null;
    const oppClass = cg && opp ? (cg.home_team === opp ? cg.home_classification : cg.away_team === opp ? cg.away_classification : null) : null;
    const teamSnaps = n(r.team_snaps), hisSnaps = n(r.his_snaps);
    out.set(g.id, {
      gameId: g.id,
      matched: r.cfd_match_status === "auto" && cg != null,
      note: r.cfd_match_note,
      teamSchool: r.team_school,
      opponentSchool: opp,
      opponentFcs: oppClass === "fcs",
      oppDefSp: n(oppSp?.sp_defense),
      oppDefRank: n(oppSp?.sp_defense_ranking),
      oppSp: n(oppSp?.sp_rating),
      oppSpRank: n(oppSp?.sp_ranking),
      kickoff: cg?.start_date ?? null,
      venue: cg?.venue ?? null,
      home: cg?.neutral_site ? null : home,
      neutral: cg?.neutral_site ?? null,
      teamPoints: cg && home != null ? n(home ? cg.home_points : cg.away_points) : null,
      oppPoints: cg && home != null ? n(home ? cg.away_points : cg.home_points) : null,
      weather: cg?.weather_status ? {
        status: cg.weather_status,
        temperatureF: n(cg.temperature_f), windMph: n(cg.wind_mph), gustMph: n(cg.gust_mph),
        precipIn: n(cg.precip_in), snowIn: n(cg.snow_in), code: n(cg.weather_code),
      } : null,
      cast: r.cast_status === "ok" ? {
        olPassBlock: n(r.ol_pass_block), olRunBlock: n(r.ol_run_block),
        qbPassGrade: n(r.qb_pass_grade), qbName: r.qb_name,
      } : null,
      hisSnaps, teamSnaps,
      snapShare: hisSnaps != null && teamSnaps ? hisSnaps / teamSnaps : null,
      units: seasonUnitsOf(r),
    });
  }
  return out;
}

function seasonUnitsOf(r: GameContextRow): SeasonUnits | null {
  if (r.season_units_status !== "ok" && r.season_units_status !== "no_data") return null;
  const teamGames = n(r.team_season_games), oppGames = n(r.opp_season_games);
  return {
    olRunBlock: n(r.ol_run_block_season), teamGames,
    oppFront7: n(r.opp_front7_run_def),
    oppCoverage: { outside: n(r.opp_cov_outside), slot: n(r.opp_cov_slot), box: n(r.opp_cov_box) },
    oppMtRate: n(r.opp_mt_rate), oppGames,
    teamFull: (teamGames ?? 0) >= MIN_SEASON_GAMES,
    oppFull: (oppGames ?? 0) >= MIN_SEASON_GAMES,
  };
}

// ── Covariates for the context effects ───────────────────────────────────

/** Weather a rep counts as "in the rain": 0.05" or more over the game window. */
export const RAIN_IN = 0.05;
/** And "cold": a game-window mean under 40°F. */
export const COLD_F = 40;

export const COV = {
  oppDefSp: "opp_def_sp",
  oppFcs: "opp_fcs",
  g5: "tier_g5",
  fcsTier: "tier_fcs",
  wind: "wind",
  rain: "rain",
  cold: "cold",
  olPassBlock: "ol_pass_block",
  olRunBlock: "ol_run_block",
  qbGrade: "qb_grade",
  // Season units (migration 103): FULL-SEASON PFF grades for that game's season.
  seasonOlRunBlock: "season_ol_rb",
  oppFront7: "opp_front7",
  oppCoverage: "opp_coverage",
  oppMtRate: "opp_mt_rate",
  lineMatchup: "line_matchup",
  /** The matchup's D-line half alone, in front-seven spreads: what its effect is measured on. */
  lineFront7: "line_front7_z",
} as const;

/** The SP+ opponent model: the opponent's defensive SP+ (a worse defense = easier reps), FCS flagged. */
export const OPPONENT_SP_SPECS = (spRef: number): CovariateSpec[] => [
  { key: COV.oppDefSp, label: "Opp. defense SP+", sign: 1, ref: spRef, unit: "pts of defensive SP+" },
  { key: COV.oppFcs, label: "FCS opponent", sign: 1, ref: "zero", unit: "FCS game" },
];
/** Today's tiers, as covariates (for the comparison and to sit under weather). */
export const OPPONENT_TIER_SPECS: CovariateSpec[] = [
  { key: COV.g5, label: "G5 opponent", sign: 1, ref: "zero", unit: "G5 game" },
  { key: COV.fcsTier, label: "FCS opponent", sign: 1, ref: "zero", unit: "FCS game" },
];
export const WEATHER_SPECS: CovariateSpec[] = [
  { key: COV.wind, label: "Wind", sign: -1, ref: "mean", unit: "mph" },
  { key: COV.rain, label: "Rain", sign: -1, ref: "zero", unit: "rain game" },
  { key: COV.cold, label: "Cold", sign: -1, ref: "zero", unit: "game under 40°F" },
];
export const CAST_SPECS = {
  olPassBlock: { key: COV.olPassBlock, label: "OL pass block", sign: 1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
  olRunBlock: { key: COV.olRunBlock, label: "OL run block", sign: 1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
  qbGrade: { key: COV.qbGrade, label: "QB passing grade", sign: 1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
};

/**
 * The season unit inputs (line season grades plan). Signs: a better line makes
 * his runs easier; a better front seven or coverage makes reps harder; a
 * defense that misses more tackles makes yards after contact / missed tackles
 * forced easier.
 */
export const SEASON_UNIT_SPECS = {
  olRunBlock: { key: COV.seasonOlRunBlock, label: "Own OL run block (season)", sign: 1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
  oppFront7: { key: COV.oppFront7, label: "Opp. front seven run D (season)", sign: -1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
  oppCoverage: { key: COV.oppCoverage, label: "Opp. coverage at his spots (season)", sign: -1, ref: "mean", unit: "PFF grade pt" } as CovariateSpec,
  oppMtRate: { key: COV.oppMtRate, label: "Opp. missed-tackle rate (season)", sign: 1, ref: "mean", unit: "pt of MT rate" } as CovariateSpec,
  /**
   * The line matchup (the user, 2026-11-19: "if its like a 75 dline vs a 55
   * oline and that back had a great game then it should be multipled as he
   * perfomed way above expectations with a bad oline vs a great dline";
   * applied as added credit like every context input, since a multiplier
   * would make a bad game in a tough matchup count worse): how
   * far the opponent's front seven sits above the average front seven, minus
   * how far his line sits above the average line, each in its own spread
   * (PFF grades fronts higher and tighter). Average vs average = 0. The
   * effect is measured on the front seven alone (it changes game to game)
   * and applied to the whole gap, so the line weighs the same as the D-line:
   * the user's call ("I dont see a world where the Oline counts as half the
   * Dline", 2026-11-19), not a tested one. Fitting one effect on the gap
   * itself was tried: the ~13 backs whose line changed between seasons
   * didn't move with it in SRAE / YCO, which dragged the D-line's effect down
   * too (SRAE 4.5% held out → 1.8%).
   */
  lineMatchup: { key: COV.lineFront7, applyKey: COV.lineMatchup, label: "Line matchup (their front 7 vs his OL)", sign: -1, ref: 0, unit: "step of matchup" } as CovariateSpec,
};

/** The season unit tests. */
export type SeasonUnitInput = "matchup" | "front7" | "coverage" | "mt";
export const SEASON_UNIT_INPUTS: Record<SeasonUnitInput, { label: string; specs: CovariateSpec[] }> = {
  matchup: { label: "Line matchup", specs: [SEASON_UNIT_SPECS.lineMatchup] },
  front7: { label: "Opp. front seven", specs: [SEASON_UNIT_SPECS.oppFront7] },
  coverage: { label: "Opp. coverage", specs: [SEASON_UNIT_SPECS.oppCoverage] },
  mt: { label: "Opp. missed-tackle rate", specs: [SEASON_UNIT_SPECS.oppMtRate] },
};

export interface ContextCovariates {
  cov: GameCovariates;
  /** Mean defensive SP+ of the charted FBS opponents: the level SP+ lifts are measured from. */
  spRef: number;
  /** The defensive SP+ an FCS opponent counts as: the mean of the charted G5 opponents (else the weakest FBS one). */
  fcsSp: number;
  /** The line matchup's yardsticks: the average and spread of his line and of their front seven over RB games (null with none). */
  lineRef?: LineRef | null;
}

export interface LineRef { ol: number; olSd: number; front7: number; front7Sd: number }

const meanSd = (v: readonly number[]) => {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  return { m, sd: Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) };
};

/**
 * The averages and spreads the line matchup is measured from, over RB games
 * (the games with his own line's report read): his line over those with a
 * full report, their front seven over those with a full opponent report.
 */
export function lineRefOf(contexts: Iterable<GameContext>): LineRef | null {
  const ol: number[] = [], f7: number[] = [];
  for (const c of contexts) {
    const u = c.units;
    if (!u || u.teamGames == null) continue;
    if (u.teamFull && u.olRunBlock != null) ol.push(u.olRunBlock);
    if (u.oppFull && u.oppFront7 != null) f7.push(u.oppFront7);
  }
  if (ol.length < 2 || f7.length < 2) return null;
  const a = meanSd(ol), b = meanSd(f7);
  return a.sd > 0 && b.sd > 0 ? { ol: a.m, olSd: a.sd, front7: b.m, front7Sd: b.sd } : null;
}

/**
 * One game's line matchup: + = tougher for him. His line counts as average
 * when its report is thin (an FCS team PFF saw once or twice), so the D-line
 * still counts (the user: "Dline always has to be accounted for for each
 * specific game"). Null for a non-RB game or a thin opponent report.
 */
export function lineMatchup(u: SeasonUnits | null | undefined, ref: LineRef | null | undefined): number | null {
  if (!u || !ref || u.teamGames == null || !u.oppFull || u.oppFront7 == null) return null;
  const line = u.teamFull && u.olRunBlock != null ? (u.olRunBlock - ref.ol) / ref.olSd : 0;
  return (u.oppFront7 - ref.front7) / ref.front7Sd - line;
}

/**
 * Every game's covariates. Opponent SP+ needs a matched FBS opponent with SP+
 * (an FCS one gets the flag and the SP+ reference); tiers come from the
 * charted opponent like today's adjustment; weather needs a reading or a dome
 * (calm, dry, mild); cast needs the PFF facet. Season units need a report of
 * MIN_SEASON_GAMES+ games behind them; the opponent's coverage is blended by
 * `alignmentMix` (his routes that game by spot, alignmentMix.ts), so a game
 * without one has no coverage input.
 */
export function gameCovariates(
  games: readonly Pick<ScoutingGame, "id">[],
  contexts: ReadonlyMap<string, GameContext>,
  tierByGame: ReadonlyMap<string, OpponentTier>,
  alignmentMix: ReadonlyMap<string, AlignmentMix> = new Map(),
): ContextCovariates {
  const fbs = games.filter((g) => { const c = contexts.get(g.id); return c?.matched && !c.opponentFcs && c.oppDefSp != null; });
  const sps = fbs.map((g) => contexts.get(g.id)!.oppDefSp!);
  const spRef = sps.length ? sps.reduce((s, x) => s + x, 0) / sps.length : 0;
  const g5 = fbs.filter((g) => tierByGame.get(g.id) === "G5").map((g) => contexts.get(g.id)!.oppDefSp!);
  const fcsSp = g5.length ? g5.reduce((s, x) => s + x, 0) / g5.length : sps.length ? Math.max(...sps) : 0;
  const lineRef = lineRefOf(games.map((g) => contexts.get(g.id)).filter((c): c is GameContext => c != null));
  const cov = new Map<string, Record<string, number>>();
  for (const g of games) {
    const v: Record<string, number> = {};
    const t = tierByGame.get(g.id);
    if (t) { v[COV.g5] = t === "G5" ? 1 : 0; v[COV.fcsTier] = t === "FCS" ? 1 : 0; }
    const c = contexts.get(g.id);
    if (c?.matched) {
      if (c.opponentFcs) { v[COV.oppFcs] = 1; v[COV.oppDefSp] = fcsSp; }
      else if (c.oppDefSp != null) { v[COV.oppFcs] = 0; v[COV.oppDefSp] = c.oppDefSp; }
      const w = c.weather;
      if (w?.status === "dome") { v[COV.wind] = 0; v[COV.rain] = 0; v[COV.cold] = 0; }
      else if (w?.status === "ok" && w.windMph != null && w.temperatureF != null) {
        v[COV.wind] = w.windMph;
        v[COV.rain] = (w.precipIn ?? 0) >= RAIN_IN ? 1 : 0;
        v[COV.cold] = w.temperatureF < COLD_F ? 1 : 0;
      }
    }
    if (c?.cast) {
      if (c.cast.olPassBlock != null) v[COV.olPassBlock] = c.cast.olPassBlock;
      if (c.cast.olRunBlock != null) v[COV.olRunBlock] = c.cast.olRunBlock;
      if (c.cast.qbPassGrade != null) v[COV.qbGrade] = c.cast.qbPassGrade;
    }
    const u = c?.units;
    if (u?.teamFull && u.olRunBlock != null) v[COV.seasonOlRunBlock] = u.olRunBlock;
    if (u?.oppFull) {
      if (u.oppFront7 != null) v[COV.oppFront7] = u.oppFront7;
      if (u.oppMtRate != null) v[COV.oppMtRate] = u.oppMtRate;
      const mix = alignmentMix.get(g.id);
      const blended = mix ? blendCoverage(mix, u.oppCoverage) : null;
      if (blended != null) v[COV.oppCoverage] = blended;
    }
    const mu = lineMatchup(u, lineRef);
    if (mu != null) {
      v[COV.lineMatchup] = mu;
      v[COV.lineFront7] = (u!.oppFront7! - lineRef!.front7) / lineRef!.front7Sd;
    }
    if (Object.keys(v).length) cov.set(g.id, v);
  }
  return { cov, spRef, fcsSp, lineRef };
}
