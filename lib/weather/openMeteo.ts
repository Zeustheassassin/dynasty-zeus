// Game-time weather from the Open-Meteo historical archive (ERA5 reanalysis;
// free, no key): https://open-meteo.com/en/docs/historical-weather-api
// (tape-grading expansion, Stage 5). The URL builder and the summary are pure;
// fetchArchive is the only I/O.
//
// One request covers several stadiums on the same dates (comma-separated
// coordinates; the response is then a list, one entry per point). Hours come
// back in UTC (timezone=GMT), the same clock as CFD's kickoffs.
//
// A game's weather is summarized over its window: the kickoff hour and the
// three after it (about a game's length): mean temperature, wind and
// humidity, the strongest gust, total rain/snow and the worst weather code.
// The archive runs about five days behind, so a game from the last few days
// comes back with empty hours; that game stays "pending" and is fetched again
// later. Domed stadiums are never fetched.

export const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
export const HOURLY_VARS = [
  "temperature_2m", "relative_humidity_2m", "precipitation", "snowfall",
  "weather_code", "wind_speed_10m", "wind_gusts_10m",
] as const;
/** Kickoff hour plus this many more. */
export const GAME_WINDOW_HOURS = 4;
/** Archive lag: a game newer than this is left pending rather than read. */
export const ARCHIVE_LAG_DAYS = 6;
/** Stadiums per request (keeps the URL short). */
export const POINTS_PER_REQUEST = 40;
/** A kickoff CFD lists as TBD is read at 18:00 UTC (early afternoon in the US). */
const TBD_KICKOFF_HOUR_UTC = 18;

export interface WeatherPoint {
  latitude: number;
  longitude: number;
}

export interface HourlyWeather {
  time: string[];
  temperature_2m?: (number | null)[];
  relative_humidity_2m?: (number | null)[];
  precipitation?: (number | null)[];
  snowfall?: (number | null)[];
  weather_code?: (number | null)[];
  wind_speed_10m?: (number | null)[];
  wind_gusts_10m?: (number | null)[];
}

export interface GameWeatherSummary {
  temperature_f: number;
  wind_mph: number;
  humidity: number | null;
  gust_mph: number | null;
  precip_in: number;
  snow_in: number;
  weather_code: number | null;
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The kickoff instant to read, from CFD's start and TBD flag. */
export function kickoffMs(start: string, tbd: boolean | null | undefined): number | null {
  const ms = Date.parse(start);
  if (!Number.isFinite(ms)) return null;
  if (!tbd) return ms;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), TBD_KICKOFF_HOUR_UTC);
}

/** The archive dates a kickoff needs (its day, and the next when the window crosses midnight UTC). */
export function windowDates(kickoff: number): { start: string; end: string } {
  return { start: isoDay(kickoff), end: isoDay(kickoff + (GAME_WINDOW_HOURS - 1) * 3_600_000) };
}

/** Can the archive have this game yet? */
export function archiveReady(kickoff: number, now = Date.now()): boolean {
  return now - kickoff >= ARCHIVE_LAG_DAYS * 86_400_000;
}

export function archiveUrl(points: readonly WeatherPoint[], start: string, end: string): string {
  const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
  const q = new URLSearchParams({
    latitude: points.map((p) => r4(p.latitude)).join(","),
    longitude: points.map((p) => r4(p.longitude)).join(","),
    start_date: start,
    end_date: end,
    hourly: HOURLY_VARS.join(","),
    temperature_unit: "fahrenheit",
    wind_speed_unit: "mph",
    precipitation_unit: "inch",
    timezone: "GMT",
  });
  return `${ARCHIVE_URL}?${q.toString()}`;
}

const round = (x: number, dp: number) => Math.round(x * 10 ** dp) / 10 ** dp;
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * The game window's weather from one point's hourly series, or null when the
 * archive doesn't cover every hour of it yet (temperature or wind missing).
 */
export function summarizeWindow(hourly: HourlyWeather | null | undefined, kickoff: number): GameWeatherSummary | null {
  if (!hourly?.time) return null;
  const first = Math.floor(kickoff / 3_600_000) * 3_600_000;
  const idx: number[] = [];
  for (let h = 0; h < GAME_WINDOW_HOURS; h++) {
    const at = first + h * 3_600_000;
    // Open-Meteo's GMT times look like "2025-09-06T19:00" (no zone).
    const i = hourly.time.findIndex((t) => Date.parse(`${t}Z`) === at);
    if (i < 0) return null;
    idx.push(i);
  }
  const pick = (xs: (number | null)[] | undefined): number[] | null => {
    if (!xs) return null;
    const out: number[] = [];
    for (const i of idx) {
      const v = xs[i];
      if (v == null || !Number.isFinite(v)) return null;
      out.push(v);
    }
    return out;
  };
  const temp = pick(hourly.temperature_2m), wind = pick(hourly.wind_speed_10m);
  if (!temp || !wind) return null;
  const gust = pick(hourly.wind_gusts_10m), hum = pick(hourly.relative_humidity_2m);
  const precip = pick(hourly.precipitation), snow = pick(hourly.snowfall), code = pick(hourly.weather_code);
  return {
    temperature_f: round(mean(temp), 1),
    wind_mph: round(mean(wind), 1),
    humidity: hum ? round(mean(hum), 1) : null,
    gust_mph: gust ? round(Math.max(...gust), 1) : null,
    precip_in: precip ? round(precip.reduce((s, x) => s + x, 0), 2) : 0,
    snow_in: snow ? round(snow.reduce((s, x) => s + x, 0), 2) : 0,
    weather_code: code ? Math.max(...code) : null,
  };
}

/** The archive's hourly series for each point, in order. Throws on a failed request. */
export async function fetchArchive(
  points: readonly WeatherPoint[], start: string, end: string, fetchImpl: typeof fetch = fetch,
): Promise<HourlyWeather[]> {
  const res = await fetchImpl(archiveUrl(points, start, end), { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Open-Meteo archive ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  const body: unknown = await res.json();
  const list = Array.isArray(body) ? body : [body];
  return list.map((p) => ((p as { hourly?: HourlyWeather }).hourly ?? { time: [] }));
}

/** Plain-words label for a WMO weather code (the worst hour of the window). */
export function weatherCodeLabel(code: number | null | undefined): string | null {
  if (code == null) return null;
  if (code <= 1) return "Clear";
  if (code <= 3) return "Cloudy";
  if (code <= 48) return "Fog";
  if (code <= 57) return "Drizzle";
  if (code <= 67) return "Rain";
  if (code <= 77) return "Snow";
  if (code <= 82) return "Showers";
  if (code <= 86) return "Snow showers";
  return "Thunderstorm";
}
