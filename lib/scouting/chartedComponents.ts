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
//   RB  broken tackles · explosive runs (SRAE reads success only) · pass
//       protection · hands (drops per target) · getting open on routes
//   WR  hands (drops per catchable target) · contested catches (SAE reads
//       getting open, not the catch)
//
// PFF's versions of the same skills (avoided tackles, 15+ yard runs,
// pressures allowed, drops, contested catches, pressure-to-sack) stay out of
// the score, so a skill isn't counted twice; they still show in the PFF
// columns. These rates exist on every charted game, old ones included (no
// re-charting), and go through the same pipeline as PFF's results
// (countComponents.ts): season-weighted, pool-relative, opponent-adjusted,
// weighted by reliability, per player.
import type { QBPlay, RBPlay, ScoutingGame } from "../types";
import type { CountStatDef, GameCount } from "./countComponents";

/** prospect_game_route_counts (migration 064): a WR game's charted receiving counts. */
export interface ProspectGameRouteCountsRow {
  prospect_id: string;
  game_id: string;
  routes: number;
  targets: number;
  catches: number;
  drops: number;
  contested: number;
  contested_catches: number;
}

interface PlayCountDef<T> extends CountStatDef {
  source: "charted";
  /** The play's part: counts toward the denominator (n) and how many hits. */
  of: (pl: T) => { n: number; hits: number } | null;
}

const RB_RUN_TYPES = new Set(["outside_zone", "inside_zone", "outside_man_gap", "inside_man_gap"]);
const isKnownRun = (pl: RBPlay) => RB_RUN_TYPES.has(pl.run_type) && pl.success !== null;
const one = (hit: boolean) => ({ n: 1, hits: hit ? 1 : 0 });

export const QB_CHARTED: readonly PlayCountDef<QBPlay>[] = [
  { key: "ch_qb_p2s", label: "Sk% pressured", source: "charted", pos: "QB", dir: -1, scale: 100, unit: "pressured dropbacks", floor: 20, suffix: "%",
    description: "Sacks taken per pressured dropback, from your charting (pressure + sack): pocket management, which AAE leaves out.",
    of: (pl) => (pl.play_type !== "run" && pl.pressure != null && pl.pressure !== "clean" ? one(pl.timing === "sack") : null) },
];

export const RB_CHARTED: readonly PlayCountDef<RBPlay>[] = [
  { key: "ch_rb_btk", label: "BTkl%", source: "charted", pos: "RB", dir: 1, scale: 100, unit: "runs", floor: 30, suffix: "%",
    description: "Runs with a broken tackle, from your charting.",
    of: (pl) => (isKnownRun(pl) ? one(pl.broken_tackle) : null) },
  { key: "ch_rb_expl", label: "Expl%", source: "charted", pos: "RB", dir: 1, scale: 100, unit: "runs", floor: 30, suffix: "%",
    description: "Explosive runs, from your charting.",
    of: (pl) => (isKnownRun(pl) ? one(pl.explosive_play) : null) },
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
  { key: "ch_wr_cc", label: "CC%", source: "charted", pos: "WR", dir: 1, scale: 100, unit: "contested targets", floor: 5, suffix: "%",
    description: "Contested catches per contested target, from your charting.",
    of: (r) => (r.contested > 0 ? { num: r.contested_catches, den: r.contested } : null) },
];

export const CHARTED_COMPONENTS: readonly CountStatDef[] = [...QB_CHARTED, ...RB_CHARTED, ...WR_CHARTED];

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
}

/** A charted component's per-game counts. */
export function chartedGameCounts(key: string, inp: ChartedInputs): GameCount[] {
  const g2p = new Map(inp.games.map((g) => [g.id, g.prospect_id]));
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
export const CHARTED_COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  ch_qb_p2s: 0.2,
  ch_rb_btk: 0.3, ch_rb_expl: 0.2, ch_rb_pb: 0.15, ch_rb_drop: 0.1, ch_rb_open: 0.1,
  ch_wr_drop: 0.2, ch_wr_cc: 0.1,
};
