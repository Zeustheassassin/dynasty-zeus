// Every prospect's role buckets, one map for the screens (Big Board, Analysis,
// Compare). WR's arrive on the prospect (ProspectWithStats.role_fit, built
// from the per-game route cells in aggregateMerge.ts); RB / QB / TE are
// computed from their plays here.
import type { Prospect, QBPlay, RBPlay, ScoutingGame, TEPlay } from "../types";
import type { RoleFit } from "./roleFit";
import { computeRBRoleFits } from "./roleFitRB";
import { computeQBRoleFits } from "./roleFitQB";
import { computeTERoleFits } from "./roleFitTE";

export function computeRoleFits(
  prospects: readonly (Prospect & { role_fit?: RoleFit | null })[],
  games: ScoutingGame[],
  rbPlays: RBPlay[],
  qbPlays: QBPlay[],
  tePlays: TEPlay[],
): Map<string, RoleFit> {
  const list = [...prospects];
  const out = new Map<string, RoleFit>();
  for (const p of list) if (p.position === "WR" && p.role_fit) out.set(p.id, p.role_fit);
  for (const m of [computeRBRoleFits(list, games, rbPlays), computeQBRoleFits(list, games, qbPlays), computeTERoleFits(list, games, tePlays)]) {
    for (const [id, fit] of m) if (fit) out.set(id, fit);
  }
  return out;
}
