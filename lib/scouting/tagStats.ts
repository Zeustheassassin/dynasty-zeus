// The tag-only stats (tape-grading expansion, Stage 4). Pure.
//
// Numbers that exist only on plays charted with the per-play tags (Stage 3),
// so they read "—" for anyone charted before the tags and never touch an old
// game. Each shows its own sample: the tagged plays the tag applies to (a
// tag is NULL on a tagged play it didn't apply to, so the denominator is the
// tagged plays where the column is non-null; see the Stage 3 write rules in
// playTags.ts):
//
//   QB  rushing success (designed runs + scrambles) · release early / on time /
//       late (throws) · better option missed (dropbacks, sacks and scrambles
//       included) · sack fault QB / line / coverage (sacks)
//   RB  missed read (carries) · pass-pro loss wrong man vs beaten (failed pass
//       blocks: the reason for a loss, not a loss rate) · broken tackle after
//       the catch (catches). Caught from behind was dropped 2026-10-07 with
//       the Explosive button it hung off; PFF's 15+ of 10+ runs reads long
//       speed instead (pffComponents.ts).
//   WR  release vs press win rate (press routes) · broken tackle after the
//       catch (catches)
//   TE  release vs press win rate (press routes) · chip rate (routes)
//
// The quality ones (TAG_COMPONENTS) can also join the AE Score as per-player
// components (aeComposite.ts), through the same pipeline as PFF's results
// (countComponents.ts). They count only for players who have them, weighted
// by trust, so an old-only player isn't moved at all. Their weights are the
// user's to approve, like PFF's.
//
// Garbage-time plays count at the position's GARBAGE_TIME_WEIGHT
// (tagCorrection.ts), the same weight as in its AE; 1 until the garbage-time
// test says otherwise.
import type { QBPlay, RBPlay, TEPlay, ScoutingGame } from "../types";
import type { CountStatDef, GameCount } from "./countComponents";
import { GARBAGE_TIME_WEIGHT, type CorrectionKey } from "./tagCorrection";
import { parseTagCells, type ProspectGameRouteTagCellsRow, type RouteTagCell } from "./aggregateMerge";
import type { TagPosition } from "./playEra";

const POS_KEY: Record<TagPosition, CorrectionKey> = { QB: "qb_aae", RB: "rb_srae", WR: "wr_sae", TE: "te_saer" };

/** One tagged play's (or WR cell's) part in a stat: n plays, `hits` of them hits. */
interface Rep { gameId: string; n: number; hits: number; garbage: boolean }

/** A tag stat: which plays it counts and what's a hit. */
export interface TagStatDef {
  key: string;
  label: string;
  pos: TagPosition;
  /** What the denominator counts, e.g. "runs". */
  unit: string;
  description: string;
  /** 1 = higher is better, -1 = lower is better, 0 = describes only. */
  dir: 1 | -1 | 0;
}

type Extract<T> = (row: T) => { n: number; hits: number } | null;
const bool = <T>(col: keyof T, hit: (v: unknown) => boolean = (v) => v === true): Extract<T> =>
  (row) => { const v = row[col]; return v == null ? null : { n: 1, hits: hit(v) ? 1 : 0 }; };

interface PlayStat<T> extends TagStatDef { of: Extract<T> }

const QB_STATS: PlayStat<QBPlay>[] = [
  { key: "tag_qb_run_succ", label: "Run Succ%", pos: "QB", unit: "runs", dir: 1, description: "Run result marked Success, on designed runs and scrambles (tagged).", of: bool("run_success") },
  { key: "tag_qb_late", label: "Late%", pos: "QB", unit: "throws", dir: -1, description: "Throws released late (tagged throws).", of: bool("release_timing", (v) => v === "late") },
  { key: "tag_qb_early", label: "Early%", pos: "QB", unit: "throws", dir: 0, description: "Throws released early, with anticipation (tagged throws).", of: bool("release_timing", (v) => v === "early") },
  { key: "tag_qb_better", label: "BetterOpt%", pos: "QB", unit: "dropbacks", dir: -1, description: "Dropbacks where a better option was missed (tagged dropbacks, sacks and scrambles included).", of: bool("better_option_missed") },
  { key: "tag_qb_sack_qb", label: "Sack: QB%", pos: "QB", unit: "sacks", dir: 0, description: "Share of sacks that were the QB's fault (tagged sacks).", of: bool("sack_fault", (v) => v === "qb") },
  { key: "tag_qb_sack_line", label: "Sack: Line%", pos: "QB", unit: "sacks", dir: 0, description: "Share of sacks that were the line's fault (tagged sacks).", of: bool("sack_fault", (v) => v === "line") },
  // QB-fault sacks per dropback. Shown, not scored: the charted sacks per
  // pressured dropback (chartedComponents.ts) already score sacks on every
  // game, and the user's rule is that nothing counts twice.
  { key: "tag_qb_qbsack", label: "QB Sack%", pos: "QB", unit: "dropbacks", dir: 0, description: "Sacks the QB caused, per tagged dropback.",
    of: (pl) => (pl.better_option_missed == null ? null : { n: 1, hits: pl.sack_fault === "qb" ? 1 : 0 }) },
];

