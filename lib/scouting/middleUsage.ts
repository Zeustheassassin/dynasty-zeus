// QB middle of the field: how often he throws 10+ yards downfield between the
// numbers, from PFF's FULL seasons (migration 092). Pure.
//
// The user's call (2026-11-10): a QB who won't throw the intermediate and
// deep middle is a much worse NFL bet ("players like Kyler are way less
// effective because they rarely throw intermediate middle"), and one who
// lives there should get credit. Every offense runs digs and slants, so the
// throw is there if he wants it: no scheme adjustment. Short middle doesn't
// count.
//
// The share is PFF center_medium + center_deep (10–19 and 20+ air yards,
// between the numbers) over his attempts past the line of scrimmage (screens
// and other throws behind the line left out, so a screen-heavy offense isn't
// read as avoiding the middle). Measured on PFF's 2024 and 2025 NCAA seasons
// (QBs with 200+ attempts): median 22.2%, bottom quarter under 19.2%, bottom
// 5% under 14.3%, top quarter over 25%, top 5% over 30.3%. A season carries
// over to the next at r 0.39 (0.47 counting every attempt). NFL 2025: median
// 16.3%, Kyler Murray 13.0% (8th lowest of 43).
//
// Over 3–5 charted games the share is mostly noise, so it reads every college
// season PFF has, not just the charted weeks (the user: "that can be a full
// season sample for just that metric"). Seasons blend by attempts, older ones
// faded like every AE (SEASON_DECAY per season before his newest), and the
// blend is pulled toward the college pool by MIDDLE_SHRINK_ATTEMPTS (about
// a season's worth is half real), so a thin sample barely moves.
//
// The adjustment (the user's picks): under MIDDLE_PENALTY_START (the bottom
// quarter) it costs up to MIDDLE_MAX at MIDDLE_PENALTY_FULL (the bottom 5%);
// over MIDDLE_BONUS_START (the top quarter) it earns up to MIDDLE_MAX at
// MIDDLE_BONUS_FULL (the top 5%); in between, nothing. Both ends curve
// like the WR alignment penalty (alignmentPenalty.ts): gentle at the start,
// steep toward full. It's added to the QB's AE Score (prospectScores.ts
// liveScoresFrom), so Dynasty and Dynasty+ carry it.
import { SEASON_DECAY } from "./seasonWeight";

/** One prospect-season of PFF's full-season passing depth (migration 092). */
export interface PffSeasonDepthRow {
  prospect_id: string;
  season: number;
  pff_player_id: number;
  team_name: string | null;
  /** PFF's <zone>_attempts: left / center / right × behind_los / short / medium / deep. */
  zone_attempts: Record<string, number>;
  fetched_at: string;
}
export const SEASON_DEPTH_SELECT = "prospect_id,season,pff_player_id,team_name,zone_attempts,fetched_at";

export const DEPTH_SIDES = ["left", "center", "right"] as const;
export const DEPTH_BANDS = ["behind_los", "short", "medium", "deep"] as const;
/** The zones counted as middle of the field: 10+ air yards, between the numbers. */
export const MIDDLE_ZONES = ["center_medium", "center_deep"] as const;

// The user picked "bottom quarter starts losing, bottom 5% takes the full
// hit" and the mirror for the reward. The cutoffs are those percentiles on
// the scale the adjustment reads: the blended, pulled share of the 226 FBS
// QBs with 150+ throws past the line in 2025 (2024 blended in). Raw single
// seasons spread wider (p5 14.3, p25 19.2, p75 25.0, p95 30.3); the pull and
// the blend narrow them, so raw cutoffs would almost never fire.
export const MIDDLE_PENALTY_START = 20.5;
export const MIDDLE_PENALTY_FULL = 17.7;
export const MIDDLE_BONUS_START = 24.1;
export const MIDDLE_BONUS_FULL = 28.3;
export const MIDDLE_MAX = 0.3;
export const MIDDLE_CURVE = 1.5;
/** The college pool's share (NCAA 2024–25, QBs with 200+ attempts), %. */
export const MIDDLE_POOL_SHARE = 22.5;
/** Attempts past the line at which the sample is half signal (2024: 114, 2025: 110). */
export const MIDDLE_SHRINK_ATTEMPTS = 110;

