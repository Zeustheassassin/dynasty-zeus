// The AE Score's PFF TWP% over a QB's full charted seasons, adjusted for how
// deep he throws. Pure.
//
// The user's call (2026-11-17): TWP% reads whole seasons, like the middle of
// the field and the rushing bonus, and only the seasons he was charted in
// (chartedSeasonRows). Over charted games alone it barely moved anyone
// (Mestemaker 6 TWP on 199 charted dropbacks vs 20 on 405 for the season).
//
// Turnover-worthy plays rise with depth (39 charted QB seasons, 2026-11-17:
// behind the line 0.5%, short 2.2%, intermediate 5.8%, deep 6.3%), so each
// season is judged against the TWPs the pool would throw on his dropbacks at
// each depth: his count minus that expected count, plus the pool's overall
// rate, so the rate still reads as a TWP% centred on the pool. PFF gives each
// band's dropbacks and TWP rate; dropbacks with no depth (sacks, scrambles,
// and the like) are their own band, the "other".
import type { GameCount } from "./countComponents";
import { DEPTH_BANDS, type PffSeasonDepthRow } from "./middleUsage";

/** Components read from full seasons instead of charted games. */
export const SEASON_PFF_KEYS: ReadonlySet<string> = new Set(["pff_twp"]);

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

type Band = (typeof DEPTH_BANDS)[number] | "other";

/** One season split into depth bands: dropbacks and TWPs in each. */
function seasonBands(r: PffSeasonDepthRow): { den: number; twp: number; bands: Record<Band, { db: number; twp: number }> } {
  const den = n(r.fs_all_dropbacks) || n(r.fs_dropbacks);
  const twp = n(r.fs_twp);
  const bands = {} as Record<Band, { db: number; twp: number }>;
  let dbIn = 0, twpIn = 0;
  for (const b of DEPTH_BANDS) {
    const db = n(r[`fs_${b}_dropbacks`]);
    const t = Math.round((n(r[`fs_${b}_twp_rate`]) * db) / 100);
    bands[b] = { db, twp: t };
    dbIn += db; twpIn += t;
  }
  bands.other = { db: Math.max(0, den - dbIn), twp: Math.max(0, twp - twpIn) };
  return { den, twp, bands };
}

export interface SeasonTwp {
  /** One count per prospect-season, keyed `${prospect_id}|${season}`. */
  counts: GameCount[];
  /** The seasons as "games" (for season weighting in countStat). */
  games: { id: string; prospect_id: string; season_year: number }[];
  /** The pool's TWP rate per depth band, 0–1. */
  poolByBand: Record<Band, number>;
  /** The pool's overall TWP rate, 0–1. */
  pool: number;
}

/**
 * Depth-adjusted TWP counts over the given seasons (pass charted seasons only).
 * `include` picks the prospects (QBs). The pool is every included season.
 */
export function seasonTwpCounts(rows: readonly PffSeasonDepthRow[], include: (prospectId: string) => boolean): SeasonTwp {
  const seasons = rows.filter((r) => include(r.prospect_id)).map((r) => ({ r, s: seasonBands(r) })).filter((x) => x.s.den > 0);
  const tot = {} as Record<Band, { db: number; twp: number }>;
  for (const b of [...DEPTH_BANDS, "other"] as Band[]) tot[b] = { db: 0, twp: 0 };
  let poolTwp = 0, poolDen = 0;
  for (const { s } of seasons) {
    for (const b of Object.keys(tot) as Band[]) { tot[b].db += s.bands[b].db; tot[b].twp += s.bands[b].twp; }
    poolTwp += s.twp; poolDen += s.den;
  }
  const poolByBand = Object.fromEntries((Object.keys(tot) as Band[]).map((b) => [b, tot[b].db > 0 ? tot[b].twp / tot[b].db : 0])) as Record<Band, number>;
  const pool = poolDen > 0 ? poolTwp / poolDen : 0;
  const counts: GameCount[] = [];
  const games: SeasonTwp["games"] = [];
  for (const { r, s } of seasons) {
    const expected = (Object.keys(s.bands) as Band[]).reduce((sum, b) => sum + s.bands[b].db * poolByBand[b], 0);
    const id = `${r.prospect_id}|${r.season}`;
    counts.push({ prospectId: r.prospect_id, gameId: id, num: s.twp - expected + pool * s.den, den: s.den });
    games.push({ id, prospect_id: r.prospect_id, season_year: r.season });
  }
  return { counts, games, poolByBand, pool };
}
