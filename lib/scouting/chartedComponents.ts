// The user's own charting that no AE uses yet, as AE Score components
// (tape-grading expansion, Stage 4). Pure.
//
// The user's rule (2026-10-05): the AE Score should be the clearest picture of
// a prospect, using every piece of information, as long as nothing counts
// twice. So each skill comes from ONE source, the user's charting first and
// PFF only where the user doesn't chart (pffComponents.ts). These are skills
// the user charts by hand that no Above-Expected metric reads:
//
//   QB  sacks taken under pressure (pocket management; AAE leaves sacks out)
//       · reads (past his 1st read) · throw difficulty (how hard his throws
//       were; AAE grades the accuracy on them, not how hard they were)
//   RB  pass protection · hands (drops per target) · getting open on routes
//   WR  hands (drops per catchable target; SAE reads getting open, not the
//       catch)
//
// PFF's versions of the same skills (pressures allowed, drops,
// pressure-to-sack) stay out of the score, so a skill isn't counted twice;
// they still show in the PFF columns. RB broken tackles and explosive runs
// used to be here too; since 2026-10-07 PFF's missed tackles and 10+ yard
// runs score them instead (pffComponents.ts) and the RB board no longer
// charts them (rb_plays.broken_tackle / explosive_play stay on old plays,
// unread). WR contested catches (CC%) went the same way on 2026-11-10: PFF's
// contested catch rate scores them and the WR board's Contested button is
// gone (route_plays.contested and the imported summary_contested counts stay
// on old games, shown only where PFF has nothing). These rates exist on every charted game, old ones included (no
// re-charting), and go through the same pipeline as PFF's results
// (countComponents.ts): season-weighted, pool-relative, opponent-adjusted,
// weighted by reliability, per player.
import type { QBPlay, RBPlay, ScoutingGame } from "../types";
import type { CountStatDef, GameCount } from "./countComponents";
import { qbThrowDifficulty } from "./aboveExpected";

/** prospect_game_route_counts (migration 064): a WR game's charted receiving counts. */
export interface ProspectGameRouteCountsRow {
  prospect_id: string;
  game_id: string;
  routes: number;
  targets: number;
  catches: number;
  drops: number;
}

interface PlayCountDef<T> extends CountStatDef {
  source: "charted";
  /** The play's part: counts toward the denominator (n) and how many hits. */
  of: (pl: T) => { n: number; hits: number } | null;
}

const one = (hit: boolean) => ({ n: 1, hits: hit ? 1 : 0 });

// The throws a read is charted on: 1st option, 2nd option or checkdown.
// Extended plays are off script, not a read (the user, 2026-11-10: the
// "make it happen" QB and the 2nd / 3rd read QB are different players), and
// scrambles, sacks and throwaways have no read.
const READ_TIMINGS: ReadonlySet<string> = new Set(["first_option", "second_option", "checkdown"]);

export const QB_CHARTED: readonly PlayCountDef<QBPlay>[] = [
  { key: "ch_qb_p2s", label: "Sk% pressured", source: "charted", pos: "QB", dir: -1, scale: 100, unit: "pressured dropbacks", floor: 20, suffix: "%",
    description: "Sacks taken per pressured dropback, from your charting (pressure + sack): pocket management, which AAE leaves out.",
    of: (pl) => (pl.play_type !== "run" && pl.pressure != null && pl.pressure !== "clean" ? one(pl.timing === "sack") : null) },
  // The user's call (2026-11-10): working the progression counts. Measured
  // first on 26 QBs: a real difference between QBs (~58% signal at ~63
  // throws), and it agrees with PFF's time to throw (r 0.46) and share of
  // dropbacks held 2.5s+ (r 0.61). It can't tell a covered first read from a
  // QB working through his reads; the user accepted that. RPO throws count as
  // first-read throws, so an RPO-heavy QB reads lower.
  { key: "ch_qb_reads", label: "Past 1st read%", source: "charted", pos: "QB", dir: 1, scale: 100, unit: "throws", floor: 25, suffix: "%",
    description: "Throws past his first read (2nd option or checkdown) per throw from a read, from your charting: working the progression. Extended plays, scrambles, sacks and throwaways have no read, so they don't count.",
    of: (pl) => (pl.play_type !== "run" && pl.timing != null && READ_TIMINGS.has(pl.timing) ? one(pl.timing !== "first_option") : null) },
];

/**
 * How hard his graded throws were (aboveExpected.ts qbThrowDifficulty), in
 * points of expected throw value below the league's average throw: credit
 * for being asked to make hard throws, beside AAE's accuracy on them. Each
 * game's count is the sum of its throws' difficulty, so the rate is his
 * average, and the pooled game-to-game scatter sets its noise like any rate.
 */
export const QB_DIFFICULTY: CountStatDef = {
  key: "ch_qb_diff", label: "Throw difficulty", source: "charted", pos: "QB", dir: 1, scale: 100, unit: "graded throws", floor: 25, suffix: " pts",
  description: "How much harder his graded throws were than the league's average throw (AAE's difficulty model: depth, coverage, timing, pressure, platform, route), from your charting. A hard-throw game lands below AAE's expected (~0.46 pts per point here), so this evens it out.",
};