export interface MiddleUsage {
  /** The blended share, pulled toward the pool, %: what the adjustment reads. */
  share: number;
  /** The blended share as PFF counted it, before the pull, %. */
  rawShare: number;
  /** Middle 10+ throws and attempts past the line, summed over his seasons (unweighted). */
  middle: number;
  attempts: number;
  seasons: number[];
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** One season's middle 10+ throws and attempts past the line. */
export function seasonMiddle(zones: Record<string, number>): { middle: number; pastLos: number } {
  let pastLos = 0;
  for (const s of DEPTH_SIDES) for (const b of DEPTH_BANDS) if (b !== "behind_los") pastLos += n(zones[`${s}_${b}`]);
  return { middle: MIDDLE_ZONES.reduce((a, z) => a + n(zones[z]), 0), pastLos };
}

/** Each prospect's middle-of-the-field share over every season stored for him. */
export function middleUsageByProspect(rows: readonly PffSeasonDepthRow[]): Map<string, MiddleUsage> {
  const by = new Map<string, PffSeasonDepthRow[]>();
  for (const r of rows) {
    const list = by.get(r.prospect_id);
    if (list) list.push(r); else by.set(r.prospect_id, [r]);
  }
  const out = new Map<string, MiddleUsage>();
  for (const [id, list] of by) {
    const newest = Math.max(...list.map((r) => r.season));
    let wMid = 0, wPast = 0, mid = 0, past = 0;
    const seasons: number[] = [];
    for (const r of list) {
      const s = seasonMiddle(r.zone_attempts);
      if (s.pastLos <= 0) continue;
      const w = SEASON_DECAY ** (newest - r.season);
      wMid += w * s.middle; wPast += w * s.pastLos;
      mid += s.middle; past += s.pastLos;
      seasons.push(r.season);
    }
    if (wPast <= 0) continue;
    out.set(id, {
      share: (100 * wMid + MIDDLE_SHRINK_ATTEMPTS * MIDDLE_POOL_SHARE) / (wPast + MIDDLE_SHRINK_ATTEMPTS),
      rawShare: (100 * wMid) / wPast,
      middle: mid,
      attempts: past,
      seasons: seasons.sort((a, b) => a - b),
    });
  }
  return out;
}

/** PFF's zone attempts out of one passing/depth row, every zone present (0 when PFF leaves it blank). */
export function zoneAttemptsFrom(row: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of DEPTH_SIDES) for (const b of DEPTH_BANDS) out[`${s}_${b}`] = Math.round(n(row[`${s}_${b}_attempts`]));
  return out;
}

/**
 * The college seasons to read for a QB: the five before his draft class
 * (a redshirt senior's whole career), never past the season under way
 * (August on). Without a class, a season before his first charted one
 * through the season under way.
 */
export function depthSeasonsFor(draftClassYear: number | null, chartedSeasons: readonly number[], now: Date): number[] {
  const underway = now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const charted = chartedSeasons.filter(Number.isFinite);
  const last = draftClassYear != null ? Math.min(underway, draftClassYear - 1) : underway;
  const first = draftClassYear != null ? draftClassYear - 5 : (charted.length ? Math.min(...charted) : underway) - 1;
  const out: number[] = [];
  for (let y = first; y <= last; y++) out.push(y);
  return out;
}

const ramp = (x: number) => Math.min(1, Math.max(0, x)) ** MIDDLE_CURVE;

/** The AE Score adjustment for his middle share: negative in the bottom quarter, positive in the top quarter, else null. */
export function middleAdjustment(u: MiddleUsage | null | undefined): { label: string; value: number } | null {
  if (!u) return null;
  const value = u.share < MIDDLE_PENALTY_START
    ? -MIDDLE_MAX * ramp((MIDDLE_PENALTY_START - u.share) / (MIDDLE_PENALTY_START - MIDDLE_PENALTY_FULL))
    : u.share > MIDDLE_BONUS_START
      ? MIDDLE_MAX * ramp((u.share - MIDDLE_BONUS_START) / (MIDDLE_BONUS_FULL - MIDDLE_BONUS_START))
      : 0;
  if (value === 0) return null;
  const seasons = u.seasons.length === 1 ? `${u.seasons[0]}` : `${u.seasons[0]}–${u.seasons[u.seasons.length - 1]}`;
  return {
    label: `${u.rawShare.toFixed(1)}% of ${u.attempts} throws past the line went 10+ yds between the numbers (${seasons}, PFF); ${u.share.toFixed(1)}% after the pull toward the ${MIDDLE_POOL_SHARE}% college average`,
    value,
  };
}
