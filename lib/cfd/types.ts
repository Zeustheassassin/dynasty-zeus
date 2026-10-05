// Shapes of the shared CollegeFootballData (CFD) cache tables (migration 065)
// and the pure normalizers from CFD's responses. Client-safe: no key, no
// fetch. The tables hold public data (schedules, venues, SP+), shared by
// every user like `recruits`; the per-user link from a charted game to its
// CFD game lives in scouting_game_context.
//
// CFD's team names (`school`) are the names opponentTier.ts resolves charted
// opponents to, since opponentTierData.ts is generated from CFD's /teams.

/** One FBS game (either team FBS) of a fetched season: `cfd_games`. */
export interface CfdGameRow {
  id: number;
  season: number;
  week: number | null;
  season_type: string | null;
  /** Kickoff, ISO UTC. */
  start_date: string | null;
  start_time_tbd: boolean | null;
  completed: boolean | null;
  neutral_site: boolean | null;
  venue_id: number | null;
  venue: string | null;
  home_team: string;
  home_classification: string | null;
  home_points: number | null;
  away_team: string;
  away_classification: string | null;
  away_points: number | null;
}

export type WeatherStatus = "ok" | "dome" | "no_location" | "pending";

/** The weather columns of `cfd_games`, filled for charted games only (Open-Meteo archive). */
export interface CfdGameWeather {
  weather_status: WeatherStatus | null;
  /** Means over the game window (kickoff hour + 3 more hours). */
  temperature_f: number | null;
  wind_mph: number | null;
  humidity: number | null;
  /** Strongest gust in the window. */
  gust_mph: number | null;
  /** Totals over the window. */
  precip_in: number | null;
  snow_in: number | null;
  /** Worst WMO weather code in the window. */
  weather_code: number | null;
  weather_fetched_at: string | null;
}

export type CfdGameWithWeather = CfdGameRow & Partial<CfdGameWeather>;

/** `cfd_venues`. */
export interface CfdVenueRow {
  id: number;
  name: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  elevation: number | null;
  dome: boolean | null;
  grass: boolean | null;
  timezone: string | null;
}

/** SP+ for one FBS team-season: `cfd_team_seasons`. FCS teams have no SP+. */
export interface CfdTeamSeasonRow {
  season: number;
  school: string;
  conference: string | null;
  /** Overall SP+ (points better than average; higher is better). */
  sp_rating: number | null;
  sp_offense: number | null;
  /** Defensive SP+: points allowed per game vs an average offense, LOWER is better. */
  sp_defense: number | null;
  sp_ranking: number | null;
  sp_defense_ranking: number | null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** A CFD /games row → `cfd_games`; null without an id or both teams. */
export function toCfdGameRow(raw: unknown): CfdGameRow | null {
  const g = obj(raw);
  const id = num(g.id), season = num(g.season);
  const home = str(g.homeTeam), away = str(g.awayTeam);
  if (id == null || season == null || !home || !away) return null;
  return {
    id, season,
    week: num(g.week),
    season_type: str(g.seasonType),
    start_date: str(g.startDate),
    start_time_tbd: bool(g.startTimeTBD),
    completed: bool(g.completed),
    neutral_site: bool(g.neutralSite),
    venue_id: num(g.venueId),
    venue: str(g.venue),
    home_team: home,
    home_classification: str(g.homeClassification),
    home_points: num(g.homePoints),
    away_team: away,
    away_classification: str(g.awayClassification),
    away_points: num(g.awayPoints),
  };
}

/** A CFD /venues row → `cfd_venues`; null without an id. */
export function toCfdVenueRow(raw: unknown): CfdVenueRow | null {
  const v = obj(raw);
  const id = num(v.id);
  if (id == null) return null;
  return {
    id,
    name: str(v.name),
    city: str(v.city),
    state: str(v.state),
    latitude: num(v.latitude),
    longitude: num(v.longitude),
    elevation: num(v.elevation),
    dome: bool(v.dome),
    grass: bool(v.grass),
    timezone: str(v.timezone),
  };
}

/** CFD /ratings/sp for a season → `cfd_team_seasons` (drops the national-averages row). */
export function toCfdTeamSeasonRows(raw: unknown, season: number): CfdTeamSeasonRow[] {
  if (!Array.isArray(raw)) return [];
  const out: CfdTeamSeasonRow[] = [];
  for (const r of raw) {
    const t = obj(r);
    const school = str(t.team);
    if (!school || school === "nationalAverages") continue;
    const off = obj(t.offense), def = obj(t.defense);
    out.push({
      season,
      school,
      conference: str(t.conference),
      sp_rating: num(t.rating),
      sp_offense: num(off.rating),
      sp_defense: num(def.rating),
      sp_ranking: num(t.ranking),
      sp_defense_ranking: num(def.ranking),
    });
  }
  return out;
}