const RB_STATS: PlayStat<RBPlay>[] = [
  { key: "tag_rb_missed_read", label: "MissRead%", pos: "RB", unit: "carries", dir: -1, description: "Carries with a missed read (tagged carries).", of: bool("missed_read") },
  { key: "tag_rb_hbl", label: "HitBehind%", pos: "RB", unit: "carries", dir: 0, description: "Carries where he was hit behind the line (tagged carries): a difficulty tag, shown for context.", of: bool("hit_behind_line") },
  { key: "tag_rb_pp_wrong", label: "PP: Wrong man%", pos: "RB", unit: "pass-pro losses", dir: 0, description: "Of his failed pass blocks, the share where he picked up the wrong man (the rest: beaten). The loss rate itself is PB% in Blocking.", of: bool("pass_pro_loss", (v) => v === "wrong_man") },
  { key: "tag_rb_btac", label: "BTAC%", pos: "RB", unit: "catches", dir: 1, description: "Catches with a broken tackle after the catch (tagged).", of: bool("broken_tackle_after_catch") },
];

const TE_STATS: PlayStat<TEPlay>[] = [
  { key: "tag_te_press", label: "Press Win%", pos: "TE", unit: "press routes", dir: 1, description: "Release won vs press (tagged press routes).", of: bool("press_release", (v) => v === "won") },
  { key: "tag_te_chip", label: "Chip%", pos: "TE", unit: "routes", dir: 0, description: "Routes where he chipped before releasing (tagged routes): usage.", of: bool("chipped_before_route") },
];

interface CellStat extends TagStatDef { of: (c: RouteTagCell) => { n: number; hits: number } | null }
const WR_STATS: CellStat[] = [
  { key: "tag_wr_press", label: "Press Win%", pos: "WR", unit: "press routes", dir: 1, description: "Release won vs press (tagged press routes).",
    of: (c) => (c.press_release == null ? null : { n: c.n, hits: c.press_release === "won" ? c.n : 0 }) },
  { key: "tag_wr_btac", label: "BTAC%", pos: "WR", unit: "catches", dir: 1, description: "Catches with a broken tackle after the catch (tagged).",
    of: (c) => (c.bt_after_catch == null ? null : { n: c.n, hits: c.bt_after_catch ? c.n : 0 }) },
];

export const TAG_STATS: Record<TagPosition, readonly TagStatDef[]> = { QB: QB_STATS, RB: RB_STATS, WR: WR_STATS, TE: TE_STATS };

// Minimum reps before a tag stat is shown (and, as a component, has a sample).
export const TAG_STAT_FLOOR = 10;

/** One prospect's value for a tag stat: rate (0–100) over n tagged reps (garbage time weighted). */
export interface TagStatValue { rate: number | null; n: number }

// Every rep of a stat, by prospect.
type RepsByProspect = Map<string, Rep[]>;

function repsFromPlays<T extends { game_id: string; garbage_time?: boolean | null }>(
  plays: readonly T[], of: Extract<T>, gameToProspect: ReadonlyMap<string, string>,
): RepsByProspect {
  const out: RepsByProspect = new Map();
  for (const pl of plays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    const r = of(pl);
    if (!r) continue;
    const list = out.get(pid);
    const rep = { gameId: pl.game_id, ...r, garbage: pl.garbage_time === true };
    if (list) list.push(rep); else out.set(pid, [rep]);
  }
  return out;
}

function repsFromCells(rows: readonly ProspectGameRouteTagCellsRow[], of: CellStat["of"]): RepsByProspect {
  const out: RepsByProspect = new Map();
  for (const row of rows) {
    for (const c of parseTagCells(row.cells)) {
      const r = of(c);
      if (!r) continue;
      const list = out.get(row.prospect_id);
      const rep = { gameId: row.game_id, ...r, garbage: c.garbage_time === true };
      if (list) list.push(rep); else out.set(row.prospect_id, [rep]);
    }
  }
  return out;
}