export const RB_CHARTED: readonly PlayCountDef<RBPlay>[] = [
  { key: "ch_rb_pb", label: "PB%", source: "charted", pos: "RB", dir: 1, scale: 100, unit: "pass blocks", floor: 15, suffix: "%",
    description: "Pass blocks won, from your charting.",
    of: (pl) => (pl.run_type === "pass_block" && pl.success !== null ? one(pl.success === true) : null) },
  { key: "ch_rb_drop", label: "Drop%", source: "charted", pos: "RB", dir: -1, scale: 100, unit: "targets", floor: 8, suffix: "%",
    description: "Drops per target, from your charting (an uncatchable ball isn't a drop).",
    of: (pl) => (pl.run_type === "route" && pl.targeted ? one(pl.success === false) : null) },
  { key: "ch_rb_open", label: "Open%", source: "charted", pos: "RB", dir: 1, scale: 100, unit: "routes", floor: 15, suffix: "%",
    description: "Routes where he got open, from your charting.",
    of: (pl) => (pl.run_type === "route" && pl.was_open !== null ? one(pl.was_open === true) : null) },
];

interface RouteCountDef extends CountStatDef {
  source: "charted";
  of: (r: ProspectGameRouteCountsRow) => { num: number; den: number } | null;
}
export const WR_CHARTED: readonly RouteCountDef[] = [
  { key: "ch_wr_drop", label: "Drop%", source: "charted", pos: "WR", dir: -1, scale: 100, unit: "catchable targets", floor: 15, suffix: "%",
    description: "Drops per catchable target (catches + drops), from your charting.",
    of: (r) => (r.catches + r.drops > 0 ? { num: r.drops, den: r.catches + r.drops } : null) },
];

export const CHARTED_COMPONENTS: readonly CountStatDef[] = [...QB_CHARTED, QB_DIFFICULTY, ...RB_CHARTED, ...WR_CHARTED];

function fromPlays<T extends { game_id: string }>(
  plays: readonly T[], of: (pl: T) => { n: number; hits: number } | null, gameToProspect: ReadonlyMap<string, string>,
): GameCount[] {
  const acc = new Map<string, GameCount>();
  for (const pl of plays) {
    const pid = gameToProspect.get(pl.game_id);
    if (!pid) continue;
    const r = of(pl);
    if (!r) continue;
    const c = acc.get(pl.game_id) ?? { prospectId: pid, gameId: pl.game_id, num: 0, den: 0 };
    c.num += r.hits; c.den += r.n;
    acc.set(pl.game_id, c);
  }
  return [...acc.values()];
}

export interface ChartedInputs {
  games: readonly Pick<ScoutingGame, "id" | "prospect_id">[];
  qbPlays: readonly QBPlay[];
  rbPlays: readonly RBPlay[];
  /** prospect_game_route_counts (migration 064); empty before it's applied. */
  wrRouteCounts: readonly ProspectGameRouteCountsRow[];
  /** Each graded throw's difficulty (qbThrowDifficulty); fit from qbPlays when absent. */
  qbDifficulty?: ReadonlyMap<string, number>;
}

/** A charted component's per-game counts. */
export function chartedGameCounts(key: string, inp: ChartedInputs): GameCount[] {
  const g2p = new Map(inp.games.map((g) => [g.id, g.prospect_id]));
  if (key === QB_DIFFICULTY.key) {
    const diff = inp.qbDifficulty ?? qbThrowDifficulty(inp.qbPlays);
    return fromPlays(inp.qbPlays, (pl) => {
      const d = diff.get(pl.id);
      return d == null ? null : { n: 1, hits: d };
    }, g2p);
  }
  const qb = QB_CHARTED.find((d) => d.key === key);
  if (qb) return fromPlays(inp.qbPlays, qb.of, g2p);
  const rb = RB_CHARTED.find((d) => d.key === key);
  if (rb) return fromPlays(inp.rbPlays, rb.of, g2p);
  const wr = WR_CHARTED.find((d) => d.key === key);
  if (!wr) return [];
  const out: GameCount[] = [];
  for (const r of inp.wrRouteCounts) {
    const c = wr.of(r);
    if (c) out.push({ prospectId: r.prospect_id, gameId: r.game_id, ...c });
  }
  return out;
}

// Weights at full trust, next to the user's own AE(s) (= 1 per position); the
// user's call (2026-10-05, the "heavier" set; see pffComponents.ts).
// QB reads and throw difficulty, 0.2 each: the user's picks (2026-11-10).
export const CHARTED_COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  ch_qb_p2s: 0.2, ch_qb_reads: 0.2, ch_qb_diff: 0.2,
  ch_rb_pb: 0.15, ch_rb_drop: 0.1, ch_rb_open: 0.1,
  ch_wr_drop: 0.2,
};
