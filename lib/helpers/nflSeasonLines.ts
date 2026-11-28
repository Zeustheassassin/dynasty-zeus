// ============================================================
// NFL season lines (positional value per league, stage 1)
// ============================================================
// One line per QB / RB / WR / TE per regular season: his games and his season
// totals under SLEEPER's scoring keys, so any league's scoring_settings can
// score it with computeLeagueFpts (scoring.ts) as Sleeper would. Built from
// nflverse's weekly player stats (stats_player_week_{season}.csv, a public
// GitHub release: the source Fill 40s' combine file comes from), so it costs
// no Sleeper calls. Read on the server (lib/server/nflSeasonLines.ts) and sent
// to the browser by /api/nfl-season-lines; the math is positionalValue.ts.
//
// A per-game bonus key (bonus_rec_yd_100…) holds the number of games that hit
// it, which is what Sleeper multiplies its value by. Rules nflverse can't
// rebuild (TD length bonuses, catch-length buckets other than 10–19 and 40+,
// pick sixes…) aren't counted: uncountedScoringKeys lists them per league.
// Pure.
// ============================================================

import { parseCsv } from "../nflContracts";

export const LINE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
export type LinePos = (typeof LINE_POSITIONS)[number];

/** Season totals under Sleeper's stat keys, read straight off nflverse's columns. */
const SUM_COLUMNS: Record<string, string> = {
  pass_yd: "passing_yards", pass_td: "passing_tds", pass_int: "passing_interceptions", pass_2pt: "passing_2pt_conversions",
  pass_cmp: "completions", pass_att: "attempts", pass_fd: "passing_first_downs", pass_sack: "sacks_suffered",
  pass_cmp_40p: "passing_40",
  rush_yd: "rushing_yards", rush_td: "rushing_tds", rush_att: "carries", rush_fd: "rushing_first_downs",
  rush_2pt: "rushing_2pt_conversions", rush_40p: "rushing_40",
  rec: "receptions", rec_yd: "receiving_yards", rec_td: "receiving_tds", rec_fd: "receiving_first_downs",
  rec_2pt: "receiving_2pt_conversions", rec_40p: "receiving_40",
  fum: "fumbles_total", fum_lost: "fumbles_lost_total",
};

/** Per-game bonuses: the number of games at or past the line (Sleeper pays each one it hits, so a 400-yard game pays both). */
const GAME_BONUSES: { key: string; at: number; of: (g: Record<string, number>) => number }[] = [
  { key: "bonus_pass_yd_300", at: 300, of: (g) => g.pass_yd },
  { key: "bonus_pass_yd_400", at: 400, of: (g) => g.pass_yd },
  { key: "bonus_pass_cmp_25", at: 25, of: (g) => g.pass_cmp },
  { key: "bonus_rush_yd_100", at: 100, of: (g) => g.rush_yd },
  { key: "bonus_rush_yd_200", at: 200, of: (g) => g.rush_yd },
  { key: "bonus_rush_att_20", at: 20, of: (g) => g.rush_att },
  { key: "bonus_rec_yd_100", at: 100, of: (g) => g.rec_yd },
  { key: "bonus_rec_yd_200", at: 200, of: (g) => g.rec_yd },
  { key: "bonus_rush_rec_yd_100", at: 100, of: (g) => g.rush_yd + g.rec_yd },
  { key: "bonus_rush_rec_yd_200", at: 200, of: (g) => g.rush_yd + g.rec_yd },
];

/** Every key a line carries, in the order the route sends them. */
export const LINE_KEYS: readonly string[] = [
  ...Object.keys(SUM_COLUMNS), "pass_inc", "rec_10_19", ...GAME_BONUSES.map((b) => b.key),
];

/** Rules the season lines can score besides LINE_KEYS: the position reception bonuses (computeLeagueFpts reads them off `rec`). */
const POSITION_REC_BONUSES = new Set(["bonus_rec_te", "bonus_rec_rb", "bonus_rec_wr"]);

export interface SeasonLine {
  season: number;
  pos: LinePos;
  /** Regular-season games with a stat line. */
  games: number;
  /** Season totals by Sleeper stat key (LINE_KEYS). */
  stats: Record<string, number>;
}

/** What /api/nfl-season-lines sends: the keys once, then each line as [pos, season, games, ...values in key order]. */
export interface SeasonLinesPayload {
  seasons: number[];
  keys: string[];
  lines: (string | number)[][];
}

const isLinePos = (p: string): p is LinePos => (LINE_POSITIONS as readonly string[]).includes(p);
const num = (v: string | undefined) => {
  const n = Number(v);
  return v != null && v !== "" && v !== "NA" && Number.isFinite(n) ? n : 0;
};

