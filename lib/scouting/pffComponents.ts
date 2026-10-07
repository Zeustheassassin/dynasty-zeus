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
// AAE's; pressures allowed, drops, contested catches and pressure-to-sack are
// the user's own charted pass-block results, drops, contested catches and
// sacks under pressure (chartedComponents.ts). Those PFF numbers still show in
// the PFF columns; they just don't score.
//
// RB missed tackles and 10+ yard runs went the other way (the user,
// 2026-10-07): PFF's counts replaced the charted Broken Tackle and Explosive
// Play buttons, which were results, not difficulty (SRAE never read them).
// Checked first on 108 charted games: PFF's 10+ runs matched the charted
// explosives almost exactly (282 vs 284; r = 0.97 per back), missed tackles
// only moderately (r = 0.43 per back: PFF counts every missed tackle, the
// button was yes / no per carry). The caught-from-behind tag went with them;
// long speed now reads PFF's 15+ runs as a share of his 10+ runs, so it adds
// to the 10+ rate rather than counting the same runs twice. Fumbles are built
// at every position (the user doesn't chart them; PFF's TWP doesn't hold most
// QB fumbles: 9 of the 27 QB games with one had no TWP at all) and score for
// RBs and QBs (weights below).
//
// The weights are the user's to approve (plan: "I approve their weights"):
// a weight of 0 means the component is computed and shown in the Grading
// checks but doesn't count.
import type { ScoutingGame } from "../types";
import type { PffGameRow } from "../pff/stats";
import { currentGameRow, touchesOf } from "../pff/totals";
import type { CountStatDef, GameCount } from "./countComponents";

export interface PffStatDef extends CountStatDef {
  source: "pff";
  /** This game's counts, or null when PFF had none for it. */
  count: (r: PffGameRow) => { num: number; den: number } | null;
}

const ratio = (num: number | null, den: number | null) =>
  num != null && den != null && den > 0 ? { num, den } : null;

/**
 * Fumbles per touch at one position (ball security; see touchesOf). Added on
 * top of the AE Score, not averaged in (the user, 2026-10-07: a low rate is
 * rewarded, a high one penalized, an average one changes nothing).
 */
const fumbles = (pos: PffStatDef["pos"], floor: number): PffStatDef => ({
  key: `pff_${pos.toLowerCase()}_fum`, label: "Fum%", source: "pff", pos, dir: -1, scale: 100, unit: "touches", floor, suffix: "%",
  description: "Fumbles per touch (PFF; dropbacks, designed runs and catches), lower is better: ball security, which nothing charted measures. Added on top of the score: 0 at the pool's rate.",
  additive: true,
  count: (r) => ratio(r.fumbles, touchesOf(r)),
});

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
  // 40 touches ≈ one game of dropbacks and runs; trust does the rest.
  fumbles("QB", 40),
  // ── RB ──
  { key: "pff_rb_yco", label: "YCO/A", source: "pff", pos: "RB", dir: 1, scale: 1, unit: "carries", floor: 30, suffix: " yds/carry",
    description: "Yards after contact per carry (PFF): contact balance and power.",
    count: (r) => ratio(r.yco, r.rush_att) },
  { key: "pff_rb_mtf", label: "MTF/A", source: "pff", pos: "RB", dir: 1, scale: 1, unit: "carries", floor: 30, suffix: " per carry",
    description: "Missed tackles forced per carry (PFF avoided tackles as a runner): making tacklers miss.",
    count: (r) => ratio(r.rush_mtf, r.rush_att) },
  { key: "pff_rb_10p", label: "10+%", source: "pff", pos: "RB", dir: 1, scale: 100, unit: "carries", floor: 30, suffix: "%",
    description: "Carries of 10+ yards (PFF explosive runs): big-play ability.",
    count: (r) => ratio(r.rush_10plus, r.rush_att) },
  { key: "pff_rb_15of10", label: "15+ of 10+", source: "pff", pos: "RB", dir: 1, scale: 100, unit: "10+ yard runs", floor: 5, suffix: "%",
    description: "Of his 10+ yard runs, the share that went 15+ (PFF): long speed, finishing the big run instead of getting caught.",
    count: (r) => ratio(r.rush_15plus, r.rush_10plus) },
  { key: "pff_rb_yprr", label: "YPRR", source: "pff", pos: "RB", dir: 1, scale: 1, unit: "routes", floor: 30, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes): receiving value.",
    count: (r) => ratio(r.rec_yards, r.routes) },
  fumbles("RB", 30),
  // ── WR ──
  { key: "pff_wr_yprr", label: "YPRR", source: "pff", pos: "WR", dir: 1, scale: 1, unit: "routes", floor: 50, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes): production, which open rate alone doesn't capture.",
    count: (r) => ratio(r.rec_yards, r.routes) },
  { key: "pff_wr_yac", label: "YAC/R", source: "pff", pos: "WR", dir: 1, scale: 1, unit: "catches", floor: 15, suffix: " yds/catch",
    description: "Yards after the catch per reception (PFF).",
    count: (r) => ratio(r.yac, r.receptions) },
  fumbles("WR", 20),
  // ── TE ──
  { key: "pff_te_yprr", label: "YPRR", source: "pff", pos: "TE", dir: 1, scale: 1, unit: "routes", floor: 40, suffix: " yds/route",
    description: "Receiving yards per route run (PFF yards ÷ PFF routes).",
    count: (r) => ratio(r.rec_yards, r.routes) },
  fumbles("TE", 10),
];

// Each component's weight in its position's score at full trust, next to the
// user's own metric(s) (QB AAE 1 · RB SRAE 1 · WR cSAE 0.7 + SAE 0.3 · TE-SAER
// 0.8 + TE-SAEB 0.2). The user's call (2026-10-05): the "heavier" set, so PFF
// fills the gaps the charting misses while the user's grading stays the
// biggest piece. Each prospect's own weight is this × his trust in the sample
// (aeComposite.ts), so today, at 4–5 charted games, PFF and the charted
// components together are a median ~25% of a QB or RB score and ~17% of a WR's.
// RB MTF/A and 10+% took over the charted broken tackles' 0.3 and explosives'
// 0.2, and 15+ of 10+ the caught-from-behind tag's 0.05 (2026-10-07).
// Fumbles, the user's call (2026-10-07): they matter most for a back (0.2),
// a little for a QB (0.05), and are only a data point for WR / TE (0: shown,
// not scored). Fumbles are `additive`: weight × z on top of the score, so a
// back at the pool's fumble rate gets exactly 0, one below it gains and one
// above it loses, more so the more touches behind it (z carries the trust).
export const PFF_COMPONENT_WEIGHTS: Readonly<Record<string, number>> = {
  pff_btt: 0.4, pff_twp: 0.4, pff_qb_ypc: 0.3, pff_qb_fum: 0.05,
  pff_rb_yco: 0.3, pff_rb_mtf: 0.3, pff_rb_10p: 0.2, pff_rb_15of10: 0.05, pff_rb_yprr: 0.2, pff_rb_fum: 0.2,
  pff_wr_yprr: 0.5, pff_wr_yac: 0.2, pff_wr_fum: 0,
  pff_te_yprr: 0.5, pff_te_fum: 0,
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