export interface TagStatInputs {
  games: readonly Pick<ScoutingGame, "id" | "prospect_id">[];
  qbPlays: readonly QBPlay[];
  rbPlays: readonly RBPlay[];
  tePlays: readonly TEPlay[];
  /** prospect_game_route_tag_cells (migration 064); empty before it's applied. */
  wrTagRows: readonly ProspectGameRouteTagCellsRow[];
}

/** Every tag stat's reps by prospect. */
export function tagStatReps(inp: TagStatInputs): Map<string, RepsByProspect> {
  const g2p = new Map(inp.games.map((g) => [g.id, g.prospect_id]));
  const out = new Map<string, RepsByProspect>();
  for (const s of QB_STATS) out.set(s.key, repsFromPlays(inp.qbPlays, s.of, g2p));
  for (const s of RB_STATS) out.set(s.key, repsFromPlays(inp.rbPlays, s.of, g2p));
  for (const s of TE_STATS) out.set(s.key, repsFromPlays(inp.tePlays, s.of, g2p));
  for (const s of WR_STATS) out.set(s.key, repsFromCells(inp.wrTagRows, s.of));
  return out;
}

const statPos = new Map<string, TagPosition>(Object.values(TAG_STATS).flat().map((s) => [s.key, s.pos]));
const gtWeight = (key: string) => GARBAGE_TIME_WEIGHT[POS_KEY[statPos.get(key) ?? "QB"]];

/** prospect → stat key → value. A stat under TAG_STAT_FLOOR reps reads rate null. */
export function tagStatValues(reps: Map<string, RepsByProspect>): Map<string, Record<string, TagStatValue>> {
  const out = new Map<string, Record<string, TagStatValue>>();
  for (const [key, byProspect] of reps) {
    const gt = gtWeight(key);
    for (const [pid, list] of byProspect) {
      let n = 0, w = 0, hits = 0;
      for (const r of list) {
        const k = r.garbage ? gt : 1;
        n += r.n; w += k * r.n; hits += k * r.hits;
      }
      const rec = out.get(pid) ?? {};
      rec[key] = { rate: n >= TAG_STAT_FLOOR && w > 0 ? (hits / w) * 100 : null, n };
      out.set(pid, rec);
    }
  }
  return out;
}

// ── As AE Score components ───────────────────────────────────────────────
// The quality stats, as count-ratio components (countComponents.ts). Floors
// match TAG_STAT_FLOOR; weights wait for the user (TAG_COMPONENT_WEIGHTS).
export const TAG_COMPONENTS: readonly CountStatDef[] = Object.values(TAG_STATS).flat()
  .filter((s) => s.dir !== 0)
  .map((s) => ({
    key: s.key, label: s.label, source: "tag" as const, pos: s.pos, dir: s.dir as 1 | -1, scale: 100,
    unit: `tagged ${s.unit}`, floor: TAG_STAT_FLOOR, suffix: "%", description: s.description,
  }));

// Weights at full trust, approved by the user 2026-10-05 before any tagged
// data existed. Each joins on its own once MIN_POOL prospects have a sample,
// and each prospect's weight is this × his trust, so one tagged game barely
// moves him and an old-only player not at all.
export const TAG_COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  tag_qb_run_succ: 0.1, tag_qb_late: 0.05, tag_qb_better: 0.1,
  tag_rb_missed_read: 0.1, tag_rb_btac: 0.05,
  tag_wr_press: 0.15, tag_wr_btac: 0.05,
  tag_te_press: 0.1,
};

/** A tag component's per-game counts (garbage time weighted). */
export function tagGameCounts(key: string, reps: Map<string, RepsByProspect>): GameCount[] {
  const byProspect = reps.get(key);
  if (!byProspect) return [];
  const gt = gtWeight(key);
  const acc = new Map<string, GameCount>();
  for (const [pid, list] of byProspect) {
    for (const r of list) {
      const k = r.garbage ? gt : 1;
      const id = `${pid}|${r.gameId}`;
      const c = acc.get(id) ?? { prospectId: pid, gameId: r.gameId, num: 0, den: 0 };
      c.num += k * r.hits; c.den += k * r.n;
      acc.set(id, c);
    }
  }
  return [...acc.values()];
}