/**
 * One season's lines from nflverse's weekly file: regular-season rows of
 * QB / RB / WR / TE only, summed per player (a player keeps the position he
 * was listed at most that season). Lines under `minGames` are left out.
 */
export function seasonLinesFromWeeklyCsv(csv: string, season: number, minGames = 1): SeasonLine[] {
  const rows = parseCsv(csv);
  const header = rows[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const idCol = col("player_id"), posCol = col("position"), typeCol = col("season_type"), seasonCol = col("season");
  if (idCol < 0 || posCol < 0) throw new Error("nflverse weekly stats: no player_id / position column");
  const sumCols = Object.entries(SUM_COLUMNS).map(([key, name]) => [key, col(name)] as const);
  const r10 = col("receiving_10"), r20 = col("receiving_20");

  const players = new Map<string, { games: number; stats: Record<string, number>; posCount: Map<LinePos, number> }>();
  for (const r of rows.slice(1)) {
    const pos = r[posCol];
    if (!pos || !isLinePos(pos)) continue;
    if (typeCol >= 0 && r[typeCol] !== "REG") continue;
    if (seasonCol >= 0 && num(r[seasonCol]) !== season) continue;
    const id = r[idCol];
    if (!id) continue;
    const g: Record<string, number> = {};
    for (const [key, i] of sumCols) g[key] = i >= 0 ? num(r[i]) : 0;
    g.pass_inc = Math.max(0, g.pass_att - g.pass_cmp);
    g.rec_10_19 = r10 >= 0 && r20 >= 0 ? Math.max(0, num(r[r10]) - num(r[r20])) : 0;
    for (const b of GAME_BONUSES) g[b.key] = b.of(g) >= b.at ? 1 : 0;

    let p = players.get(id);
    if (!p) {
      p = { games: 0, stats: Object.fromEntries(LINE_KEYS.map((k) => [k, 0])), posCount: new Map() };
      players.set(id, p);
    }
    p.games++;
    p.posCount.set(pos, (p.posCount.get(pos) ?? 0) + 1);
    for (const k of LINE_KEYS) p.stats[k] += g[k];
  }

  const out: SeasonLine[] = [];
  for (const p of players.values()) {
    if (p.games < minGames) continue;
    const pos = [...p.posCount].sort((a, b) => b[1] - a[1])[0][0];
    out.push({ season, pos, games: p.games, stats: p.stats });
  }
  return out;
}

/** The compact form the route sends (keys once; whole numbers, as nflverse's counts are). */
export function toPayload(seasons: number[], lines: readonly SeasonLine[]): SeasonLinesPayload {
  return {
    seasons,
    keys: [...LINE_KEYS],
    lines: lines.map((l) => [l.pos, l.season, l.games, ...LINE_KEYS.map((k) => l.stats[k] ?? 0)]),
  };
}

/** Back from the compact form; a line with an unknown position or the wrong length is dropped. */
export function fromPayload(p: SeasonLinesPayload): SeasonLine[] {
  const out: SeasonLine[] = [];
  for (const row of p.lines) {
    const [pos, season, games, ...values] = row;
    if (typeof pos !== "string" || !isLinePos(pos) || values.length !== p.keys.length) continue;
    const stats: Record<string, number> = {};
    p.keys.forEach((k, i) => { stats[k] = Number(values[i]) || 0; });
    out.push({ pos, season: Number(season), games: Number(games), stats });
  }
  return out;
}

/** A rule touches QB / RB / WR / TE scoring (passing, rushing, receiving, fumbles), as opposed to kicking, defense or IDP. */
const OFFENSE_RULE = /^(pass|rush|rec|fum_lost$|fum$|bonus_(pass|rush|rec))/;

/**
 * A league's QB / RB / WR / TE rules the season lines can't score (a value
 * set, but nflverse has no column to rebuild it from): shown with the
 * league's numbers so a missing rule isn't silent.
 */
export function uncountedScoringKeys(scoring: Record<string, number> | null | undefined): string[] {
  const counted = new Set(LINE_KEYS);
  return Object.entries(scoring ?? {})
    .filter(([k, v]) => typeof v === "number" && v !== 0 && OFFENSE_RULE.test(k) && !counted.has(k) && !POSITION_REC_BONUSES.has(k))
    .map(([k]) => k)
    .sort();
}

/**
 * The seasons the lines come from: the last `count` finished regular seasons.
 * A season counts as finished from February 1 after it (its week 18 is in
 * early January), so on 2026-11-27 that's 2023–2025 and from 2027-02-01
 * 2024–2026.
 */
export function finishedSeasons(now: Date, count = 3): number[] {
  const last = now.getUTCMonth() >= 1 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
  return Array.from({ length: count }, (_, i) => last - count + 1 + i);
}
