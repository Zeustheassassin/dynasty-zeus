// Each charted game's automatic context, as the screens and the grading use
// it (tape-grading expansion, Stage 5). Pure; client-safe.
//
// ScoutingHub loads three things (migration 065): the user's
// scouting_game_context rows (his CFD game, the two teams, his supporting
// cast from PFF), the shared cfd_games rows those point at (kickoff, venue,
// score, weather) and cfd_team_seasons (SP+). resolveGameContexts joins
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
}

export const CONTEXT_ROW_SELECT =
  "game_id,prospect_id,cfd_game_id,cfd_match_status,cfd_match_note,team_school,opponent_school,cast_status,pff_franchise_id,team_snaps,his_snaps,ol_pass_block,ol_pass_block_snaps,ol_run_block,ol_run_block_snaps,qb_pass_grade,qb_name,qb_pff_id,qb_dropbacks,fetched_at";
export const CFD_GAME_SELECT =
  "id,season,week,season_type,start_date,start_time_tbd,completed,neutral_site,venue_id,venue,home_team,home_classification,home_points,away_team,away_classification,away_points,weather_status,temperature_f,wind_mph,humidity,gust_mph,precip_in,snow_in,weather_code,weather_fetched_at";
export const TEAM_SEASON_SELECT = "season,school,conference,sp_rating,sp_offense,sp_defense,sp_ranking,sp_defense_ranking";

export interface GameContextData {
  rows: readonly GameContextRow[];
  cfdGames: readonly CfdGameWithWeather[];
  teamSeasons: readonly CfdTeamSeasonRow[];
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
    });
  }
  return out;
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

export interface ContextCovariates {
  cov: GameCovariates;
  /** Mean defensive SP+ of the charted FBS opponents: the level SP+ lifts are measured from. */
  spRef: number;
  /** The defensive SP+ an FCS opponent counts as: the mean of the charted G5 opponents (else the weakest FBS one). */
  fcsSp: number;
}

/**
 * Every game's covariates. Opponent SP+ needs a matched FBS opponent with SP+
 * (an FCS one gets the flag and the SP+ reference); tiers come from the
 * charted opponent like today's adjustment; weather needs a reading or a dome
 * (calm, dry, mild); cast needs the PFF facet.
 */
export function gameCovariates(
  games: readonly Pick<ScoutingGame, "id">[],
  contexts: ReadonlyMap<string, GameContext>,
  tierByGame: ReadonlyMap<string, OpponentTier>,
): ContextCovariates {
  const fbs = games.filter((g) => { const c = contexts.get(g.id); return c?.matched && !c.opponentFcs && c.oppDefSp != null; });
  const sps = fbs.map((g) => contexts.get(g.id)!.oppDefSp!);
  const spRef = sps.length ? sps.reduce((s, x) => s + x, 0) / sps.length : 0;
  const g5 = fbs.filter((g) => tierByGame.get(g.id) === "G5").map((g) => contexts.get(g.id)!.oppDefSp!);
  const fcsSp = g5.length ? g5.reduce((s, x) => s + x, 0) / g5.length : sps.length ? Math.max(...sps) : 0;
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
    if (Object.keys(v).length) cov.set(g.id, v);
  }
  return { cov, spRef, fcsSp };
}
