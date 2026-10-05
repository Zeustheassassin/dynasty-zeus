// PFF's results over the charted games as AE Score components (tape-grading
// expansion, Stage 4). Pure and client-safe.
//
// The plan (approved 2026-10-04): PFF's results go INSIDE the AE Score, not
// beside it, so the score uses everything the user has. Each is a ratio of
// PFF's per-game counts over exactly the games the user charted (never season
// totals), so it reaches old games too (backfilled, no re-charting).
// countComponents.ts turns each into a pool-relative, opponent-adjusted,
// reliability-weighted component; aeComposite.ts blends it into the position's
// score, per player (a prospect without PFF games keeps his score as it was).
//
// What's here are results, not PFF's grades: a grade is PFF's opinion of the
// player, and the AE Score is the user's. And only what the user doesn't chart
// (the user's rule, 2026-10-05: nothing may count twice). Accuracy (ADJ%) is
// AAE's; avoided tackles, 15+ yard runs, pressures allowed, drops, contested
// catches and pressure-to-sack are the user's own charted broken tackles,
// explosive runs, pass-block results, drops, contested catches and sacks
// under pressure (chartedComponents.ts). Those PFF numbers still show in the
// PFF columns; they just don't score.
//
// The weights are the user's to approve (plan: "I approve their weights"):
// a weight of 0 means the component is computed and shown in the Grading
// checks but doesn't count.
import type { ScoutingGame } from "../types";
import type { PffGameRow } from "../pff/stats";
import { currentGameRow } from "../pff/totals";
import type { CountStatDef, GameCount } from "./countComponents";

export interface PffStatDef extends CountStatDef {
  source: "pff";
  /** This game's counts, or null when PFF had none for it. */
  count: (r: PffGameRow) => { num: number; den: number } | null;
}

const ratio = (num: number | null, den: number | null) =>
  num != null && den != null && den > 0 ? { num, den } : null;

export const PFF_COMPONENTS: readonly PffStatDef[] = [
  // ── QB ──
  { key: "pff_btt", label: "BTT%", source: "pff", pos: "QB", dir: 1, scale: 100, unit: "attempts", floor: 50, suffix: "%",
    description: "Big-time throws per attempt (PFF): the hard, high-value throws, which on-target accuracy alone doesn't credit.",
    count: (r) => ratio(r.btt, r.all_attempts) },
  { key: "pff_twp", label: "TWP%", source: "pff", pos: "QB", dir: -1, scale: 100, unit: "dropbacks", floor: 50, suffix: "%",
    description: "Turnover-worthy plays per dropback (PFF), lower is better: decision-making risk that accuracy doesn't see.",
    count: (r) => ratio(r.twp, r.all_dropbacks) },
  { key: "pff_qb_ypc", label: "Rush Y/C", source: "pff", pos: "QB", dir: 1, scale: 1, unit: "carries", floor: 15, suffix: " yds/carry",
    description: "Rushing yards per carry, designed runs and scrambles (PFF): what his legs add.",
    count: (r) => ratio(r.rush_yards, r.rush_att) },
  // ── RB ──
  { key: "pff_rb_yco", label: "YCO/A", source: "pff", pos: "RB", dir: 1, scale: 1, unit: "carries", floor: 30, suffix: " yds/carry",
    description: "Yards after contact per carry (PFF): contact balance and power.",
    count: (r) => ratio(r.yco, r.rush_att) },
  { key: "pff_rb_yprr", label: "YPRR", source: "pff", pos: "RB", dir: 1, scale: 1, unit: "routes", floor: 30, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes): receiving value.",
    count: (r) => ratio(r.rec_yards, r.routes) },
  // ── WR ──
  { key: "pff_wr_yprr", label: "YPRR", source: "pff", pos: "WR", dir: 1, scale: 1, unit: "routes", floor: 50, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes): production, which open rate alone doesn't capture.",
    count: (r) => ratio(r.rec_yards, r.routes) },
  { key: "pff_wr_yac", label: "YAC/R", source: "pff", pos: "WR", dir: 1, scale: 1, unit: "catches", floor: 15, suffix: " yds/catch",
    description: "Yards after the catch per reception (PFF).",
    count: (r) => ratio(r.yac, r.receptions) },
  // ── TE ──
  { key: "pff_te_yprr", label: "YPRR", source: "pff", pos: "TE", dir: 1, scale: 1, unit: "routes", floor: 40, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes).",
    count: (r) => ratio(r.rec_yards, r.routes) },
];

// Each component's weight in its position's score at full trust, next to the
// user's own metric(s) (QB AAE 1 · RB SRAE 1 · WR cSAE 0.7 + SAE 0.3 · TE-SAER
// 0.8 + TE-SAEB 0.2). The user's call (2026-10-05): the "heavier" set, so PFF
// fills the gaps the charting misses while the user's grading stays the
// biggest piece. Each prospect's own weight is this × his trust in the sample
// (aeComposite.ts), so today, at 4–5 charted games, PFF and the charted
// components together are a median ~25% of a QB or RB score and ~17% of a WR's.
export const PFF_COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  pff_btt: 0.4, pff_twp: 0.4, pff_qb_ypc: 0.3,
  pff_rb_yco: 0.3, pff_rb_yprr: 0.2,
  pff_wr_yprr: 0.5, pff_wr_yac: 0.2,
  pff_te_yprr: 0.5,
};

/** Each PFF component's per-game counts: charted games still linked to the PFF game their row is for. */
export function pffGameCounts(
  def: PffStatDef,
  games: readonly Pick<ScoutingGame, "id" | "prospect_id" | "pff_game_id" | "pff_match_status">[],
  rows: readonly PffGameRow[],
  positionOf: (prospectId: string) => string | undefined,
): GameCount[] {
  const byGame = new Map(rows.map((r) => [r.game_id, r]));
  const out: GameCount[] = [];
  for (const g of games) {
    if (positionOf(g.prospect_id) !== def.pos) continue;
    const row = currentGameRow(g, byGame.get(g.id));
    if (!row) continue;
    const c = def.count(row);
    if (c) out.push({ prospectId: g.prospect_id, gameId: g.id, ...c });
  }
  return out;
}
