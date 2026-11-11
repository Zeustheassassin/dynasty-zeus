// The Dynasty Score's QB rushing bonus (2026-11-10). Pure.
//
// The user: rushing is a fantasy bonus for a QB who can pass. "A QB like
// Justin Fields who's a poor passer and elite runner doesn't stick in the
// NFL, but a QB like Jalen Hurts was pure gold for years cause he's a good
// enough passer to stick but also racks up rushing yards." Measured by
// carries and yards per carry, not touchdowns ("mostly luck"), so the number
// is rushing yards per game (carries per game × yards per carry) over PFF's
// full college seasons (migration 094).
//
// Checked on PFF's 2024 and 2025 NCAA seasons (QBs with 200+ dropbacks):
// rushing yards per game carries from one season to the next at r 0.82
// (carries per game 0.80; yards per carry only 0.29, mostly noise), so a
// season is mostly real and the pull toward average is light. Median 26
// yards a game, top quarter ~43, top 10% ~62.
//
// The bonus (the user's picks): 0 at the college median, rising evenly to
// RUSH_BONUS_MAX at the top 10%, times a passing gate. The gate ranks every
// scored QB by his AE Score without its rushing pieces (his passing, pocket
// and middle of the field): none in the bottom third, all of it in the top
// third, a smooth curve between. It sits in the Dynasty Score behind its own
// slider; the AE Score keeps its own rushing pieces (the user's call: "both").
import { SEASON_DECAY } from "./seasonWeight";
import type { PffSeasonDepthRow } from "./middleUsage";
import type { AEComposite } from "./aeComposite";
import { scorePieces, type ScoreView } from "./prospectScores";

/** College QB median rushing yards per game (2024–25 starters): the bonus starts here. */
export const RUSH_YPG_START = 26;
/** The top 10% (2024: 61.4, 2025: 61.9): the full bonus. */
export const RUSH_YPG_FULL = 62;
export const RUSH_BONUS_MAX = 0.3;
/** Games of the college median blended in: a season (~12 games) is ~80% real. */
export const RUSH_SHRINK_GAMES = 3;
/** The AE Score's own rushing pieces, left out of the passing gate. */
export const RUSHING_AE_KEYS: ReadonlySet<string> = new Set(["pff_qb_ypc", "tag_qb_run_succ"]);
/** Fewer scored QBs than this and the gate can't be read: no bonus. */
export const GATE_MIN_POOL = 6;

export interface QBRushing {
  seasons: number[];
  /** Summed over his seasons. */
  games: number;
  attempts: number;
  yards: number;
  /** Rushing yards per game, seasons blended (older ones faded) and pulled toward the median: what the bonus reads. */
  ypg: number;
  /** The blend before the pull. */
  rawYpg: number;
}

const n = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Each QB's rushing over the seasons PFF's rushing summary covers. */
export function qbRushingByProspect(rows: readonly PffSeasonDepthRow[]): Map<string, QBRushing> {
  const by = new Map<string, PffSeasonDepthRow[]>();
  for (const r of rows) {
    if (!(n(r.fr_games) > 0)) continue;
    const list = by.get(r.prospect_id);
    if (list) list.push(r); else by.set(r.prospect_id, [r]);
  }
  const out = new Map<string, QBRushing>();
  for (const [id, list] of by) {
    list.sort((a, b) => a.season - b.season);
    const newest = list[list.length - 1].season;
    let wYds = 0, wGames = 0, games = 0, attempts = 0, yards = 0;
    for (const r of list) {
      const w = SEASON_DECAY ** (newest - r.season);
      wYds += w * n(r.fr_yds); wGames += w * n(r.fr_games);
      games += n(r.fr_games); attempts += n(r.fr_att); yards += n(r.fr_yds);
    }
    out.set(id, {
      seasons: list.map((r) => r.season), games, attempts, yards,
      ypg: (wYds + RUSH_SHRINK_GAMES * RUSH_YPG_START) / (wGames + RUSH_SHRINK_GAMES),
      rawYpg: wYds / wGames,
    });
  }
  return out;
}

/** His AE Score without its rushing pieces: the passing gate's reading. */
export function passingPart(view: ScoreView, composite: AEComposite): number {
  const rush = scorePieces(view, composite.positions.QB).filter((x) => RUSHING_AE_KEYS.has(x.key)).reduce((a, x) => a + x.add, 0);
  return view.score - rush;
}

export interface RushingBonus {
  /** Before the Rushing slider. */
  value: number;
  label: string;
  ypg: number;
  /** 0–1: how much of the rushing bonus his passing lets through. */
  gate: number;
}

const smooth = (t: number) => { const x = Math.min(1, Math.max(0, t)); return x * x * (3 - 2 * x); };
const quantile = (sorted: readonly number[], p: number) => {
  const i = p * (sorted.length - 1), lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
};

/**
 * Every QB's rushing bonus: QBs with a live AE Score and rushing on file.
 * A QB who runs below the median gets none (no entry); one gated out by his
 * passing gets an entry worth 0, so the tooltip can say why.
 */
export function rushingBonuses(
  prospects: readonly { id: string; position: string }[], live: ReadonlyMap<string, ScoreView>, composite: AEComposite,
  rushing: ReadonlyMap<string, QBRushing>,
): Map<string, RushingBonus> {
  const passing = new Map<string, number>();
  for (const p of prospects) {
    const view = p.position === "QB" ? live.get(p.id) : undefined;
    if (view) passing.set(p.id, passingPart(view, composite));
  }
  const out = new Map<string, RushingBonus>();
  if (passing.size < GATE_MIN_POOL) return out;
  const sorted = [...passing.values()].sort((a, b) => a - b);
  const lowCut = quantile(sorted, 1 / 3), highCut = quantile(sorted, 2 / 3);
  for (const [id, pass] of passing) {
    const r = rushing.get(id);
    if (!r) continue;
    const ramp = Math.min(1, Math.max(0, (r.ypg - RUSH_YPG_START) / (RUSH_YPG_FULL - RUSH_YPG_START)));
    if (ramp <= 0) continue;
    const gate = highCut > lowCut ? smooth((pass - lowCut) / (highCut - lowCut)) : pass >= highCut ? 1 : 0;
    const value = RUSH_BONUS_MAX * ramp * gate;
    const span = r.seasons.length === 1 ? `${r.seasons[0]}` : `${r.seasons[0]}–${r.seasons[r.seasons.length - 1]}`;
    const third = gate >= 1 ? "top third" : gate <= 0 ? "bottom third" : "middle third";
    out.set(id, {
      value, ypg: r.ypg, gate,
      label: `${r.rawYpg.toFixed(0)} rush yds/game (${r.attempts} carries, ${(r.yards / Math.max(1, r.attempts)).toFixed(1)} Y/C, ${span}, PFF) × passing gate ${Math.round(gate * 100)}% (his passing ranks in the ${third} of charted QBs)`,
    });
  }
  return out;
}
